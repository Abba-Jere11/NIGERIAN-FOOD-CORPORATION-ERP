import type { ActorContext } from '@nfc/db';
import { type PermissionKey, roleHasPermission } from '@nfc/shared';
import { ForbiddenError } from '../common/errors/domain-error';

/**
 * The single server-side authorisation check (rule R4).
 *
 * Every endpoint runs through this. Hidden buttons in the interface are
 * cosmetic; this is the enforcement. It denies by default: no role, no
 * permission, or an entity outside the actor's scope all return false.
 *
 * M1 answers from the static role-to-permission map in @nfc/shared because
 * there are no permission tables yet. M2 replaces the lookup with
 * database-backed grants. The signature and every call site stay the same.
 */
export function can(
  actor: ActorContext | null | undefined,
  permission: PermissionKey,
  entityId?: string | null,
): boolean {
  if (!actor) return false;
  // System actors run background work; they never serve a request.
  if (actor.role === null) return false;
  if (!roleHasPermission(actor.role, permission)) return false;

  if (entityId !== undefined && entityId !== null) {
    return actor.isCorporate || actor.entityIds.includes(entityId);
  }
  return true;
}

export function assertCan(
  actor: ActorContext | null | undefined,
  permission: PermissionKey,
  entityId?: string | null,
): void {
  if (can(actor, permission, entityId)) return;

  if (!actor) {
    throw new ForbiddenError('You are not signed in.');
  }
  if (entityId && actor.role && roleHasPermission(actor.role, permission)) {
    throw new ForbiddenError(
      'You do not have access to this subsidiary.',
      { permission, entityId, scope: actor.isCorporate ? 'CORPORATE' : 'ENTITY' },
    );
  }
  throw new ForbiddenError('Your role does not permit this action.', {
    permission,
    role: actor.role,
  });
}

/** Restricts a list query to the actor's entities. Null means "all entities". */
export function scopeFilter(actor: ActorContext): string[] | null {
  return actor.isCorporate ? null : actor.entityIds;
}
