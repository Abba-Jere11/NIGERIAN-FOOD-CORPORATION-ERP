import { createHash } from 'node:crypto';
import { COMMON_PASSWORDS } from './common-passwords';
import { loadApiEnv } from '../config/env';
import { ValidationFailedError } from '../common/errors/domain-error';

const MIN_LENGTH = 12;

export interface PasswordPolicyResult {
  ok: boolean;
  errors: string[];
  hibpChecked: boolean;
}

function hasMixedClasses(password: string): boolean {
  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  return classes >= 3;
}

export async function evaluatePassword(
  password: string,
  options: { hibpEnabled?: boolean } = {},
): Promise<PasswordPolicyResult> {
  const errors: string[] = [];
  if (password.length < MIN_LENGTH) {
    errors.push(`Use at least ${MIN_LENGTH} characters.`);
  }
  if (!hasMixedClasses(password)) {
    errors.push('Use a mix of upper case, lower case, digits and symbols (at least three of those).');
  }
  if (COMMON_PASSWORDS.includes(password.toLowerCase())) {
    errors.push('That password is too common.');
  }

  let hibpChecked = false;
  const hibpEnabled = options.hibpEnabled ?? loadApiEnv().HIBP_ENABLED;
  if (hibpEnabled && errors.length === 0) {
    try {
      const pwned = await isPwned(password);
      hibpChecked = true;
      if (pwned) errors.push('That password appears in a known breach. Choose another.');
    } catch {
      hibpChecked = false;
    }
  }

  return { ok: errors.length === 0, errors, hibpChecked };
}

export async function assertPasswordPolicy(password: string): Promise<void> {
  const result = await evaluatePassword(password);
  if (!result.ok) {
    throw new ValidationFailedError(result.errors[0] ?? 'That password is not acceptable.', {
      fieldErrors: { password: result.errors },
    });
  }
}

async function isPwned(password: string): Promise<boolean> {
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HIBP ${response.status}`);
    const body = await response.text();
    return body.split('\n').some((line) => line.startsWith(suffix));
  } finally {
    clearTimeout(timer);
  }
}
