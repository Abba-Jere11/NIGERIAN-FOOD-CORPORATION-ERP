import { type AuditAction, type JsonRecord } from '@nfc/shared';
import type { PoolClient } from 'pg';
import { type ActorContext, isSystemActorRef } from './session';

/**
 * Low-level audit writer (M1 item 5).
 *
 * This lives in the database package rather than the API so that the seed
 * scripts, the API services and the integration tests all write audit entries
 * through one code path. The API wraps it in `AuditService`, which supplies the
 * actor and request provenance automatically.
 *
 * The write always happens on the caller's client, so it joins the caller's
 * transaction: if the business change rolls back, so does its audit entry, and
 * a committed change can never be missing one.
 */

/** Rule R11: these actions are meaningless without a stored explanation. */
export const REASON_REQUIRED_ACTIONS: readonly AuditAction[] = ['reject', 'return', 'archive'];

export interface AuditEntryInput {
  action: AuditAction;
  subjectType: string;
  subjectId?: string | null;
  subjectLabel?: string | null;
  /** Populated from M3, when the Reference-Number Engine exists. */
  subjectReferenceNumber?: string | null;
  entityId?: string | null;
  oldValue?: JsonRecord | null;
  newValue?: JsonRecord | null;
  reason?: string | null;
}

export class AuditValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditValidationError';
  }
}

export function assertAuditEntryValid(entry: AuditEntryInput): void {
  if (entry.subjectType.trim() === '') {
    throw new AuditValidationError('An audit entry must name the subject type it describes.');
  }
  if (REASON_REQUIRED_ACTIONS.includes(entry.action)) {
    if (entry.reason === null || entry.reason === undefined || entry.reason.trim() === '') {
      throw new AuditValidationError(
        `A reason is required for the "${entry.action}" action and must be stored permanently (rule R11).`,
      );
    }
  }
}

const INSERT_SQL = `
  INSERT INTO audit_log (
    actor_user_id, actor_system_name, actor_name,
    actor_role, actor_scope_type, actor_scope_entity_ids,
    action, subject_type, subject_id, subject_label, subject_reference_number,
    entity_id, old_value, new_value, reason,
    ip_address, user_agent, session_id, request_id
  ) VALUES (
    $1, $2, $3,
    $4, $5, $6::uuid[],
    $7, $8, $9, $10, $11,
    $12, $13::jsonb, $14::jsonb, $15,
    $16, $17, $18, $19
  )
  RETURNING id, occurred_at
`;

export interface AuditEntryWritten {
  id: string;
  occurredAt: Date;
}

export async function insertAuditEntry(
  client: PoolClient,
  actor: ActorContext,
  entry: AuditEntryInput,
): Promise<AuditEntryWritten> {
  assertAuditEntryValid(entry);

  const isSystem = isSystemActorRef(actor.ref);

  const result = await client.query<{ id: string; occurred_at: Date }>(INSERT_SQL, [
    isSystem ? null : actor.ref,
    isSystem ? actor.ref : null,
    actor.name,
    isSystem ? null : actor.role,
    isSystem ? null : actor.scopeType,
    actor.entityIds,
    entry.action,
    entry.subjectType,
    entry.subjectId ?? null,
    entry.subjectLabel ?? null,
    entry.subjectReferenceNumber ?? null,
    entry.entityId ?? null,
    entry.oldValue === null || entry.oldValue === undefined ? null : JSON.stringify(entry.oldValue),
    entry.newValue === null || entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
    entry.reason ?? null,
    actor.ipAddress ?? null,
    actor.userAgent ?? null,
    actor.sessionId ?? null,
    actor.requestId ?? null,
  ]);

  const row = result.rows[0];
  if (!row) {
    throw new Error('The audit entry was not written. The transaction must not be committed.');
  }
  return { id: row.id, occurredAt: row.occurred_at };
}
