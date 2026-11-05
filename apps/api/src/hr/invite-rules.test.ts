import { describe, expect, it } from 'vitest';
import { assertInviteRate, inviteIsUsable, INVITE_TTL_MS } from './invite-rules';

describe('staff invite rules', () => {
  it('accepts an issued invite that has not expired', () => {
    const expires = new Date(Date.now() + INVITE_TTL_MS);
    expect(inviteIsUsable('ISSUED', expires)).toBe(true);
  });

  it('rejects a used, revoked or expired invite', () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 1_000);
    expect(inviteIsUsable('REGISTERED', future)).toBe(false);
    expect(inviteIsUsable('APPROVED', future)).toBe(false);
    expect(inviteIsUsable('REVOKED', future)).toBe(false);
    expect(inviteIsUsable('ISSUED', past)).toBe(false);
  });

  it('keeps the link valid for 72 hours', () => {
    expect(INVITE_TTL_MS).toBe(72 * 60 * 60 * 1000);
  });

  it('stops repeated invite attempts', () => {
    expect(() => assertInviteRate(20)).not.toThrow();
    expect(() => assertInviteRate(21)).toThrow(/RATE/);
  });
});
