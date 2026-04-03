export interface WalletConfig {
  readonly chain: 'base' | 'ethereum' | 'polygon';
  readonly dataDir: string;
}

export interface WalletInfo {
  readonly address: string;
  readonly chain: string;
  readonly createdAt: string;
  readonly keyFile: string;
}

export interface SignedMessage {
  readonly message: string;
  readonly signature: string;
  readonly address: string;
}
