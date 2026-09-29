import { type RoleKey } from './org';

/**
 * Named permission keys, checked server-side against (user, permission, entity).
 *
 * M1 defines only the keys its own screens need. The mapping below is a static
 * table because M1 deliberately has no `roles`, `permissions` or
 * `role_permissions` tables - those arrive in M2, which replaces this map with
 * database-backed grants and the full `can(user, permissionKey, entityId)`
 * engine. The key names and the call sites do not change when that happens.
 */

export const PERMISSION_KEYS = [
  'organization.view',
  'organization.entity.manage',
  'organization.department.manage',
  'audit.view',
  'audit.export',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** A5: system administration is held by the MD in the five-role model. */
export const ROLE_PERMISSIONS: Record<RoleKey, readonly PermissionKey[]> = {
  md: [
    'organization.view',
    'organization.entity.manage',
    'organization.department.manage',
    'audit.view',
    'audit.export',
  ],
  // The two roles with group-wide visibility may read the audit log (M1 item 7).
  ed_finance: ['organization.view', 'audit.view', 'audit.export'],
  ed_operations: ['organization.view'],
  gm: ['organization.view'],
  finance_head: ['organization.view'],
};

export function roleHasPermission(role: RoleKey, permission: PermissionKey): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsForRole(role: RoleKey): readonly PermissionKey[] {
  return ROLE_PERMISSIONS[role];
}
