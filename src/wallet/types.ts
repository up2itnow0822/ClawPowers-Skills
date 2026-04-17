export interface WalletConfig {
  readonly chain: 'base' | 'ethereum' | 'polygon';
  readonly dataDir: string;
  /**
   * Passphrase used to encrypt the wallet's private key at rest.
   * If omitted, `generateWallet`/`importWallet` will generate a
   * cryptographically random passphrase and return it in
   * `WalletInfo.passphrase`. The caller is then responsible for
   * storing the passphrase securely; without it the wallet cannot
   * be used to sign transactions.
   */
  readonly passphrase?: string;
}

export interface WalletInfo {
  readonly address: string;
  readonly chain: string;
  readonly createdAt: string;
  readonly keyFile: string;
  /**
   * Passphrase required to decrypt the private key for signing.
   * - If `WalletConfig.passphrase` was provided, this field echoes it back.
   * - If not, this is the cryptographically random passphrase generated at
   *   creation time. The caller MUST persist it — it is never stored on
   *   disk in cleartext and cannot be recovered once this value is lost.
   */
  readonly passphrase: string;
}

export interface SignedMessage {
  readonly message: string;
  readonly signature: string;
  readonly address: string;
}
