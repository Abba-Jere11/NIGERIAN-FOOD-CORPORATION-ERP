import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { canonicalize } from '@nfc/shared';

/**
 * Envelope encryption for document bytes (M4A) and snapshot hashing (M4B).
 *
 * Each version gets its own DEK (AES-256-GCM). The DEK is wrapped by a KEK
 * from DOCUMENT_ENCRYPTION_KEY and stored with the version row. The object
 * store holds ciphertext only.
 */

const WRAP_PREFIX = 'v1';
const GCM_IV_LENGTH = 12;
const DEK_LENGTH = 32;

export function parseKek(keyHex: string): Buffer {
  const trimmed = keyHex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error('DOCUMENT_ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes).');
  }
  return Buffer.from(trimmed, 'hex');
}

export function wrapDataKey(dek: Buffer, kekHex: string): string {
  const kek = parseKek(kekHex);
  const iv = randomBytes(GCM_IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${WRAP_PREFIX}:${iv.toString('base64url')}:${encrypted.toString('base64url')}:${tag.toString('base64url')}`;
}

export function unwrapDataKey(wrapped: string, kekHex: string): Buffer {
  const kek = parseKek(kekHex);
  const parts = wrapped.split(':');
  if (parts.length !== 4 || parts[0] !== WRAP_PREFIX) {
    throw new Error('Wrapped data key is not in the expected format.');
  }
  const iv = Buffer.from(parts[1] ?? '', 'base64url');
  const encrypted = Buffer.from(parts[2] ?? '', 'base64url');
  const tag = Buffer.from(parts[3] ?? '', 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedKey: string;
  sha256: string;
  kekKid: string;
}

export function encryptBlob(plaintext: Buffer, kekHex: string, kekKid = 'v1'): EncryptedBlob {
  const dek = randomBytes(DEK_LENGTH);
  const iv = randomBytes(GCM_IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext,
    iv,
    authTag,
    wrappedKey: wrapDataKey(dek, kekHex),
    sha256: createHash('sha256').update(plaintext).digest('hex'),
    kekKid,
  };
}

export function decryptBlob(
  ciphertext: Buffer,
  iv: Buffer,
  authTag: Buffer,
  wrappedKey: string,
  kekHex: string,
): Buffer {
  const dek = unwrapDataKey(wrappedKey, kekHex);
  const decipher = createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function snapshotHash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

export function hmacSha256Hex(key: Buffer, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

export function parseSigningKeyHex(keyHex: string): Buffer {
  const trimmed = keyHex.trim();
  if (!/^[0-9a-fA-F]{64,}$/.test(trimmed) || trimmed.length % 2 !== 0) {
    throw new Error('Seal signing keys must be even-length hexadecimal (at least 32 bytes).');
  }
  return Buffer.from(trimmed, 'hex');
}
