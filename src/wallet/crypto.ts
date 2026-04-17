/**
 * ClawPowers Skills — Wallet Crypto
 * Ethereum-oriented wallet generation, import, and signing.
 * Address derivation: secp256k1 public key → Keccak-256 → last 20 bytes (MetaMask-compatible)
 * when Tier 1 (native) or Tier 2 (WASM) is available; legacy hash-of-key digest only on Tier 3.
 */

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { debuglog } from 'node:util';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  digestForWalletAddress,
  deriveEthereumAddress as deriveEthAddressNative,
  keccak256Digest,
  signEcdsa as signEcdsaNative,
  getActiveTier,
} from '../native/index.js';
import type { WalletConfig, WalletInfo, SignedMessage } from './types.js';

const dlog = debuglog('clawpowers:wallet');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/** Tier 3: last 20 bytes of the 32-byte digest as `0x`-prefixed address (legacy). */
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
  const cleaned = privateKeyHex.replace(/^0x/i, '');
  const privBuf = Buffer.from(cleaned, 'hex');
  const eth = deriveEthAddressNative(privBuf);
  if (eth) {
    dlog('address derivation: secp256k1+keccak (tier %s)', getActiveTier());
    return eth;
  }
  dlog('address derivation: tier3 legacy digest (tier %s)', getActiveTier());
  return addressFromKeyMaterial(privBuf);
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function signMessageFromKeyFile(
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

  const msgBuf = Buffer.from(message, 'utf8');
  const hash = keccak256Digest(msgBuf);
  const sigEcdsa = hash ? signEcdsaNative(privateKey, hash) : null;
  if (sigEcdsa) {
    dlog('signMessage (keyfile): secp256k1 ECDSA (tier %s)', getActiveTier());
    return {
      message,
      signature: '0x' + sigEcdsa.toString('hex'),
      address: keyFileData.address,
    };
  }

  const { createHmac } = await import('node:crypto');
  dlog('signMessage (keyfile): HMAC-SHA256 legacy (no secp256k1/keccak tier)');
  const signature = createHmac('sha256', privateKey).update(message).digest('hex');

  return {
    message,
    signature: '0x' + signature,
    address: keyFileData.address,
  };
}

async function signMessageFromPrivateKey(privateKeyHex: string, message: string): Promise<string> {
  const cleaned = privateKeyHex.replace(/^0x/i, '');
  if (cleaned.length !== 64 || !/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new Error('Invalid private key: must be 32 bytes (64 hex characters)');
  }
  const priv = Buffer.from(cleaned, 'hex');
  const hash = keccak256Digest(Buffer.from(message, 'utf8'));
  if (!hash) {
    throw new Error(
      'Ethereum signing requires Keccak-256 (Tier 1 native or Tier 2 WASM). Pure TypeScript tier has no Keccak.',
    );
  }
  const sig = signEcdsaNative(priv, hash);
  if (!sig) {
    throw new Error('Ethereum signing requires secp256k1 (Tier 1 native or Tier 2 WASM).');
  }
  return '0x' + sig.toString('hex');
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

  // Use caller-supplied passphrase if provided, otherwise generate a random
  // one and return it to the caller. CRIT #1 fix: the previously-generated
  // passphrase was discarded, rendering the wallet unsignable.
  const passphrase = config.passphrase ?? randomBytes(16).toString('hex');

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
    passphrase,
  };
}

/**
 * Import an existing wallet from a private key hex string.
 */
export async function importWallet(privateKeyHex: string, config: WalletConfig): Promise<WalletInfo> {
  // Validate private key format
  const cleaned = privateKeyHex.replace(/^0x/i, '');
  if (cleaned.length !== 64 || !/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new Error('Invalid private key: must be 32 bytes (64 hex characters)');
  }

  const privateKey = Buffer.from(cleaned, 'hex');
  const address = generateAddress(cleaned);
  const createdAt = new Date().toISOString();

  // Use caller-supplied passphrase if provided, otherwise generate a random
  // one and return it to the caller. CRIT #1 fix: the previously-generated
  // passphrase was discarded, rendering the imported wallet unsignable.
  const passphrase = config.passphrase ?? randomBytes(16).toString('hex');

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
    passphrase,
  };
}

/**
 * Sign a message using an encrypted key file and passphrase (returns structured result).
 * Uses secp256k1 ECDSA over Keccak-256(UTF-8 message) when native/WASM tiers provide it;
 * otherwise falls back to HMAC-SHA256 for backward compatibility.
 */
export async function signMessage(
  message: string,
  keyFile: string,
  passphrase: string,
): Promise<SignedMessage>;

/**
 * Sign a message with a raw hex private key. Returns 65-byte ECDSA signature (r‖s‖v) as hex.
 * Requires Tier 1 or Tier 2 (Keccak + secp256k1).
 */
export async function signMessage(privateKeyHex: string, message: string): Promise<string>;

export async function signMessage(
  a: string,
  b: string,
  c?: string,
): Promise<SignedMessage | string> {
  if (c !== undefined) {
    return signMessageFromKeyFile(a, b, c);
  }
  return signMessageFromPrivateKey(a, b);
}
