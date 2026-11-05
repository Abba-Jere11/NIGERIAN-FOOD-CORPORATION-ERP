import { describe, expect, it } from 'vitest';
import { evaluatePassword } from './password-policy';

describe('password policy', () => {
  it('rejects short passwords', async () => {
    const result = await evaluatePassword('Ab1!', { hibpEnabled: false });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => /12/.test(error))).toBe(true);
  });

  it('rejects passwords without mixed classes', async () => {
    const result = await evaluatePassword('abcdefghijkl', { hibpEnabled: false });
    expect(result.ok).toBe(false);
  });

  it('rejects the bundled common list even when HIBP is off', async () => {
    const result = await evaluatePassword('password1234', { hibpEnabled: false });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => /common/i.test(error))).toBe(true);
  });

  it('accepts a mixed 12-character secret when HIBP is skipped', async () => {
    const result = await evaluatePassword('Nfc-Seeded!9x', { hibpEnabled: false });
    expect(result.ok).toBe(true);
    expect(result.hibpChecked).toBe(false);
  });
});
