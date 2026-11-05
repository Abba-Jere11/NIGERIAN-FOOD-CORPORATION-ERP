/**
 * The audit vocabulary, taken verbatim from the build plan (M1 item 5).
 * Every mutation in the system records one of these actions.
 */

export const AUDIT_ACTIONS = [
  'login',
  'logout',
  'create',
  'edit',
  'approve',
  'reject',
  'return',
  'archive',
  'upload',
  'download',
  'payment',
  'transfer',
  'inventory_adjustment',
  'employee_change',
  'payroll_change',
  'permission_change',
  'account_change',
  'document_access',
  'document_share',
  'system_configuration_change',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  login: 'Login',
  logout: 'Logout',
  create: 'Create',
  edit: 'Edit',
  approve: 'Approve',
  reject: 'Reject',
  return: 'Return for correction',
  archive: 'Archive',
  upload: 'Upload',
  download: 'Download',
  payment: 'Payment',
  transfer: 'Transfer',
  inventory_adjustment: 'Inventory adjustment',
  employee_change: 'Employee change',
  payroll_change: 'Payroll change',
  permission_change: 'Permission change',
  account_change: 'Account change',
  document_access: 'Document access',
  document_share: 'Document share',
  system_configuration_change: 'System configuration change',
};

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/**
 * Subject types registered so far. Later milestones append their own record
 * types here; the database column is free text so no migration is needed.
 */
export const AUDIT_SUBJECT_TYPES = ['organization', 'entity', 'department'] as const;

export type AuditSubjectType = (typeof AUDIT_SUBJECT_TYPES)[number] | (string & {});

/**
 * Background jobs and bootstrap processes act as named system actors, never
 * anonymously (rule R1). `system:seed` is the only actor permitted to write
 * with no user row behind it.
 */
export const SYSTEM_ACTORS = ['system:seed', 'system:escalation', 'system:outbox', 'system:edms'] as const;

export type SystemActor = (typeof SYSTEM_ACTORS)[number];

export function isSystemActor(value: string | null | undefined): value is SystemActor {
  return typeof value === 'string' && (SYSTEM_ACTORS as readonly string[]).includes(value);
}
