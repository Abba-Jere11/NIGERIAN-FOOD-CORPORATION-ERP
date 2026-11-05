import {
  DMA_BANK_ACCOUNT_ID,
  NFC_BANK_ACCOUNT_ID,
  NOM_BANK_ACCOUNT_ID,
  SEED_USERS,
  XYZ_VENDOR_ID,
  YFW_BANK_ACCOUNT_ID,
  YFW_PROCUREMENT_DUPLICATE_INVOICE_ID,
  YFZ_BANK_ACCOUNT_ID,
  YFZ_PROCUREMENT_AWAITING_FINANCE_ID,
} from '@nfc/shared';
import type { Pool, PoolClient } from 'pg';
import { upsertSearchIndex } from './search';
import { seedVersionLinesFromHeader } from './seed-version-lines';

const MUSA_ID = SEED_USERS.find((user) => user.email === 'gm.yfz@nfc.local')?.id;
const YFW_GM_ID = SEED_USERS.find((user) => user.email === 'gm.yfw@nfc.local')?.id;
const HALIMA_ID = SEED_USERS.find((user) => user.email === 'ed.operations@nfc.local')?.id;
const ABUBAKAR_ID = SEED_USERS.find((user) => user.email === 'md@nfc.local')?.id;
const EMEKA_ID = SEED_USERS.find((user) => user.email === 'ed.finance@nfc.local')?.id;

const CROSS_INVOICE = 'INV-SEED-CROSS-001';

