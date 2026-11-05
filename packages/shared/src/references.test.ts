import { describe, expect, it } from 'vitest';
import {
  formatReferenceNumber,
  isReferenceKind,
  isYearlessReferenceKind,
  REFERENCE_KINDS,
} from './references';

describe('reference numbers (A7)', () => {
  it('formats a procurement number with a year and six digits', () => {
    expect(formatReferenceNumber('PR', 184, 2026)).toBe('PR-2026-000184');
  });

  it('formats a vendor number without a year', () => {
    expect(formatReferenceNumber('VND', 18, 0)).toBe('VND-000018');
    expect(isYearlessReferenceKind('VND')).toBe(true);
    expect(isYearlessReferenceKind('PR')).toBe(false);
  });

  it('knows every kind named in A7', () => {
    for (const kind of ['PR', 'PAY', 'TRF', 'GRN', 'INV', 'EMP', 'DOC', 'SEAL', 'JNL', 'BUD', 'VND', 'IST', 'ITR', 'IAD', 'CNT', 'DSP', 'SRN', 'DISC', 'TRN'] as const) {
      expect(isReferenceKind(kind)).toBe(true);
    }
    expect(REFERENCE_KINDS).toHaveLength(39);
    expect(isReferenceKind('DEL')).toBe(true);
  });
});
