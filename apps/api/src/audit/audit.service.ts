import { Injectable } from '@nestjs/common';
import {
  type ActorContext,
  type AuditEntryInput,
  type AuditEntryWritten,
  insertAuditEntry,
} from '@nfc/db';
import {
  type AuditAction,
  type AuditEntryView,
  buildPage,
  type Page,
  type RoleKey,
  type ScopeType,
} from '@nfc/shared';
import { ForbiddenError, ValidationFailedError } from '../common/errors/domain-error';
import { UnitOfWork } from '../database/unit-of-work';
import { AUDIT_EXPORT_ROW_LIMIT, type AuditExportQuery, type AuditQuery } from './audit.dto';

interface AuditRow {
  id: string;
  occurred_at: Date;
  actor_ref: string | null;
  actor_name: string | null;
  actor_role: RoleKey | null;
  actor_scope_type: ScopeType | null;
  action: AuditAction;
  subject_type: string;
  subject_id: string | null;
  subject_label: string | null;
  subject_reference_number: string | null;
  entity_id: string | null;
  entity_code: string | null;
  entity_name: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  session_id: string | null;
  request_id: string | null;
}

/**
 * The audit engine's read and write surface (M1 item 5 and item 7).
 *
 * Writes normally happen through `TxScope.audit` so they share the transaction
 * of the change they describe. `record()` exists for actions that are not part
 * of a business mutation, such as a sign-in or an export.
 *
 * Reads are entity-scoped twice over: this query joins only rows the caller's
 * Row-Level Security context permits, and the controller additionally requires
 * the `audit.view` permission, which only the MD and ED Finance hold.
 */
@Injectable()
export class AuditService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async record(actor: ActorContext, entry: AuditEntryInput): Promise<AuditEntryWritten> {
    return this.unitOfWork.write(actor, (tx) => insertAuditEntry(tx.client, actor, entry));
  }

  async query(actor: ActorContext, query: AuditQuery): Promise<Page<AuditEntryView>> {
    this.assertEntityInScope(actor, query.entityId);
    const { where, params } = this.buildWhere(query);

    return this.unitOfWork.read(actor, async (tx) => {
      const countResult = await tx.client.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM audit_log a ${where}`,
        params,
      );
      const total = Number.parseInt(countResult.rows[0]?.total ?? '0', 10);

      const offset = (query.page - 1) * query.pageSize;
      const rows = await tx.client.query<AuditRow>(
        `${this.selectClause()} ${where}
         ORDER BY a.occurred_at DESC, a.id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.pageSize, offset],
      );

      return buildPage(rows.rows.map(toView), total, {
        page: query.page,
        pageSize: query.pageSize,
      });
    });
  }

  /**
   * Exports the filtered entries as CSV and records the export itself in the
   * audit log, because reading the whole trail is a sensitive action.
   */
  async exportCsv(
    actor: ActorContext,
    query: AuditExportQuery,
  ): Promise<{ csv: string; rowCount: number; truncated: boolean }> {
    this.assertEntityInScope(actor, query.entityId);
    const { where, params } = this.buildWhere(query);

    return this.unitOfWork.write(actor, async (tx) => {
      const rows = await tx.client.query<AuditRow>(
        `${this.selectClause()} ${where}
         ORDER BY a.occurred_at DESC, a.id DESC
         LIMIT $${params.length + 1}`,
        [...params, AUDIT_EXPORT_ROW_LIMIT + 1],
      );

      const truncated = rows.rows.length > AUDIT_EXPORT_ROW_LIMIT;
      const exported = truncated ? rows.rows.slice(0, AUDIT_EXPORT_ROW_LIMIT) : rows.rows;

      await insertAuditEntry(tx.client, actor, {
        action: 'download',
        subjectType: 'audit_log',
        subjectLabel: `Audit log export (${exported.length} entries)`,
        newValue: {
          filters: Object.fromEntries(
            Object.entries(query).filter(([, value]) => value !== undefined),
          ),
          rowCount: exported.length,
          truncated,
        },
      });

      return { csv: toCsv(exported.map(toView)), rowCount: exported.length, truncated };
    });
  }

  /** Distinct subject types present, to populate the viewer's filter. */
  async subjectTypes(actor: ActorContext): Promise<string[]> {
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{ subject_type: string }>(
        'SELECT DISTINCT subject_type FROM audit_log ORDER BY subject_type',
      );
      return result.rows.map((row) => row.subject_type);
    });
  }

  private selectClause(): string {
    return `
      SELECT a.id, a.occurred_at, a.actor_ref, a.actor_name, a.actor_role, a.actor_scope_type,
             a.action, a.subject_type, a.subject_id, a.subject_label, a.subject_reference_number,
             a.entity_id, e.code AS entity_code, e.name AS entity_name,
             a.old_value, a.new_value, a.reason,
             host(a.ip_address) AS ip_address, a.user_agent, a.session_id, a.request_id
      FROM audit_log a
      LEFT JOIN entities e ON e.id = a.entity_id`;
  }

  private buildWhere(query: AuditQuery | AuditExportQuery): {
    where: string;
    params: unknown[];
  } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    const add = (clause: string, value: unknown): void => {
      params.push(value);
      clauses.push(clause.replace('?', `$${params.length}`));
    };

    if (query.from) add('a.occurred_at >= ?::timestamptz', parseAuditBoundary(query.from, 'from'));
    if (query.to) add('a.occurred_at <= ?::timestamptz', parseAuditBoundary(query.to, 'to'));
    if (query.action) add('a.action = ?::audit_action', query.action);
    if (query.subjectType) add('a.subject_type = ?', query.subjectType);
    if (query.subjectId) add('a.subject_id = ?::uuid', query.subjectId);
    if (query.entityId) add('a.entity_id = ?::uuid', query.entityId);

    if (query.actor) {
      params.push(`%${query.actor}%`);
      clauses.push(`(a.actor_ref ILIKE $${params.length} OR a.actor_name ILIKE $${params.length})`);
    }

    if (query.q) {
      params.push(`%${query.q}%`);
      const index = params.length;
      clauses.push(
        `(a.subject_label ILIKE $${index} OR a.subject_reference_number ILIKE $${index} OR a.reason ILIKE $${index})`,
      );
    }

    return {
      where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
      params,
    };
  }

  private assertEntityInScope(actor: ActorContext, entityId: string | undefined): void {
    if (!entityId) return;
    if (actor.isCorporate || actor.entityIds.includes(entityId)) return;
    throw new ForbiddenError('You do not have access to that subsidiary.', { entityId });
  }
}

