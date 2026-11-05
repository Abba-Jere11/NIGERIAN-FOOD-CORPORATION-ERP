import { SEED_USERS, XYZ_VENDOR_ID, YFZ_PROCUREMENT_DRAFT_ID, YFZ_REQUISITION_DRAFT_ID } from '@nfc/shared';
import type { Pool, PoolClient } from 'pg';
import { upsertSearchIndex } from './search';
import { seedVersionLinesFromHeader } from './seed-version-lines';

const MUSA_ID = SEED_USERS.find((user) => user.email === 'gm.yfz@nfc.local')?.id;

export async function seedM6(pool: Pool): Promise<{ alreadyPresent: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT 1 FROM procurement_requests WHERE id = $1', [
      YFZ_PROCUREMENT_DRAFT_ID,
    ]);
    if (existing.rows[0]) {
      const yfzRow = await client.query<{ id: string }>(`SELECT id FROM entities WHERE code = 'YFZ'`);
      if (yfzRow.rows[0]) await seedRequisitionDraft(client, yfzRow.rows[0].id);
      await client.query('COMMIT');
      return { alreadyPresent: true };
    }
    if (!MUSA_ID) throw new Error('Seed identities before M6 fixtures.');

    const entities = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM entities WHERE code IN ('YFZ', 'YFW', 'DMA', 'NOM')`,
    );
    const byCode = new Map(entities.rows.map((row) => [row.code, row.id]));
    const yfz = byCode.get('YFZ');
    if (!yfz) throw new Error('Seed organisations before M6 fixtures.');

    const department = await client.query<{ id: string }>(
      `SELECT id FROM departments WHERE entity_id = $1 AND name = 'Operations' LIMIT 1`,
      [yfz],
    );
    const departmentId = department.rows[0]?.id;
    const equipment = await client.query<{ id: string }>(
      `SELECT id FROM procurement_categories WHERE key = 'equipment'`,
    );
    const pcs = await client.query<{ id: string }>(`SELECT id FROM units_of_measure WHERE code = 'PCS'`);
    const funding = await client.query<{ id: string }>(
      `SELECT id FROM funding_sources WHERE key = 'subsidiary_operating'`,
    );
    const equipmentId = equipment.rows[0]?.id;
    const unitId = pcs.rows[0]?.id;
    const fundingId = funding.rows[0]?.id;
    if (!equipmentId || !unitId || !fundingId) {
      throw new Error('Procurement reference data was not seeded by migration 0019.');
    }

    for (const [code, entityId] of byCode) {
      await client.query(
        `INSERT INTO budget_lines (
           entity_id, fiscal_year, code, name, approved_amount_kobo, created_by, updated_by
         ) VALUES ($1, 2026, $2, $3, $4, $5, $5)
         ON CONFLICT (entity_id, fiscal_year, code) DO NOTHING`,
        [entityId, `${code}-CAPEX`, `${code} capital expenditure`, 50_000_000_000, MUSA_ID],
      );
    }

    await client.query(
      `INSERT INTO projects (entity_id, code, name, created_by, updated_by)
       VALUES ($1, 'YFZ-MILL', 'Yobe Fertilizer mill upgrade', $2, $2)
       ON CONFLICT (entity_id, code) DO NOTHING`,
      [yfz, MUSA_ID],
    );

    const budget = await client.query<{ id: string }>(
      `SELECT id FROM budget_lines WHERE entity_id = $1 AND code = 'YFZ-CAPEX'`,
      [yfz],
    );
    const project = await client.query<{ id: string }>(
      `SELECT id FROM projects WHERE entity_id = $1 AND code = 'YFZ-MILL'`,
      [yfz],
    );
    const budgetId = budget.rows[0]?.id;
    const projectId = project.rows[0]?.id;

    await client.query(
      `INSERT INTO procurement_requests (
         id, reference_number, entity_id, department_id, originator_user_id, vendor_id,
         current_version, status, created_by, updated_by
       ) VALUES (
         $1, 'PR-2026-000186', $2, $3, $4::uuid, $5, 1, 'DRAFT', $6, $6
       )`,
      [YFZ_PROCUREMENT_DRAFT_ID, yfz, departmentId ?? null, MUSA_ID, XYZ_VENDOR_ID, MUSA_ID],
    );
    await client.query(
      `INSERT INTO procurement_versions (
         request_id, entity_id, version_number, title, subject, category_id, reason, description,
         quantity, unit_id, unit_price_kobo, total_amount_kobo, required_date, vendor_id,
         delivery_location, funding_source_id, budget_line_id, project_id, urgency, created_by, updated_by
       ) VALUES (
         $1, $2, 1, 'Replacement conveyor rollers', 'Replacement of worn conveyor rollers at YFZ',
         $3, 'Existing rollers are beyond economic repair.',
         'Supply of 12 heavy-duty conveyor rollers for the main mill line.',
         12, $4::uuid, 25000000, 300000000, DATE '2026-12-15', $5,
         'Yobe Fertilizer mill stores, Damaturu', $6, $7, $8, 'NORMAL', $9, $9
       )`,
      [
        YFZ_PROCUREMENT_DRAFT_ID,
        yfz,
        equipmentId,
        unitId,
        XYZ_VENDOR_ID,
        fundingId,
        budgetId ?? null,
        projectId ?? null,
        MUSA_ID,
      ],
    );
    await seedVersionLinesFromHeader(client, YFZ_PROCUREMENT_DRAFT_ID);

    await client.query(
      `INSERT INTO reference_counters (kind, year, last_value)
       VALUES ('PR', 2026, 186)
       ON CONFLICT (kind, year) DO UPDATE SET last_value = GREATEST(reference_counters.last_value, 186)`,
    );

    await upsertSearchIndex(client, {
      recordType: 'PROCUREMENT',
      recordId: YFZ_PROCUREMENT_DRAFT_ID,
      referenceNumber: 'PR-2026-000186',
      title: 'Replacement conveyor rollers',
      searchableText: 'PR-2026-000186 Replacement conveyor rollers XYZ Limited YFZ 300000000',
      entityId: yfz,
      permissionKey: 'procurement.view',
    });

    await seedRequisitionDraft(client, yfz);

    await client.query('COMMIT');
    return { alreadyPresent: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedRequisitionDraft(client: PoolClient, yfz: string): Promise<void> {
  if (!MUSA_ID) return;
  const existing = await client.query('SELECT 1 FROM requisitions WHERE id = $1', [YFZ_REQUISITION_DRAFT_ID]);
  if (existing.rows[0]) return;
  const department = await client.query<{ id: string }>(
    `SELECT id FROM departments WHERE entity_id = $1 AND name = 'Operations' LIMIT 1`,
    [yfz],
  );
  const equipment = await client.query<{ id: string }>(`SELECT id FROM procurement_categories WHERE key = 'equipment'`);
  const pcs = await client.query<{ id: string }>(`SELECT id FROM units_of_measure WHERE code = 'PCS'`);
  await client.query(
    `INSERT INTO requisitions (
       id, reference_number, entity_id, department_id, originator_user_id, created_by, updated_by
     ) VALUES ($1, 'REQ-2026-000001', $2, $3, $4::uuid, $4, $4)
     ON CONFLICT (id) DO NOTHING`,
    [YFZ_REQUISITION_DRAFT_ID, yfz, department.rows[0]?.id ?? null, MUSA_ID],
  );
  await client.query(
    `INSERT INTO requisition_versions (
       requisition_id, entity_id, version_number, title, background, justification, prayer,
       category_id, required_date, urgency, delivery_location, created_by, updated_by
     )
     SELECT $1, $2, 1, 'Mill spare parts need', 'Existing rollers are beyond economic repair.',
            'The mill cannot run safely without replacement rollers.',
            'Management is invited to approve the need.',
            $3, DATE '2026-12-15', 'NORMAL', 'Yobe Fertilizer mill stores, Damaturu', $4, $4
      WHERE NOT EXISTS (
        SELECT 1 FROM requisition_versions WHERE requisition_id = $1 AND version_number = 1
      )`,
    [YFZ_REQUISITION_DRAFT_ID, yfz, equipment.rows[0]?.id ?? null, MUSA_ID],
  );
  await client.query(
    `INSERT INTO requisition_lines (
       version_id, entity_id, line_number, description, quantity, unit_id, created_by, updated_by
     )
     SELECT v.id, v.entity_id, 1, 'Heavy-duty conveyor rollers', 12, $2, $3, $3
       FROM requisition_versions v
      WHERE v.requisition_id = $1 AND v.version_number = 1
        AND NOT EXISTS (SELECT 1 FROM requisition_lines l WHERE l.version_id = v.id)`,
    [YFZ_REQUISITION_DRAFT_ID, pcs.rows[0]?.id ?? null, MUSA_ID],
  );
  await client.query(
    `INSERT INTO reference_counters (kind, year, last_value)
     VALUES ('REQ', 2026, 1)
     ON CONFLICT (kind, year) DO UPDATE SET last_value = GREATEST(reference_counters.last_value, 1)`,
  );
}
