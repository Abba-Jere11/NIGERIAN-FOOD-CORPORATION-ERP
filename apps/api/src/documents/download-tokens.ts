import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadApiEnv } from '../config/env';

export interface DownloadTokenPayload {
  sub: string;
  documentId: string;
  versionId: string;
  exp: number;
}

export function signDownloadToken(
  payload: Omit<DownloadTokenPayload, 'exp'>,
  ttlSeconds?: number,
): { token: string; expiresAt: Date } {
  const env = loadApiEnv();
  const ttl = ttlSeconds ?? env.DOCUMENT_DOWNLOAD_TTL_SECONDS;
  const full: DownloadTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttl,
  };
  const body = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  const sig = createHmac('sha256', env.SESSION_SECRET).update(body).digest('base64url');
  return { token: `${body}.${sig}`, expiresAt: new Date(full.exp * 1000) };
}

export function verifyDownloadToken(token: string): DownloadTokenPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', loadApiEnv().SESSION_SECRET).update(body).digest('base64url');
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as DownloadTokenPayload;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    if (!parsed.sub || !parsed.documentId || !parsed.versionId) return null;
    return parsed;
  } catch {
    return null;
  }
}
