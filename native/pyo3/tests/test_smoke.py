"""Smoke test for clawpowers_core PyO3 bindings.

Exercises at least one function from: wallet, tokens, fee, x402, canonical,
compression, security, and policy (8 crates).
"""

import json
import sys


def main():
    import clawpowers_core as cc

    passed = 0
    total = 0

    # ── 1. Wallet ──────────────────────────────────────────────────────────
    total += 1
    w = cc.AgentWallet.generate()
    addr = w.address()
    assert addr.startswith("0x"), f"address should start with 0x, got {addr}"
    assert len(addr) == 42, f"address should be 42 chars, got {len(addr)}"
    wid = w.wallet_id()
    assert len(wid) == 36, f"wallet_id should be UUID, got {wid}"
    sig = w.sign_message(b"hello clawpowers")
    assert len(sig) > 0, "signature should not be empty"
    passed += 1
    print(f"  ✅ wallet: address={addr[:10]}…")

    # ── 2. Wallet from private key ─────────────────────────────────────────
    total += 1
    w2 = cc.AgentWallet.from_private_key(
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    )
    assert w2.address() == "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
    passed += 1
    print(f"  ✅ wallet from_private_key: {w2.address()[:10]}…")

    # ── 3. Tokens ──────────────────────────────────────────────────────────
    total += 1
    t = cc.TokenAmount.from_human(123.456, 6)
    assert abs(t.to_human() - 123.456) < 0.001
    assert not t.is_zero()
    j = t.to_json()
    assert "raw" in j
    passed += 1
    print(f"  ✅ tokens: {t}")

    # ── 4. Token registry ──────────────────────────────────────────────────
    total += 1
    reg = json.loads(cc.default_token_registry())
    symbols = {t["symbol"] for t in reg}
    assert "USDC" in symbols
    assert "ETH" in symbols
    passed += 1
    print(f"  ✅ token registry: {len(reg)} tokens")

    # ── 5. Fee ─────────────────────────────────────────────────────────────
    total += 1
    fs = cc.FeeSchedule.with_defaults()
    calc = json.loads(fs.calculate(1000.0, 6, "transaction"))
    assert abs(calc["fee"] - 7.7) < 0.001, f"fee should be 7.7, got {calc['fee']}"
    assert abs(calc["net"] - 992.3) < 0.001
    passed += 1
    print(f"  ✅ fee: gross={calc['gross']} fee={calc['fee']} net={calc['net']}")

    # ── 6. X402 ────────────────────────────────────────────────────────────
    total += 1
    x = cc.X402Client()
    payment_json = json.dumps({
        "payment_url": "https://pay.example.com/pay",
        "amount": "1.00",
        "token": "USDC",
        "chain_id": 8453,
        "recipient": "0xrecipient",
        "memo": None,
    })
    header = x.create_payment_header(payment_json, "0xsig")
    assert "0xrecipient" in header
    assert "0xsig" in header
    passed += 1
    print(f"  ✅ x402: header={header[:40]}…")

    # ── 7. Canonical store ─────────────────────────────────────────────────
    total += 1
    store = cc.CanonicalStore.in_memory()
    record = json.dumps({
        "id": "00000000-0000-0000-0000-000000000001",
        "namespace": "test",
        "content": "hello world",
        "content_hash": cc.compute_sha256("hello world"),
        "embedding": None,
        "metadata": {},
        "created_at": "2026-03-31T00:00:00Z",
        "provenance": "smoke-test",
    })
    rid = store.insert(record)
    assert len(rid) == 36, f"insert should return UUID, got {rid}"
    fetched = store.get(rid)
    assert fetched is not None
    assert json.loads(fetched)["content"] == "hello world"
    assert store.verify_integrity(rid) is True
    passed += 1
    print(f"  ✅ canonical: inserted and verified id={rid[:8]}…")

    # ── 8. Compression ─────────────────────────────────────────────────────
    total += 1
    comp = cc.TurboCompressor(64, 8)
    vec = [float(i) / 64.0 for i in range(64)]
    compressed = comp.compress(vec)
    cdata = json.loads(compressed)
    assert len(cdata["quantized"]) == 64
    decompressed = comp.decompress(compressed)
    assert len(decompressed) == 64
    # Check roundtrip fidelity
    err = sum((a - b) ** 2 for a, b in zip(vec, decompressed)) ** 0.5
    assert err < 1.0, f"roundtrip error too high: {err}"
    passed += 1
    print(f"  ✅ compression: {len(vec)} dims → {len(cdata['quantized'])} quantized, err={err:.4f}")

    # ── 9. Security (WriteFirewall) ────────────────────────────────────────
    total += 1
    fw = cc.WriteFirewall('{"allowed_namespaces": ["agents", "test"]}')
    decision = json.loads(fw.evaluate(json.dumps({
        "namespace": "agents",
        "content": "normal content",
        "trust_level": "Agent",
        "source": "test-agent",
    })))
    assert decision == "Allow", f"expected Allow, got {decision}"
    # Test deny for unlisted namespace
    deny = json.loads(fw.evaluate(json.dumps({
        "namespace": "forbidden",
        "content": "bad",
        "trust_level": "Agent",
        "source": "test",
    })))
    assert "Deny" in str(deny), f"expected Deny, got {deny}"
    passed += 1
    print(f"  ✅ security: allow={decision}, deny works")

    # ── 10. Policy ─────────────────────────────────────────────────────────
    total += 1
    result = cc.evaluate_spending_policy(
        100.0, 6, True, 50.0,
        "0x0000000000000000000000000000000000000000"
    )
    assert result == "approve", f"expected approve, got {result}"
    # Test deny
    result2 = cc.evaluate_spending_policy(
        100.0, 6, True, 200.0,
        "0x0000000000000000000000000000000000000000"
    )
    assert result2.startswith("deny"), f"expected deny, got {result2}"
    passed += 1
    print(f"  ✅ policy: approve ok, deny ok")

    # ── 11. Utility functions ──────────────────────────────────────────────
    total += 1
    h = cc.compute_sha256("test")
    assert len(h) == 64, f"sha256 should be 64 hex chars, got {len(h)}"
    sim = cc.cosine_similarity([1.0, 0.0], [1.0, 0.0])
    assert abs(sim - 1.0) < 0.001
    dist = cc.l2_distance([0.0, 0.0], [3.0, 4.0])
    assert abs(dist - 5.0) < 0.001
    passed += 1
    print(f"  ✅ utilities: sha256, cosine_similarity, l2_distance")

    print(f"\n{'='*60}")
    print(f"  SMOKE TEST: {passed}/{total} passed")
    print(f"  Crates exercised: wallet, tokens, fee, x402, canonical,")
    print(f"    compression, security, policy (8 crates)")
    print(f"{'='*60}")

    if passed < total:
        sys.exit(1)


if __name__ == "__main__":
    main()
