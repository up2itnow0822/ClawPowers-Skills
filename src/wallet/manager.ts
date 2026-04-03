/**
 * ClawPowers Skills — Wallet Manager
 * High-level wallet management: generate, import, sign, list.
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { WalletConfig, WalletInfo } from './types.js';
import { generateWallet, importWallet, signMessage } from './crypto.js';

export class WalletManager {
  constructor(private readonly config: WalletConfig) {}

  async generate(): Promise<WalletInfo> {
    return generateWallet(this.config);
  }

  async import(privateKey: string): Promise<WalletInfo> {
    return importWallet(privateKey, this.config);
  }

  async sign(message: string, walletInfo: WalletInfo, passphrase: string): Promise<string> {
    const result = await signMessage(message, walletInfo.keyFile, passphrase);
    return result.signature;
  }

  async listWallets(): Promise<WalletInfo[]> {
    if (!existsSync(this.config.dataDir)) {
      return [];
    }

    const files = await readdir(this.config.dataDir);
    const wallets: WalletInfo[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const filePath = join(this.config.dataDir, file);
        const content = await readFile(filePath, 'utf-8');
        const data = JSON.parse(content) as {
          address: string;
          chain: string;
          createdAt: string;
        };

        wallets.push({
          address: data.address,
          chain: data.chain,
          createdAt: data.createdAt,
          keyFile: filePath,
        });
      } catch {
        // Skip malformed key files
      }
    }

    return wallets;
  }
}
