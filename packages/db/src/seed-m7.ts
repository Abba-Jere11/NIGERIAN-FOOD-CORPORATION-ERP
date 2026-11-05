import {
  SEED_USERS,
  XYZ_VENDOR_ID,
  YFZ_PROCUREMENT_AWAITING_MD_ID,
  YFZ_PROCUREMENT_AWAITING_OPS_ID,
  YFZ_PROCUREMENT_REJECTED_ID,
  YFZ_PROCUREMENT_RETURNED_ID,
} from '@nfc/shared';
import type { Pool, PoolClient } from 'pg';
import { upsertSearchIndex } from './search';
import { seedVersionLinesFromHeader } from './seed-version-lines';

const MUSA_ID = SEED_USERS.find((user) => user.email === 'gm.yfz@nfc.local')?.id;
const HALIMA_ID = SEED_USERS.find((user) => user.email === 'ed.operations@nfc.local')?.id;
const ABUBAKAR_ID = SEED_USERS.find((user) => user.email === 'md@nfc.local')?.id;

interface SeedRefs {
  yfz: string;
  departmentId: string | null;
  equipmentId: string;
  unitId: string;
  fundingId: string;
  budgetId: string | null;
  projectId: string | null;
  opsStageId: string;
  mdStageId: string;
  gmStageId: string;
  definitionId: string;
}

