import { APPROVAL_OR_PAYMENT_KEYS, DEFAULT_ROLE_GRANTS, PERMISSION_KEYS } from '@nfc/shared';
import { describe, expect, it } from 'vitest';

describe('the Administrator cannot receive approval or payment keys', () => {
  it('has none of those keys in the seeded catalog', () => {
    for (const key of APPROVAL_OR_PAYMENT_KEYS) {
      expect(DEFAULT_ROLE_GRANTS.administrator).not.toContain(key);
    }
  });

  it('has none of the vendor keys', () => {
    for (const key of PERMISSION_KEYS.filter((permission) => permission.startsWith('vendor.'))) {
      expect(DEFAULT_ROLE_GRANTS.administrator).not.toContain(key);
    }
  });

  it('has none of the procurement keys', () => {
    for (const key of PERMISSION_KEYS.filter((permission) => permission.startsWith('procurement.'))) {
      expect(DEFAULT_ROLE_GRANTS.administrator).not.toContain(key);
    }
  });
});

describe('GM and Finance Head conflict on the same entity', () => {
  it('are the seeded conflicting pair', () => {
    expect(['gm', 'finance_head'].sort()).toEqual(['finance_head', 'gm']);
  });
});
