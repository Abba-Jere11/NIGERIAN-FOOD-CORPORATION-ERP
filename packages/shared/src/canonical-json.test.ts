import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalize } from './canonical-json';

function snapshotHash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

describe('canonicalize', () => {
  it('sorts object keys and omits whitespace', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ a: { d: 1, c: 2 }, b: [true, null] })).toBe(
      '{"a":{"c":2,"d":1},"b":[true,null]}',
    );
  });

  it('produces a stable hash for equivalent objects written in different key order', () => {
    expect(snapshotHash({ entityId: 'e', action: 'approved' })).toBe(
      snapshotHash({ action: 'approved', entityId: 'e' }),
    );
  });
});
