# 60-Second Demo

```bash
npm install clawpowers
node -e "
const { getActiveTier, generateWallet } = await import('clawpowers');
const wallet = await generateWallet({ chain: 'base', dataDir: './demo-wallet' });
console.log(getActiveTier());
console.log(wallet.address);
"
```

What this demonstrates:
- package installs from npm
- active runtime tier is visible
- wallet generation works through native or packaged WASM fallback
