import type { ActorContext } from '@nfc/db';
import { isSystemActorRef } from '@nfc/db';
import { type PermissionKey } from '@nfc/shared';
import { ForbiddenError } from '../common/errors/domain-error';

/**
 * The single server-side authorisation check (rule R4).
 *
 * Deny by default. Grants come from the session (loaded from `role_permissions`
 * plus extra scope grants), never from a static role map and never from a
 * comparison against a role name.
 */
export function can(
  actor: ActorContext | null | undefined,
  permission: PermissionKey,
  entityId?: string | null,
): boolean {
  if (!actor) return false;
  if (isSystemActorRef(actor.ref)) return false;
  if (!actor.permissions.includes(permission)) return false;

  if (entityId !== undefined && entityId !== null) {
    if (actor.isCorporate) return true;
    if (actor.entityIds.includes(entityId)) return true;
    // Administrator may reach org-management rows without becoming a corporate
    // business actor. This does not open audit, procurement, finance or inventory.
    if (actor.isAdmin && isAdminScopedPermission(permission)) return true;
    return false;
  }
  return true;
}

function isAdminScopedPermission(permission: PermissionKey): boolean {
  return (
    permission.startsWith('admin.') ||
    permission.startsWith('organization.') ||
    permission.startsWith('edms.manage_') ||
    permission === 'org_report.template.manage'
  );
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
  if (
    entityId &&
    actor.permissions.includes(permission) &&
    !actor.isCorporate &&
    !actor.entityIds.includes(entityId)
  ) {
    throw new ForbiddenError('You do not have access to this subsidiary.', {
      permission,
      entityId,
      scope: actor.isCorporate ? 'CORPORATE' : 'ENTITY',
    });
  }
  throw new ForbiddenError('Your role does not permit this action.', {
    permission,
  });
}

/** Restricts a list query to the actor's entities. Null means "all entities". */
export function scopeFilter(actor: ActorContext): string[] | null {
  if (actor.isCorporate) return null;
  if (actor.isAdmin) return null;
  return actor.entityIds;
}
