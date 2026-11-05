import { describe, expect, it } from 'vitest';
import { decryptBlob, encryptBlob, snapshotHash, unwrapDataKey, wrapDataKey } from './envelope';

const KEK = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('envelope encryption', () => {
  it('round-trips plaintext and stores a hash of the plaintext', () => {
    const plain = Buffer.from('invoice-bytes');
    const box = encryptBlob(plain, KEK);
    expect(box.ciphertext.equals(plain)).toBe(false);
    expect(decryptBlob(box.ciphertext, box.iv, box.authTag, box.wrappedKey, KEK).equals(plain)).toBe(
      true,
    );
    expect(box.sha256).toHaveLength(64);
  });

  it('wraps a data key so the KEK is required to recover it', () => {
    const dek = Buffer.alloc(32, 7);
    const wrapped = wrapDataKey(dek, KEK);
    expect(unwrapDataKey(wrapped, KEK).equals(dek)).toBe(true);
  });
});

describe('snapshotHash', () => {
  it('is stable across key order', () => {
    expect(snapshotHash({ b: 1, a: 'x' })).toBe(snapshotHash({ a: 'x', b: 1 }));
  });
});