/**
 * A bare date is interpreted in Africa/Lagos, so "from 29/09/2026" means from the
 * start of that day locally rather than an hour earlier in UTC. Africa/Lagos has
 * never observed daylight saving, so the offset is a constant +01:00.
 */
export function parseAuditBoundary(value: string, field: 'from' | 'to'): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return field === 'from' ? `${value}T00:00:00+01:00` : `${value}T23:59:59.999+01:00`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationFailedError(`"${value}" is not a valid date for the ${field} filter.`);
  }
  return parsed.toISOString();
}

function toView(row: AuditRow): AuditEntryView {
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    actorRef: row.actor_ref,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    actorScopeType: row.actor_scope_type,
    action: row.action,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    subjectLabel: row.subject_label,
    subjectReferenceNumber: row.subject_reference_number,
    entityId: row.entity_id,
    entityCode: row.entity_code,
    entityName: row.entity_name,
    oldValue: row.old_value,
    newValue: row.new_value,
    reason: row.reason,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    sessionId: row.session_id,
    requestId: row.request_id,
  };
}

const CSV_COLUMNS: ReadonlyArray<[header: string, pick: (row: AuditEntryView) => unknown]> = [
  ['Timestamp (UTC)', (row) => row.occurredAt],
  ['Actor', (row) => row.actorName ?? row.actorRef],
  ['Actor reference', (row) => row.actorRef],
  ['Role', (row) => row.actorRole],
  ['Scope', (row) => row.actorScopeType],
  ['Action', (row) => row.action],
  ['Subject type', (row) => row.subjectType],
  ['Subject', (row) => row.subjectLabel],
  ['Subject id', (row) => row.subjectId],
  ['Reference number', (row) => row.subjectReferenceNumber],
  ['Entity', (row) => row.entityCode],
  ['Reason', (row) => row.reason],
  ['Old value', (row) => (row.oldValue ? JSON.stringify(row.oldValue) : '')],
  ['New value', (row) => (row.newValue ? JSON.stringify(row.newValue) : '')],
  ['IP address', (row) => row.ipAddress],
  ['Device', (row) => row.userAgent],
  ['Session id', (row) => row.sessionId],
  ['Request id', (row) => row.requestId],
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Neutralise spreadsheet formula injection before quoting.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(rows: AuditEntryView[]): string {
  const header = CSV_COLUMNS.map(([name]) => csvCell(name)).join(',');
  const body = rows.map((row) => CSV_COLUMNS.map(([, pick]) => csvCell(pick(row))).join(','));
  return [header, ...body].join('\r\n');
}
