import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type {
  CaseAccessKind,
  CaseListItemView,
  CasePersonView,
  CaseView,
} from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import { ForbiddenError, NotFoundError, ValidationFailedError } from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import type { CaseCommentInput, CaseStatusInput, CreateCaseInput } from './cases.dto';

@Injectable()
export class CasesService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async directory(actor: ActorContext): Promise<CasePersonView[]> {
    if (!can(actor, 'cases.view') && !can(actor, 'cases.create')) {
      throw new ForbiddenError('You cannot list people for confidential cases.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<CasePersonView>(
        `SELECT id, name FROM app.confidential_case_directory()`,
      );
      return result.rows;
    });
  }

  async list(actor: ActorContext): Promise<CaseListItemView[]> {
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        reference_number: string;
        title: string;
        status: CaseListItemView['status'];
        entity_id: string;
        assigned_user_id: string | null;
        assigned_user_name: string | null;
        updated_at: Date;
      }>(
        `SELECT c.id, c.reference_number, c.title, c.status, c.entity_id, c.assigned_user_id,
                app.user_public_name(c.assigned_user_id) AS assigned_user_name, c.updated_at
           FROM confidential_cases c
          ORDER BY c.updated_at DESC`,
      );
      return result.rows.map((row) => ({
        id: row.id,
        referenceNumber: row.reference_number,
        title: row.title,
        status: row.status,
        entityId: row.entity_id,
        assignedUserId: row.assigned_user_id,
        assignedUserName: row.assigned_user_name,
        updatedAt: row.updated_at.toISOString(),
      }));
    });
  }

  async get(actor: ActorContext, id: string): Promise<CaseView> {
    return this.unitOfWork.read(actor, async (tx) => this.getInTx(tx, actor, id));
  }

  async create(actor: ActorContext, input: CreateCaseInput): Promise<CaseView> {
    assertCan(actor, 'cases.create', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const allocated = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('CASE') AS ref`);
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The case reference was not allocated.');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO confidential_cases (
           reference_number, entity_id, title, body, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING id`,
        [reference, input.entityId, input.title.trim(), input.body.trim(), actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The case was not created.');
      await tx.audit({
        action: 'create',
        subjectType: 'confidential_case',
        subjectId: id,
        subjectLabel: input.title.trim(),
        subjectReferenceNumber: reference,
        entityId: input.entityId,
        newValue: { title: input.title.trim() },
      });
      return this.getInTx(tx, actor, id);
    });
  }

  async assign(actor: ActorContext, id: string, userId: string): Promise<CaseView> {
    return this.addAccess(actor, id, userId, 'ASSIGNEE', 'cases.assign');
  }

  async grant(actor: ActorContext, id: string, userId: string): Promise<CaseView> {
    return this.addAccess(actor, id, userId, 'GRANT', 'cases.grant');
  }

  async cc(actor: ActorContext, id: string, userId: string): Promise<CaseView> {
    return this.addAccess(actor, id, userId, 'CC', 'cases.grant');
  }

  async comment(actor: ActorContext, id: string, input: CaseCommentInput): Promise<CaseView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lockCase(tx, actor, id);
      await tx.client.query(
        `INSERT INTO confidential_case_comments (case_id, entity_id, body, created_by)
         VALUES ($1, $2, $3, $4)`,
        [id, current.entity_id, input.body.trim(), actor.ref],
      );
      return this.getInTx(tx, actor, id);
    });
  }

  async setStatus(actor: ActorContext, id: string, input: CaseStatusInput): Promise<CaseView> {
    if (input.status === 'CLOSED') assertCan(actor, 'cases.close');
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lockCase(tx, actor, id);
      if (this.kindOn(current, actor) === 'CC') {
        throw new ForbiddenError('CC recipients can read and comment, not change status.');
      }
      if (input.status === 'CLOSED') assertCan(actor, 'cases.close', current.entity_id);
      await tx.client.query(
        `UPDATE confidential_cases SET status = $1, updated_by = $2 WHERE id = $3`,
        [input.status, actor.ref, id],
      );
      return this.getInTx(tx, actor, id);
    });
  }

  private async addAccess(
    actor: ActorContext,
    id: string,
    userId: string,
    kind: CaseAccessKind,
    permission: 'cases.assign' | 'cases.grant',
  ): Promise<CaseView> {
    assertCan(actor, permission);
    if (userId === actor.ref) {
      throw new ValidationFailedError('You cannot assign or grant this case to yourself.');
    }
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lockCase(tx, actor, id);
      if (this.kindOn(current, actor) === 'CC') {
        throw new ForbiddenError('CC recipients can read and comment, not change access.');
      }
      assertCan(actor, permission, current.entity_id);
      if (kind === 'ASSIGNEE') {
        await tx.client.query(
          `UPDATE confidential_cases SET assigned_user_id = $1, status = CASE WHEN status = 'OPEN' THEN 'IN_PROGRESS' ELSE status END, updated_by = $2 WHERE id = $3`,
          [userId, actor.ref, id],
        );
      }
      await tx.client.query(
        `INSERT INTO confidential_case_access (case_id, entity_id, user_id, kind, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (case_id, user_id, kind) DO NOTHING`,
        [id, current.entity_id, userId, kind, actor.ref],
      );
      await tx.audit({
        action: 'edit',
        subjectType: 'confidential_case',
        subjectId: id,
        subjectLabel: current.title,
        subjectReferenceNumber: current.reference_number,
        entityId: current.entity_id,
        newValue: { kind, userId },
      });
      return this.getInTx(tx, actor, id);
    });
  }

  private kindOn(
    row: { created_by: string; assigned_user_id: string | null; access: Array<{ user_id: string; kind: CaseAccessKind }> },
    actor: ActorContext,
  ): CaseAccessKind | 'OWNER' | null {
    if (row.created_by === actor.ref) return 'OWNER';
    if (row.assigned_user_id === actor.ref) return 'ASSIGNEE';
    return row.access.find((item) => item.user_id === actor.ref)?.kind ?? null;
  }

  private async lockCase(
    tx: TxScope,
    actor: ActorContext,
    id: string,
  ): Promise<{
    id: string;
    entity_id: string;
    title: string;
    reference_number: string;
    created_by: string;
    assigned_user_id: string | null;
    access: Array<{ user_id: string; kind: CaseAccessKind }>;
  }> {
    const result = await tx.client.query<{
      id: string;
      entity_id: string;
      title: string;
      reference_number: string;
      created_by: string;
      assigned_user_id: string | null;
    }>(
      `SELECT id, entity_id, title, reference_number, created_by, assigned_user_id
         FROM confidential_cases WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That case does not exist, or you cannot see it.');
    const access = await tx.client.query<{ user_id: string; kind: CaseAccessKind }>(
      `SELECT user_id, kind FROM confidential_case_access WHERE case_id = $1`,
      [id],
    );
    const current = { ...row, access: access.rows };
    if (!this.kindOn(current, actor)) {
      throw new NotFoundError('That case does not exist, or you cannot see it.');
    }
    return current;
  }

  private async getInTx(tx: TxScope, actor: ActorContext, id: string): Promise<CaseView> {
    const header = await tx.client.query<{
      id: string;
      reference_number: string;
      title: string;
      body: string;
      status: CaseView['status'];
      entity_id: string;
      assigned_user_id: string | null;
      assigned_user_name: string | null;
      created_by: string;
      created_by_name: string | null;
      created_at: Date;
      updated_at: Date;
      row_version: number;
    }>(
      `SELECT c.id, c.reference_number, c.title, c.body, c.status, c.entity_id,
              c.assigned_user_id, app.user_public_name(c.assigned_user_id) AS assigned_user_name,
              c.created_by, app.user_public_name(NULLIF(c.created_by, '')::uuid) AS created_by_name,
              c.created_at, c.updated_at, c.row_version
         FROM confidential_cases c
        WHERE c.id = $1`,
      [id],
    );
    const row = header.rows[0];
    if (!row) throw new NotFoundError('That case does not exist, or you cannot see it.');
    const access = await tx.client.query<{
      user_id: string;
      user_name: string | null;
      kind: CaseAccessKind;
    }>(
      `SELECT a.user_id, app.user_public_name(a.user_id) AS user_name, a.kind
         FROM confidential_case_access a
        WHERE a.case_id = $1
        ORDER BY a.created_at`,
      [id],
    );
    const comments = await tx.client.query<{
      id: string;
      body: string;
      created_by: string;
      created_by_name: string | null;
      created_at: Date;
    }>(
      `SELECT id, body, created_by, app.user_public_name(NULLIF(created_by, '')::uuid) AS created_by_name, created_at
         FROM confidential_case_comments
        WHERE case_id = $1
        ORDER BY created_at`,
      [id],
    );
    const current = {
      created_by: row.created_by,
      assigned_user_id: row.assigned_user_id,
      access: access.rows.map((item) => ({ user_id: item.user_id, kind: item.kind })),
    };
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      title: row.title,
      body: row.body,
      status: row.status,
      entityId: row.entity_id,
      assignedUserId: row.assigned_user_id,
      assignedUserName: row.assigned_user_name,
      createdBy: row.created_by,
      createdByName: row.created_by_name,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      rowVersion: row.row_version,
      access: access.rows.map((item) => ({
        userId: item.user_id,
        userName: item.user_name,
        kind: item.kind,
      })),
      comments: comments.rows.map((item) => ({
        id: item.id,
        body: item.body,
        createdBy: item.created_by,
        createdByName: item.created_by_name,
        createdAt: item.created_at.toISOString(),
      })),
      myKind: this.kindOn(current, actor),
    };
  }
}
