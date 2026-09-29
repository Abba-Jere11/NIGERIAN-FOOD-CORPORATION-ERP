/**
 * Organisation vocabulary (A4) and the five roles (A5).
 *
 * The system has exactly five roles. No others exist, in any module.
 */

export const ENTITY_TYPES = ['HOLDING', 'SUBSIDIARY'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const RECORD_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const SCOPE_TYPES = ['CORPORATE', 'ENTITY'] as const;
/** `CORPORATE` covers the holding company and every subsidiary. */
export type ScopeType = (typeof SCOPE_TYPES)[number];

export const ROLE_KEYS = ['gm', 'ed_operations', 'md', 'ed_finance', 'finance_head'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  shortName: string;
  scopeType: ScopeType;
  responsibility: string;
}

export const ROLES: Record<RoleKey, RoleDefinition> = {
  gm: {
    key: 'gm',
    name: 'General Manager',
    shortName: 'GM',
    scopeType: 'ENTITY',
    responsibility:
      'Originates procurement and verifies delivery. Views own subsidiary inventory and finance read-only.',
  },
  ed_operations: {
    key: 'ed_operations',
    name: 'Executive Director, Operations',
    shortName: 'ED Operations',
    scopeType: 'CORPORATE',
    responsibility:
      'First approver on procurement after the GM. Views inventory across all subsidiaries.',
  },
  md: {
    key: 'md',
    name: 'Managing Director',
    shortName: 'MD',
    scopeType: 'CORPORATE',
    responsibility:
      'Final procurement approver, full group visibility, and system administration (users, roles, configuration).',
  },
  ed_finance: {
    key: 'ed_finance',
    name: 'Executive Director, Finance',
    shortName: 'ED Finance',
    scopeType: 'CORPORATE',
    responsibility: 'Runs financial checks, decides funding routes, owns consolidated finance.',
  },
  finance_head: {
    key: 'finance_head',
    name: 'Finance Head',
    shortName: 'Finance Head',
    scopeType: 'ENTITY',
    responsibility: 'Executes vendor payment for their own subsidiary only.',
  },
};

export function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

/** The two roles with group-wide visibility, per A5. */
export const GROUP_VISIBILITY_ROLES: readonly RoleKey[] = ['md', 'ed_finance', 'ed_operations'];

/** Roles permitted to read the audit log in M1 (M1 item 7). */
export const AUDIT_VIEWER_ROLES: readonly RoleKey[] = ['md', 'ed_finance'];

/** Roles holding system administration in the five-role model (A5). */
export const SYSTEM_ADMIN_ROLES: readonly RoleKey[] = ['md'];

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
