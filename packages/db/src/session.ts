import type { RoleKey, ScopeType } from '@nfc/shared';
import type { PoolClient } from 'pg';

/**
 * The acting identity for one unit of work.
 *
 * M1 has no users, authentication or roles - those arrive in M2. Until then the
 * API builds this from the dev-actor configuration. The shape is already the
 * one M2 will produce from a real session, so nothing downstream changes.
 */
export interface ActorContext {
  /** A user uuid, or a named system actor such as `system:seed`. */
  ref: string;
  name: string;
  role: RoleKey | null;
  scopeType: ScopeType | null;
  /** Entities this actor may reach. Empty for corporate actors is still valid. */
  entityIds: string[];
  isCorporate: boolean;
  requestId?: string | undefined;
  sessionId?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export function isSystemActorRef(ref: string): boolean {
  return ref.startsWith('system:');
}

/**
 * Publishes the actor into PostgreSQL session variables so Row-Level Security
 * policies can enforce entity isolation (rule R5).
 *
 * `set_config(..., true)` scopes the value to the current transaction, so it
 * cannot leak to the next request that borrows this pooled connection.
 */
export async function applyActorSession(client: PoolClient, actor: ActorContext): Promise<void> {
  await client.query(
    `SELECT set_config('app.actor_ref', $1, true),
            set_config('app.actor_role', $2, true),
            set_config('app.entity_ids', $3, true),
            set_config('app.is_corporate', $4, true),
            set_config('app.request_id', $5, true)`,
    [
      actor.ref,
      actor.role ?? '',
      actor.entityIds.join(','),
      actor.isCorporate ? 'true' : 'false',
      actor.requestId ?? '',
    ],
  );
}

/** Reads the session variables back, for diagnostics and tests. */
export async function readActorSession(client: PoolClient): Promise<{
  actorRef: string | null;
  actorRole: string | null;
  entityIds: string[];
  isCorporate: boolean;
  requestId: string | null;
}> {
  const result = await client.query<{
    actor_ref: string | null;
    actor_role: string | null;
    entity_ids: string[] | null;
    is_corporate: boolean;
    request_id: string | null;
  }>(
    `SELECT app.current_actor_ref()  AS actor_ref,
            app.current_actor_role() AS actor_role,
            app.current_entity_ids() AS entity_ids,
            app.is_corporate_actor() AS is_corporate,
            app.current_request_id() AS request_id`,
  );
  const row = result.rows[0];
  return {
    actorRef: row?.actor_ref ?? null,
    actorRole: row?.actor_role ?? null,
    entityIds: row?.entity_ids ?? [],
    isCorporate: row?.is_corporate ?? false,
    requestId: row?.request_id ?? null,
  };
}
