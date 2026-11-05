import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { loadApiEnv } from '../config/env';

export function hashBackupCode(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHmac('sha256', 'nfc-token-hash')
    .update(value)
    .digest('hex');
}

/** Hash a session/reset token. HMAC with the session secret so a DB leak is not enough. */
export function hashSecret(value: string): string {
  return createHmac('sha256', loadApiEnv().SESSION_SECRET).update(value).digest('hex');
}

export function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface SignedPayload {
  sub: string;
  exp: number;
  kind: 'mfa' | 'stepup' | 'csrf';
}

export function signPayload(payload: Omit<SignedPayload, 'exp'>, ttlSeconds: number): string {
  const full: SignedPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  const sig = createHmac('sha256', loadApiEnv().SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyPayload(token: string, kind: SignedPayload['kind']): SignedPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', loadApiEnv().SESSION_SECRET).update(body).digest('base64url');
  if (!tokensEqual(sig, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedPayload;
    if (parsed.kind !== kind) return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    if (!parsed.sub) return null;
    return parsed;
  } catch {
    return null;
  }
}
