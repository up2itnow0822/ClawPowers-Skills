/**
 * ClawPowers Skills — Wallet Crypto
 *
 * Ethereum-compatible wallet: generate, import, sign.
 *
 * Address derivation (ALL tiers):
 *   private key → secp256k1 public key → Keccak-256 → last 20 bytes → EIP-55 checksum
 *
 * Tier 1 (native .node) and Tier 2 (WASM) accelerate the crypto operations.
 * Tier 3 (pure TypeScript) uses @noble/curves + @noble/hashes — audited, zero-dependency
 * pure-JS implementations of secp256k1 and Keccak-256. Every tier produces identical,
 * MetaMask-compatible, on-chain-valid Ethereum addresses.
 */

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { debuglog } from 'node:util';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex } from '@noble/hashes/utils';
import {
  deriveEthereumAddress as deriveEthAddressNative,
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

// ─── Pure-TS Ethereum Crypto (via @noble) ─────────────────────────────────────

/**
 * Derive a standard Ethereum address from a 32-byte private key using pure TypeScript.
 * Pipeline: privKey → secp256k1 uncompressed pubkey (65 bytes) → drop 0x04 prefix →
 *           keccak256 → last 20 bytes → EIP-55 checksum.
 */
function deriveAddressNoble(privateKeyBytes: Uint8Array): string {
  // Get uncompressed public key (65 bytes: 0x04 || x || y)
  const pubKeyUncompressed = secp256k1.getPublicKey(privateKeyBytes, false);
  // Hash the 64 bytes after the 0x04 prefix
  const hash = keccak_256(pubKeyUncompressed.subarray(1));
  // Take last 20 bytes
  const addressBytes = hash.subarray(12);
  return toChecksumAddress(bytesToHex(addressBytes));
}

/**
 * EIP-55 mixed-case checksum encoding.
 */
function toChecksumAddress(address: string): string {
  const addr = address.toLowerCase().replace(/^0x/, '');
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(addr)));
  let checksummed = '0x';
  for (let i = 0; i < 40; i++) {
    checksummed += parseInt(hash[i]!, 16) >= 8 ? addr[i]!.toUpperCase() : addr[i]!;
  }
  return checksummed;
}

/**
 * Keccak-256 hash using @noble/hashes (pure TS).
 */
function keccak256Noble(data: Uint8Array): Uint8Array {
  return keccak_256(data);
}

/**
 * Sign a 32-byte message hash with secp256k1 ECDSA, returning 65 bytes (r || s || v).
 * Uses EIP-191 personal_sign format when called via signMessage().
 */
