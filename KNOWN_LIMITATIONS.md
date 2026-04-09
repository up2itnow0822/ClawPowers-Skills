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
- users should not assume modeled prompt-cache savings are direct provider billing results
- downstream runtimes should validate their own integration behavior separately from this library
