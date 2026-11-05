import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM box for MFA secrets at rest. The key is 32 bytes hex
 * (`MFA_ENCRYPTION_KEY`). Payload format: `v1:<ivB64>:<cipherB64>:<tagB64>`.
 */

const PREFIX = 'v1';

export function parseEncryptionKey(keyHex: string): Buffer {
  const trimmed = keyHex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error('MFA_ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes).');
  }
  return Buffer.from(trimmed, 'hex');
}

export function encryptSecret(plaintext: string, keyHex: string): string {
  const key = parseEncryptionKey(keyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString('base64url')}:${encrypted.toString('base64url')}:${tag.toString('base64url')}`;
}

export function decryptSecret(payload: string, keyHex: string): string {
  const key = parseEncryptionKey(keyHex);
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error('Encrypted secret is not in the expected format.');
  }
  const iv = Buffer.from(parts[1] ?? '', 'base64url');
  const encrypted = Buffer.from(parts[2] ?? '', 'base64url');
  const tag = Buffer.from(parts[3] ?? '', 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
