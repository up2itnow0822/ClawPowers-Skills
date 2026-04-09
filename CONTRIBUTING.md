# Contributing

## Before opening a PR

- keep the library/runtime boundary clear: capability logic belongs here, wrapper/runtime glue belongs in `clawpowers-agent`
- do not publish claims about WASM/native packaging that are not verifiable in the tarball
- update docs when API, packaging, or benchmark language changes

## Validation

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run verify:pack
npm audit --omit=dev
```
