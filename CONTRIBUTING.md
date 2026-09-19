# Contributing

## Development environment

The published package supports Node.js 22+. The development toolchain requires
Node.js `^22.13.0 || ^24.0.0 || >=26.0.0`; this matches the supported ranges
of the locked Vitest and ESLint releases. `npm install`, `npm ci`, and `npm run`
enforce that contributor-only requirement through `devEngines`.

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
