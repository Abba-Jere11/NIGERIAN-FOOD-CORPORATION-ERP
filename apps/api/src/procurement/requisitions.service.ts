import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { snapshotHash } from '@nfc/db';
import {
  REQUISITION_MEMO_TEMPLATE_VERSION,
  formatLagosIsoDate,
  isRequisitionStatus,
  isSealAction,
  memoStamps,
  renderRequisitionMemoHtml,
  ROLES,
  isRoleKey,
  type RequisitionLineView,
  type RequisitionMemoSnapshot,
  type RequisitionStatus,
  type RequisitionView,
} from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StaleRecordError,
  ValidationFailedError,
} from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import { DocumentsService } from '../documents/documents.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { renderRequisitionMemoPdf } from './requisition-pdf';
import type {
  CreateRequisitionInput,
  DiscardProcurementInput,
  SubmitProcurementInput,
  UpdateRequisitionInput,
} from './procurement.dto';

interface LoadedRequisition {
  id: string;
  reference_number: string;
  entity_id: string;
  entity_code: string | null;
  entity_name: string | null;
  department_id: string | null;
  department_name: string | null;
  originator_user_id: string;
  originator_name: string | null;
  originator_position: string | null;
  current_version: number;
  status: string;
  title: string;
  background: string | null;
  justification: string | null;
  prayer: string | null;
  category_id: string | null;
  category_key: string | null;
  category_name: string | null;
  operations_machinery: boolean;
  required_date: Date | string | null;
  urgency: string;
  delivery_location: string | null;
  version_id: string;
  row_version: number;
  created_at: Date;
  procurement_request_id: string | null;
  procurement_reference: string | null;
  workflow_instance_id: string | null;
  memo_hash: string | null;
  pdf_document_id: string | null;
  submit_idempotency_key: string | null;
  last_return_reason: string | null;
}

const LOAD_SQL = `
  SELECT q.id, q.reference_number, q.entity_id, e.code AS entity_code, e.name AS entity_name,
         q.department_id, d.name AS department_name, q.originator_user_id,
         app.user_public_name(q.originator_user_id) AS originator_name, u.position AS originator_position,
         q.current_version, q.status, q.row_version, q.created_at,
         v.id AS version_id, v.title, v.background, v.justification, v.prayer, v.category_id,
         c.key AS category_key, c.name AS category_name, coalesce(c.operations_machinery, false) AS operations_machinery,
         v.required_date, v.urgency, v.delivery_location, v.submit_idempotency_key,
         pr.id AS procurement_request_id, pr.reference_number AS procurement_reference,
         snap.memo_snapshot_hash AS memo_hash, snap.pdf_document_id,
         wi.id AS workflow_instance_id,
         (
           SELECT wa.reason
             FROM workflow_actions wa
            WHERE wa.instance_id = wi.id AND wa.action = 'RETURN_FOR_CORRECTION'
            ORDER BY wa.occurred_at DESC
            LIMIT 1
         ) AS last_return_reason
    FROM requisitions q
    JOIN entities e ON e.id = q.entity_id
    JOIN requisition_versions v ON v.requisition_id = q.id AND v.version_number = q.current_version
    LEFT JOIN users u ON u.id = q.originator_user_id
    LEFT JOIN departments d ON d.id = q.department_id
    LEFT JOIN procurement_categories c ON c.id = v.category_id
    LEFT JOIN procurement_requests pr ON pr.requisition_id = q.id
    LEFT JOIN requisition_memo_snapshots snap ON snap.version_id = v.id
    LEFT JOIN LATERAL (
      SELECT id FROM workflow_instances
       WHERE subject_id = pr.id AND subject_type = 'PROCUREMENT'
       ORDER BY created_at DESC LIMIT 1
    ) wi ON true
`;

