import type { AuditAction } from './audit';
import type { EntityType, RecordStatus, RoleKey, ScopeType } from './org';
import type { PermissionKey } from './permissions';

/**
 * The HTTP contract between the API and the web application.
 *
 * Both sides import these, so a change to a response shape is a compile error
 * in the consumer rather than a runtime surprise.
 */

export interface EntityView {
  id: string;
  organizationId: string;
  parentEntityId: string | null;
  code: string;
  name: string;
  legalName: string;
  type: EntityType;
  status: RecordStatus;
  rowVersion: number;
  departmentCount: number;
  activeDepartmentCount: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface DepartmentView {
  id: string;
  entityId: string;
  entityCode: string;
  name: string;
  code: string | null;
  description: string | null;
  status: RecordStatus;
  rowVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface AuditEntryView {
  id: string;
  occurredAt: string;
  actorRef: string | null;
  actorName: string | null;
  actorRole: RoleKey | null;
  actorScopeType: ScopeType | null;
  action: AuditAction;
  subjectType: string;
  subjectId: string | null;
  subjectLabel: string | null;
  subjectReferenceNumber: string | null;
  entityId: string | null;
  entityCode: string | null;
  entityName: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  sessionId: string | null;
  requestId: string | null;
}

export interface AuditFiltersView {
  actions: Array<{ value: AuditAction; label: string }>;
  subjectTypes: string[];
}

export interface MeView {
  ref: string;
  name: string;
  role: RoleKey | null;
  roleName: string | null;
  roleShortName: string | null;
  scopeType: ScopeType | null;
  isCorporate: boolean;
  permissions: readonly PermissionKey[];
  entities: Array<{ id: string; code: string; name: string; type: EntityType }>;
}

export interface DevActorSummaryView {
  key: string;
  name: string;
  position: string;
  role: RoleKey;
  roleShortName: string;
  scopeType: ScopeType;
  entityCode: string | null;
}

export interface HealthView {
  status: 'ok' | 'degraded';
  environment: string;
  checks: {
    database: 'up' | 'down';
    databaseError?: string;
    databaseLatencyMs: number;
  };
  time: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    fieldErrors?: Record<string, string[]>;
    requestId: string | null;
  };
}
