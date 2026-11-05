import {
  SEED_USERS,
  YFZ_BANK_ACCOUNT_ID,
  YFZ_BANK_STATEMENT_ID,
  YFZ_BUDGET_2026_ID,
  YFZ_PENDING_JOURNAL_ID,
  YFZ_POSTED_JOURNAL_ID,
} from '@nfc/shared';
import type { Pool, PoolClient } from 'pg';
import { upsertSearchIndex } from './search';

const YAHUZA_ID = SEED_USERS.find((user) => user.email === 'fh.yfz@nfc.local')?.id;
const EMEKA_ID = SEED_USERS.find((user) => user.email === 'ed.finance@nfc.local')?.id;

export async function seedM10(pool: Pool): Promise<{ alreadyPresent: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT 1 FROM journals WHERE id = $1', [YFZ_POSTED_JOURNAL_ID]);
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return { alreadyPresent: true };
    }
    if (!YAHUZA_ID || !EMEKA_ID) throw new Error('Seed identities before M10 fixtures.');

    const entities = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM entities WHERE code IN ('NFC', 'YFZ', 'YFW', 'DMA', 'NOM')`,
    );
    const byCode = new Map(entities.rows.map((row) => [row.code, row.id]));
    if (byCode.size < 5) throw new Error('Seed organisations before M10 fixtures.');

    for (const [code, entityId] of byCode) {
      await ensureYear(client, entityId, code);
      await copyAccounts(client, entityId);
    }

    await mapBanks(client, byCode);
    await wrapBudgets(client, byCode);
    await seedJournals(client, byCode.get('YFZ')!);
    await seedStatement(client, byCode.get('YFZ')!);

    await client.query(
      `INSERT INTO reference_counters (kind, year, last_value)
       VALUES ('JNL', 2026, 2), ('BUD', 2026, 5)
       ON CONFLICT (kind, year) DO UPDATE SET last_value = GREATEST(reference_counters.last_value, EXCLUDED.last_value)`,
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

async function ensureYear(client: PoolClient, entityId: string, _code: string): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM fiscal_years WHERE entity_id = $1 AND year = 2026`,
    [entityId],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO fiscal_years (entity_id, year, starts_on, ends_on, created_by, updated_by)
     VALUES ($1, 2026, '2026-01-01', '2026-12-31', $2, $2)
     RETURNING id`,
    [entityId, EMEKA_ID],
  );
  const yearId = inserted.rows[0]!.id;
  for (let index = 1; index <= 12; index += 1) {
    const start = new Date(Date.UTC(2026, index - 1, 1));
    const end = new Date(Date.UTC(2026, index, 0));
    await client.query(
      `INSERT INTO fiscal_periods (
         fiscal_year_id, entity_id, period_index, name, starts_on, ends_on, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [
        yearId,
        entityId,
        index,
        start.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }),
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
        EMEKA_ID,
      ],
    );
  }
  return yearId;
}

async function copyAccounts(client: PoolClient, entityId: string): Promise<void> {
  const templates = await client.query<{
    id: string;
    code: string;
    name: string;
    type: string;
    parent_code: string | null;
    normal_balance: string;
    consolidation_code: string;
    intercompany: boolean;
  }>(
    `SELECT id, code, name, type, parent_code, normal_balance, consolidation_code, intercompany
       FROM account_templates ORDER BY sort_order`,
  );
  const byCode = new Map<string, string>();
  for (const template of templates.rows) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO accounts (
         entity_id, template_id, code, name, type, parent_id, normal_balance,
         consolidation_code, intercompany, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       ON CONFLICT (entity_id, code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [
        entityId,
        template.id,
        template.code,
        template.name,
        template.type,
        template.parent_code ? (byCode.get(template.parent_code) ?? null) : null,
        template.normal_balance,
        template.consolidation_code,
        template.intercompany,
        EMEKA_ID,
      ],
    );
    if (inserted.rows[0]) {
      byCode.set(template.code, inserted.rows[0].id);
      await upsertSearchIndex(client, {
        recordType: 'ACCOUNT',
        recordId: inserted.rows[0].id,
        referenceNumber: template.code,
        title: template.name,
        searchableText: `${template.code} ${template.name}`,
        entityId,
        permissionKey: 'finance.view',
      });
    }
  }
}