export async function seedM7(pool: Pool): Promise<{ alreadyPresent: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM procurement_requests
        WHERE id = ANY($1::uuid[])`,
      [
        [
          YFZ_PROCUREMENT_AWAITING_OPS_ID,
          YFZ_PROCUREMENT_AWAITING_MD_ID,
          YFZ_PROCUREMENT_RETURNED_ID,
          YFZ_PROCUREMENT_REJECTED_ID,
        ],
      ],
    );
    if (existing.rows.length === 4) {
      await client.query('COMMIT');
      return { alreadyPresent: true };
    }
    if (!MUSA_ID || !HALIMA_ID || !ABUBAKAR_ID) {
      throw new Error('Seed identities before M7 fixtures.');
    }

    const yfz = await client.query<{ id: string }>(`SELECT id FROM entities WHERE code = 'YFZ'`);
    const yfzId = yfz.rows[0]?.id;
    if (!yfzId) throw new Error('Seed organisations before M7 fixtures.');

    const department = await client.query<{ id: string }>(
      `SELECT id FROM departments WHERE entity_id = $1 AND name = 'Operations' LIMIT 1`,
      [yfzId],
    );
    const equipment = await client.query<{ id: string }>(
      `SELECT id FROM procurement_categories WHERE key = 'equipment'`,
    );
    const pcs = await client.query<{ id: string }>(`SELECT id FROM units_of_measure WHERE code = 'PCS'`);
    const funding = await client.query<{ id: string }>(
      `SELECT id FROM funding_sources WHERE key = 'subsidiary_operating'`,
    );
    const budget = await client.query<{ id: string }>(
      `SELECT id FROM budget_lines WHERE entity_id = $1 AND code = 'YFZ-CAPEX'`,
      [yfzId],
    );
    const project = await client.query<{ id: string }>(
      `SELECT id FROM projects WHERE entity_id = $1 AND code = 'YFZ-MILL'`,
      [yfzId],
    );
    const stages = await client.query<{ id: string; key: string; definition_id: string }>(
      `SELECT s.id, s.key, s.definition_id
         FROM workflow_stages s
         JOIN workflow_definitions d ON d.id = s.definition_id
        WHERE d.key = 'procurement-v1'`,
    );
    const ops = stages.rows.find((row) => row.key === 'ed-operations');
    const md = stages.rows.find((row) => row.key === 'md');
    const gmStage = stages.rows.find((row) => row.key === 'gm-submission');
    if (!equipment.rows[0] || !pcs.rows[0] || !funding.rows[0] || !ops || !md || !gmStage) {
      throw new Error('Procurement reference data or procurement-v1 stages are missing.');
    }

    const refs: SeedRefs = {
      yfz: yfzId,
      departmentId: department.rows[0]?.id ?? null,
      equipmentId: equipment.rows[0].id,
      unitId: pcs.rows[0].id,
      fundingId: funding.rows[0].id,
      budgetId: budget.rows[0]?.id ?? null,
      projectId: project.rows[0]?.id ?? null,
      opsStageId: ops.id,
      mdStageId: md.id,
      gmStageId: gmStage.id,
      definitionId: ops.definition_id,
    };

    const refsToInsert = [
      {
        id: YFZ_PROCUREMENT_AWAITING_OPS_ID,
        preferred: 'PR-2026-000187',
        title: 'Spare mill bearings',
        status: 'AWAITING_OPERATIONS',
        version: 1,
        stageId: refs.opsStageId,
        workflowStatus: 'IN_PROGRESS' as const,
      },
      {
        id: YFZ_PROCUREMENT_AWAITING_MD_ID,
        preferred: 'PR-2026-000188',
        title: 'Laboratory moisture analyser',
        status: 'AWAITING_MD',
        version: 1,
        stageId: refs.mdStageId,
        workflowStatus: 'IN_PROGRESS' as const,
        opsApproved: true,
      },
      {
        id: YFZ_PROCUREMENT_RETURNED_ID,
        preferred: 'PR-2026-000189',
        title: 'Warehouse racking extension',
        status: 'DRAFT',
        version: 2,
        stageId: refs.opsStageId,
        workflowStatus: 'DRAFT' as const,
        returned: true,
      },
      {
        id: YFZ_PROCUREMENT_REJECTED_ID,
        preferred: 'PR-2026-000190',
        title: 'Office split air-conditioners',
        status: 'REJECTED',
        version: 1,
        stageId: refs.opsStageId,
        workflowStatus: 'REJECTED' as const,
        rejected: true,
      },
    ];

    let highest = 186;
    for (const fixture of refsToInsert) {
      if (existing.rows.some((row) => row.id === fixture.id)) continue;
      const reference = await nextFreeReference(client, fixture.preferred);
      const parsed = Number(reference.slice(-6));
      if (Number.isFinite(parsed)) highest = Math.max(highest, parsed);
      await insertFixture(client, refs, {
        id: fixture.id,
        reference,
        title: fixture.title,
        status: fixture.status,
        version: fixture.version,
        stageId: fixture.stageId,
        workflowStatus: fixture.workflowStatus,
        opsApproved: fixture.opsApproved,
        returned: fixture.returned,
        rejected: fixture.rejected,
      });
    }

    await client.query(
      `INSERT INTO reference_counters (kind, year, last_value)
       VALUES ('PR', 2026, $1)
       ON CONFLICT (kind, year) DO UPDATE SET last_value = GREATEST(reference_counters.last_value, $1)`,
      [highest],
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

async function insertFixture(
  client: PoolClient,
  refs: SeedRefs,
  input: {
    id: string;
    reference: string;
    title: string;
    status: string;
    version: number;
    stageId: string;
    workflowStatus: string;
    opsApproved?: boolean;
    returned?: boolean;
    rejected?: boolean;
  },
): Promise<void> {
  if (!MUSA_ID || !HALIMA_ID) throw new Error('Seed identities before M7 fixtures.');
  await client.query(
    `INSERT INTO procurement_requests (
       id, reference_number, entity_id, department_id, originator_user_id, vendor_id,
       current_version, status, proposed_payment_timing, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5::uuid, $6, $7, $8, 'before_delivery', $5, $5)`,
    [input.id, input.reference, refs.yfz, refs.departmentId, MUSA_ID, XYZ_VENDOR_ID, input.version, input.status],
  );

  const versionOne = await client.query<{ id: string }>(
    `INSERT INTO procurement_versions (
       request_id, entity_id, version_number, title, subject, category_id, reason, description,
       quantity, unit_id, unit_price_kobo, total_amount_kobo, required_date, vendor_id,
       delivery_location, funding_source_id, budget_line_id, project_id, urgency,
       submitted_at, created_by, updated_by
     ) VALUES (
       $1, $2, 1, $3, $4, $5, $6, $7, 4, $8, 150000000, 600000000, DATE '2026-11-30', $9,
       'Yobe Fertilizer mill stores, Damaturu', $10, $11, $12, 'NORMAL', now(), $13, $13
     ) RETURNING id`,
    [
      input.id,
      refs.yfz,
      input.title,
      input.title,
      refs.equipmentId,
      'Required for the 2026 mill uptime programme.',
      `Supply of ${input.title.toLowerCase()} for Yobe Fertilizer.`,
      refs.unitId,
      XYZ_VENDOR_ID,
      refs.fundingId,
      refs.budgetId,
      refs.projectId,
      MUSA_ID,
    ],
  );

  if (input.version === 2) {
    await client.query(
      `INSERT INTO procurement_versions (
         request_id, entity_id, version_number, title, subject, category_id, reason, description,
         quantity, unit_id, unit_price_kobo, total_amount_kobo, required_date, vendor_id,
         delivery_location, funding_source_id, budget_line_id, project_id, urgency, created_by, updated_by
       )
       SELECT request_id, entity_id, 2, title, subject, category_id, reason, description,
              quantity, unit_id, unit_price_kobo, total_amount_kobo, required_date, vendor_id,
              delivery_location, funding_source_id, budget_line_id, project_id, urgency, $2, $2
         FROM procurement_versions WHERE id = $1`,
      [versionOne.rows[0]?.id, MUSA_ID],
    );
  }
  await seedVersionLinesFromHeader(client, input.id);

  const instance = await client.query<{ id: string }>(
    `INSERT INTO workflow_instances (
       definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
       current_stage_id, status, created_by, updated_by
     ) VALUES ($1, 'PROCUREMENT', $2, $3, $4, $5::uuid, $6, $7, $5, $5)
     RETURNING id`,
    [
      refs.definitionId,
      input.id,
      input.version,
      refs.yfz,
      MUSA_ID,
      input.returned ? refs.gmStageId : input.stageId,
      input.workflowStatus,
    ],
  );
  const instanceId = instance.rows[0]?.id;
  if (!instanceId) throw new Error('M7 workflow instance was not created.');

  if (input.opsApproved) {
    await insertAction(client, instanceId, refs.opsStageId, refs.yfz, 'APPROVE', HALIMA_ID, null, 'IN_PROGRESS', 'IN_PROGRESS', 1);
  }
  if (input.returned) {
    await insertAction(
      client,
      instanceId,
      refs.opsStageId,
      refs.yfz,
      'RETURN_FOR_CORRECTION',
      HALIMA_ID,
      'Quantity is not supported by the production requirement stated in the memo.',
      'IN_PROGRESS',
      'DRAFT',
      1,
    );
  }
  if (input.rejected) {
    await insertAction(
      client,
      instanceId,
      refs.opsStageId,
      refs.yfz,
      'REJECT',
      HALIMA_ID,
      'Specification does not match the approved mill package.',
      'IN_PROGRESS',
      'REJECTED',
      1,
    );
  }

  if (input.status === 'AWAITING_OPERATIONS' || input.status === 'AWAITING_MD') {
    await client.query(
      `INSERT INTO procurement_commitment_events (
         request_id, entity_id, budget_line_id, action, amount_kobo, created_by
       ) VALUES ($1, $2, $3, 'OPEN', 600000000, $4)`,
      [input.id, refs.yfz, refs.budgetId, MUSA_ID],
    );
  }

  await upsertSearchIndex(client, {
    recordType: 'PROCUREMENT',
    recordId: input.id,
    referenceNumber: input.reference,
    title: input.title,
    searchableText: `${input.reference} ${input.title} XYZ Limited YFZ`,
    entityId: refs.yfz,
    permissionKey: 'procurement.view',
  });
}

async function nextFreeReference(client: PoolClient, preferred: string): Promise<string> {
  const taken = await client.query<{ reference_number: string }>(
    `SELECT reference_number FROM procurement_requests WHERE reference_number = $1`,
    [preferred],
  );
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
  let next = Number(ceiling.rows[0]?.n ?? 186) + 1;
  for (;;) {
    const candidate = `PR-2026-${String(next).padStart(6, '0')}`;
    const clash = await client.query('SELECT 1 FROM procurement_requests WHERE reference_number = $1', [
      candidate,
    ]);
    if (!clash.rows[0]) return candidate;
    next += 1;
  }
}

async function insertAction(
  client: PoolClient,
  instanceId: string,
  stageId: string,
  entityId: string,
  action: string,
  actorId: string,
  reason: string | null,
  previous: string,
  next: string,
  version: number,
): Promise<void> {
  await client.query(
    `INSERT INTO workflow_actions (
       instance_id, stage_id, entity_id, action, actor_id, actor_permission, reason,
       previous_status, new_status, subject_version, snapshot_hash, idempotency_key, created_by
     ) VALUES (
       $1, $2, $3, $4, $5::uuid, 'procurement.approve.operations', $6, $7, $8, $9,
       'seed-m7', gen_random_uuid()::text, $5
     )`,
    [instanceId, stageId, entityId, action, actorId, reason, previous, next, version],
  );
}
