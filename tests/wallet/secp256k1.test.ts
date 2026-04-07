/**
 * secp256k1 / Ethereum address derivation and ECDSA (native or WASM tier).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  deriveEthereumAddress,
  derivePublicKey,
  signEcdsa,
  verifyEcdsa,
  keccak256Digest,
  getActiveTier,
} from '../../src/native/index.js';
import { importWallet, signMessage } from '../../src/wallet/crypto.js';

const HARDHAT_0_SK =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const HARDHAT_0_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

describe('secp256k1 / Ethereum wallet', () => {
  it('derives Hardhat account #0 address from private key', () => {
    const priv = Buffer.from(HARDHAT_0_SK.replace(/^0x/i, ''), 'hex');
    const addr = deriveEthereumAddress(priv);
    expect(
      addr,
      `secp256k1 address derivation requires Tier 1 or 2 (got ${getActiveTier()})`,
    ).not.toBeNull();
    expect(addr!.toLowerCase()).toBe(HARDHAT_0_ADDR.toLowerCase());
  });

  it('signs Keccak-256(message) and verifies with derived public key', () => {
    const priv = Buffer.from(HARDHAT_0_SK.replace(/^0x/i, ''), 'hex');
    const pub = derivePublicKey(priv);
    expect(pub).not.toBeNull();
    const message = 'clawpowers secp256k1 sanity';
    const hash = keccak256Digest(Buffer.from(message, 'utf8'));
    expect(hash).not.toBeNull();
    expect(hash!.length).toBe(32);
    const sig = signEcdsa(priv, hash!);
    expect(sig).not.toBeNull();
    expect(sig!.length).toBe(65);
    expect(verifyEcdsa(pub!, hash!, sig!)).toBe(true);
  });

  describe('importWallet address parity', () => {
    let dir: string;
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'cp-wallet-secp-'));
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('imported wallet matches Hardhat address; second import matches first', async () => {
      const a = await importWallet(HARDHAT_0_SK, { dataDir: dir, chain: 'local' });
      expect(a.address.toLowerCase()).toBe(HARDHAT_0_ADDR.toLowerCase());
      const b = await importWallet(HARDHAT_0_SK, { dataDir: dir, chain: 'local' });
      expect(b.address.toLowerCase()).toBe(a.address.toLowerCase());
    });
  });

  it('signMessage(privateKey, message) returns 65-byte ECDSA hex signature', async () => {
    const sig = await signMessage(HARDHAT_0_SK, 'hello ecdsa');
    expect(typeof sig).toBe('string');
    expect(sig.startsWith('0x')).toBe(true);
    expect(sig.length).toBe(2 + 130);
  });
});
