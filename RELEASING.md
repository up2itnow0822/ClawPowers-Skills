# Releasing ClawPowers-Skills

## Pre-release checklist

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run verify:pack`
- `npm run verify:consumer-install`
- `npm audit --omit=dev`
- confirm packaged WASM artifacts are present in `npm pack --dry-run --json`
- README, CHANGELOG, SECURITY, compatibility, limitations, and licensing docs updated

## Release discipline

- use a signed Git tag for public releases
- inspect tarball contents before publishing
- do not claim packaged WASM availability unless the tarball actually contains the required artifacts
- document breaking changes in `CHANGELOG.md`

## Published versions

| Version | Date | Notes |
|---------|------|-------|
| 2.2.7 | 2026-05-12 | Consumer-install smoke gate; wallet passphrase repair; npm-visible dependency metadata refresh |
| 2.2.6 | 2026-04-14 | Repair release: internal version surfaces corrected and `skill.json` restored to the npm tarball |
| 2.2.5 | 2026-04-09 | Added clawpowers.ai canonical links and aligned the remaining 2.2.5 version surfaces |
| 2.2.4 | 2026-04-09 | Final launch closeout: CI WASM verification stabilized with a dedicated script, GitHub release/version surfaces aligned |
| 2.2.3 | 2026-04-09 | Security automation, ROADMAP, CI badge, wallet safety warning, Node 22 CI coverage, launch hardening |
| 2.2.2 | 2026-04-09 | Full polish pass: package.json homepage to npm, CHANGELOG entries, compatibility matrix current versions |
| 2.2.1 | 2026-04-08 | Patch: CHANGELOG date corrections, RELEASING populated, README registry fix, `npm pkg fix` repository URL |
| 2.2.0 | 2026-04-08 | Full secp256k1 Ethereum wallet derivation, WASM ECDSA exports, packaging hardening, pre-launch audit pass |
| 2.1.0 | 2026-04-06 | Native acceleration layer, 3-tier loader (native/.node + WASM + TS), pre-built WASM artifacts |
| 2.0.0 | 2026-04-03 | Complete TypeScript rewrite, BSL-1.1, no agent control loop, ESM-only, 231 tests |
