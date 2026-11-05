import { Secret, TOTP } from 'otpauth';
import { randomBytes } from 'node:crypto';

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function totpUri(secret: string, email: string): string {
  const totp = new TOTP({
    issuer: 'NFC',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
  return totp.toString();
}

export function verifyTotp(secret: string, code: string): boolean {
  const totp = new TOTP({
    issuer: 'NFC',
    label: 'NFC',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
  const delta = totp.validate({ token: code.replace(/\s/g, ''), window: 1 });
  return delta !== null;
}

export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () => randomBytes(5).toString('hex'));
}
