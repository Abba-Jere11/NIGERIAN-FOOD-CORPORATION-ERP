import type { PermissionKey, RoleKey, ScopeType } from '@nfc/shared';
import type { PoolClient } from 'pg';

/**
 * The acting identity for one unit of work.
 *
 * Built from a real session (cookie → users → assignments → grants). System
 * actors (`system:seed` and similar) never serve a request.
 */
export interface ActorContext {
  /** A user uuid, or a named system actor such as `system:seed`. */
  ref: string;
  name: string;
  email?: string;
  position?: string;
  /** Recorded on the audit row. Authorisation uses `permissions`, never this. */
  role: RoleKey | null;
  scopeType: ScopeType | null;
  /** Entities this actor may reach. Empty for corporate actors is still valid. */
  entityIds: string[];
  /**
   * True when a *business* role has corporate scope. The Administrator is never
   * corporate: that flag would leak every subsidiary's business rows.
   */
  isCorporate: boolean;
  /** True when the actor holds an admin.* permission. Does not imply business access. */
  isAdmin: boolean;
  permissions: readonly PermissionKey[];
  homePath: string | null;
  mustChangePassword?: boolean;
  /** Effective MFA policy (admin flag or Administrator role). */
  mfaPolicyRequired?: boolean;
  mfaEnrolled?: boolean;
  sessionRowId?: string;
  requestId?: string | undefined;
  sessionId?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export function isSystemActorRef(ref: string): boolean {
  return ref.startsWith('system:');
}

export function systemActorContext(
  ref: 'system:seed' | 'system:outbox' | 'system:escalation' | 'system:edms',
  name: string,
): ActorContext {
  return {
    ref,
    name,
    role: null,
    scopeType: null,
    entityIds: [],
    isCorporate: true,
    isAdmin: ref === 'system:outbox' || ref === 'system:escalation',
    permissions: [],
    homePath: null,
  };
}

export function actorHasPermission(actor: ActorContext, permission: PermissionKey): boolean {
  return actor.permissions.includes(permission);
}

/**
 * Publishes the actor into PostgreSQL session variables so Row-Level Security
 * policies can enforce entity isolation (rule R5).
 *
 * `set_config(..., true)` scopes the value to the current transaction, so it
 * cannot leak to the next request that borrows this pooled connection.
 */
export async function applyActorSession(client: PoolClient, actor: ActorContext): Promise<void> {
  const userId = isSystemActorRef(actor.ref) ? '' : actor.ref;
  await client.query(
    `SELECT set_config('app.actor_ref', $1, true),
            set_config('app.actor_role', $2, true),
            set_config('app.entity_ids', $3, true),
            set_config('app.is_corporate', $4, true),
            set_config('app.is_admin', $5, true),
            set_config('app.user_id', $6, true),
            set_config('app.request_id', $7, true),
            set_config('app.permission_keys', $8, true)`,
    [
      actor.ref,
      actor.role ?? '',
      actor.entityIds.join(','),
      actor.isCorporate ? 'true' : 'false',
      actor.isAdmin ? 'true' : 'false',
      userId,
      actor.requestId ?? '',
      actor.permissions.join(','),
    ],
  );
}

/** Reads the session variables back, for diagnostics and tests. */
export async function readActorSession(client: PoolClient): Promise<{
  actorRef: string | null;
  actorRole: string | null;
  entityIds: string[];
  isCorporate: boolean;
  isAdmin: boolean;
  userId: string | null;
  requestId: string | null;
}> {
  const result = await client.query<{
    actor_ref: string | null;
    actor_role: string | null;
    entity_ids: string[] | null;
    is_corporate: boolean;
    is_admin: boolean;
    user_id: string | null;
    request_id: string | null;
  }>(
    `SELECT app.current_actor_ref()  AS actor_ref,
            app.current_actor_role() AS actor_role,
            app.current_entity_ids() AS entity_ids,
            app.is_corporate_actor() AS is_corporate,
            app.is_admin_actor()     AS is_admin,
            app.current_user_id()    AS user_id,
            app.current_request_id() AS request_id`,
  );
  const row = result.rows[0];
  return {
    actorRef: row?.actor_ref ?? null,
    actorRole: row?.actor_role ?? null,
    entityIds: row?.entity_ids ?? [],
    isCorporate: row?.is_corporate ?? false,
    isAdmin: row?.is_admin ?? false,
    userId: row?.user_id ?? null,
    requestId: row?.request_id ?? null,
  };
}
