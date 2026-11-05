import { formatReferenceNumber, SEED_USERS } from '@nfc/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyActorSession } from '../src/session';
import { insertDomainEvent, markDeliveryDelivered, markDeliveryFailure, MAX_EVENT_ATTEMPTS } from '../src/events';
import { searchIndex } from '../src/search';
import { insertDueSlaReminders } from '../src/sla';
import { listTimelineEvents } from '../src/timeline';
import { TIMELINE_SUBJECT_ID, YFZ_SEARCH_RECORD_ID } from '../src/seed-engines';
import {
  appPool,
  captureError,
  entityIdFor,
  inCommittedTransaction,
  inRolledBackTransaction,
  ownerPool,
  systemActor,
  userActor,
} from './support';
import type { Pool } from 'pg';

describe('M3 reference numbers', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;

  beforeAll(async () => {
    owner = ownerPool('nfc-erp-test-ref-owner');
    app = appPool('nfc-erp-test-ref-app');
    yfz = await entityIdFor(owner, 'YFZ');
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  it('issues 100 unique sequential numbers under parallel allocates', async () => {
    const actor = userActor({
      isCorporate: true,
      permissions: ['organization.view'],
      entityIds: [yfz],
    });
    const year = 2099;
    const refs = await Promise.all(
      Array.from({ length: 100 }, async () => {
        const client = await app.connect();
        try {
          await client.query('BEGIN');
          await applyActorSession(client, actor);
          const result = await client.query<{ ref: string }>(
            'SELECT app.next_reference($1, $2) AS ref',
            ['PR', year],
          );
          await client.query('COMMIT');
          return result.rows[0]?.ref ?? '';
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      }),
    );

    expect(new Set(refs).size).toBe(100);
    const sequences = refs
      .map((value) => Number.parseInt(value.slice(-6), 10))
      .sort((a, b) => a - b);
    for (let i = 1; i < sequences.length; i += 1) {
      expect(sequences[i]).toBe((sequences[i - 1] ?? 0) + 1);
    }
    expect(refs[0]?.startsWith('PR-2099-')).toBe(true);
  });

  it('skips a stored PR suffix when the counter lags and RLS hides the row', async () => {
    const musaId = SEED_USERS.find((user) => user.email === 'gm.yfz@nfc.local')?.id;
    if (!musaId) throw new Error('Seed identities before this test.');
    const dma = await entityIdFor(owner, 'DMA');

    await owner.query(
      `INSERT INTO procurement_requests (
         reference_number, entity_id, originator_user_id, created_by, updated_by
       ) VALUES ('PR-2097-000010', $1, $2::uuid, $2, $2)`,
      [yfz, musaId],
    );

    const dmaActor = userActor({
      isCorporate: false,
      permissions: ['procurement.create'],
      entityIds: [dma],
      scopeType: 'ENTITY',
    });
    const allocated = await inCommittedTransaction(app, dmaActor, async (client) => {
      const result = await client.query<{ ref: string }>(
        `SELECT app.next_reference('PR', 2097) AS ref`,
      );
      return result.rows[0]?.ref ?? '';
    });

    expect(allocated).toBe('PR-2097-000011');
    const counter = await owner.query<{ last_value: number }>(
      `SELECT last_value FROM reference_counters WHERE kind = 'PR' AND year = 2097`,
    );
    expect(Number(counter.rows[0]?.last_value)).toBe(11);
  });

  it('matches the shared formatter', async () => {
    expect(formatReferenceNumber('PR', 184, 2026)).toBe('PR-2026-000184');
    expect(formatReferenceNumber('VND', 18, 0)).toBe('VND-000018');
  });

  it('refuses an UPDATE of reference_number at the database', async () => {
    const actor = userActor({
      isCorporate: true,
      permissions: ['organization.view'],
      entityIds: [yfz],
    });
    const id = await inCommittedTransaction(app, actor, async (client) => {
      const allocated = await client.query<{ ref: string }>(
        `SELECT app.next_reference('PAY', 2098) AS ref`,
      );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO engine_records (entity_id, kind, reference_number, title, created_by, updated_by)
         VALUES ($1, 'PAY', $2, 'Fixture', $3, $3)
         RETURNING id`,
        [yfz, allocated.rows[0]?.ref, actor.ref],
      );
      return inserted.rows[0]?.id ?? '';
    });

    const error = await captureError(() =>
      inRolledBackTransaction(app, actor, (client) =>
        client.query('UPDATE engine_records SET reference_number = $1 WHERE id = $2', [
          'PAY-2098-999999',
          id,
        ]),
      ),
    );
    expect(error.message).toMatch(/cannot be changed/i);
  });
});

describe('M3 domain events', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;

  beforeAll(async () => {
    owner = ownerPool('nfc-erp-test-events-owner');
    app = appPool('nfc-erp-test-events-app');
    yfz = await entityIdFor(owner, 'YFZ');
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  it('does not keep an event when the originating transaction rolls back', async () => {
    const actor = userActor({ isCorporate: true, entityIds: [yfz] });
    const marker = `rollback-${Date.now()}`;
    await inRolledBackTransaction(app, actor, async (client) => {
      await insertDomainEvent(client, actor, {
        eventType: 'engine.record.created',
        subjectType: 'engine_record',
        entityId: yfz,
        payload: { marker },
      });
    });
    const leftover = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM domain_events WHERE payload->>'marker' = $1`,
      [marker],
    );
    expect(leftover.rows[0]?.n).toBe('0');
  });

  it('keeps an event when the transaction commits', async () => {
    const actor = userActor({ isCorporate: true, entityIds: [yfz] });
    const marker = `commit-${Date.now()}`;
    await inCommittedTransaction(app, actor, async (client) => {
      await insertDomainEvent(client, actor, {
        eventType: 'engine.record.created',
        subjectType: 'engine_record',
        entityId: yfz,
        payload: { marker },
      });
    });
    const kept = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM domain_events WHERE payload->>'marker' = $1`,
      [marker],
    );
    expect(kept.rows[0]?.n).toBe('1');
  });

  it('moves a failing delivery to dead-letter after max attempts; redelivery is a no-op', async () => {
    const actor = userActor({ isCorporate: true, entityIds: [yfz] });
    const deliveryId = await inCommittedTransaction(app, actor, async (client) => {
      await client.query(
        `INSERT INTO event_subscriptions (event_type, handler_key, created_by)
         VALUES ('test.force-fail', 'test.fail', $1)
         ON CONFLICT DO NOTHING`,
        [actor.ref],
      );
      const event = await insertDomainEvent(client, actor, {
        eventType: 'test.force-fail',
        subjectType: 'engine_record',
        entityId: yfz,
        payload: {},
      });
      const row = await client.query<{ id: string }>(
        `SELECT id FROM event_deliveries WHERE event_id = $1 AND handler_key = 'test.fail'`,
        [event.id],
      );
      return row.rows[0]?.id ?? '';
    });

    let status: 'pending' | 'dead' = 'pending';
    for (let i = 0; i < MAX_EVENT_ATTEMPTS; i += 1) {
      status = await inCommittedTransaction(app, actor, (client) =>
        markDeliveryFailure(client, deliveryId, 'forced handler failure'),
      );
    }
    expect(status).toBe('dead');

    await inCommittedTransaction(app, actor, (client) => markDeliveryDelivered(client, deliveryId));
    const row = await owner.query<{ status: string; attempts: number }>(
      'SELECT status, attempts FROM event_deliveries WHERE id = $1',
      [deliveryId],
    );
    expect(row.rows[0]?.status).toBe('dead');
  });
});

describe('M3 search, timeline and SLA', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;

  beforeAll(async () => {
    owner = ownerPool('nfc-erp-test-search-owner');
    app = appPool('nfc-erp-test-search-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  it('returns only in-scope search hits for the same term', async () => {
    const yfzGm = userActor({
      ref: '00000000-0000-4000-8000-000000000011',
      role: 'gm',
      scopeType: 'ENTITY',
      isCorporate: false,
      entityIds: [yfz],
      permissions: ['procurement.create', 'organization.view'],
    });
    const dmaGm = userActor({
      ref: '00000000-0000-4000-8000-000000000013',
      role: 'gm',
      scopeType: 'ENTITY',
      isCorporate: false,
      entityIds: [dma],
      permissions: ['procurement.create', 'organization.view'],
    });

    const yfzHits = await inRolledBackTransaction(app, yfzGm, (client) =>
      searchIndex(client, 'XYZ Limited'),
    );
    const dmaHits = await inRolledBackTransaction(app, dmaGm, (client) =>
      searchIndex(client, 'XYZ Limited'),
    );

    expect(yfzHits.some((hit) => hit.recordId === YFZ_SEARCH_RECORD_ID)).toBe(true);
    expect(yfzHits.some((hit) => hit.entityId === dma)).toBe(false);
    expect(dmaHits.some((hit) => hit.entityId === yfz)).toBe(false);
    expect(dmaHits.length).toBeGreaterThan(0);
  });

  it('finds a naira amount and a reference number', async () => {
    const yfzGm = userActor({
      role: 'gm',
      isCorporate: false,
      entityIds: [yfz],
      permissions: ['procurement.create'],
    });
    const byRef = await inRolledBackTransaction(app, yfzGm, (client) =>
      searchIndex(client, 'PR-2026-000184'),
    );
    const byAmount = await inRolledBackTransaction(app, yfzGm, (client) =>
      searchIndex(client, '₦50,000,000'),
    );
    expect(byRef.length).toBeGreaterThan(0);
    expect(byAmount.length).toBeGreaterThan(0);
  });

  it('lists timeline events in order with actor and time', async () => {
    const md = userActor({ isCorporate: true, permissions: ['organization.view'], entityIds: [yfz] });
    const events = await inRolledBackTransaction(app, md, (client) =>
      listTimelineEvents(client, 'ENGINE', TIMELINE_SUBJECT_ID),
    );
    expect(events.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]!.occurredAt.getTime()).toBeGreaterThanOrEqual(events[i - 1]!.occurredAt.getTime());
    }
    expect(events[0]?.actorName.length).toBeGreaterThan(0);
  });

  it('records exactly one reminder per SLA threshold', async () => {
    const actor = userActor({ isCorporate: true, entityIds: [yfz] });
    const holdId = await inCommittedTransaction(app, actor, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO workflow_holds (
           subject_type, subject_id, reference_number, title, holder_user_id, entity_id, pending_since, created_by, updated_by
         ) VALUES ('ENGINE', gen_random_uuid(), 'PR-2026-000184', 'Awaiting review', $1::uuid, $2, now() - interval '7 days', $3, $3)
         RETURNING id`,
        [actor.ref, yfz, actor.ref],
      );
      const id = inserted.rows[0]?.id ?? '';
      for (const days of [2, 5, 7]) {
        await client.query(
          `INSERT INTO workflow_reminders (hold_id, threshold_days, created_by) VALUES ($1, $2, $3)`,
          [id, days, actor.ref],
        );
      }
      return id;
    });

    const count = await owner.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM workflow_reminders WHERE hold_id = $1',
      [holdId],
    );
    expect(count.rows[0]?.n).toBe('3');

    const duplicate = await captureError(() =>
      inRolledBackTransaction(app, actor, (client) =>
        client.query(
          `INSERT INTO workflow_reminders (hold_id, threshold_days, created_by) VALUES ($1, 5, $2)`,
          [holdId, actor.ref],
        ),
      ),
    );
    expect(duplicate.message.toLowerCase()).toMatch(/duplicate|unique/);
  });

  it('creates one reminder per crossed SLA threshold for a frozen now', async () => {
    const actor = userActor({ isCorporate: true, entityIds: [yfz] });
    const now = new Date('2026-09-29T12:00:00Z');
    const holdId = await inCommittedTransaction(app, actor, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO workflow_holds (
           subject_type, subject_id, reference_number, title, holder_user_id, entity_id, pending_since, created_by, updated_by
         ) VALUES ('ENGINE', gen_random_uuid(), 'PR-2026-000190', 'Aged hold', $1::uuid, $2, $3::timestamptz - interval '7 days', $4, $4)
         RETURNING id`,
        [actor.ref, yfz, now.toISOString(), actor.ref],
      );
      return inserted.rows[0]?.id ?? '';
    });

    const escalation = systemActor('system:escalation');
    const first = await inCommittedTransaction(app, escalation, (client) =>
      insertDueSlaReminders(client, escalation, now),
    );
    const forHold = first.filter((row) => row.holdId === holdId);
    expect(forHold.map((row) => row.days).sort((a, b) => a - b)).toEqual([2, 5, 7]);

    const second = await inCommittedTransaction(app, escalation, (client) =>
      insertDueSlaReminders(client, escalation, now),
    );
    expect(second.filter((row) => row.holdId === holdId)).toHaveLength(0);

    const overdue = await inRolledBackTransaction(app, actor, async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM workflow_holds
          WHERE id = $1
            AND status = 'open'
            AND pending_since <= $2::timestamptz
              - make_interval(days => (SELECT coalesce(min(days), 2) FROM sla_thresholds))`,
        [holdId, now.toISOString()],
      );
      return result.rows;
    });
    expect(overdue.some((row) => row.id === holdId)).toBe(true);
  });
});