async function mapBanks(client: PoolClient, byCode: Map<string, string>): Promise<void> {
  const banks = await client.query<{ id: string; entity_id: string }>(
    `SELECT id, entity_id FROM entity_bank_accounts`,
  );
  for (const bank of banks.rows) {
    const code = [...byCode.entries()].find(([, id]) => id === bank.entity_id)?.[0];
    const accountCode = code === 'NFC' ? '1130' : '1120';
    const gl = await client.query<{ id: string }>(
      `SELECT id FROM accounts WHERE entity_id = $1 AND code = $2`,
      [bank.entity_id, accountCode],
    );
    if (gl.rows[0]) {
      await client.query(`UPDATE entity_bank_accounts SET gl_account_id = $1 WHERE id = $2`, [
        gl.rows[0].id,
        bank.id,
      ]);
    }
  }
}

async function wrapBudgets(client: PoolClient, byCode: Map<string, string>): Promise<void> {
  let version = 0;
  for (const [code, entityId] of byCode) {
    if (code === 'NFC') continue;
    const year = await client.query<{ id: string }>(
      `SELECT id FROM fiscal_years WHERE entity_id = $1 AND year = 2026`,
      [entityId],
    );
    const yearId = year.rows[0]?.id;
    if (!yearId) continue;
    version += 1;
    const budgetId = code === 'YFZ' ? YFZ_BUDGET_2026_ID : undefined;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO budgets (
         id, reference_number, entity_id, fiscal_year_id, version_number, status, created_by, updated_by
       ) VALUES (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, 1, 'APPROVED', $5, $5)
       RETURNING id`,
      [budgetId ?? null, `BUD-2026-${String(version).padStart(6, '0')}`, entityId, yearId, EMEKA_ID],
    );
    const id = inserted.rows[0]!.id;
    await client.query(
      `UPDATE budget_lines SET budget_id = $1, updated_by = $2
        WHERE entity_id = $3 AND fiscal_year = 2026 AND budget_id IS NULL`,
      [id, EMEKA_ID, entityId],
    );
    await upsertSearchIndex(client, {
      recordType: 'BUDGET',
      recordId: id,
      referenceNumber: `BUD-2026-${String(version).padStart(6, '0')}`,
      title: `Budget 2026 ${code}`,
      searchableText: `${code} CAPEX budget 2026`,
      entityId,
      permissionKey: 'finance.budget.view',
    });
  }
  const nfc = byCode.get('NFC');
  if (nfc) {
    const year = await client.query<{ id: string }>(
      `SELECT id FROM fiscal_years WHERE entity_id = $1 AND year = 2026`,
      [nfc],
    );
    if (year.rows[0]) {
      await client.query(
        `INSERT INTO budgets (
           reference_number, entity_id, fiscal_year_id, version_number, status, created_by, updated_by
         ) VALUES ('BUD-2026-000005', $1, $2, 1, 'DRAFT', $3, $3)`,
        [nfc, year.rows[0].id, EMEKA_ID],
      );
    }
  }
}

async function seedJournals(client: PoolClient, yfz: string): Promise<void> {
  const period = await client.query<{ id: string }>(
    `SELECT id FROM fiscal_periods WHERE entity_id = $1 AND period_index = 10`,
    [yfz],
  );
  const admin = await client.query<{ id: string }>(
    `SELECT id FROM accounts WHERE entity_id = $1 AND code = '5220'`,
    [yfz],
  );
  const bank = await client.query<{ id: string }>(
    `SELECT id FROM accounts WHERE entity_id = $1 AND code = '1120'`,
    [yfz],
  );
  const periodId = period.rows[0]?.id;
  const expense = admin.rows[0]?.id;
  const cash = bank.rows[0]?.id;
  if (!periodId || !expense || !cash) throw new Error('YFZ accounts or October 2026 period missing.');

  await insertBalancedJournal(client, {
    id: YFZ_POSTED_JOURNAL_ID,
    reference: 'JNL-2026-000001',
    entityId: yfz,
    periodId,
    narration: 'Seeded administration expense',
    status: 'POSTED',
    debitAccount: expense,
    creditAccount: cash,
    amount: 100_000_000,
    actor: YAHUZA_ID!,
    posted: true,
  });
  await insertBalancedJournal(client, {
    id: YFZ_PENDING_JOURNAL_ID,
    reference: 'JNL-2026-000002',
    entityId: yfz,
    periodId,
    narration: 'Seeded journal awaiting approval',
    status: 'PENDING_APPROVAL',
    debitAccount: expense,
    creditAccount: cash,
    amount: 50_000_000,
    actor: YAHUZA_ID!,
    posted: false,
  });

  const def = await client.query<{ id: string }>(`SELECT id FROM workflow_definitions WHERE key = 'journal-v1'`);
  const stage = await client.query<{ id: string }>(
    `SELECT s.id FROM workflow_stages s JOIN workflow_definitions d ON d.id = s.definition_id
      WHERE d.key = 'journal-v1' AND s.key = 'review'`,
  );
  if (def.rows[0] && stage.rows[0]) {
    const instance = await client.query<{ id: string }>(
      `INSERT INTO workflow_instances (
         definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
         current_stage_id, status, created_by, updated_by
       ) VALUES ($1, 'JOURNAL', $2, 1, $3, $4::uuid, $5, 'IN_PROGRESS', $4, $4)
       RETURNING id`,
      [def.rows[0].id, YFZ_PENDING_JOURNAL_ID, yfz, YAHUZA_ID, stage.rows[0].id],
    );
    await client.query(`UPDATE journals SET workflow_instance_id = $1 WHERE id = $2`, [
      instance.rows[0]?.id,
      YFZ_PENDING_JOURNAL_ID,
    ]);
  }
}

async function insertBalancedJournal(
  client: PoolClient,
  input: {
    id: string;
    reference: string;
    entityId: string;
    periodId: string;
    narration: string;
    status: string;
    debitAccount: string;
    creditAccount: string;
    amount: number;
    actor: string;
    posted: boolean;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO journals (
       id, reference_number, entity_id, fiscal_period_id, status, narration, idempotency_key,
       posted_at, posted_by, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6, NULL, NULL, $7, $7)`,
    [input.id, input.reference, input.entityId, input.periodId, input.narration, `seed-${input.id}`, input.actor],
  );
  await client.query(
    `INSERT INTO journal_lines (
       journal_id, entity_id, account_id, line_number, debit_kobo, credit_kobo, created_by, updated_by
     ) VALUES
       ($1, $2, $3, 1, $4, 0, $6, $6),
       ($1, $2, $5, 2, 0, $4, $6, $6)`,
    [input.id, input.entityId, input.debitAccount, input.amount, input.creditAccount, input.actor],
  );
  await client.query(
    `UPDATE journals
        SET status = $2, posted_at = CASE WHEN $3 THEN now() ELSE NULL END,
            posted_by = CASE WHEN $3 THEN $4 ELSE NULL END, updated_by = $4
      WHERE id = $1`,
    [input.id, input.status, input.posted, input.actor],
  );
  await upsertSearchIndex(client, {
    recordType: 'JOURNAL',
    recordId: input.id,
    referenceNumber: input.reference,
    title: input.narration,
    searchableText: `${input.reference} ${input.narration}`,
    entityId: input.entityId,
    permissionKey: 'finance.view',
  });
}

async function seedStatement(client: PoolClient, yfz: string): Promise<void> {
  await client.query(
    `INSERT INTO bank_statements (id, account_id, entity_id, reference, created_by)
     VALUES ($1, $2, $3, 'YFZ-OCT-2026', $4)`,
    [YFZ_BANK_STATEMENT_ID, YFZ_BANK_ACCOUNT_ID, yfz, EMEKA_ID],
  );
  await client.query(
    `INSERT INTO bank_statement_lines (statement_id, entity_id, occurred_on, description, amount_kobo, created_by)
     VALUES
       ($1, $2, '2026-10-03', 'Admin expense', -100000000, $3),
       ($1, $2, '2026-10-04', 'Unmatched inflow', 25000000, $3)`,
    [YFZ_BANK_STATEMENT_ID, yfz, EMEKA_ID],
  );
}
