import { formatKobo, kobo, DMA_SEARCH_RECORD_ID, TIMELINE_SUBJECT_ID, YFZ_SEARCH_RECORD_ID } from '@nfc/shared';
import type { Pool, PoolClient } from 'pg';
import { upsertSearchIndex } from './search';
import { type ActorContext } from './session';
import { insertTimelineEvent } from './timeline';

const SEED_ACTOR: ActorContext = {
  ref: 'system:seed',
  name: 'Seed process',
  role: null,
  scopeType: null,
  entityIds: [],
  isCorporate: true,
  isAdmin: false,
  permissions: [],
  homePath: null,
  requestId: 'seed',
};

export { YFZ_SEARCH_RECORD_ID, DMA_SEARCH_RECORD_ID, TIMELINE_SUBJECT_ID } from '@nfc/shared';

export async function seedEngines(pool: Pool): Promise<{ alreadyPresent: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT 1 FROM search_index WHERE record_id = $1', [
      YFZ_SEARCH_RECORD_ID,
    ]);
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return { alreadyPresent: true };
    }

    await seedSearchFixtures(client);
    await seedTimelineFixtures(client);
    await client.query('COMMIT');
    return { alreadyPresent: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedSearchFixtures(client: PoolClient): Promise<void> {
  const entities = await client.query<{ id: string; code: string }>('SELECT id, code FROM entities');
  const byCode = new Map(entities.rows.map((row) => [row.code, row.id]));
  const yfz = byCode.get('YFZ');
  const dma = byCode.get('DMA');
  if (!yfz || !dma) throw new Error('Seed organisations before engine fixtures.');
  if (!DMA_SEARCH_RECORD_ID) {
    throw new Error('Rebuild @nfc/shared so the search fixture IDs are exported.');
  }

  const amount = formatKobo(kobo(50_000_000));
  const textDma = `XYZ Limited procurement ${amount} 50000000 Damaturu Modern Abattoir PR-2026-000185`;

  // YFZ / PR-2026-000184 is promoted to the M4 milling-machine subject in seed-m4.
  await upsertSearchIndex(client, {
    recordType: 'PROCUREMENT',
    recordId: DMA_SEARCH_RECORD_ID,
    referenceNumber: 'PR-2026-000185',
    title: 'XYZ Limited — Damaturu Modern Abattoir',
    searchableText: textDma,
    entityId: dma,
    permissionKey: 'procurement.create',
  });
}

async function seedTimelineFixtures(client: PoolClient): Promise<void> {
  const yfz = await client.query<{ id: string }>('SELECT id FROM entities WHERE code = $1', ['YFZ']);
  const entityId = yfz.rows[0]?.id;
  if (!entityId) return;

  await insertTimelineEvent(client, SEED_ACTOR, {
    subjectType: 'ENGINE',
    subjectId: TIMELINE_SUBJECT_ID,
    text: 'Record opened as a draft.',
    entityId,
    occurredAt: new Date('2026-01-10T08:00:00Z'),
  });
  await insertTimelineEvent(client, { ...SEED_ACTOR, ref: 'system:seed', name: 'Dr. Babagana Adam' }, {
    subjectType: 'ENGINE',
    subjectId: TIMELINE_SUBJECT_ID,
    text: 'Submitted for review.',
    href: `/engine/${TIMELINE_SUBJECT_ID}`,
    entityId,
    occurredAt: new Date('2026-01-10T09:15:00Z'),
  });
}
