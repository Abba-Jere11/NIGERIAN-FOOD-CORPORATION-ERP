import {
  EDMS_PROCUREMENT_SLOTS,
  SEED_USERS,
  XYZ_VENDOR_ID,
  YFZ_EDMS_COMPLETED_ID,
} from '@nfc/shared';
import type { Pool, PoolClient } from 'pg';
import { seedVersionLinesFromHeader } from './seed-version-lines';

const MUSA_ID = SEED_USERS.find((user) => user.email === 'gm.yfz@nfc.local')?.id;
const TITLE = 'YFZ mill bag archive fixture';

export async function seedM15(pool: Pool): Promise<{ alreadyPresent: boolean; packagesFiled: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO edms_tags (key, name, created_by, updated_by) VALUES
         ('urgent', 'Urgent', 'system:seed', 'system:seed'),
         ('confidential', 'Confidential', 'system:seed', 'system:seed')
       ON CONFLICT (key) DO NOTHING`,
    );

    const entities = await client.query<{ id: string }>(`SELECT id FROM entities WHERE status = 'ACTIVE'`);
    for (const entity of entities.rows) {
      await client.query(`SELECT app.seed_edms_entity_folders($1, 'system:seed')`, [entity.id]);
    }

    const existing = await client.query('SELECT 1 FROM procurement_requests WHERE id = $1', [
      YFZ_EDMS_COMPLETED_ID,
    ]);
    if (existing.rows[0]) {
      const filed = await fileCompletedWithoutPackage(client);
      await client.query('COMMIT');
      return { alreadyPresent: true, packagesFiled: filed };
    }
    if (!MUSA_ID) throw new Error('Seed identities before M15 fixtures.');

    const yfz = await client.query<{ id: string }>(`SELECT id FROM entities WHERE code = 'YFZ'`);
    const entityId = yfz.rows[0]?.id;
    if (!entityId) throw new Error('Seed organisations before M15 fixtures.');

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
    const department = await client.query<{ id: string }>(
      `SELECT id FROM departments WHERE entity_id = $1 AND name = 'Operations' LIMIT 1`,
      [entityId],
    );
    if (!equipment.rows[0] || !pcs.rows[0] || !funding.rows[0]) {
      throw new Error('Procurement reference data is missing.');
    }

    await client.query(
      `INSERT INTO procurement_requests (
         id, reference_number, entity_id, department_id, originator_user_id, vendor_id,
         current_version, status, accepted_quantity_total, proposed_payment_timing,
         final_payment_timing, final_payment_timing_set_at, final_payment_timing_set_by,
         created_by, updated_by
       ) VALUES (
         $1, 'PR-2026-000195', $2, $3, $4::uuid, $5, 1, 'COMPLETED', 1000, 'before_delivery',
         'before_delivery', now(), $4, $4, $4
       )`,
      [YFZ_EDMS_COMPLETED_ID, entityId, department.rows[0]?.id ?? null, MUSA_ID, XYZ_VENDOR_ID],
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
        YFZ_EDMS_COMPLETED_ID,
        entityId,
        TITLE,
        equipment.rows[0].id,
        'Required for the 2026 archive programme.',
        `Supply of ${TITLE.toLowerCase()}.`,
        pcs.rows[0].id,
        XYZ_VENDOR_ID,
        funding.rows[0].id,
        budget.rows[0]?.id ?? null,
        MUSA_ID,
      ],
    );
    await seedVersionLinesFromHeader(client, YFZ_EDMS_COMPLETED_ID);
    await client.query(
      `INSERT INTO reference_counters (kind, year, last_value)
       VALUES ('PR', 2026, 195)
       ON CONFLICT (kind, year) DO UPDATE SET last_value = GREATEST(reference_counters.last_value, 195)`,
    );

    const filed = await fileCompletedWithoutPackage(client);
    await client.query('COMMIT');
    return { alreadyPresent: false, packagesFiled: filed };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function fileCompletedWithoutPackage(client: PoolClient): Promise<number> {
  const due = await client.query<{
    id: string;
    entity_id: string;
    title: string;
    reference_number: string;
    created_at: Date;
  }>(
    `SELECT r.id, r.entity_id, v.title, r.reference_number, r.created_at
       FROM procurement_requests r
       JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
      WHERE r.status = 'COMPLETED'
        AND NOT EXISTS (
          SELECT 1 FROM edms_folders f
           WHERE f.source_type = 'PROCUREMENT' AND f.source_id = r.id
        )`,
  );
  let filed = 0;
  for (const row of due.rows) {
    await client.query(`SELECT app.seed_edms_entity_folders($1, 'system:seed')`, [row.entity_id]);
    const year = String(row.created_at.getUTCFullYear());
    const procurement = await client.query<{ id: string }>(
      `SELECT f.id
         FROM edms_folders f
         JOIN edms_folders active ON active.id = f.parent_id
        WHERE f.entity_id = $1 AND f.name = 'Procurement' AND active.name = 'Active' AND active.parent_id IS NULL`,
      [row.entity_id],
    );
    const procurementId = procurement.rows[0]?.id;
    if (!procurementId) continue;
    let yearId = (
      await client.query<{ id: string }>(
        `SELECT id FROM edms_folders WHERE entity_id = $1 AND parent_id = $2 AND name = $3`,
        [row.entity_id, procurementId, year],
      )
    ).rows[0]?.id;
    if (!yearId) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO edms_folders (entity_id, parent_id, name, kind, created_by, updated_by)
         VALUES ($1, $2, $3, 'year', 'system:seed', 'system:seed')
         RETURNING id`,
        [row.entity_id, procurementId, year],
      );
      yearId = inserted.rows[0]?.id;
    }
    if (!yearId) continue;
    let name = row.title;
    const clash = await client.query(
      `SELECT 1 FROM edms_folders WHERE parent_id = $1 AND name = $2`,
      [yearId, name],
    );
    if (clash.rows[0]) name = `${name} [${row.reference_number}]`;
    const pack = await client.query<{ id: string }>(
      `INSERT INTO edms_folders (
         entity_id, parent_id, name, kind, source_type, source_id, created_by, updated_by
       ) VALUES ($1, $2, $3, 'package', 'PROCUREMENT', $4, 'system:seed', 'system:seed')
       ON CONFLICT (source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [row.entity_id, yearId, name, row.id],
    );
    const packageId =
      pack.rows[0]?.id ??
      (
        await client.query<{ id: string }>(
          `SELECT id FROM edms_folders WHERE source_type = 'PROCUREMENT' AND source_id = $1`,
          [row.id],
        )
      ).rows[0]?.id;
    if (!packageId) continue;
    for (const slot of EDMS_PROCUREMENT_SLOTS) {
      await client.query(
        `INSERT INTO edms_folders (entity_id, parent_id, name, kind, created_by, updated_by)
         VALUES ($1, $2, $3, 'slot', 'system:seed', 'system:seed')
         ON CONFLICT (entity_id, parent_id, name) WHERE parent_id IS NOT NULL DO NOTHING`,
        [row.entity_id, packageId, `${slot.slot} ${slot.label}`],
      );
    }
    filed += 1;
  }
  return filed;
}