@Injectable()
export class RequisitionsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly workflows: WorkflowsService,
    private readonly documents: DocumentsService,
  ) {}

  async list(actor: ActorContext): Promise<{ items: RequisitionView[] }> {
    this.assertReader(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<LoadedRequisition>(`${LOAD_SQL} ORDER BY q.created_at DESC`);
      const items: RequisitionView[] = [];
      for (const row of result.rows) {
        if (!this.canSee(actor, row.entity_id)) continue;
        items.push(await this.toView(tx, row, actor));
      }
      return { items };
    });
  }

  async get(actor: ActorContext, id: string): Promise<RequisitionView> {
    this.assertReader(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const row = await this.loadRow(tx, id);
      if (!this.canSee(actor, row.entity_id)) throw new NotFoundError('That requisition was not found.');
      return this.toView(tx, row, actor);
    });
  }

  async create(actor: ActorContext, input: CreateRequisitionInput): Promise<RequisitionView> {
    assertCan(actor, 'requisition.create');
    const entityId = input.entityId ?? actor.entityIds[0];
    if (!entityId) throw new ValidationFailedError('An entity is required.');
    assertCan(actor, 'requisition.create', entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const allocated = await tx.client.query<{ ref: string }>(
        'SELECT app.next_reference($1, NULL) AS ref',
        ['REQ'],
      );
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The requisition reference was not allocated.');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO requisitions (
           reference_number, entity_id, department_id, originator_user_id, created_by, updated_by
         ) VALUES ($1, $2, $3, $4::uuid, $4, $4)
         RETURNING id`,
        [reference, entityId, input.departmentId ?? null, actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The requisition was not created.');
      await tx.client.query(
        `INSERT INTO requisition_versions (
           requisition_id, entity_id, version_number, title, created_by, updated_by
         ) VALUES ($1, $2, 1, $3, $4, $4)`,
        [id, entityId, input.title.trim(), actor.ref],
      );
      await tx.audit({
        action: 'create',
        subjectType: 'requisition',
        subjectId: id,
        subjectLabel: input.title.trim(),
        subjectReferenceNumber: reference,
        entityId,
        newValue: { title: input.title.trim(), status: 'DRAFT' },
      });
      return this.toView(tx, await this.loadRow(tx, id), actor);
    });
  }

  async update(actor: ActorContext, id: string, input: UpdateRequisitionInput): Promise<RequisitionView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.loadRow(tx, id);
      this.assertOriginatorDraft(actor, current);
      if (current.row_version !== input.rowVersion) {
        throw new StaleRecordError('This requisition has changed. Refresh and try again.', {
          rowVersion: current.row_version,
        });
      }
      if (input.requiredDate) this.assertRequiredDate(input.requiredDate);
      await tx.client.query(
        `UPDATE requisitions SET department_id = $1, updated_by = $2 WHERE id = $3 AND row_version = $4`,
        [
          input.departmentId === undefined ? current.department_id : input.departmentId,
          actor.ref,
          id,
          current.row_version,
        ],
      );
      await tx.client.query(
        `UPDATE requisition_versions
            SET title = $1, background = $2, justification = $3, prayer = $4, category_id = $5,
                required_date = $6, urgency = $7, delivery_location = $8, updated_by = $9
          WHERE id = $10`,
        [
          input.title?.trim() ?? current.title,
          input.background === undefined ? current.background : input.background,
          input.justification === undefined ? current.justification : input.justification,
          input.prayer === undefined ? current.prayer : input.prayer,
          input.categoryId === undefined ? current.category_id : input.categoryId,
          input.requiredDate === undefined ? dateOnly(current.required_date) : input.requiredDate,
          input.urgency ?? current.urgency,
          input.deliveryLocation === undefined ? current.delivery_location : input.deliveryLocation,
          actor.ref,
          current.version_id,
        ],
      );
      if (input.lines) {
        await tx.client.query(`DELETE FROM requisition_lines WHERE version_id = $1`, [current.version_id]);
        let lineNumber = 1;
        for (const line of input.lines) {
          if (!line.description.trim() || !line.quantity || !line.unitId) continue;
          await tx.client.query(
            `INSERT INTO requisition_lines (
               version_id, entity_id, line_number, description, quantity, unit_id, created_by, updated_by
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
            [current.version_id, current.entity_id, lineNumber, line.description.trim(), line.quantity, line.unitId, actor.ref],
          );
          lineNumber += 1;
        }
      }
      return this.toView(tx, await this.loadRow(tx, id), actor);
    });
  }

  async submit(actor: ActorContext, id: string, input: SubmitProcurementInput): Promise<RequisitionView> {
    return this.unitOfWork.write(actor, async (tx) => {
      await tx.client.query(`SELECT id FROM requisitions WHERE id = $1 FOR UPDATE`, [id]);
      const current = await this.loadRow(tx, id);
      if (current.status !== 'DRAFT') {
        if (input.idempotencyKey && current.submit_idempotency_key === input.idempotencyKey) {
          return this.toView(tx, current, actor);
        }
        throw new ConflictError('This requisition has already been submitted.');
      }
      this.assertOriginatorDraft(actor, current, 'requisition.submit');
      if (current.row_version !== input.rowVersion) {
        throw new StaleRecordError('This requisition has changed. Refresh and try again.', {
          rowVersion: current.row_version,
        });
      }
      const lines = await this.loadLines(tx, current.version_id);
      this.assertReady(current, lines);
      const snapshot = this.buildSnapshot(current, lines);
      await tx.client.query(
        `UPDATE requisition_versions
            SET submitted_at = now(), submit_idempotency_key = coalesce($1, submit_idempotency_key), updated_by = $2
          WHERE id = $3`,
        [input.idempotencyKey ?? `req-submit:${id}:${current.current_version}`, actor.ref, current.version_id],
      );
      await tx.client.query(`UPDATE requisitions SET status = 'SUBMITTED', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        id,
      ]);
      const pdf = await renderRequisitionMemoPdf(snapshot);
      const stored = await this.documents.storeGeneratedPdfInTx(tx, actor, {
        title: `Requisition ${current.reference_number}`,
        entityId: current.entity_id,
        ownerType: 'requisition',
        ownerId: id,
        buffer: pdf,
        filename: `${current.reference_number}-memo.pdf`,
      });
      await tx.client.query(
        `INSERT INTO requisition_memo_snapshots (
           requisition_id, version_id, entity_id, memo_template_version, canonical_json,
           memo_snapshot_hash, pdf_document_id, pdf_hash, created_by
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
        [
          id,
          current.version_id,
          current.entity_id,
          REQUISITION_MEMO_TEMPLATE_VERSION,
          JSON.stringify(snapshot),
          snapshotHash(snapshot),
          stored.documentId,
          stored.sha256,
          actor.ref,
        ],
      );
      const requestId = await this.ensureShellRequest(tx, actor, current, lines);
      await this.refreshShellRequest(tx, actor, current, lines, requestId);
      await tx.client.query(
        `UPDATE procurement_requests SET status = 'AWAITING_NEED_APPROVAL', updated_by = $1 WHERE id = $2`,
        [actor.ref, requestId],
      );
      await this.workflows.startRequisitionInTx(tx, actor, { requestId, snapshot });
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: requestId,
        text: 'GM submitted requisition',
        href: `/procurement/${requestId}`,
        entityId: current.entity_id,
      });
      await tx.indexSearch({
        recordType: 'REQUISITION',
        recordId: id,
        referenceNumber: current.reference_number,
        title: current.title,
        searchableText: `${current.reference_number} ${current.title} ${current.entity_code ?? ''}`,
        entityId: current.entity_id,
        permissionKey: 'requisition.create',
      });
      return this.toView(tx, await this.loadRow(tx, id), actor);
    });
  }

  async discard(actor: ActorContext, id: string, input: DiscardProcurementInput): Promise<RequisitionView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.loadRow(tx, id);
      this.assertOriginatorDraft(actor, current, 'requisition.discard_draft');
      if (current.row_version !== input.rowVersion) {
        throw new StaleRecordError('This requisition has changed. Refresh and try again.', {
          rowVersion: current.row_version,
        });
      }
      await tx.client.query(`UPDATE requisitions SET status = 'DISCARDED', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        id,
      ]);
      return this.toView(tx, await this.loadRow(tx, id), actor);
    });
  }

  async memoHtml(actor: ActorContext, id: string): Promise<{ html: string }> {
    const view = await this.get(actor, id);
    const snapshot = await this.snapshotFor(actor, id, view);
    const stamps = await this.liveStamps(actor, view, snapshot);
    return { html: renderRequisitionMemoHtml(snapshot, stamps) };
  }

  async memoPdf(actor: ActorContext, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const view = await this.get(actor, id);
    const snapshot = await this.snapshotFor(actor, id, view);
    const stamps = await this.liveStamps(actor, view, snapshot);
    const buffer = await renderRequisitionMemoPdf(snapshot, stamps);
    return { buffer, filename: `${view.referenceNumber}-memo.pdf` };
  }

  private async snapshotFor(
    actor: ActorContext,
    id: string,
    view: RequisitionView,
  ): Promise<RequisitionMemoSnapshot> {
    return this.unitOfWork.read(actor, async (tx) => {
      const frozen = await tx.client.query<{ canonical_json: RequisitionMemoSnapshot }>(
        `SELECT canonical_json FROM requisition_memo_snapshots s
           JOIN requisition_versions v ON v.id = s.version_id
           JOIN requisitions q ON q.id = v.requisition_id
          WHERE q.id = $1 AND v.version_number = q.current_version`,
        [id],
      );
      if (frozen.rows[0]) return frozen.rows[0].canonical_json;
      const row = await this.loadRow(tx, id);
      const lines = await this.loadLines(tx, row.version_id);
      void view;
      return this.buildSnapshot(row, lines);
    });
  }

  private async liveStamps(actor: ActorContext, view: RequisitionView, snapshot: RequisitionMemoSnapshot) {
    if (!view.procurementRequestId) {
      return memoStamps({
        originatorName: snapshot.originatorName,
        originatorPosition: snapshot.originatorPosition,
        templateVersion: 3,
        includeOperations: false,
      }).slice(0, 2);
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        action: string;
        approver_name: string | null;
        approver_role: string | null;
        occurred_at: Date;
      }>(
        `SELECT s.action, app.user_public_name(s.approver_id) AS approver_name, s.approver_role, s.occurred_at
           FROM seals s
          WHERE s.subject_type = 'PROCUREMENT' AND s.subject_id = $1
          ORDER BY s.occurred_at`,
        [view.procurementRequestId],
      );
      return memoStamps({
        originatorName: snapshot.originatorName,
        originatorPosition: snapshot.originatorPosition,
        templateVersion: 3,
        includeOperations: false,
        seals: result.rows.flatMap((row) =>
          isSealAction(row.action)
            ? [
                {
                  action: row.action,
                  approverName: row.approver_name ?? snapshot.originatorName,
                  approverRole: row.approver_role,
                  approverRoleLabel:
                    row.approver_role && isRoleKey(row.approver_role) ? ROLES[row.approver_role].name : null,
                  occurredAt: row.occurred_at.toISOString(),
                },
              ]
            : [],
        ),
      }).slice(0, 2);
    });
  }

  private buildSnapshot(row: LoadedRequisition, lines: RequisitionLineView[]): RequisitionMemoSnapshot {
    return {
      templateVersion: REQUISITION_MEMO_TEMPLATE_VERSION,
      referenceNumber: row.reference_number,
      title: row.title,
      memoDate: new Date().toISOString(),
      originatorName: row.originator_name ?? 'Originator',
      originatorPosition: row.originator_position ?? 'General Manager',
      entityCode: row.entity_code ?? '',
      entityName: row.entity_name ?? '',
      departmentName: row.department_name ?? '',
      categoryName: row.category_name ?? '',
      background: row.background ?? '',
      justification: row.justification ?? '',
      prayer: row.prayer ?? '',
      requiredDate: dateOnly(row.required_date) ?? '',
      deliveryLocation: row.delivery_location ?? '',
      urgency: row.urgency,
      version: row.current_version,
      lines: lines.map((line) => ({
        lineNumber: line.lineNumber,
        description: line.description,
        quantity: line.quantity,
        unitCode: line.unitCode ?? '',
        unitName: line.unitName ?? '',
      })),
    };
  }

  private async ensureShellRequest(
    tx: TxScope,
    actor: ActorContext,
    requisition: LoadedRequisition,
    lines: RequisitionLineView[],
  ): Promise<string> {
    if (requisition.procurement_request_id) return requisition.procurement_request_id;
    const allocated = await tx.client.query<{ ref: string }>(
      'SELECT app.next_reference($1, NULL) AS ref',
      ['PR'],
    );
    const reference = allocated.rows[0]?.ref;
    if (!reference) throw new Error('The procurement reference was not allocated.');
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO procurement_requests (
         reference_number, entity_id, department_id, originator_user_id, requisition_id, created_by, updated_by
       ) VALUES ($1, $2, $3, $4::uuid, $5, $4, $4)
       RETURNING id`,
      [reference, requisition.entity_id, requisition.department_id, actor.ref, requisition.id],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('The procurement request was not created.');
    const version = await tx.client.query<{ id: string }>(
      `INSERT INTO procurement_versions (
         request_id, entity_id, version_number, title, subject, category_id, reason, description,
         required_date, delivery_location, urgency, additional_instructions, created_by, updated_by
       ) VALUES ($1, $2, 1, $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
       RETURNING id`,
      [
        id,
        requisition.entity_id,
        requisition.title,
        requisition.category_id,
        requisition.justification,
        requisition.background,
        dateOnly(requisition.required_date),
        requisition.delivery_location,
        requisition.urgency,
        requisition.prayer,
        actor.ref,
      ],
    );
    const versionId = version.rows[0]?.id;
    if (versionId) {
      let lineNumber = 1;
      for (const line of lines) {
        await tx.client.query(
          `INSERT INTO procurement_version_lines (
             version_id, entity_id, line_number, description, category_id, quantity, unit_id, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
          [
            versionId,
            requisition.entity_id,
            lineNumber,
            line.description,
            requisition.category_id,
            line.quantity,
            line.unitId,
            actor.ref,
          ],
        );
        lineNumber += 1;
      }
    }
    return id;
  }

  private async refreshShellRequest(
    tx: TxScope,
    actor: ActorContext,
    requisition: LoadedRequisition,
    lines: RequisitionLineView[],
    requestId: string,
  ): Promise<void> {
    const version = await tx.client.query<{ id: string; submitted_at: Date | null }>(
      `SELECT v.id, v.submitted_at
         FROM procurement_requests r
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
        WHERE r.id = $1`,
      [requestId],
    );
    const current = version.rows[0];
    if (!current || current.submitted_at) return;
    await tx.client.query(
      `UPDATE procurement_requests SET department_id = $1, updated_by = $2 WHERE id = $3`,
      [requisition.department_id, actor.ref, requestId],
    );
    await tx.client.query(
      `UPDATE procurement_versions
          SET title = $1, subject = $1, category_id = $2, reason = $3, description = $4,
              required_date = $5, delivery_location = $6, urgency = $7,
              additional_instructions = $8, updated_by = $9
        WHERE id = $10`,
      [
        requisition.title,
        requisition.category_id,
        requisition.justification,
        requisition.background,
        dateOnly(requisition.required_date),
        requisition.delivery_location,
        requisition.urgency,
        requisition.prayer,
        actor.ref,
        current.id,
      ],
    );
    await tx.client.query(`DELETE FROM procurement_version_lines WHERE version_id = $1`, [current.id]);
    let lineNumber = 1;
    for (const line of lines) {
      await tx.client.query(
        `INSERT INTO procurement_version_lines (
           version_id, entity_id, line_number, description, category_id, quantity, unit_id, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          current.id,
          requisition.entity_id,
          lineNumber,
          line.description,
          requisition.category_id,
          line.quantity,
          line.unitId,
          actor.ref,
        ],
      );
      lineNumber += 1;
    }
  }

  private async loadRow(tx: TxScope, id: string): Promise<LoadedRequisition> {
    const result = await tx.client.query<LoadedRequisition>(`${LOAD_SQL} WHERE q.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That requisition was not found.');
    return row;
  }

  private async loadLines(tx: TxScope, versionId: string): Promise<RequisitionLineView[]> {
    const result = await tx.client.query<{
      id: string;
      line_number: number;
      description: string;
      quantity: number;
      unit_id: string | null;
      unit_code: string | null;
      unit_name: string | null;
    }>(
      `SELECT l.id, l.line_number, l.description, l.quantity, l.unit_id, u.code AS unit_code, u.name AS unit_name
         FROM requisition_lines l
         LEFT JOIN units_of_measure u ON u.id = l.unit_id
        WHERE l.version_id = $1
        ORDER BY l.line_number`,
      [versionId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      lineNumber: row.line_number,
      description: row.description,
      quantity: row.quantity,
      unitId: row.unit_id,
      unitCode: row.unit_code,
      unitName: row.unit_name,
    }));
  }

  private async toView(tx: TxScope, row: LoadedRequisition, _actor: ActorContext): Promise<RequisitionView> {
    const lines = await this.loadLines(tx, row.version_id);
    const status: RequisitionStatus = isRequisitionStatus(row.status) ? row.status : 'DRAFT';
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      entityName: row.entity_name,
      departmentId: row.department_id,
      departmentName: row.department_name,
      originatorUserId: row.originator_user_id,
      originatorName: row.originator_name,
      originatorPosition: row.originator_position,
      currentVersion: row.current_version,
      status,
      title: row.title,
      background: row.background,
      justification: row.justification,
      prayer: row.prayer,
      categoryId: row.category_id,
      categoryKey: row.category_key,
      categoryName: row.category_name,
      operationsMachinery: row.operations_machinery,
      requiredDate: dateOnly(row.required_date),
      urgency: (row.urgency as RequisitionView['urgency']) ?? 'NORMAL',
      deliveryLocation: row.delivery_location,
      versionId: row.version_id,
      rowVersion: row.row_version,
      createdAt: row.created_at.toISOString(),
      procurementRequestId: row.procurement_request_id,
      procurementReference: row.procurement_reference,
      workflowInstanceId: row.workflow_instance_id,
      memoSnapshotHash: row.memo_hash,
      pdfDocumentId: row.pdf_document_id,
      lastReturnReason: row.last_return_reason,
      lines,
    };
  }

  private assertReady(row: LoadedRequisition, lines: RequisitionLineView[]): void {
    const missing: string[] = [];
    if (!row.title.trim()) missing.push('title');
    if (!row.background?.trim()) missing.push('background');
    if (!row.justification?.trim()) missing.push('justification');
    if (!row.prayer?.trim()) missing.push('prayer');
    if (!row.category_id) missing.push('category');
    if (!row.required_date) missing.push('required date');
    if (!row.delivery_location?.trim()) missing.push('delivery location');
    if (!row.department_id) missing.push('department');
    if (lines.length === 0) missing.push('items');
    if (missing.length > 0) {
      throw new ValidationFailedError(`Complete the requisition before submitting: ${missing.join(', ')}.`);
    }
  }

  private assertOriginatorDraft(
    actor: ActorContext,
    row: LoadedRequisition,
    permission: 'requisition.edit_draft' | 'requisition.submit' | 'requisition.discard_draft' = 'requisition.edit_draft',
  ): void {
    assertCan(actor, permission, row.entity_id);
    if (actor.ref !== row.originator_user_id) {
      throw new ForbiddenError('Only the originating GM may change a draft requisition.');
    }
    if (row.status !== 'DRAFT') {
      throw new ConflictError('Only a draft requisition can be changed.');
    }
  }

  private assertReader(actor: ActorContext): void {
    if (
      !can(actor, 'requisition.create') &&
      !can(actor, 'requisition.approve.need') &&
      !can(actor, 'procurement.view') &&
      !can(actor, 'procurement.prepare')
    ) {
      throw new ForbiddenError('You cannot view requisitions.');
    }
  }

  private canSee(actor: ActorContext, entityId: string): boolean {
    return (
      can(actor, 'requisition.create', entityId) ||
      can(actor, 'requisition.approve.need', entityId) ||
      can(actor, 'procurement.view', entityId) ||
      can(actor, 'procurement.prepare', entityId)
    );
  }

  private assertRequiredDate(isoDate: string): void {
    const today = formatLagosIsoDate(new Date());
    if (isoDate < today) {
      throw new ValidationFailedError('The required date cannot be in the past.');
    }
  }
}

function dateOnly(value: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return formatLagosIsoDate(value);
}
