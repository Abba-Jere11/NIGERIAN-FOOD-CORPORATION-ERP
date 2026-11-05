import { ED_FINANCE_IS_SET_ID, SEED_USERS } from '@nfc/shared';
import type { Pool } from 'pg';

const EMEKA_ID = SEED_USERS.find((user) => user.email === 'ed.finance@nfc.local')?.id;

export async function seedM12(pool: Pool): Promise<{ alreadyPresent: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT 1 FROM report_parameter_sets WHERE id = $1', [ED_FINANCE_IS_SET_ID]);
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return { alreadyPresent: true };
    }
    if (!EMEKA_ID) throw new Error('Seed identities before M12 fixtures.');

    await client.query(
      `INSERT INTO report_parameter_sets (
         id, user_id, name, report_kind, params, created_by, updated_by
       ) VALUES ($1, $2::uuid, 'FY 2026 consolidated income statement', 'income_statement', $3::jsonb, $4, $4)`,
      [ED_FINANCE_IS_SET_ID, EMEKA_ID, JSON.stringify({ consolidated: true, year: 2026 }), EMEKA_ID],
    );

    await client.query('COMMIT');
    return { alreadyPresent: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
