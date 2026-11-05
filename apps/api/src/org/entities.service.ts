import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { computeDiff, type EntityType, type EntityView, type RecordStatus } from '@nfc/shared';
import { assertCan } from '../auth/can';
import { EntityDirectory } from '../auth/entity-directory.service';
import {
  ConflictError,
  NotFoundError,
  StaleRecordError,
  ValidationFailedError,
} from '../common/errors/domain-error';
import { UnitOfWork } from '../database/unit-of-work';
import type { CreateEntityInput, EntityStatusChangeInput, UpdateEntityInput } from './org.dto';

interface EntityRowRaw {
  id: string;
  organization_id: string;
  parent_entity_id: string | null;
  code: string;
  name: string;
  legal_name: string;
  type: EntityType;
  status: RecordStatus;
  row_version: number;
  department_count: string;
  active_department_count: string;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

/**
 * Entity administration (M1 items 3 and 4).
 *
 * Held by the Administrator (organization.entity.manage). Entities are
 * deactivated, never deleted: the database refuses DELETE outright (rule R3),
 * and the application role holds no DELETE privilege either.
 */
@Injectable()
export class EntitiesService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly directory: EntityDirectory,
  ) {}

  private readonly selectSql = `
    SELECT e.id, e.organization_id, e.parent_entity_id, e.code, e.name, e.legal_name,
           e.type, e.status, e.row_version,
           e.created_at, e.created_by, e.updated_at, e.updated_by,
           (SELECT count(*) FROM departments d WHERE d.entity_id = e.id)::text
             AS department_count,
           (SELECT count(*) FROM departments d WHERE d.entity_id = e.id AND d.status = 'ACTIVE')::text
             AS active_department_count
    FROM entities e`;

  /** Row-Level Security limits this to the entities the caller may reach. */
  async list(actor: ActorContext): Promise<EntityView[]> {
    assertCan(actor, 'organization.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<EntityRowRaw>(
        `${this.selectSql} ORDER BY e.type DESC, e.code`,
      );
      return result.rows.map(toView);
    });
  }

  async get(actor: ActorContext, id: string): Promise<EntityView> {
    assertCan(actor, 'organization.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<EntityRowRaw>(`${this.selectSql} WHERE e.id = $1`, [id]);
      const row = result.rows[0];
      if (!row)
        throw new NotFoundError('That subsidiary was not found, or is outside your access.');
      return toView(row);
    });
  }

  async create(actor: ActorContext, input: CreateEntityInput): Promise<EntityView> {
    assertCan(actor, 'organization.entity.manage');

    return this.unitOfWork.write(actor, async (tx) => {
      const organization = await tx.client.query<{ id: string }>(
        'SELECT id FROM organizations ORDER BY created_at LIMIT 1',
      );
      const organizationId = organization.rows[0]?.id;
      if (!organizationId) {
        throw new ValidationFailedError(
          'No organization exists yet. Run "pnpm db:seed" before creating entities.',
        );
      }

      const parentEntityId = await this.resolveParent(tx.client, input);

      const existing = await tx.client.query<{ code: string }>(
        'SELECT code FROM entities WHERE code = $1',
        [input.code],
      );
      if (existing.rows.length > 0) {
        throw new ConflictError(`An entity with the code ${input.code} already exists.`);
      }

      const inserted = await tx.client.query<EntityRowRaw>(
        `INSERT INTO entities
           (organization_id, parent_entity_id, code, name, legal_name, type, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         RETURNING id, organization_id, parent_entity_id, code, name, legal_name, type, status,
                   row_version, created_at, created_by, updated_at, updated_by,
                   '0' AS department_count, '0' AS active_department_count`,
        [
          organizationId,
          parentEntityId,
          input.code,
          input.name,
          input.legalName,
          input.type,
          actor.ref,
        ],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error('The entity was not created.');

      await tx.audit({
        action: 'create',
        subjectType: 'entity',
        subjectId: row.id,
        subjectLabel: `${row.code} - ${row.name}`,
        entityId: row.id,
        newValue: {
          code: row.code,
          name: row.name,
          legalName: row.legal_name,
          type: row.type,
          parentEntityId,
          status: row.status,
        },
      });

      this.directory.invalidate();
      return toView(row);
    });
  }

  async update(actor: ActorContext, id: string, input: UpdateEntityInput): Promise<EntityView> {
    return this.mutate(actor, id, input.rowVersion, async (tx, before) => {
      assertCan(actor, 'organization.entity.manage', id);

      const updated = await tx.client.query<EntityRowRaw>(
        `UPDATE entities
            SET name = $1, legal_name = $2, updated_by = $3
          WHERE id = $4 AND row_version = $5
        RETURNING id, organization_id, parent_entity_id, code, name, legal_name, type, status,
                  row_version, created_at, created_by, updated_at, updated_by,
                  '0' AS department_count, '0' AS active_department_count`,
        [input.name, input.legalName, actor.ref, id, input.rowVersion],
      );
      const row = updated.rows[0];
      if (!row) throw staleError('subsidiary');

      const diff = computeDiff(
        { name: before.name, legalName: before.legal_name },
        { name: row.name, legalName: row.legal_name },
      );

      if (diff.changedFields.length > 0) {
        await tx.audit({
          action: 'edit',
          subjectType: 'entity',
          subjectId: id,
          subjectLabel: `${row.code} - ${row.name}`,
          entityId: id,
          oldValue: diff.oldValue,
          newValue: diff.newValue,
        });
      }

      this.directory.invalidate();
      return row;
    });
  }

  async setStatus(
    actor: ActorContext,
    id: string,
    status: RecordStatus,
    input: EntityStatusChangeInput,
  ): Promise<EntityView> {
    return this.mutate(actor, id, input.rowVersion, async (tx, before) => {
      assertCan(actor, 'organization.entity.manage', id);

      if (before.status === status) {
        throw new ConflictError(
          status === 'ACTIVE'
            ? 'That subsidiary is already active.'
            : 'That subsidiary is already inactive.',
        );
      }
      if (status === 'INACTIVE' && before.type === 'HOLDING') {
        throw new ValidationFailedError(
          'The holding company cannot be deactivated. It is the root of the organisation.',
        );
      }

      const updated = await tx.client.query<EntityRowRaw>(
        `UPDATE entities
            SET status = $1::record_status, updated_by = $2
          WHERE id = $3 AND row_version = $4
        RETURNING id, organization_id, parent_entity_id, code, name, legal_name, type, status,
                  row_version, created_at, created_by, updated_at, updated_by,
                  '0' AS department_count, '0' AS active_department_count`,
        [status, actor.ref, id, input.rowVersion],
      );
      const row = updated.rows[0];
      if (!row) throw staleError('subsidiary');

      await tx.audit({
        action: 'edit',
        subjectType: 'entity',
        subjectId: id,
        subjectLabel: `${row.code} - ${row.name}`,
        entityId: id,
        oldValue: { status: before.status },
        newValue: { status: row.status },
        reason: input.reason,
      });

      this.directory.invalidate();
      return row;
    });
  }

  /**
   * Reads the row under a lock, runs the change, and reports a stale version
   * rather than silently overwriting a concurrent edit (rule R10).
   */
  private async mutate(
    actor: ActorContext,
    id: string,
    expectedRowVersion: number,
    run: (
      tx: Parameters<Parameters<UnitOfWork['write']>[1]>[0],
      before: EntityRowRaw,
    ) => Promise<EntityRowRaw>,
  ): Promise<EntityView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await tx.client.query<EntityRowRaw>(
        `${this.selectSql} WHERE e.id = $1 FOR UPDATE OF e`,
        [id],
      );
      const before = current.rows[0];
      if (!before) {
        throw new NotFoundError('That subsidiary was not found, or is outside your access.');
      }
      if (before.row_version !== expectedRowVersion) throw staleError('subsidiary');

      const after = await run(tx, before);
      const counts = await tx.client.query<{ total: string; active: string }>(
        `SELECT count(*)::text AS total,
                count(*) FILTER (WHERE status = 'ACTIVE')::text AS active
           FROM departments WHERE entity_id = $1`,
        [id],
      );
      return toView({
        ...after,
        department_count: counts.rows[0]?.total ?? '0',
        active_department_count: counts.rows[0]?.active ?? '0',
      });
    });
  }

  private async resolveParent(
    client: Parameters<Parameters<UnitOfWork['write']>[1]>[0]['client'],
    input: CreateEntityInput,
  ): Promise<string | null> {
    if (input.type === 'HOLDING') {
      if (input.parentEntityId) {
        throw new ValidationFailedError('A holding company cannot have a parent entity.');
      }
      return null;
    }

    if (input.parentEntityId) return input.parentEntityId;

    // A4: subsidiaries are direct children of the holding company, so the
    // parent does not need to be chosen by hand.
    const holding = await client.query<{ id: string }>(
      "SELECT id FROM entities WHERE type = 'HOLDING' ORDER BY created_at LIMIT 1",
    );
    const holdingId = holding.rows[0]?.id;
    if (!holdingId) {
      throw new ValidationFailedError(
        'The holding company does not exist yet, so a subsidiary cannot be attached to it.',
      );
    }
    return holdingId;
  }
}

function staleError(subject: string): StaleRecordError {
  return new StaleRecordError(
    `This ${subject} was changed by someone else while you were editing it. Reload and try again.`,
  );
}

function toView(row: EntityRowRaw): EntityView {
  return {
    id: row.id,
    organizationId: row.organization_id,
    parentEntityId: row.parent_entity_id,
    code: row.code,
    name: row.name,
    legalName: row.legal_name,
    type: row.type,
    status: row.status,
    rowVersion: row.row_version,
    departmentCount: Number.parseInt(row.department_count, 10),
    activeDepartmentCount: Number.parseInt(row.active_department_count, 10),
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by,
  };
}
