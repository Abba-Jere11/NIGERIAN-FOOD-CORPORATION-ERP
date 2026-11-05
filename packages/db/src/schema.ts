import { sql } from 'drizzle-orm';
import {
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle mirror of the hand-written SQL migrations.
 *
 * The SQL files under `migrations/` are the source of truth, because triggers,
 * Row-Level Security policies and privilege grants cannot be expressed here.
 * An integration test compares the enum labels in this file against the
 * database and against the shared constants, so the three cannot drift apart.
 */

export const entityTypeEnum = pgEnum('entity_type', ['HOLDING', 'SUBSIDIARY']);

export const recordStatusEnum = pgEnum('record_status', ['ACTIVE', 'INACTIVE']);

export const scopeTypeEnum = pgEnum('scope_type', ['CORPORATE', 'ENTITY']);

export const roleKeyEnum = pgEnum('role_key', [
  'gm',
  'ed_operations',
  'md',
  'ed_finance',
  'finance_head',
  'administrator',
  'inventory_officer',
  'hr_officer',
  'staff',
]);

export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'PENDING_APPROVAL']);

export const auditActionEnum = pgEnum('audit_action', [
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
]);

/** The mutable standard column set (M1 item 2). */
const standardColumns = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by').notNull(),
  rowVersion: integer('row_version').notNull().default(1),
};

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  legalName: text('legal_name').notNull(),
  status: recordStatusEnum('status').notNull().default('ACTIVE'),
  ...standardColumns,
});

export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    parentEntityId: uuid('parent_entity_id'),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    legalName: text('legal_name').notNull(),
    type: entityTypeEnum('type').notNull(),
    status: recordStatusEnum('status').notNull().default('ACTIVE'),
    ...standardColumns,
  },
  (table) => [
    index('entities_parent_entity_id_idx').on(table.parentEntityId),
    index('entities_organization_id_idx').on(table.organizationId),
  ],
);

export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    name: text('name').notNull(),
    code: text('code'),
    description: text('description'),
    status: recordStatusEnum('status').notNull().default('ACTIVE'),
    ...standardColumns,
  },
  (table) => [
    uniqueIndex('departments_entity_name_key').on(table.entityId, sql`lower(${table.name})`),
    index('departments_entity_id_idx').on(table.entityId),
    index('departments_status_idx').on(table.status),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),

    actorUserId: uuid('actor_user_id'),
    actorSystemName: text('actor_system_name'),
    actorRef: text('actor_ref').generatedAlwaysAs(
      sql`coalesce(actor_user_id::text, actor_system_name)`,
    ),
    actorName: text('actor_name'),
    actorRole: roleKeyEnum('actor_role'),
    actorScopeType: scopeTypeEnum('actor_scope_type'),
    actorScopeEntityIds: uuid('actor_scope_entity_ids')
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),

    action: auditActionEnum('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id'),
    subjectLabel: text('subject_label'),
    subjectReferenceNumber: text('subject_reference_number'),

    entityId: uuid('entity_id').references(() => entities.id),

    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    reason: text('reason'),

    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    sessionId: text('session_id'),
    requestId: text('request_id'),
  },
  (table) => [
    index('audit_log_occurred_at_idx').on(table.occurredAt.desc()),
    index('audit_log_actor_ref_idx').on(table.actorRef, table.occurredAt.desc()),
    index('audit_log_action_idx').on(table.action, table.occurredAt.desc()),
    index('audit_log_subject_idx').on(table.subjectType, table.subjectId),
    index('audit_log_entity_idx').on(table.entityId, table.occurredAt.desc()),
    index('audit_log_request_id_idx').on(table.requestId),
  ],
);

export type OrganizationRow = typeof organizations.$inferSelect;
export type EntityRow = typeof entities.$inferSelect;
export type DepartmentRow = typeof departments.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type AuditLogInsert = typeof auditLog.$inferInsert;

export const schema = { organizations, entities, departments, auditLog };
