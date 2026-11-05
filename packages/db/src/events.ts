import type { PoolClient } from 'pg';
import { type ActorContext } from './session';

export interface DomainEventInput {
  eventType: string;
  subjectType: string;
  subjectId?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown>;
}

export interface DomainEventWritten {
  id: string;
  occurredAt: Date;
}

export async function insertDomainEvent(
  client: PoolClient,
  actor: ActorContext,
  event: DomainEventInput,
): Promise<DomainEventWritten> {
  const result = await client.query<{ id: string; occurred_at: Date }>(
    `INSERT INTO domain_events (event_type, subject_type, subject_id, entity_id, payload, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id, occurred_at`,
    [
      event.eventType,
      event.subjectType,
      event.subjectId ?? null,
      event.entityId ?? null,
      JSON.stringify(event.payload ?? {}),
      actor.ref,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('The domain event was not written.');
  return { id: row.id, occurredAt: row.occurred_at };
}

export const MAX_EVENT_ATTEMPTS = 5;

export interface ClaimedDelivery {
  deliveryId: string;
  eventId: string;
  handlerKey: string;
  eventType: string;
  subjectType: string;
  subjectId: string | null;
  entityId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * Picks due deliveries, skipping later events for a subject while an earlier
 * pending delivery for the same handler is still outstanding.
 */
export async function claimDueDeliveries(
  client: PoolClient,
  limit = 25,
): Promise<ClaimedDelivery[]> {
  const result = await client.query<{
    delivery_id: string;
    event_id: string;
    handler_key: string;
    event_type: string;
    subject_type: string;
    subject_id: string | null;
    entity_id: string | null;
    payload: Record<string, unknown>;
    attempts: number;
  }>(
    `SELECT d.id AS delivery_id,
            e.id AS event_id,
            d.handler_key,
            e.event_type,
            e.subject_type,
            e.subject_id,
            e.entity_id,
            e.payload,
            d.attempts
       FROM event_deliveries d
       JOIN domain_events e ON e.id = d.event_id
      WHERE d.status = 'pending'
        AND d.next_attempt_at <= now()
        AND NOT EXISTS (
          SELECT 1
            FROM event_deliveries earlier
            JOIN domain_events e2 ON e2.id = earlier.event_id
           WHERE earlier.handler_key = d.handler_key
             AND earlier.status = 'pending'
             AND e2.subject_type = e.subject_type
             AND e2.subject_id IS NOT DISTINCT FROM e.subject_id
             AND (e2.occurred_at, e2.id) < (e.occurred_at, e.id)
        )
      ORDER BY e.subject_type, e.subject_id, e.occurred_at, d.id
      FOR UPDATE OF d SKIP LOCKED
      LIMIT $1`,
    [limit],
  );

  return result.rows.map((row) => ({
    deliveryId: row.delivery_id,
    eventId: row.event_id,
    handlerKey: row.handler_key,
    eventType: row.event_type,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    entityId: row.entity_id,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload ?? {}),
    attempts: row.attempts,
  }));
}

export async function markDeliveryDelivered(client: PoolClient, deliveryId: string): Promise<void> {
  await client.query(
    `UPDATE event_deliveries
        SET status = 'delivered',
            attempts = attempts + 1,
            processed_at = now(),
            last_error = NULL
      WHERE id = $1 AND status = 'pending'`,
    [deliveryId],
  );
}

export async function markDeliveryFailure(
  client: PoolClient,
  deliveryId: string,
  error: string,
  maxAttempts = MAX_EVENT_ATTEMPTS,
): Promise<'pending' | 'dead'> {
  const result = await client.query<{ status: 'pending' | 'dead' }>(
    `UPDATE event_deliveries
        SET attempts = attempts + 1,
            last_error = $2,
            status = CASE WHEN attempts + 1 >= $3 THEN 'dead' ELSE 'pending' END,
            next_attempt_at = CASE
              WHEN attempts + 1 >= $3 THEN next_attempt_at
              ELSE now() + make_interval(secs => GREATEST(1, power(2, LEAST(attempts, 8)))::integer)
            END,
            processed_at = CASE WHEN attempts + 1 >= $3 THEN now() ELSE processed_at END
      WHERE id = $1
      RETURNING status`,
    [deliveryId, error.slice(0, 2000), maxAttempts],
  );
  return result.rows[0]?.status ?? 'pending';
}

export async function listDeadLetters(
  client: PoolClient,
  limit = 50,
): Promise<
  Array<{
    deliveryId: string;
    eventType: string;
    handlerKey: string;
    lastError: string | null;
    attempts: number;
    processedAt: Date | null;
  }>
> {
  const result = await client.query<{
    delivery_id: string;
    event_type: string;
    handler_key: string;
    last_error: string | null;
    attempts: number;
    processed_at: Date | null;
  }>(`SELECT * FROM app.list_dead_letters($1)`, [limit]);
  return result.rows.map((row) => ({
    deliveryId: row.delivery_id,
    eventType: row.event_type,
    handlerKey: row.handler_key,
    lastError: row.last_error,
    attempts: row.attempts,
    processedAt: row.processed_at,
  }));
}
