/**
 * ClawPowers Skills — Wallet Crypto
 * Ethereum-oriented wallet generation, import, and signing using Node.js crypto.
 * Address derivation: Keccak-256 when Tier 1 (native `keccak256Bytes`) or Tier 2 (WASM) is available; SHA-256 fallback (Tier 3) only when neither is loaded.
 */

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { digestForWalletAddress } from '../native/index.js';
import type { WalletConfig, WalletInfo, SignedMessage } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/** Last 20 bytes of the 32-byte digest as `0x`-prefixed address (pseudo-derivation from key material). */
function addressFromKeyMaterial(keyMaterial: Buffer): string {
  const digestHex = digestForWalletAddress(keyMaterial);
  const hash = Buffer.from(digestHex.replace(/^0x/, ''), 'hex');
  return '0x' + hash.subarray(hash.length - 20).toString('hex');
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
}

interface EncryptedKeyFile {
  readonly version: 1;
  readonly address: string;
  readonly chain: string;
  readonly createdAt: string;
  readonly crypto: {
    readonly cipher: 'aes-256-gcm';
    readonly ciphertext: string;
    readonly iv: string;
    readonly authTag: string;
    readonly salt: string;
    readonly scryptParams: {
      readonly N: number;
      readonly r: number;
      readonly p: number;
    };
  };
}

function encryptPrivateKey(privateKey: Buffer, passphrase: string): {
  ciphertext: string;
  iv: string;
  authTag: string;
  salt: string;
} {
  const salt = randomBytes(32);
  const key = deriveKey(passphrase, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(privateKey), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    salt: salt.toString('hex'),
  };
}

function decryptPrivateKey(
  ciphertext: string,
  iv: string,
  authTag: string,
  salt: string,
  passphrase: string
): Buffer {
  const key = deriveKey(passphrase, Buffer.from(salt, 'hex'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final(),
  ]);

  return decrypted;
}

function generateAddress(privateKeyHex: string): string {
  const privBuf = Buffer.from(privateKeyHex, 'hex');
  return addressFromKeyMaterial(privBuf);
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a new Ethereum-compatible wallet.
 * Private key is encrypted with a random passphrase and stored to disk.
 */
export async function generateWallet(config: WalletConfig): Promise<WalletInfo> {
  const privateKey = randomBytes(32);
  const privateKeyHex = privateKey.toString('hex');
  const address = generateAddress(privateKeyHex);
  const createdAt = new Date().toISOString();

  // Generate a random passphrase for initial encryption
  const passphrase = randomBytes(16).toString('hex');

  const encrypted = encryptPrivateKey(privateKey, passphrase);

  const keyFileData: EncryptedKeyFile = {
    version: 1,
    address,
    chain: config.chain,
    createdAt,
    crypto: {
      cipher: 'aes-256-gcm',
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      salt: encrypted.salt,
      scryptParams: { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
    },
  };

  await ensureDir(config.dataDir);
  const keyFileName = `${address.slice(2, 10)}-${Date.now()}.json`;
  const keyFilePath = join(config.dataDir, keyFileName);
  await writeFile(keyFilePath, JSON.stringify(keyFileData, null, 2) + '\n', 'utf-8');

  return {
    address,
    chain: config.chain,
    createdAt,
    keyFile: keyFilePath,
  };
}

/**
 * Import an existing wallet from a private key hex string.
 */
export async function importWallet(privateKeyHex: string, config: WalletConfig): Promise<WalletInfo> {
  // Validate private key format
  const cleaned = privateKeyHex.replace(/^0x/, '');
  if (cleaned.length !== 64 || !/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new Error('Invalid private key: must be 32 bytes (64 hex characters)');
  }

  const privateKey = Buffer.from(cleaned, 'hex');
  const address = generateAddress(cleaned);
  const createdAt = new Date().toISOString();

  // Generate a random passphrase for encryption
  const passphrase = randomBytes(16).toString('hex');

  const encrypted = encryptPrivateKey(privateKey, passphrase);

  const keyFileData: EncryptedKeyFile = {
    version: 1,
    address,
    chain: config.chain,
    createdAt,
    crypto: {
      cipher: 'aes-256-gcm',
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      salt: encrypted.salt,
      scryptParams: { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
    },
  };

  await ensureDir(config.dataDir);
  const keyFileName = `${address.slice(2, 10)}-${Date.now()}.json`;
  const keyFilePath = join(config.dataDir, keyFileName);
  await writeFile(keyFilePath, JSON.stringify(keyFileData, null, 2) + '\n', 'utf-8');

  return {
    address,
    chain: config.chain,
    createdAt,
    keyFile: keyFilePath,
  };
}

/**
 * Sign a message using an encrypted key file and passphrase.
 */
export async function signMessage(
  message: string,
  keyFile: string,
  passphrase: string
): Promise<SignedMessage> {
  const content = await readFile(keyFile, 'utf-8');
  const keyFileData = JSON.parse(content) as EncryptedKeyFile;

  const privateKey = decryptPrivateKey(
    keyFileData.crypto.ciphertext,
    keyFileData.crypto.iv,
    keyFileData.crypto.authTag,
    keyFileData.crypto.salt,
    passphrase
  );

  // Sign: HMAC-SHA256 of the message with the private key
  const { createHmac } = await import('node:crypto');
  const signature = createHmac('sha256', privateKey)
    .update(message)
    .digest('hex');

  return {
    message,
    signature: '0x' + signature,
    address: keyFileData.address,
  };
}
