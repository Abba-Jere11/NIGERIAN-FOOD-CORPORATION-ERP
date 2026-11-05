/** An invite can be used once, and only before it expires. */
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

export function inviteIsUsable(status: string, expiresAt: Date, now = new Date()): boolean {
  return status === 'ISSUED' && expiresAt.getTime() > now.getTime();
}

export function assertInviteRate(attemptsInWindow: number, limit = 20): void {
  if (attemptsInWindow > limit) {
    throw new Error('RATE');
  }
}
