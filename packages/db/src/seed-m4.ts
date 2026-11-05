import { formatKobo, kobo, PR_2026_000184, PR_2026_000184_SUBJECT_ID, SEED_USERS } from '@nfc/shared';
import type { Pool, PoolClient } from 'pg';
import { upsertSearchIndex } from './search';

const MUSA_ID = SEED_USERS.find((user) => user.email === 'gm.yfz@nfc.local')?.id;

export function millingMachineSnapshot(version: number): Record<string, unknown> {
  return {
    reference: PR_2026_000184,
    title: 'Milling machine',
    vendor: 'XYZ Limited',
    entity: 'YFZ',
    amountKobo: 5_000_000_000,
    version,
  };
}

export async function seedM4(pool: Pool): Promise<{ alreadyPresent: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT 1 FROM workflow_demo_subjects WHERE id = $1', [
      PR_2026_000184_SUBJECT_ID,
    ]);
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return { alreadyPresent: true };
    }

    const yfz = await client.query<{ id: string }>('SELECT id FROM entities WHERE code = $1', ['YFZ']);
    const entityId = yfz.rows[0]?.id;
    if (!entityId) throw new Error('Seed organisations before M4 fixtures.');
    if (!MUSA_ID) throw new Error('Seed identities before M4 fixtures.');

    const snapshot = millingMachineSnapshot(1);
    await client.query(
      `INSERT INTO workflow_demo_subjects (
         id, reference_number, entity_id, originator_user_id, title, current_version, snapshot, status, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, 1, $6::jsonb, 'DRAFT', 'system:seed', 'system:seed')`,
      [
        PR_2026_000184_SUBJECT_ID,
        PR_2026_000184,
        entityId,
        MUSA_ID,
        'Milling machine — Yobe Fertilizer',
        JSON.stringify(snapshot),
      ],
    );
    await client.query(
      `INSERT INTO workflow_demo_subject_versions (subject_id, entity_id, version, snapshot, created_by)
       VALUES ($1, $2, 1, $3::jsonb, 'system:seed')`,
      [PR_2026_000184_SUBJECT_ID, entityId, JSON.stringify(snapshot)],
    );

    await client.query(
      `INSERT INTO reference_counters (kind, year, last_value)
       VALUES ('PR', 2026, 184)
       ON CONFLICT (kind, year) DO UPDATE
         SET last_value = GREATEST(reference_counters.last_value, 184)`,
    );

    const amount = formatKobo(kobo(50_000_000));
    await upsertSearchIndex(client, {
      recordType: 'WORKFLOW',
      recordId: PR_2026_000184_SUBJECT_ID,
      referenceNumber: PR_2026_000184,
      title: 'Milling machine — Yobe Fertilizer',
      searchableText: `XYZ Limited procurement milling machine ${amount} 50000000 Yobe Fertilizer ${PR_2026_000184}`,
      entityId,
      permissionKey: 'procurement.create',
    });

    await client.query('COMMIT');
    return { alreadyPresent: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Test helper: a fresh demo subject on the same definition chain. */
export async function insertDemoSubject(
  client: PoolClient,
  input: {
    id: string;
    referenceNumber: string;
    entityId: string;
    originatorUserId: string;
    title: string;
    snapshot?: Record<string, unknown>;
  },
): Promise<void> {
  const snapshot = input.snapshot ?? { title: input.title, version: 1 };
  await client.query(
    `INSERT INTO workflow_demo_subjects (
       id, reference_number, entity_id, originator_user_id, title, current_version, snapshot, status, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, 1, $6::jsonb, 'DRAFT', $7, $7)`,
    [
      input.id,
      input.referenceNumber,
      input.entityId,
      input.originatorUserId,
      input.title,
      JSON.stringify(snapshot),
      input.originatorUserId,
    ],
  );
  await client.query(
    `INSERT INTO workflow_demo_subject_versions (subject_id, entity_id, version, snapshot, created_by)
     VALUES ($1, $2, 1, $3::jsonb, $4)`,
    [input.id, input.entityId, JSON.stringify(snapshot), input.originatorUserId],
  );
}
