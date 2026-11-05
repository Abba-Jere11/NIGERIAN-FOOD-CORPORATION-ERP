import { describe, expect, it } from 'vitest';
import { effectiveMfaRequired } from './auth-mfa';

describe('effectiveMfaRequired', () => {
  it('is false when flag is off and user is not Administrator', () => {
    expect(effectiveMfaRequired(false, ['gm'])).toBe(false);
  });

  it('is true when admin enabled MFA', () => {
    expect(effectiveMfaRequired(true, ['gm'])).toBe(true);
  });

  it('is true for Administrator role even when flag is off', () => {
    expect(effectiveMfaRequired(false, ['administrator'])).toBe(true);
  });
});