export async function seedM8(pool: Pool): Promise<{ alreadyPresent: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM procurement_requests WHERE id = ANY($1::uuid[])`,
      [[YFZ_PROCUREMENT_AWAITING_FINANCE_ID, YFW_PROCUREMENT_DUPLICATE_INVOICE_ID]],
    );
    const banks = await client.query('SELECT 1 FROM entity_bank_accounts WHERE id = $1', [
      YFZ_BANK_ACCOUNT_ID,
    ]);
    if (existing.rows.length === 2 && banks.rows[0]) {
      await client.query('COMMIT');
      return { alreadyPresent: true };
    }
    if (!MUSA_ID || !YFW_GM_ID || !HALIMA_ID || !ABUBAKAR_ID || !EMEKA_ID) {
      throw new Error('Seed identities before M8 fixtures.');
    }

    const entities = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM entities WHERE code IN ('NFC', 'YFZ', 'YFW', 'DMA', 'NOM')`,
    );
    const byCode = new Map(entities.rows.map((row) => [row.code, row.id]));
    const nfc = byCode.get('NFC');
    const yfz = byCode.get('YFZ');
    const yfw = byCode.get('YFW');
    if (!nfc || !yfz || !yfw) throw new Error('Seed organisations before M8 fixtures.');

    await seedBanks(client, byCode);

    const equipment = await client.query<{ id: string }>(
      `SELECT id FROM procurement_categories WHERE key = 'equipment'`,
    );
    const pcs = await client.query<{ id: string }>(`SELECT id FROM units_of_measure WHERE code = 'PCS'`);
    const funding = await client.query<{ id: string }>(
      `SELECT id FROM funding_sources WHERE key = 'subsidiary_operating'`,
    );
    const yfzBudget = await client.query<{ id: string }>(
      `SELECT id FROM budget_lines WHERE entity_id = $1 AND code = 'YFZ-CAPEX'`,
      [yfz],
    );
    const yfwBudget = await client.query<{ id: string }>(
      `SELECT id FROM budget_lines WHERE entity_id = $1 AND code = 'YFW-CAPEX'`,
      [yfw],
    );
    const stages = await client.query<{ id: string; key: string; definition_id: string }>(
      `SELECT s.id, s.key, s.definition_id
         FROM workflow_stages s
         JOIN workflow_definitions d ON d.id = s.definition_id
        WHERE d.key = 'procurement-v1'`,
    );
    const ops = stages.rows.find((row) => row.key === 'ed-operations');
    const md = stages.rows.find((row) => row.key === 'md');
    const finance = stages.rows.find((row) => row.key === 'ed-finance');
    if (!equipment.rows[0] || !pcs.rows[0] || !funding.rows[0] || !ops || !md || !finance) {
      throw new Error('Procurement reference data or procurement-v1 stages are missing.');
    }

    if (!existing.rows.some((row) => row.id === YFZ_PROCUREMENT_AWAITING_FINANCE_ID)) {
      const reference = await nextFreeReference(client, 'PR-2026-000191');
      await insertRequest(client, {
        id: YFZ_PROCUREMENT_AWAITING_FINANCE_ID,
        reference,
        entityId: yfz,
        originatorId: MUSA_ID,
        title: 'Standby generator for mill switchgear',
        status: 'AWAITING_ED_FINANCE',
        stageId: finance.id,
        definitionId: finance.definition_id,
        categoryId: equipment.rows[0].id,
        unitId: pcs.rows[0].id,
        fundingId: funding.rows[0].id,
        budgetId: yfzBudget.rows[0]?.id ?? null,
        invoiceNumber: CROSS_INVOICE,
      });
      await insertAction(client, YFZ_PROCUREMENT_AWAITING_FINANCE_ID, ops.id, yfz, 'APPROVE', HALIMA_ID);
      await insertAction(client, YFZ_PROCUREMENT_AWAITING_FINANCE_ID, md.id, yfz, 'APPROVE', ABUBAKAR_ID);
    }

    if (!existing.rows.some((row) => row.id === YFW_PROCUREMENT_DUPLICATE_INVOICE_ID)) {
      const reference = await nextFreeReference(client, 'PR-2026-000192');
      await insertRequest(client, {
        id: YFW_PROCUREMENT_DUPLICATE_INVOICE_ID,
        reference,
        entityId: yfw,
        originatorId: YFW_GM_ID,
        title: 'Workshop compressor overhaul kit',
        status: 'AWAITING_OPERATIONS',
        stageId: ops.id,
        definitionId: ops.definition_id,
        categoryId: equipment.rows[0].id,
        unitId: pcs.rows[0].id,
        fundingId: funding.rows[0].id,
        budgetId: yfwBudget.rows[0]?.id ?? null,
        invoiceNumber: CROSS_INVOICE,
      });
    }

    await client.query(
      `INSERT INTO reference_counters (kind, year, last_value)
       VALUES ('PR', 2026, 192)
       ON CONFLICT (kind, year) DO UPDATE SET last_value = GREATEST(reference_counters.last_value, 192)`,
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

async function seedBanks(client: PoolClient, byCode: Map<string, string>): Promise<void> {
  const rows: Array<[string, string, string, string, string, string, number]> = [
    [NFC_BANK_ACCOUNT_ID, 'NFC', 'NFC Holding operating', 'First Bank of Nigeria', 'Nigeria Food Corporation', '2011000001', 500_000_000_000],
    [YFZ_BANK_ACCOUNT_ID, 'YFZ', 'YFZ operating', 'Zenith Bank', 'Yobe Fertilizer', '1011840001', 80_000_000_000],
    [YFW_BANK_ACCOUNT_ID, 'YFW', 'YFW operating', 'UBA', 'Yobe Flour & Wheat Mills', '1011840002', 40_000_000_000],
    [DMA_BANK_ACCOUNT_ID, 'DMA', 'DMA operating', 'Access Bank', 'Damaturu Modern Abattoir', '1011840003', 20_000_000_000],
    [NOM_BANK_ACCOUNT_ID, 'NOM', 'NOM operating', 'GTBank', 'Nguru Oil Mills', '1011840004', 15_000_000_000],
  ];
  if (!EMEKA_ID) throw new Error('Seed identities before M8 bank accounts.');
  for (const [id, code, name, bank, accountName, number, balance] of rows) {
    const entityId = byCode.get(code);
    if (!entityId) continue;
    await client.query(
      `INSERT INTO entity_bank_accounts (
         id, entity_id, name, bank_name, account_name, account_number, recorded_balance_kobo,
         balance_as_of, balance_recorded_by, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, DATE '2026-10-01', $8, $8, $8)
       ON CONFLICT (id) DO NOTHING`,
      [id, entityId, name, bank, accountName, number, balance, EMEKA_ID],
    );
  }
}

async function insertRequest(
  client: PoolClient,
  input: {
    id: string;
    reference: string;
    entityId: string;
    originatorId: string;
    title: string;
    status: string;
    stageId: string;
    definitionId: string;
    categoryId: string;
    unitId: string;
    fundingId: string;
    budgetId: string | null;
    invoiceNumber: string;
  },
): Promise<void> {
  const department = await client.query<{ id: string }>(
    `SELECT id FROM departments WHERE entity_id = $1 AND name = 'Operations' LIMIT 1`,
    [input.entityId],
  );
  await client.query(
    `INSERT INTO procurement_requests (
       id, reference_number, entity_id, department_id, originator_user_id, vendor_id,
       current_version, status, proposed_payment_timing, final_payment_timing,
       final_payment_timing_set_at, final_payment_timing_set_by, created_by, updated_by
     ) VALUES (
       $1, $2, $3, $4, $5::uuid, $6, 1, $7, 'before_delivery',
       CASE WHEN $7 = 'AWAITING_ED_FINANCE' THEN 'before_delivery' ELSE NULL END,
       CASE WHEN $7 = 'AWAITING_ED_FINANCE' THEN now() ELSE NULL END,
       CASE WHEN $7 = 'AWAITING_ED_FINANCE' THEN $5 ELSE NULL END,
       $5, $5
     )`,
    [
      input.id,
      input.reference,
      input.entityId,
      department.rows[0]?.id ?? null,
      input.originatorId,
      XYZ_VENDOR_ID,
      input.status,
    ],
  );
  await client.query(
    `INSERT INTO procurement_versions (
       request_id, entity_id, version_number, title, subject, category_id, reason, description,
       quantity, unit_id, unit_price_kobo, total_amount_kobo, required_date, vendor_id,
       delivery_location, funding_source_id, budget_line_id, urgency, submitted_at, created_by, updated_by
     ) VALUES (
       $1, $2, 1, $3, $3, $4, $5, $6, 2, $7, 250000000, 500000000, DATE '2026-12-15', $8,
       'Mill stores', $9, $10, 'NORMAL', now(), $11, $11
     )`,
    [
      input.id,
      input.entityId,
      input.title,
      input.categoryId,
      'Required for the 2026 reliability programme.',
      `Supply of ${input.title.toLowerCase()}.`,
      input.unitId,
      XYZ_VENDOR_ID,
      input.fundingId,
      input.budgetId,
      input.originatorId,
    ],
  );
  await seedVersionLinesFromHeader(client, input.id);
  await client.query(
    `INSERT INTO workflow_instances (
       definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
       current_stage_id, status, created_by, updated_by
     ) VALUES ($1, 'PROCUREMENT', $2, 1, $3, $4::uuid, $5, 'IN_PROGRESS', $4, $4)`,
    [input.definitionId, input.id, input.entityId, input.originatorId, input.stageId],
  );
  await client.query(
    `INSERT INTO procurement_commitment_events (
       request_id, entity_id, budget_line_id, action, amount_kobo, created_by
     ) VALUES ($1, $2, $3, 'OPEN', 500000000, $4)`,
    [input.id, input.entityId, input.budgetId, input.originatorId],
  );
  await client.query(
    `INSERT INTO vendor_invoice_claims (vendor_id, entity_id, invoice_number, procurement_ref, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [XYZ_VENDOR_ID, input.entityId, input.invoiceNumber, input.reference, input.originatorId],
  );
  await upsertSearchIndex(client, {
    recordType: 'PROCUREMENT',
    recordId: input.id,
    referenceNumber: input.reference,
    title: input.title,
    searchableText: `${input.reference} ${input.title} XYZ Limited ${input.invoiceNumber}`,
    entityId: input.entityId,
    permissionKey: 'procurement.view',
  });
}

async function insertAction(
  client: PoolClient,
  requestId: string,
  stageId: string,
  entityId: string,
  action: string,
  actorId: string,
): Promise<void> {
  const instance = await client.query<{ id: string }>(
    `SELECT id FROM workflow_instances WHERE subject_type = 'PROCUREMENT' AND subject_id = $1`,
    [requestId],
  );
  const instanceId = instance.rows[0]?.id;
  if (!instanceId) return;
  await client.query(
    `INSERT INTO workflow_actions (
       instance_id, stage_id, entity_id, action, actor_id, actor_permission, reason,
       previous_status, new_status, subject_version, snapshot_hash, idempotency_key, created_by
     ) VALUES (
       $1, $2, $3, $4, $5::uuid, 'procurement.approve.operations', NULL, 'IN_PROGRESS', 'IN_PROGRESS', 1,
       'seed-m8', gen_random_uuid()::text, $5
     )`,
    [instanceId, stageId, entityId, action, actorId],
  );
}

async function nextFreeReference(client: PoolClient, preferred: string): Promise<string> {
  const taken = await client.query('SELECT 1 FROM procurement_requests WHERE reference_number = $1', [
    preferred,
  ]);
  if (!taken.rows[0]) return preferred;
  const ceiling = await client.query<{ n: string }>(
    `SELECT GREATEST(
       coalesce((SELECT last_value FROM reference_counters WHERE kind = 'PR' AND year = 2026), 0),
       coalesce((
         SELECT max(substring(reference_number from 9)::int)
           FROM procurement_requests
          WHERE reference_number ~ '^PR-2026-[0-9]{6}$'
       ), 0)
     )::text AS n`,
  );
  let next = Number(ceiling.rows[0]?.n ?? 190) + 1;
  for (;;) {
    const candidate = `PR-2026-${String(next).padStart(6, '0')}`;
    const clash = await client.query('SELECT 1 FROM procurement_requests WHERE reference_number = $1', [
      candidate,
    ]);
    if (!clash.rows[0]) return candidate;
    next += 1;
  }
}
