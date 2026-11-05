import { afterAll, describe, expect, it } from 'vitest';
import { ADMINISTRATOR_USER_ID, effectiveMfaRequired } from '@nfc/shared';
import { appPool, ownerPool } from './support';

describe('MFA policy (0051)', () => {
  const owner = ownerPool('mfa-policy-test');
  const app = appPool('mfa-policy-test-app');

  afterAll(async () => {
    await owner.end();
    await app.end();
  });

  it('resolves role keys before a session exists, so Administrator MFA is enforced at login', async () => {
    const roles = await app.query<{ role_key: string }>(
      'SELECT role_key FROM app.assignments_for_user($1)',
      [ADMINISTRATOR_USER_ID],
    );
    const keys = roles.rows.map((row) => row.role_key) as Parameters<typeof effectiveMfaRequired>[1];
    expect(keys).toContain('administrator');
    expect(effectiveMfaRequired(false, keys)).toBe(true);
  });

  it('defaults mfa_required to false for new accounts', async () => {
    const column = await owner.query<{ column_default: string | null; is_nullable: string }>(
      `SELECT column_default, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'mfa_required'`,
    );
    expect(column.rows[0]?.column_default).toBe('false');
    expect(column.rows[0]?.is_nullable).toBe('NO');
  });

  it('user_auth_row exposes mfa_required', async () => {
    const row = await owner.query<{ mfa_required: boolean }>(
      `SELECT mfa_required FROM app.user_auth_row('md@nfc.local')`,
    );
    expect(typeof row.rows[0]?.mfa_required).toBe('boolean');
  });

  it('effectiveMfaRequired treats Administrator role as mandatory', () => {
    expect(effectiveMfaRequired(false, ['administrator'])).toBe(true);
    expect(effectiveMfaRequired(false, ['md'])).toBe(false);
  });

  it('clear_mfa removes enrolment', async () => {
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE email = 'md@nfc.local'`,
      );
      const id = user.rows[0]?.id;
      expect(id).toBeTruthy();
      await client.query(
        `UPDATE users SET mfa_enrolled_at = now(), mfa_secret_encrypted = 'v1:test' WHERE id = $1`,
        [id],
      );
      await client.query(`SELECT app.clear_mfa($1, 'test')`, [id]);
      const after = await client.query<{ mfa_enrolled_at: Date | null; mfa_secret_encrypted: string | null }>(
        `SELECT mfa_enrolled_at, mfa_secret_encrypted FROM users WHERE id = $1`,
        [id],
      );
      expect(after.rows[0]?.mfa_enrolled_at).toBeNull();
      expect(after.rows[0]?.mfa_secret_encrypted).toBeNull();
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
