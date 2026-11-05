import { describe, expect, it } from 'vitest';
import { hmacSha256Hex, parseSigningKeyHex, snapshotHash } from '@nfc/db';
import { canonicalize, type SealPayload } from '@nfc/shared';
import { parseSealSigningKeys } from './seals.service';

const V1 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const V2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

function payload(overrides: Partial<SealPayload> = {}): SealPayload {
  return {
    approverId: '00000000-0000-4000-8000-000000000002',
    approverRole: 'ed_operations',
    entityId: 'entity',
    subjectType: 'DEMO_PROCUREMENT',
    subjectId: 'subject',
    subjectVersion: 1,
    snapshotHash: snapshotHash({ memo: 'frozen' }),
    action: 'approved',
    timestamp: '2026-03-12T09:14:00.000Z',
    kid: 'v1',
    referenceNumber: 'SEAL-2026-000001',
    reason: null,
    paymentRef: null,
    ...overrides,
  };
}

describe('seal signatures', () => {
  it('still verifies a seal after the active kid rotates', () => {
    const keys = parseSealSigningKeys(JSON.stringify({ v1: V1, v2: V2 }));
    const body = payload();
    const signature = hmacSha256Hex(keys.v1 ?? parseSigningKeyHex(V1), canonicalize(body));
    const active = keys.v2;
    expect(active).toBeTruthy();
    const expected = hmacSha256Hex(keys.v1 ?? parseSigningKeyHex(V1), canonicalize(body));
    expect(signature).toBe(expected);
    expect(hmacSha256Hex(keys.v2 ?? parseSigningKeyHex(V2), canonicalize(body))).not.toBe(signature);
  });

  it('detects a snapshot mismatch and a tampered field', () => {
    const original = payload();
    const current = snapshotHash({ memo: 'frozen' });
    expect(current).toBe(original.snapshotHash);
    expect(snapshotHash({ memo: 'tampered' })).not.toBe(original.snapshotHash);

    const tampered = payload({ snapshotHash: snapshotHash({ memo: 'other' }) });
    const key = parseSigningKeyHex(V1);
    const sig = hmacSha256Hex(key, canonicalize(original));
    const tamperedSig = hmacSha256Hex(key, canonicalize(tampered));
    expect(sig).not.toBe(tamperedSig);
  });
});
