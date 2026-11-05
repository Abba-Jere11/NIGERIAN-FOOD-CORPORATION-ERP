import {
  SEED_USERS,
  XYZ_VENDOR_ID,
  YFZ_PROCUREMENT_AWAITING_DELIVERY_ID,
  YFZ_PROCUREMENT_PARTIAL_RECEIPT_ID,
} from '@nfc/shared';
import type { Pool, PoolClient } from 'pg';
import { upsertSearchIndex } from './search';
import { seedVersionLinesFromHeader } from './seed-version-lines';

const MUSA_ID = SEED_USERS.find((user) => user.email === 'gm.yfz@nfc.local')?.id;

const IDS = [YFZ_PROCUREMENT_AWAITING_DELIVERY_ID, YFZ_PROCUREMENT_PARTIAL_RECEIPT_ID];

export async function seedM9(pool: Pool): Promise<{ alreadyPresent: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM procurement_requests WHERE id = ANY($1::uuid[])`,
      [IDS],
    );
    if (existing.rows.length === 2) {
      await client.query('COMMIT');
      return { alreadyPresent: true };
    }
    if (!MUSA_ID) {
      throw new Error('Seed identities before M9 fixtures.');
    }

    const yfz = await client.query<{ id: string }>(`SELECT id FROM entities WHERE code = 'YFZ'`);
    const entityId = yfz.rows[0]?.id;
    if (!entityId) throw new Error('Seed organisations before M9 fixtures.');

    const equipment = await client.query<{ id: string }>(
      `SELECT id FROM procurement_categories WHERE key = 'equipment'`,
    );
    const pcs = await client.query<{ id: string }>(`SELECT id FROM units_of_measure WHERE code = 'PCS'`);
    const funding = await client.query<{ id: string }>(
      `SELECT id FROM funding_sources WHERE key = 'subsidiary_operating'`,
    );
    const budget = await client.query<{ id: string }>(
      `SELECT id FROM budget_lines WHERE entity_id = $1 AND code = 'YFZ-CAPEX'`,
      [entityId],
    );
    const stages = await client.query<{ id: string; key: string; definition_id: string }>(
      `SELECT s.id, s.key, s.definition_id
         FROM workflow_stages s
         JOIN workflow_definitions d ON d.id = s.definition_id
        WHERE d.key = 'procurement-v1'`,
    );
    const finance = stages.rows.find((row) => row.key === 'ed-finance');
    if (!equipment.rows[0] || !pcs.rows[0] || !funding.rows[0] || !finance) {
      throw new Error('Procurement reference data or procurement-v1 stages are missing.');
    }

    if (!existing.rows.some((row) => row.id === YFZ_PROCUREMENT_AWAITING_DELIVERY_ID)) {
      const reference = await nextFreeReference(client, 'PR-2026-000193');
      await insertPaidRequest(client, {
        id: YFZ_PROCUREMENT_AWAITING_DELIVERY_ID,
        reference,
        entityId,
        title: '1,000 kg mill bags awaiting delivery',
        status: 'AWAITING_DELIVERY',
        accepted: 0,
        stageId: finance.id,
        definitionId: finance.definition_id,
        categoryId: equipment.rows[0].id,
        unitId: pcs.rows[0].id,
        fundingId: funding.rows[0].id,
        budgetId: budget.rows[0]?.id ?? null,
      });
    }

    if (!existing.rows.some((row) => row.id === YFZ_PROCUREMENT_PARTIAL_RECEIPT_ID)) {
      const reference = await nextFreeReference(client, 'PR-2026-000194');
      await insertPaidRequest(client, {
        id: YFZ_PROCUREMENT_PARTIAL_RECEIPT_ID,
        reference,
        entityId,
        title: '1,000 filter cartridges — 800 received',
        status: 'PARTIALLY_RECEIVED',
        accepted: 800,
        stageId: finance.id,
        definitionId: finance.definition_id,
        categoryId: equipment.rows[0].id,
        unitId: pcs.rows[0].id,
        fundingId: funding.rows[0].id,
        budgetId: budget.rows[0]?.id ?? null,
      });
      const version = await client.query<{ id: string }>(
        `SELECT id FROM procurement_versions WHERE request_id = $1 AND version_number = 1`,
        [YFZ_PROCUREMENT_PARTIAL_RECEIPT_ID],
      );
      const allocated = await client.query<{ ref: string }>('SELECT app.next_reference($1, 2026) AS ref', [
        'GRN',
      ]);
      const grn = allocated.rows[0]?.ref ?? (await nextFreeGrn(client, 'GRN-2026-000001'));
      const line = await client.query<{ id: string }>(
        `SELECT id FROM procurement_version_lines WHERE version_id = $1 AND line_number = 1`,
        [version.rows[0]?.id],
      );
      await client.query(
        `INSERT INTO procurement_goods_receipts (
           reference_number, request_id, version_id, entity_id, line_id, received_date, location,
           quantity_ordered, quantity_received, quantity_accepted, quantity_rejected,
           idempotency_key, created_by
         ) VALUES ($1, $2, $3, $4, $5, DATE '2026-10-01', 'YFZ mill stores', 1000, 800, 800, 0, $6, $7)`,
        [
          grn,
          YFZ_PROCUREMENT_PARTIAL_RECEIPT_ID,
          version.rows[0]?.id,
          entityId,
          line.rows[0]?.id ?? null,
          `seed-m9-partial-${YFZ_PROCUREMENT_PARTIAL_RECEIPT_ID}`,
          MUSA_ID,
        ],
      );
    }

    await client.query(
      `INSERT INTO reference_counters (kind, year, last_value)
       VALUES ('PR', 2026, 194)
       ON CONFLICT (kind, year) DO UPDATE SET last_value = GREATEST(reference_counters.last_value, 194)`,
    );
    await client.query(
      `INSERT INTO reference_counters (kind, year, last_value)
       VALUES ('GRN', 2026, 1)
       ON CONFLICT (kind, year) DO UPDATE SET last_value = GREATEST(reference_counters.last_value, 1)`,
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

async function insertPaidRequest(
  client: PoolClient,
  input: {
    id: string;
    reference: string;
    entityId: string;
    title: string;
    status: string;
    accepted: number;
    stageId: string;
    definitionId: string;
    categoryId: string;
    unitId: string;
    fundingId: string;
    budgetId: string | null;
  },
): Promise<void> {
  if (!MUSA_ID) throw new Error('Seed identities before M9 fixtures.');
  const department = await client.query<{ id: string }>(
    `SELECT id FROM departments WHERE entity_id = $1 AND name = 'Operations' LIMIT 1`,
    [input.entityId],
  );
  await client.query(
    `INSERT INTO procurement_requests (
       id, reference_number, entity_id, department_id, originator_user_id, vendor_id,
       current_version, status, accepted_quantity_total, proposed_payment_timing,
       final_payment_timing, final_payment_timing_set_at, final_payment_timing_set_by,
       created_by, updated_by
     ) VALUES (
       $1, $2, $3, $4, $5::uuid, $6, 1, $7, $8, 'before_delivery', 'before_delivery', now(), $5, $5, $5
     )`,
    [
      input.id,
      input.reference,
      input.entityId,
      department.rows[0]?.id ?? null,
      MUSA_ID,
      XYZ_VENDOR_ID,
      input.status,
      input.accepted,
    ],
  );
  await client.query(
    `INSERT INTO procurement_versions (
       request_id, entity_id, version_number, title, subject, category_id, reason, description,
       quantity, unit_id, unit_price_kobo, total_amount_kobo, required_date, vendor_id,
       delivery_location, funding_source_id, budget_line_id, urgency, submitted_at, created_by, updated_by
     ) VALUES (
       $1, $2, 1, $3, $3, $4, $5, $6, 1000, $7, 10000, 10000000, DATE '2026-12-15', $8,
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
      MUSA_ID,
    ],
  );
  await seedVersionLinesFromHeader(client, input.id);
  const version = await client.query<{ id: string }>(
    `SELECT id FROM procurement_versions WHERE request_id = $1 AND version_number = 1`,
    [input.id],
  );
  const snapshot = {
    templateVersion: 2,
    referenceNumber: input.reference,
    title: input.title,
    subject: input.title,
    quantity: 1000,
  };
  await client.query(
    `INSERT INTO procurement_memo_snapshots (
       request_id, version_id, entity_id, memo_template_version, canonical_json,
       memo_snapshot_hash, pdf_hash, budget_available_kobo, created_by
     ) VALUES ($1, $2, $3, 2, $4::jsonb, $5, $5, 0, $6)`,
    [
      input.id,
      version.rows[0]?.id,
      input.entityId,
      JSON.stringify(snapshot),
      '0'.repeat(64),
      MUSA_ID,
    ],
  );
  await client.query(
    `INSERT INTO workflow_instances (
       definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
       current_stage_id, status, money_moved, created_by, updated_by
     ) VALUES ($1, 'PROCUREMENT', $2, 1, $3, $4::uuid, $5, 'COMPLETED', true, $4, $4)`,
    [input.definitionId, input.id, input.entityId, MUSA_ID, input.stageId],
  );
  await upsertSearchIndex(client, {
    recordType: 'PROCUREMENT',
    recordId: input.id,
    referenceNumber: input.reference,
    title: input.title,
    searchableText: `${input.reference} ${input.title} XYZ Limited`,
    entityId: input.entityId,
    permissionKey: 'procurement.view',
  });
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
  let next = Number(ceiling.rows[0]?.n ?? 192) + 1;
  for (;;) {
    const candidate = `PR-2026-${String(next).padStart(6, '0')}`;
    const clash = await client.query('SELECT 1 FROM procurement_requests WHERE reference_number = $1', [
      candidate,
    ]);
    if (!clash.rows[0]) return candidate;
    next += 1;
  }
}

async function nextFreeGrn(client: PoolClient, preferred: string): Promise<string> {
  const taken = await client.query('SELECT 1 FROM procurement_goods_receipts WHERE reference_number = $1', [
    preferred,
  ]);
  if (!taken.rows[0]) return preferred;
  let next = 2;
  for (;;) {
    const candidate = `GRN-2026-${String(next).padStart(6, '0')}`;
    const clash = await client.query('SELECT 1 FROM procurement_goods_receipts WHERE reference_number = $1', [
      candidate,
    ]);
    if (!clash.rows[0]) return candidate;
    next += 1;
  }
}
