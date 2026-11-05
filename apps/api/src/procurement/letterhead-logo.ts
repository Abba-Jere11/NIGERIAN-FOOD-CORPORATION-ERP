import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Absolute path to the NFC seal for PDF letterheads, or null if missing. */
export function nfcLogoPath(): string | null {
  const candidates = [
    join(__dirname, '../../assets/nfc-logo.png'),
    join(process.cwd(), 'apps/api/assets/nfc-logo.png'),
    join(process.cwd(), 'assets/nfc-logo.png'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
