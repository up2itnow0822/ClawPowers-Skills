export interface WalletConfig {
  readonly chain: 'base' | 'ethereum' | 'polygon' | 'local';
  readonly dataDir: string;
  /**
   * Passphrase used to encrypt newly generated/imported wallet key files.
   * If omitted, ClawPowers generates a high-entropy passphrase and returns it
   * on the WalletInfo object from generateWallet()/importWallet().
   */
  readonly passphrase?: string;
}

export interface WalletInfo {
  readonly address: string;
  readonly chain: string;
  readonly createdAt: string;
  readonly keyFile: string;
  /**
   * Encryption passphrase for the key file. Present on WalletInfo returned by
   * generateWallet()/importWallet(); intentionally absent from listWallets()
   * because the passphrase is never persisted in plaintext.
   */
  readonly passphrase?: string;
}

export interface SignedMessage {
  readonly message: string;
  readonly signature: string;
  readonly address: string;
}
