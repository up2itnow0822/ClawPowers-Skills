# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.0.x   | ✅ Active support  |
| < 2.0   | ❌ No support      |

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Please report security vulnerabilities via email:

📧 **security@ai-agent-economy.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial Assessment:** Within 5 business days
- **Fix Timeline:** Critical vulnerabilities within 7 days

## Security Design Principles

### Spending Policy (Financial Safety)
- **Fail-closed:** Any policy error results in payment rejection
- **Never auto-retry:** Failed payments are logged but never automatically retried
- **Daily limits:** Hard-enforced, cannot be overridden by RSI
- **Domain allowlists:** When configured, only listed domains can receive payments

### RSI Safety Invariants
The following can **NEVER** be modified by the RSI engine:
1. Spending limits and SpendingPolicy configuration
2. Core identity and directives
3. RSI safety tier definitions
4. Sandbox boundaries
5. Authentication credentials

### T4 Gate
T4 (Architecture Proposals) mutations **always** require human approval. The `'auto'` mode is rejected at the type system level and the validation layer.

### Wallet Security
- Private keys are encrypted at rest using AES-256-GCM
- Key derivation uses scrypt (N=16384, r=8, p=1)
- Atomic file writes prevent corruption
- Backup files created before overwrites

### Memory Integrity
- Episodic memory is append-only (JSONL)
- Procedural memory uses atomic writes with backup
- Checkpoint files use write-to-temp-then-rename pattern
- Corruption recovery is built into episodic memory

## Dependencies

This library has minimal runtime dependencies:
- `zod` — Schema validation (no known vulnerabilities)
- Node.js built-in `crypto` — For wallet operations

## Audit

The codebase enforces:
- Zero `any` types in TypeScript
- Strict mode enabled
- All financial operations logged to audit trail
