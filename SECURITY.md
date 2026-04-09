# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 2.2.x   | ✅ |
| 2.1.x   | ✅ |
| < 2.1.0 | ❌ |

## Reporting a Vulnerability

Please report security issues privately to **bill@ai-agent-economy.com**.

Include:
- affected version
- reproduction steps
- impact assessment
- whether the issue affects native, WASM, or TypeScript fallback paths

Please do not open public GitHub issues for unpatched vulnerabilities.

## Response Expectations

- initial acknowledgement: within 3 business days
- severity triage: within 5 business days
- fix target: depends on impact and exploitability

## Scope Notes

ClawPowers ships wallet, payment, memory, and RSI primitives. Security-sensitive areas include:
- private key generation and storage
- payment policy enforcement
- x402 header creation and parsing
- native and WASM crypto fallbacks
- local file-backed memory stores

## Data Handling

ClawPowers is designed for local-first operation.

- no telemetry is sent by the library itself
- secrets are not intentionally exfiltrated by package code
- payment, wallet, and memory data storage behavior depends on the consuming application configuration

## Disclosure Policy

We prefer coordinated disclosure. After a fix is available, we may publish:
- affected versions
- impact summary
- remediation guidance
- CVE or advisory references when applicable
