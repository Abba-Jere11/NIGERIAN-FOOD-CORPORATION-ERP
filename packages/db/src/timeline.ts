import type { PoolClient } from 'pg';
import { type ActorContext } from './session';

export interface TimelineEventInput {
  subjectType: string;
  subjectId: string;
  text: string;
  href?: string | null;
  entityId?: string | null;
  occurredAt?: Date;
}

export interface TimelineEventRow {
  id: string;
  occurredAt: Date;
  actorRef: string;
  actorName: string;
  text: string;
  href: string | null;
}

export async function insertTimelineEvent(
  client: PoolClient,
  actor: ActorContext,
  event: TimelineEventInput,
): Promise<TimelineEventRow> {
  const result = await client.query<{
    id: string;
    occurred_at: Date;
    actor_ref: string;
    actor_name: string;
    event_text: string;
    href: string | null;
  }>(
    `INSERT INTO timeline_events (
       subject_type, subject_id, occurred_at, actor_ref, actor_name, event_text, href, entity_id, created_by
     ) VALUES ($1, $2, coalesce($3, now()), $4, $5, $6, $7, $8, $4)
     RETURNING id, occurred_at, actor_ref, actor_name, event_text, href`,
    [
      event.subjectType,
      event.subjectId,
      event.occurredAt ?? null,
      actor.ref,
      actor.name,
      event.text,
      event.href ?? null,
      event.entityId ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('The timeline event was not written.');
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorRef: row.actor_ref,
    actorName: row.actor_name,
    text: row.event_text,
    href: row.href,
  };
}

export async function listTimelineEvents(
  client: PoolClient,
  subjectType: string,
  subjectId: string,
): Promise<TimelineEventRow[]> {
  const result = await client.query<{
    id: string;
    occurred_at: Date;
    actor_ref: string;
    actor_name: string;
    event_text: string;
    href: string | null;
  }>(
    `SELECT id, occurred_at, actor_ref, actor_name, event_text, href
       FROM timeline_events
      WHERE subject_type = $1 AND subject_id = $2
      ORDER BY occurred_at ASC, id ASC`,
    [subjectType, subjectId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    actorRef: row.actor_ref,
    actorName: row.actor_name,
    text: row.event_text,
    href: row.href,
  }));
}
