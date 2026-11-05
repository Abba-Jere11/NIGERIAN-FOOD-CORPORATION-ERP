/**
 * Organisation vocabulary (A4) and the nine roles (A5 plus staff).
 *
 * The system has exactly these roles. Business logic never branches on the
 * role name: it checks `can(user, permissionKey, entityId)` against grants.
 */

export const ENTITY_TYPES = ['HOLDING', 'SUBSIDIARY'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const RECORD_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'PENDING_APPROVAL'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const SCOPE_TYPES = ['CORPORATE', 'ENTITY'] as const;
/** `CORPORATE` covers the holding company and every subsidiary. */
export type ScopeType = (typeof SCOPE_TYPES)[number];

export const ROLE_KEYS = [
  'gm',
  'ed_operations',
  'md',
  'ed_finance',
  'finance_head',
  'administrator',
  'inventory_officer',
  'hr_officer',
  'staff',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  shortName: string;
  scopeType: ScopeType;
  homePath: string;
  responsibility: string;
}

export const ROLES: Record<RoleKey, RoleDefinition> = {
  gm: {
    key: 'gm',
    name: 'General Manager',
    shortName: 'GM',
    scopeType: 'ENTITY',
    homePath: '/home/gm',
    responsibility:
      'Originates requisitions. Views own subsidiary inventory and finance read-only. Does not verify delivery.',
  },
  ed_operations: {
    key: 'ed_operations',
    name: 'Executive Director, Operations',
    shortName: 'ED Operations',
    scopeType: 'CORPORATE',
    homePath: '/home/ed-operations',
    responsibility:
      'Reviews operations-machinery procurement after the proposal is prepared. Views inventory across all subsidiaries.',
  },
  md: {
    key: 'md',
    name: 'Managing Director',
    shortName: 'MD',
    scopeType: 'CORPORATE',
    homePath: '/home/md',
    responsibility:
      'Approves the need, then the procurement proposal, with full group visibility of operations, finance and the audit log. Does not administer accounts, roles or entities.',
  },
  ed_finance: {
    key: 'ed_finance',
    name: 'Executive Director, Finance',
    shortName: 'ED Finance',
    scopeType: 'CORPORATE',
    homePath: '/home/ed-finance',
    responsibility: 'Runs financial checks, decides funding routes, owns consolidated finance.',
  },
  finance_head: {
    key: 'finance_head',
    name: 'Finance Head',
    shortName: 'Finance Head',
    scopeType: 'ENTITY',
    homePath: '/home/finance-head',
    responsibility: 'Executes vendor payment for their own subsidiary only.',
  },
  inventory_officer: {
    key: 'inventory_officer',
    name: 'Procurement Manager',
    shortName: 'Procurement Manager',
    scopeType: 'CORPORATE',
    homePath: '/home/inventory',
    responsibility:
      'Prepares the procurement proposal from an approved requisition, verifies vendor delivery, records goods received and initiates shortage-closure across subsidiaries. Does not originate the need or authorize payment.',
  },
  administrator: {
    key: 'administrator',
    name: 'Administrator',
    shortName: 'Administrator',
    scopeType: 'CORPORATE',
    homePath: '/home/admin',
    responsibility:
      'Owns accounts, roles, entity structure and system configuration. Has no business visibility over procurement, finance, inventory or the audit log.',
  },
  hr_officer: {
    key: 'hr_officer',
    name: 'HR Officer',
    shortName: 'HR Officer',
    scopeType: 'CORPORATE',
    homePath: '/home/hr',
    responsibility:
      'Manages the employee lifecycle across all subsidiaries: records, recruitment, leave, attendance, performance, disciplinary cases and training. Not a line-manager role.',
  },
  staff: {
    key: 'staff',
    name: 'Staff',
    shortName: 'Staff',
    scopeType: 'ENTITY',
    homePath: '/me',
    responsibility:
      'Employee self-service for the linked person record. Not combined with a management role.',
  },
};

export function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

/**
 * Business roles with group-wide visibility. The Administrator is deliberately
 * absent: admin is not a corporate business actor.
 */
export const GROUP_VISIBILITY_ROLES: readonly RoleKey[] = [
  'md',
  'ed_finance',
  'ed_operations',
  'inventory_officer',
  'hr_officer',
];

/** Roles whose default grants include the audit log. */
export const AUDIT_VIEWER_ROLES: readonly RoleKey[] = ['md', 'ed_finance'];

/** The role that owns accounts, roles, entities and configuration. */
export const SYSTEM_ADMIN_ROLES: readonly RoleKey[] = ['administrator'];

export const ORGANIZATION_NAME = 'Nigeria Food Corporation';
export const ORGANIZATION_CODE = 'NFC';

export interface SeedEntity {
  code: string;
  name: string;
  legalName: string;
  type: EntityType;
}

/** A4: all four subsidiaries are direct children of NFC. */
export const HOLDING_ENTITY: SeedEntity = {
  code: 'NFC',
  name: 'Nigeria Food Corporation',
  legalName: 'Nigeria Food Corporation',
  type: 'HOLDING',
};

export const SUBSIDIARY_ENTITIES: readonly SeedEntity[] = [
  {
    code: 'YFZ',
    name: 'Yobe Fertilizer',
    legalName: 'Yobe Fertilizer Limited',
    type: 'SUBSIDIARY',
  },
  {
    code: 'YFW',
    name: 'Yobe Flour & Wheat Mills',
    legalName: 'Yobe Flour & Wheat Mills Limited',
    type: 'SUBSIDIARY',
  },
  {
    code: 'DMA',
    name: 'Damaturu Modern Abattoir',
    legalName: 'Damaturu Modern Abattoir Limited',
    type: 'SUBSIDIARY',
  },
  {
    code: 'NOM',
    name: 'Nguru Oil Mills',
    legalName: 'Nguru Oil Mills Limited',
    type: 'SUBSIDIARY',
  },
];

/** M1 item 4: the configurable default department list, seeded per entity. */
export const DEFAULT_DEPARTMENTS: readonly string[] = [
  'Operations',
  'Finance',
  'HR',
  'Production',
  'Stores',
  'Administration',
  'Maintenance',
];
