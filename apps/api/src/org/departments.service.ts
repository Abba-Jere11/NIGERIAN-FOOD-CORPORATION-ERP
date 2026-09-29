import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { computeDiff, type DepartmentView, type RecordStatus } from '@nfc/shared';
import { assertCan } from '../auth/can';
import { ConflictError, NotFoundError, StaleRecordError } from '../common/errors/domain-error';
import { UnitOfWork, type TxScope } from '../database/unit-of-work';
import type {
  CreateDepartmentInput,
  EntityStatusChangeInput,
  ListDepartmentsInput,
  UpdateDepartmentInput,
} from './org.dto';

interface DepartmentRowRaw {
  id: string;
  entity_id: string;
  entity_code: string;
  name: string;
  code: string | null;
  description: string | null;
  status: RecordStatus;
  row_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

/**
 * Department administration (M1 item 4).
 *
 * Departments are configurable per entity and are deactivated rather than
 * deleted. Every change writes an audit entry in the same transaction, and a
 * deactivation or reactivation additionally requires a stored reason (R11).
 */
@Injectable()
export class DepartmentsService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  private readonly selectSql = `
    SELECT d.id, d.entity_id, e.code AS entity_code, d.name, d.code, d.description,
           d.status, d.row_version, d.created_at, d.created_by, d.updated_at, d.updated_by
    FROM departments d
    JOIN entities e ON e.id = d.entity_id`;

  async listForEntity(
    actor: ActorContext,
    entityId: string,
    query: ListDepartmentsInput,
  ): Promise<DepartmentView[]> {
    assertCan(actor, 'organization.view', entityId);

    return this.unitOfWork.read(actor, async (tx) => {
      const statusClause = query.status === 'ALL' ? '' : 'AND d.status = $2::record_status';
      const params: unknown[] = query.status === 'ALL' ? [entityId] : [entityId, query.status];
      const result = await tx.client.query<DepartmentRowRaw>(
        `${this.selectSql} WHERE d.entity_id = $1 ${statusClause} ORDER BY d.name`,
        params,
      );
      return result.rows.map(toView);
    });
  }

  async create(
    actor: ActorContext,
    entityId: string,
    input: CreateDepartmentInput,
  ): Promise<DepartmentView> {
    assertCan(actor, 'organization.department.manage', entityId);

    return this.unitOfWork.write(actor, async (tx) => {
      await this.assertEntityReachable(tx, entityId);

      const clash = await tx.client.query(
        'SELECT 1 FROM departments WHERE entity_id = $1 AND lower(name) = lower($2)',
        [entityId, input.name],
      );
      if (clash.rows.length > 0) {
        throw new ConflictError(
          `A department called "${input.name}" already exists in this subsidiary.`,
        );
      }

      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO departments (entity_id, name, code, description, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING id`,
        [entityId, input.name, input.code ?? null, input.description ?? null, actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The department was not created.');

      const row = await this.readRow(tx, id);

      await tx.audit({
        action: 'create',
        subjectType: 'department',
        subjectId: id,
        subjectLabel: `${row.entity_code} - ${row.name}`,
        entityId,
        newValue: {
          name: row.name,
          code: row.code,
          description: row.description,
          status: row.status,
        },
      });

      return toView(row);
    });
  }

  async update(
    actor: ActorContext,
    id: string,
    input: UpdateDepartmentInput,
  ): Promise<DepartmentView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const before = await this.lockRow(tx, id, input.rowVersion);
      assertCan(actor, 'organization.department.manage', before.entity_id);

      if (input.name.toLowerCase() !== before.name.toLowerCase()) {
        const clash = await tx.client.query(
          'SELECT 1 FROM departments WHERE entity_id = $1 AND lower(name) = lower($2) AND id <> $3',
          [before.entity_id, input.name, id],
        );
        if (clash.rows.length > 0) {
          throw new ConflictError(
            `A department called "${input.name}" already exists in this subsidiary.`,
          );
        }
      }

      const updated = await tx.client.query(
        `UPDATE departments
            SET name = $1, code = $2, description = $3, updated_by = $4
          WHERE id = $5 AND row_version = $6`,
        [
          input.name,
          input.code ?? null,
          input.description ?? null,
          actor.ref,
          id,
          input.rowVersion,
        ],
      );
      if (updated.rowCount === 0) throw staleError();

      const after = await this.readRow(tx, id);
      const diff = computeDiff(
        { name: before.name, code: before.code, description: before.description },
        { name: after.name, code: after.code, description: after.description },
      );

      if (diff.changedFields.length > 0) {
        await tx.audit({
          action: 'edit',
          subjectType: 'department',
          subjectId: id,
          subjectLabel: `${after.entity_code} - ${after.name}`,
          entityId: after.entity_id,
          oldValue: diff.oldValue,
          newValue: diff.newValue,
        });
      }

      return toView(after);
    });
  }

  async setStatus(
    actor: ActorContext,
    id: string,
    status: RecordStatus,
    input: EntityStatusChangeInput,
  ): Promise<DepartmentView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const before = await this.lockRow(tx, id, input.rowVersion);
      assertCan(actor, 'organization.department.manage', before.entity_id);

      if (before.status === status) {
        throw new ConflictError(
          status === 'ACTIVE'
            ? 'That department is already active.'
            : 'That department is already inactive.',
        );
      }

      const updated = await tx.client.query(
        `UPDATE departments SET status = $1::record_status, updated_by = $2
          WHERE id = $3 AND row_version = $4`,
        [status, actor.ref, id, input.rowVersion],
      );
      if (updated.rowCount === 0) throw staleError();

      const after = await this.readRow(tx, id);

      await tx.audit({
        action: 'edit',
        subjectType: 'department',
        subjectId: id,
        subjectLabel: `${after.entity_code} - ${after.name}`,
        entityId: after.entity_id,
        oldValue: { status: before.status },
        newValue: { status: after.status },
        reason: input.reason,
      });

      return toView(after);
    });
  }

  private async assertEntityReachable(tx: TxScope, entityId: string): Promise<void> {
    const found = await tx.client.query('SELECT 1 FROM entities WHERE id = $1', [entityId]);
    if (found.rows.length === 0) {
      throw new NotFoundError('That subsidiary was not found, or is outside your access.');
    }
  }

  private async readRow(tx: TxScope, id: string): Promise<DepartmentRowRaw> {
    const result = await tx.client.query<DepartmentRowRaw>(`${this.selectSql} WHERE d.id = $1`, [
      id,
    ]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That department was not found, or is outside your access.');
    return row;
  }

  private async lockRow(
    tx: TxScope,
    id: string,
    expectedRowVersion: number,
  ): Promise<DepartmentRowRaw> {
    const result = await tx.client.query<DepartmentRowRaw>(
      `${this.selectSql} WHERE d.id = $1 FOR UPDATE OF d`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That department was not found, or is outside your access.');
    if (row.row_version !== expectedRowVersion) throw staleError();
    return row;
  }
}

function staleError(): StaleRecordError {
  return new StaleRecordError(
    'This department was changed by someone else while you were editing it. Reload and try again.',
  );
}

function toView(row: DepartmentRowRaw): DepartmentView {
  return {
    id: row.id,
    entityId: row.entity_id,
    entityCode: row.entity_code,
    name: row.name,
    code: row.code,
    description: row.description,
    status: row.status,
    rowVersion: row.row_version,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by,
  };
}
