# Known Limitations

## Production-ready

- capability library APIs for payments, memory, RSI, wallet, swarm, and ITP
- native plus WASM fallback packaging when shipped correctly
- local validation commands: lint, typecheck, test, build, pack

## Experimental or environment-dependent

- prompt-cache economics in benchmark collateral remain modeled, not billed receipts
- native acceleration availability depends on platform and install environment
- some consumer behavior depends on the wrapper/runtime that integrates this package

## Important operational notes

- non-native environments depend on packaged WASM fallback artifacts for real wallet derivation
- ClawPowers encrypts wallet key files but does not store passphrases in plaintext. Callers must persist caller-supplied or generated passphrases securely; `listWallets()` cannot recover them later.
- `SpendingPolicy` daily counters are in-memory unless the caller opts in with `persistPath` plus an integrity key of at least 16 bytes. The HMAC key is caller-held; this package does not derive or store it. Use one key per persist file. An attacker who also has that key can rewrite history.
- The persist directory must be private. `initializeSpendingPersist` creates missing parents with mode `0700`. Do not share that directory with less-trusted accounts.
- Opt-in persist is one process, one dest file. It does not lock concurrent writers. Last `renameSync` wins.
- HMAC authenticity does not detect rollback to an older still-valid signed snapshot after restart. A clock jump past UTC midnight drops those rows from `getDailySpent()` because daily spend is the verified log summed for the current UTC day; the signed file still keeps today and yesterday relative to the last trusted UTC day so a forward jump cannot permanently erase them.
- A crash after the tmp write and before rename leaves the previous signed dest in place. A deleted dest after initialize fails closed (refuses spends) rather than treating missing history as zero spend.
- users should not assume modeled prompt-cache savings are direct provider billing results
- downstream runtimes should validate their own integration behavior separately from this library