function signEcdsaNoble(privateKey: Uint8Array, messageHash: Uint8Array): Uint8Array {
  const sig = secp256k1.sign(messageHash, privateKey);
  // r (32 bytes) || s (32 bytes) || recovery (1 byte, 27 or 28 per Ethereum convention)
  const r = sig.r.toString(16).padStart(64, '0');
  const s = sig.s.toString(16).padStart(64, '0');
  const v = sig.recovery + 27;
  const sigBytes = new Uint8Array(65);
  sigBytes.set(hexToBytes(r), 0);
  sigBytes.set(hexToBytes(s), 32);
  sigBytes[64] = v;
  return sigBytes;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ─── Unified Crypto Operations (best tier wins) ──────────────────────────────

/**
 * Derive Ethereum address. Tries native → WASM → @noble pure TS.
 * All tiers produce the same standard EIP-55 checksummed address.
 */
function generateAddress(privateKeyHex: string): string {
  const cleaned = privateKeyHex.replace(/^0x/i, '');
  const privBuf = Buffer.from(cleaned, 'hex');

  // Try native/WASM acceleration first
  const eth = deriveEthAddressNative(privBuf);
  if (eth) {
    dlog('address derivation: native/WASM secp256k1+keccak (tier %s)', getActiveTier());
    return eth;
  }

  // Pure TypeScript via @noble (produces identical addresses)
  dlog('address derivation: @noble/curves pure TS (tier %s)', getActiveTier());
  return deriveAddressNoble(privBuf);
}

/**
 * Keccak-256 hash. Tries native → WASM → @noble.
 * Always succeeds — @noble provides the fallback.
 */
function keccak256(data: Uint8Array): Uint8Array {
  // @noble is fast enough and always available; native/WASM checked by caller if needed
  return keccak256Noble(data);
}

/**
 * ECDSA sign a 32-byte hash. Tries native → WASM → @noble.
 * Always succeeds — @noble provides the fallback.
 */
function signEcdsaUnified(privateKey: Uint8Array, messageHash: Uint8Array): Uint8Array {
  // Try native/WASM first for acceleration
  const nativeSig = signEcdsaNative(Buffer.from(privateKey), Buffer.from(messageHash));
  if (nativeSig) {
    dlog('ecdsa sign: native/WASM (tier %s)', getActiveTier());
    return new Uint8Array(nativeSig);
  }

  // Pure TS fallback
  dlog('ecdsa sign: @noble/curves pure TS');
  return signEcdsaNoble(privateKey, messageHash);
}

// ─── Key Encryption ───────────────────────────────────────────────────────────

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

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

// ─── EIP-191 Personal Sign ───────────────────────────────────────────────────

/**
 * Ethereum personal_sign: "\x19Ethereum Signed Message:\n" + len + message → keccak256 → ECDSA
 */
function personalMessageHash(message: string): Uint8Array {
  const msgBytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msgBytes.length}`);
  const combined = new Uint8Array(prefix.length + msgBytes.length);
  combined.set(prefix, 0);
  combined.set(msgBytes, prefix.length);
  return keccak256(combined);
}

// ─── Sign Implementations ────────────────────────────────────────────────────

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

  const hash = personalMessageHash(message);
  const sig = signEcdsaUnified(new Uint8Array(privateKey), hash);

  return {
    message,
    signature: '0x' + bytesToHex(sig),
    address: keyFileData.address,
  };
}

async function signMessageFromPrivateKey(privateKeyHex: string, message: string): Promise<string> {
  const cleaned = privateKeyHex.replace(/^0x/i, '');
  if (cleaned.length !== 64 || !/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new Error('Invalid private key: must be 32 bytes (64 hex characters)');
  }
  const priv = hexToBytes(cleaned);
  const hash = personalMessageHash(message);
  const sig = signEcdsaUnified(priv, hash);
  return '0x' + bytesToHex(sig);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a new Ethereum-compatible wallet.
 * Produces a standard, on-chain-valid EIP-55 checksummed address on ALL tiers.
 * Private key is encrypted with AES-256-GCM and stored to disk.
 */
export async function generateWallet(config: WalletConfig): Promise<WalletInfo> {
  const privateKey = randomBytes(32);
  const privateKeyHex = privateKey.toString('hex');
  const address = generateAddress(privateKeyHex);
  const createdAt = new Date().toISOString();

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
 * Derives the standard Ethereum address and encrypts the key to disk.
 */
export async function importWallet(privateKeyHex: string, config: WalletConfig): Promise<WalletInfo> {
  const cleaned = privateKeyHex.replace(/^0x/i, '');
  if (cleaned.length !== 64 || !/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new Error('Invalid private key: must be 32 bytes (64 hex characters)');
  }

  const privateKey = Buffer.from(cleaned, 'hex');
  const address = generateAddress(cleaned);
  const createdAt = new Date().toISOString();

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
 * Uses EIP-191 personal_sign format with secp256k1 ECDSA on all tiers.
 */
export async function signMessage(
  message: string,
  keyFile: string,
  passphrase: string,
): Promise<SignedMessage>;

/**
 * Sign a message with a raw hex private key.
 * Returns 65-byte ECDSA signature (r || s || v) as 0x-prefixed hex.
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
