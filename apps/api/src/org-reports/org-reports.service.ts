import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import {
  canTransitionOrgMinute,
  canTransitionOrgReport,
  type OrgExternalView,
  type OrgMinuteListItemView,
  type OrgMinutePriority,
  type OrgMinuteRecipientKind,
  type OrgMinuteStatus,
  type OrgMinuteView,
  type OrgReportAccessKind,
  type OrgReportAttachmentView,
  type OrgReportDashboardView,
  type OrgReportListItemView,
  type OrgReportPersonView,
  type OrgReportSearchHitView,
  type OrgReportStatus,
  type OrgReportTemplateView,
  type OrgReportView,
  type OrgResponseStatus,
  type OrgResponseView,
  type OrgDecisionView,
  type PermissionKey,
} from '@nfc/shared';
import type { PoolClient } from 'pg';
import { assertCan, can } from '../auth/can';
import {
  ForbiddenError,
  NotFoundError,
  StaleRecordError,
  ValidationFailedError,
} from '../common/errors/domain-error';
import { loadApiEnv } from '../config/env';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import { sendSmtp, smtpConfigured } from '../mail/smtp-transport';
import { renderOrgMinutePdf, renderOrgReportPdf, renderOrgResponsePdf } from './org-reports-pdf';
import { PayrollService } from '../payroll/payroll.service';
import type {
  AmendOrgReportInput,
  CloseOrgReportInput,
  CreateDecisionInput,
  CreateMinuteInput,
  CreateOrgReportInput,
  CreateResponseInput,
  ForwardOrgReportInput,
  ReviewResponseInput,
  SendExternalInput,
  SubmitOrgReportInput,
  UpdateOrgReportInput,
  UpdateTemplateInput,
} from './org-reports.dto';

const INVALID_RECIPIENT = 'That recipient cannot be used.';
const ORG_OWNERS = new Set(['org_report', 'org_minute', 'org_response', 'org_decision']);

interface ReportRow {
  id: string;
  reference_number: string;
  template_id: string;
  template_key: string;
  template_title: string;
  entity_id: string;
  entity_code: string | null;
  entity_name: string | null;
  title: string;
  body: string;
  observations: string | null;
  reporting_period: string | null;
  report_date: string;
  status: OrgReportStatus;
  sender_user_id: string;
  sender_name: string | null;
  to_user_id: string | null;
  to_name: string | null;
  current_revision_id: string | null;
  submitted_at: Date | null;
  intended_cc_user_ids: string[];
  idempotency_key: string | null;
  created_by: string;
  updated_at: Date;
  row_version: number;
  snapshot: Record<string, unknown> | null;
}

@Injectable()
export class OrgReportsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    @Optional() @Inject(forwardRef(() => PayrollService)) private readonly payroll?: PayrollService,
  ) {}

  async templates(actor: ActorContext, forCreate = true): Promise<OrgReportTemplateView[]> {
    if (!can(actor, 'org_report.create') && !can(actor, 'org_report.view') && !can(actor, 'org_report.template.manage')) {
      throw new ForbiddenError('You cannot view official report templates.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        key: string;
        title: string;
        kind: OrgReportTemplateView['kind'];
        required_permission: PermissionKey;
        available: boolean;
        sort_order: number;
        acknowledgement_default: boolean;
        row_version: number;
        fields: Record<string, unknown>;
      }>(
        `SELECT id, key, title, kind, required_permission, available, sort_order, acknowledgement_default, row_version, fields
           FROM org_report_templates
          ORDER BY sort_order, title`,
      );
      return result.rows
        .filter((row) => {
          if (can(actor, 'org_report.template.manage')) return true;
          if (forCreate && !row.available) return false;
          return can(actor, row.required_permission);
        })
        .map((row) => ({
          id: row.id,
          key: row.key,
          title: row.title,
          kind: row.kind,
          requiredPermission: row.required_permission,
          available: row.available,
          sortOrder: row.sort_order,
          acknowledgementDefault: row.acknowledgement_default,
          rowVersion: row.row_version,
          fields: row.fields ?? {},
        }));
    });
  }

  async updateTemplate(actor: ActorContext, id: string, input: UpdateTemplateInput): Promise<OrgReportTemplateView> {
    assertCan(actor, 'org_report.template.manage');
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await tx.client.query<{ row_version: number; title: string; available: boolean }>(
        `SELECT row_version, title, available FROM org_report_templates WHERE id = $1`,
        [id],
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundError('That template does not exist.');
      if (row.row_version !== input.rowVersion) throw new StaleRecordError('This template has changed.');
      await tx.client.query(
        `UPDATE org_report_templates SET title = $1, available = $2, updated_by = $3 WHERE id = $4`,
        [input.title?.trim() || row.title, input.available ?? row.available, actor.ref, id],
      );
      await tx.audit({
        action: 'system_configuration_change',
        subjectType: 'org_report_template',
        subjectId: id,
        subjectLabel: input.title?.trim() || row.title,
        newValue: { available: input.available ?? row.available },
      });
      const list = await this.templates(actor, false);
      const updated = list.find((item) => item.id === id);
      if (!updated) throw new NotFoundError('That template does not exist.');
      return updated;
    });
  }

  async directory(actor: ActorContext): Promise<OrgReportPersonView[]> {
    if (!can(actor, 'org_report.create') && !can(actor, 'org_report.view') && !can(actor, 'org_report.forward')) {
      throw new ForbiddenError('You cannot list recipients.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<OrgReportPersonView>(
        `SELECT id, name, job_title AS position, entity_code AS "entityCode" FROM app.org_report_directory()`,
      );
      return result.rows.filter((row) => row.id !== actor.ref);
    });
  }

  async dashboard(actor: ActorContext): Promise<OrgReportDashboardView> {
    if (!can(actor, 'org_report.view') && !can(actor, 'org_report.create')) {
      throw new ForbiddenError('You cannot view official reports.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const counts = await tx.client.query<{
        incoming: string;
        under_review: string;
        recently_forwarded: string;
        minutes_issued: string;
        awaiting_response: string;
        awaiting_review: string;
        outstanding: string;
        recent_decisions: string;
        my_reports: string;
        information: string;
        assigned: string;
        awaiting_submission: string;
      }>(
        `SELECT
           (SELECT count(*) FROM org_reports r
             JOIN org_report_access a ON a.report_id = r.id AND a.user_id = $1 AND a.kind = 'TO' AND a.revoked_at IS NULL
            WHERE r.status IN ('SUBMITTED', 'UNDER_REVIEW')) AS incoming,
           (SELECT count(*) FROM org_reports r
             JOIN org_report_access a ON a.report_id = r.id AND a.user_id = $1 AND a.kind = 'TO' AND a.revoked_at IS NULL
            WHERE r.status = 'UNDER_REVIEW') AS under_review,
           (SELECT count(*) FROM org_report_forwards f WHERE f.created_by = $2 AND f.created_at > now() - interval '14 days') AS recently_forwarded,
           (SELECT count(*) FROM org_minutes m WHERE m.issuer_user_id = $1 AND m.status <> 'DRAFT') AS minutes_issued,
           (SELECT count(*) FROM org_minutes m WHERE m.issuer_user_id = $1 AND m.status IN ('ISSUED','ACKNOWLEDGED','IN_PROGRESS','FURTHER_ACTION_REQUIRED')) AS awaiting_response,
           (SELECT count(*) FROM org_minutes m WHERE m.issuer_user_id = $1 AND m.status = 'RESPONSE_SUBMITTED') AS awaiting_review,
           (SELECT count(*) FROM org_minutes m WHERE (m.issuer_user_id = $1 OR m.to_user_id = $1)
              AND m.status IN ('ISSUED','ACKNOWLEDGED','IN_PROGRESS','FURTHER_ACTION_REQUIRED','RESPONSE_SUBMITTED')) AS outstanding,
           (SELECT count(*) FROM org_decisions d WHERE d.created_by = $2 AND d.created_at > now() - interval '14 days') AS recent_decisions,
           (SELECT count(*) FROM org_reports r WHERE r.sender_user_id = $1) AS my_reports,
           (SELECT count(*) FROM org_reports r
             JOIN org_report_access a ON a.report_id = r.id AND a.user_id = $1 AND a.kind IN ('CC','FORWARD') AND a.revoked_at IS NULL
            WHERE r.status <> 'DRAFT') AS information,
           (SELECT count(*) FROM org_minutes m WHERE m.to_user_id = $1 AND m.status NOT IN ('DRAFT','COMPLETED')) AS assigned,
           (SELECT count(*) FROM org_minutes m WHERE m.to_user_id = $1 AND m.status IN ('ISSUED','ACKNOWLEDGED','IN_PROGRESS','FURTHER_ACTION_REQUIRED')) AS awaiting_submission`,
        [actor.ref, actor.ref],
      );
      const row = counts.rows[0];
      return {
        incoming: Number(row?.incoming ?? 0),
        underReview: Number(row?.under_review ?? 0),
        recentlyForwarded: Number(row?.recently_forwarded ?? 0),
        minutesIssued: Number(row?.minutes_issued ?? 0),
        minutesAwaitingResponse: Number(row?.awaiting_response ?? 0),
        responsesAwaitingReview: Number(row?.awaiting_review ?? 0),
        outstandingActions: Number(row?.outstanding ?? 0),
        recentDecisions: Number(row?.recent_decisions ?? 0),
        myReports: Number(row?.my_reports ?? 0),
        receivedForInformation: Number(row?.information ?? 0),
        assignedMinutes: Number(row?.assigned ?? 0),
        responsesAwaitingSubmission: Number(row?.awaiting_submission ?? 0),
      };
    });
  }

  async list(
    actor: ActorContext,
    box: 'mine' | 'incoming' | 'information' | 'forwarded' = 'mine',
    status?: OrgReportStatus,
  ): Promise<OrgReportListItemView[]> {
    if (!can(actor, 'org_report.view') && !can(actor, 'org_report.create')) {
      throw new ForbiddenError('You cannot view official reports.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const filters: string[] = [];
      const values: unknown[] = [actor.ref];
      if (box === 'mine') filters.push('r.sender_user_id = $1');
      if (box === 'incoming') {
        filters.push(`EXISTS (SELECT 1 FROM org_report_access a WHERE a.report_id = r.id AND a.user_id = $1 AND a.kind = 'TO' AND a.revoked_at IS NULL)`);
        filters.push(`r.status IN ('SUBMITTED','UNDER_REVIEW','CLOSED','ARCHIVED')`);
      }
      if (box === 'information') {
        filters.push(`EXISTS (SELECT 1 FROM org_report_access a WHERE a.report_id = r.id AND a.user_id = $1 AND a.kind IN ('CC','FORWARD') AND a.revoked_at IS NULL)`);
        filters.push(`r.status <> 'DRAFT'`);
      }
      if (box === 'forwarded') {
        filters.push(`EXISTS (SELECT 1 FROM org_report_forwards f WHERE f.report_id = r.id AND f.created_by = $1)`);
      }
      if (status) {
        values.push(status);
        filters.push(`r.status = $${values.length}`);
      }
      const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
      const result = await tx.client.query<ReportRow>(`${this.reportSelectSql()} ${where} ORDER BY r.updated_at DESC`, values);
      const items: OrgReportListItemView[] = [];
      for (const row of result.rows) {
        items.push(await this.toListItem(tx.client, actor, row));
      }
      return items;
    });
  }

  async get(actor: ActorContext, id: string): Promise<OrgReportView> {
    const current = await this.unitOfWork.read(actor, async (tx) => this.getInTx(tx, actor, id));
    if (
      current.status === 'SUBMITTED' &&
      can(actor, 'org_report.forward', current.entityId) &&
      current.toUserId === actor.ref
    ) {
      return this.unitOfWork.write(actor, async (tx) => {
        await tx.client.query(
          `UPDATE org_reports SET status = 'UNDER_REVIEW', updated_by = $1 WHERE id = $2 AND status = 'SUBMITTED'`,
          [actor.ref, id],
        );
        return this.getInTx(tx, actor, id);
      });
    }
    return current;
  }

  async create(actor: ActorContext, input: CreateOrgReportInput): Promise<OrgReportView> {
    assertCan(actor, 'org_report.create', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM org_reports WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) return this.getInTx(tx, actor, existing.rows[0].id);

      const template = await this.loadTemplate(tx, input.templateKey);
      if (!template.available) throw new ValidationFailedError('That report type is not available.');
      if (!can(actor, template.required_permission, input.entityId)) {
        throw new ForbiddenError('You are not authorised to create this type of report.');
      }
      const cc = input.ccUserIds ?? [];
      await this.assertSelectable(tx, actor, cc);

      const allocated = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('ORG') AS ref`);
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The report reference was not allocated.');

      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO org_reports (
           reference_number, template_id, entity_id, title, body, observations, reporting_period,
           report_date, sender_user_id, intended_cc_user_ids, idempotency_key, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7, coalesce($8::date, (timezone('Africa/Lagos', now()))::date), $9, $10::uuid[], $11, $12, $12)
         RETURNING id`,
        [
          reference,
          template.id,
          input.entityId,
          input.title.trim(),
          input.body.trim(),
          input.observations?.trim() || null,
          input.reportingPeriod?.trim() || null,
          input.reportDate ?? null,
          actor.ref,
          cc,
          input.idempotencyKey,
          actor.ref,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The report was not created.');
      const snapshot = await this.payroll?.stampOrgSnapshotInTx(tx, template.key, input.entityId);
      if (snapshot) {
        await tx.client.query(`UPDATE org_reports SET snapshot = $1::jsonb WHERE id = $2`, [
          JSON.stringify(snapshot),
          id,
        ]);
      }
      const revisionId = await this.insertRevision(tx, id, input.entityId, input.title.trim(), input.body.trim(), input.observations?.trim() || null, 'Draft created', actor.ref);
      await tx.client.query(`UPDATE org_reports SET current_revision_id = $1, updated_by = $2 WHERE id = $3`, [
        revisionId,
        actor.ref,
        id,
      ]);
      await this.grantAccess(tx, id, input.entityId, actor.ref, 'OWNER', actor.ref);
      await tx.audit({
        action: 'create',
        subjectType: 'org_report',
        subjectId: id,
        subjectLabel: input.title.trim(),
        subjectReferenceNumber: reference,
        entityId: input.entityId,
        newValue: { template: template.key },
      });
      await tx.appendTimeline({
        subjectType: 'ORG_REPORT',
        subjectId: id,
        text: `Draft official report ${reference} created.`,
        href: `/org-reports/${id}`,
        entityId: input.entityId,
      });
      return this.getInTx(tx, actor, id);
    });
  }

  async updateDraft(actor: ActorContext, id: string, input: UpdateOrgReportInput): Promise<OrgReportView> {
    assertCan(actor, 'org_report.create');
    return this.unitOfWork.write(actor, async (tx) => {
      const row = await this.lockReport(tx, id);
      if (row.status !== 'DRAFT') throw new ForbiddenError('Submitted reports cannot be overwritten.');
      if (row.sender_user_id !== actor.ref) throw new ForbiddenError('Only the author can edit this draft.');
      if (row.row_version !== input.rowVersion) throw new StaleRecordError('This report has changed.');
      const cc = input.ccUserIds ?? row.intended_cc_user_ids ?? [];
      await this.assertSelectable(tx, actor, cc);
      const title = input.title?.trim() || row.title;
      const body = input.body?.trim() || row.body;
      const observations = input.observations === undefined ? row.observations : input.observations?.trim() || null;
      const revisionId = await this.insertRevision(tx, id, row.entity_id, title, body, observations, 'Draft updated', actor.ref);
      await tx.client.query(
        `UPDATE org_reports
            SET title = $1, body = $2, observations = $3, reporting_period = $4, report_date = coalesce($5::date, report_date),
                intended_cc_user_ids = $6::uuid[], current_revision_id = $7, updated_by = $8
          WHERE id = $9`,
        [
          title,
          body,
          observations,
          input.reportingPeriod === undefined ? row.reporting_period : input.reportingPeriod?.trim() || null,
          input.reportDate ?? null,
          cc,
          revisionId,
          actor.ref,
          id,
        ],
      );
      return this.getInTx(tx, actor, id);
    });
  }

  async submit(actor: ActorContext, id: string, input: SubmitOrgReportInput): Promise<OrgReportView> {
    assertCan(actor, 'org_report.submit');
    return this.unitOfWork.write(actor, async (tx) => {
      const row = await this.lockReport(tx, id);
      if (row.sender_user_id !== actor.ref) throw new ForbiddenError('Only the author can submit this report.');
      if (row.status !== 'DRAFT') {
        return this.getInTx(tx, actor, id);
      }
      if (row.row_version !== input.rowVersion) throw new StaleRecordError('This report has changed.');
      assertCan(actor, 'org_report.submit', row.entity_id);
      if (!canTransitionOrgReport(row.status, 'SUBMITTED')) {
        throw new ValidationFailedError('This report cannot be submitted from its current status.');
      }
      const md = await this.managingDirector(tx);
      const cc = row.intended_cc_user_ids ?? [];
      await this.assertSelectable(tx, actor, cc.filter((userId) => userId !== md.id));

      const snapshot = await this.payroll?.stampOrgSnapshotInTx(tx, row.template_key, row.entity_id);
      await tx.client.query(
        `UPDATE org_reports SET status = 'SUBMITTED', to_user_id = $1, submitted_at = now(), updated_by = $2,
                snapshot = coalesce($4::jsonb, snapshot) WHERE id = $3`,
        [md.id, actor.ref, id, snapshot ? JSON.stringify(snapshot) : null],
      );
      await this.addRecipient(tx, id, row.entity_id, md.id, 'TO', null, actor.ref);
      await this.grantAccess(tx, id, row.entity_id, md.id, 'TO', actor.ref);
      for (const userId of cc) {
        if (userId === md.id || userId === actor.ref) continue;
        await this.addRecipient(tx, id, row.entity_id, userId, 'CC', null, actor.ref);
        await this.grantAccess(tx, id, row.entity_id, userId, 'CC', actor.ref);
      }
      await tx.audit({
        action: 'edit',
        subjectType: 'org_report',
        subjectId: id,
        subjectLabel: row.title,
        subjectReferenceNumber: row.reference_number,
        entityId: row.entity_id,
        newValue: { status: 'SUBMITTED', toUserId: md.id },
      });
      await tx.appendTimeline({
        subjectType: 'ORG_REPORT',
        subjectId: id,
        text: `Submitted ${row.reference_number} to the Managing Director.`,
        href: `/org-reports/${id}`,
        entityId: row.entity_id,
      });
      await this.notify(tx, 'org_report.submitted', md.id, row.entity_id, row.reference_number, row.title, `/org-reports/${id}`);
      for (const userId of cc) {
        if (userId === md.id || userId === actor.ref) continue;
        await this.notify(tx, 'org_report.submitted', userId, row.entity_id, row.reference_number, row.title, `/org-reports/${id}`);
      }
      return this.getInTx(tx, actor, id);
    });
  }

  async amend(actor: ActorContext, id: string, input: AmendOrgReportInput): Promise<OrgReportView> {
    assertCan(actor, 'org_report.create');
    if (!input.reason.trim()) throw new ValidationFailedError('A reason is required to amend an official report.');
    return this.unitOfWork.write(actor, async (tx) => {
      const row = await this.lockReport(tx, id);
      if (row.status === 'DRAFT') throw new ValidationFailedError('Edit the draft instead of amending it.');
      if (row.sender_user_id !== actor.ref && !can(actor, 'org_report.close', row.entity_id)) {
        throw new ForbiddenError('You cannot amend this report.');
      }
      if (row.row_version !== input.rowVersion) throw new StaleRecordError('This report has changed.');
      const title = input.title?.trim() || row.title;
      const body = input.body?.trim() || row.body;
      const observations = input.observations === undefined ? row.observations : input.observations?.trim() || null;
      const revisionId = await this.insertRevision(tx, id, row.entity_id, title, body, observations, input.reason.trim(), actor.ref);
      await tx.client.query(
        `UPDATE org_reports SET title = $1, body = $2, observations = $3, current_revision_id = $4, updated_by = $5 WHERE id = $6`,
        [title, body, observations, revisionId, actor.ref, id],
      );
      await tx.audit({
        action: 'edit',
        subjectType: 'org_report',
        subjectId: id,
        subjectLabel: title,
        subjectReferenceNumber: row.reference_number,
        entityId: row.entity_id,
        reason: input.reason.trim(),
        newValue: { revisionId },
      });
      await tx.appendTimeline({
        subjectType: 'ORG_REPORT',
        subjectId: id,
        text: `Controlled amendment recorded. ${input.reason.trim()}`,
        href: `/org-reports/${id}`,
        entityId: row.entity_id,
      });
      return this.getInTx(tx, actor, id);
    });
  }

  async forward(actor: ActorContext, id: string, input: ForwardOrgReportInput): Promise<OrgReportView> {
    assertCan(actor, 'org_report.forward');
    return this.unitOfWork.write(actor, async (tx) => {
      const row = await this.lockReport(tx, id);
      assertCan(actor, 'org_report.forward', row.entity_id);
      if (row.status === 'DRAFT') throw new ValidationFailedError('A draft cannot be forwarded.');
      if (row.to_user_id !== actor.ref) throw new ForbiddenError('Only the Managing Director can forward this report.');
      if (row.row_version !== input.rowVersion) throw new StaleRecordError('This report has changed.');
      await this.assertSelectable(tx, actor, input.userIds);
      const event = await tx.client.query<{ id: string }>(
        `INSERT INTO org_report_forwards (report_id, entity_id, note, document_revision_id, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [id, row.entity_id, input.note?.trim() || null, row.current_revision_id, actor.ref],
      );
      const eventId = event.rows[0]?.id;
      if (!eventId) throw new Error('The forwarding event was not recorded.');
      for (const userId of input.userIds) {
        if (userId === actor.ref) continue;
        await this.addRecipient(tx, id, row.entity_id, userId, 'FORWARD', eventId, actor.ref);
        await this.grantAccess(tx, id, row.entity_id, userId, 'FORWARD', actor.ref);
        await this.notify(tx, 'org_report.forwarded', userId, row.entity_id, row.reference_number, row.title, `/org-reports/${id}`);
      }
      await tx.audit({
        action: 'document_share',
        subjectType: 'org_report',
        subjectId: id,
        subjectLabel: row.title,
        subjectReferenceNumber: row.reference_number,
        entityId: row.entity_id,
        newValue: { forwardId: eventId, userIds: input.userIds },
      });
      await tx.appendTimeline({
        subjectType: 'ORG_REPORT',
        subjectId: id,
        text: `Forwarded ${row.reference_number} to additional authorised recipients.`,
        href: `/org-reports/${id}`,
        entityId: row.entity_id,
      });
      return this.getInTx(tx, actor, id);
    });
  }

  async close(actor: ActorContext, id: string, input: CloseOrgReportInput): Promise<OrgReportView> {
    assertCan(actor, 'org_report.close');
    return this.unitOfWork.write(actor, async (tx) => {
      const row = await this.lockReport(tx, id);
      assertCan(actor, 'org_report.close', row.entity_id);
      if (row.row_version !== input.rowVersion) throw new StaleRecordError('This report has changed.');
      if (!canTransitionOrgReport(row.status, input.status)) {
        throw new ValidationFailedError('That status change is not permitted.');
      }
      await tx.client.query(
        `UPDATE org_reports
            SET status = $1,
                closed_at = CASE WHEN $1 = 'CLOSED' THEN now() ELSE closed_at END,
                archived_at = CASE WHEN $1 = 'ARCHIVED' THEN now() ELSE archived_at END,
                updated_by = $2
          WHERE id = $3`,
        [input.status, actor.ref, id],
      );
      await tx.audit({
        action: input.status === 'ARCHIVED' ? 'archive' : 'edit',
        subjectType: 'org_report',
        subjectId: id,
        subjectLabel: row.title,
        subjectReferenceNumber: row.reference_number,
        entityId: row.entity_id,
        newValue: { status: input.status },
      });
      return this.getInTx(tx, actor, id);
    });
  }

  async revokeAccess(actor: ActorContext, id: string, userId: string): Promise<OrgReportView> {
    assertCan(actor, 'org_report.forward');
    return this.unitOfWork.write(actor, async (tx) => {
      const row = await this.lockReport(tx, id);
      assertCan(actor, 'org_report.forward', row.entity_id);
      if (row.to_user_id !== actor.ref) throw new ForbiddenError('Only the Managing Director can revoke access.');
      await tx.client.query(
        `UPDATE org_report_access
            SET revoked_at = now(), revoked_by = $1, updated_by = $1
          WHERE report_id = $2 AND user_id = $3 AND kind IN ('CC','FORWARD') AND revoked_at IS NULL`,
        [actor.ref, id, userId],
      );
      await tx.audit({
        action: 'permission_change',
        subjectType: 'org_report',
        subjectId: id,
        subjectLabel: row.title,
        subjectReferenceNumber: row.reference_number,
        entityId: row.entity_id,
        newValue: { revokedUserId: userId },
      });
      return this.getInTx(tx, actor, id);
    });
  }

  async createMinute(actor: ActorContext, reportId: string, input: CreateMinuteInput): Promise<OrgMinuteView> {
    assertCan(actor, 'org_report.minute.issue');
    return this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{ id: string }>(`SELECT id FROM org_minutes WHERE idempotency_key = $1`, [
        input.idempotencyKey,
      ]);
      if (existing.rows[0]) return this.getMinuteInTx(tx, actor, existing.rows[0].id);
      const report = await this.lockReport(tx, reportId);
      assertCan(actor, 'org_report.minute.issue', report.entity_id);
      if (report.status === 'DRAFT') throw new ValidationFailedError('Issue a minute from a submitted report.');
      if (report.to_user_id !== actor.ref) throw new ForbiddenError('Only the Managing Director can issue an official minute.');
      await this.assertSelectable(tx, actor, [input.toUserId, ...(input.ccUserIds ?? [])]);
      const allocated = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('MIN') AS ref`);
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The minute reference was not allocated.');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO org_minutes (
           reference_number, source_report_id, entity_id, subject, instruction, expected_outcome,
           due_at, response_required, acknowledgement_required, priority, issuer_user_id, to_user_id,
           issued_revision_id, idempotency_key, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
         RETURNING id`,
        [
          reference,
          reportId,
          report.entity_id,
          input.subject.trim(),
          input.instruction.trim(),
          input.expectedOutcome?.trim() || null,
          input.dueAt ? new Date(input.dueAt) : null,
          input.responseRequired ?? true,
          input.acknowledgementRequired ?? false,
          input.priority ?? 'NORMAL',
          actor.ref,
          input.toUserId,
          report.current_revision_id,
          input.idempotencyKey,
          actor.ref,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The minute was not created.');
      const cc = input.ccUserIds ?? [report.sender_user_id];
      await tx.client.query(
        `INSERT INTO org_minute_recipients (minute_id, entity_id, user_id, kind, created_by) VALUES ($1,$2,$3,'TO',$4)`,
        [id, report.entity_id, input.toUserId, actor.ref],
      );
      for (const userId of cc) {
        if (userId === input.toUserId) continue;
        await tx.client.query(
          `INSERT INTO org_minute_recipients (minute_id, entity_id, user_id, kind, created_by)
           VALUES ($1,$2,$3,'CC',$4) ON CONFLICT DO NOTHING`,
          [id, report.entity_id, userId, actor.ref],
        );
      }
      await tx.audit({
        action: 'create',
        subjectType: 'org_minute',
        subjectId: id,
        subjectLabel: input.subject.trim(),
        subjectReferenceNumber: reference,
        entityId: report.entity_id,
        newValue: { sourceReport: report.reference_number },
      });
      return this.getMinuteInTx(tx, actor, id);
    });
  }

  async issueMinute(actor: ActorContext, id: string, rowVersion: number): Promise<OrgMinuteView> {
    assertCan(actor, 'org_report.minute.issue');
    return this.unitOfWork.write(actor, async (tx) => {
      const minute = await this.lockMinute(tx, id);
      if (minute.issuer_user_id !== actor.ref) throw new ForbiddenError('Only the issuer can issue this minute.');
      if (minute.status !== 'DRAFT') return this.getMinuteInTx(tx, actor, id);
      if (minute.row_version !== rowVersion) throw new StaleRecordError('This minute has changed.');
      if (!canTransitionOrgMinute('DRAFT', 'ISSUED')) throw new ValidationFailedError('This minute cannot be issued.');
      assertCan(actor, 'org_report.minute.issue', minute.entity_id);
      if (!minute.to_user_id) throw new ValidationFailedError('A named officer is required in the To field.');
      await tx.client.query(
        `UPDATE org_minutes SET status = 'ISSUED', issued_at = now(), updated_by = $1 WHERE id = $2`,
        [actor.ref, id],
      );
      const recipients = await tx.client.query<{ user_id: string; kind: OrgMinuteRecipientKind }>(
        `SELECT user_id, kind FROM org_minute_recipients WHERE minute_id = $1`,
        [id],
      );
      for (const recipient of recipients.rows) {
        await this.grantAccess(
          tx,
          minute.source_report_id,
          minute.entity_id,
          recipient.user_id,
          recipient.kind === 'TO' ? 'MINUTE_TO' : 'MINUTE_CC',
          actor.ref,
        );
        await this.notify(
          tx,
          'org_report.minute.issued',
          recipient.user_id,
          minute.entity_id,
          minute.reference_number,
          minute.subject,
          `/org-reports/minutes/${id}`,
        );
      }
      await tx.audit({
        action: 'edit',
        subjectType: 'org_minute',
        subjectId: id,
        subjectLabel: minute.subject,
        subjectReferenceNumber: minute.reference_number,
        entityId: minute.entity_id,
        newValue: { status: 'ISSUED' },
      });
      await tx.appendTimeline({
        subjectType: 'ORG_REPORT',
        subjectId: minute.source_report_id,
        text: `Official minute ${minute.reference_number} issued.`,
        href: `/org-reports/minutes/${id}`,
        entityId: minute.entity_id,
      });
      return this.getMinuteInTx(tx, actor, id);
    });
  }

  async getMinute(actor: ActorContext, id: string): Promise<OrgMinuteView> {
    return this.unitOfWork.read(actor, async (tx) => this.getMinuteInTx(tx, actor, id));
  }

  async listMinutes(
    actor: ActorContext,
    box: 'assigned' | 'issued' | 'my-responses',
  ): Promise<OrgMinuteListItemView[]> {
    if (!can(actor, 'org_report.view') && !can(actor, 'org_report.minute.respond') && !can(actor, 'org_report.minute.issue')) {
      throw new ForbiddenError('You cannot view official minutes.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const clause =
        box === 'assigned'
          ? `m.to_user_id = $1 AND m.status <> 'DRAFT'`
          : box === 'my-responses'
            ? `m.to_user_id = $1 AND EXISTS (SELECT 1 FROM org_minute_responses s WHERE s.minute_id = m.id AND s.created_by = $1)`
            : 'm.issuer_user_id = $1';
      const result = await tx.client.query(this.minuteListSql(`WHERE ${clause}`), [actor.ref]);
      return result.rows.map((row) => this.toMinuteListItem(row));
    });
  }

  async acknowledgeMinute(actor: ActorContext, id: string, rowVersion: number): Promise<OrgMinuteView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const minute = await this.lockMinute(tx, id);
      if (minute.to_user_id !== actor.ref) throw new ForbiddenError('Only the assigned officer can acknowledge this minute.');
      if (minute.row_version !== rowVersion) throw new StaleRecordError('This minute has changed.');
      if (minute.status !== 'ISSUED') throw new ValidationFailedError('Acknowledgement is only recorded against an issued minute.');
      if (!minute.acknowledgement_required) {
        throw new ValidationFailedError('Acknowledgement is not required for this minute.');
      }
      await tx.client.query(`UPDATE org_minutes SET status = 'ACKNOWLEDGED', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        id,
      ]);
      await tx.appendTimeline({
        subjectType: 'ORG_MINUTE',
        subjectId: id,
        text: `Receipt of ${minute.reference_number} acknowledged. This is not completion.`,
        href: `/org-reports/minutes/${id}`,
        entityId: minute.entity_id,
      });
      return this.getMinuteInTx(tx, actor, id);
    });
  }

  async markMinuteInProgress(actor: ActorContext, id: string, rowVersion: number): Promise<OrgMinuteView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const minute = await this.lockMinute(tx, id);
      if (minute.to_user_id !== actor.ref) throw new ForbiddenError('Only the assigned officer can update this minute.');
      if (minute.row_version !== rowVersion) throw new StaleRecordError('This minute has changed.');
      if (!canTransitionOrgMinute(minute.status, 'IN_PROGRESS')) {
        throw new ValidationFailedError('This minute cannot move to in progress.');
      }
      await tx.client.query(`UPDATE org_minutes SET status = 'IN_PROGRESS', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        id,
      ]);
      return this.getMinuteInTx(tx, actor, id);
    });
  }

  async createResponse(actor: ActorContext, minuteId: string, input: CreateResponseInput): Promise<OrgMinuteView> {
    assertCan(actor, 'org_report.minute.respond');
    return this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{ id: string; minute_id: string }>(
        `SELECT id, minute_id FROM org_minute_responses WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) return this.getMinuteInTx(tx, actor, existing.rows[0].minute_id);
      const minute = await this.lockMinute(tx, minuteId);
      if (minute.to_user_id !== actor.ref) throw new ForbiddenError('Only the assigned officer can respond.');
      if (minute.status === 'DRAFT' || minute.status === 'COMPLETED') {
        throw new ValidationFailedError('A response cannot be submitted against this minute.');
      }
      assertCan(actor, 'org_report.minute.respond', minute.entity_id);
      const allocated = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('RSP') AS ref`);
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The response reference was not allocated.');
      await tx.client.query(
        `INSERT INTO org_minute_responses (
           reference_number, minute_id, entity_id, subject, body, outcome, status, submitted_at,
           idempotency_key, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,'SUBMITTED', now(), $7, $8, $8)`,
        [
          reference,
          minuteId,
          minute.entity_id,
          input.subject.trim(),
          input.body.trim(),
          input.outcome?.trim() || null,
          input.idempotencyKey,
          actor.ref,
        ],
      );
      await tx.client.query(
        `UPDATE org_minutes SET status = 'RESPONSE_SUBMITTED', updated_by = $1 WHERE id = $2`,
        [actor.ref, minuteId],
      );
      await tx.audit({
        action: 'create',
        subjectType: 'org_minute_response',
        subjectId: minuteId,
        subjectLabel: input.subject.trim(),
        subjectReferenceNumber: reference,
        entityId: minute.entity_id,
      });
      await tx.appendTimeline({
        subjectType: 'ORG_REPORT',
        subjectId: minute.source_report_id,
        text: `Response ${reference} submitted on ${minute.reference_number}.`,
        href: `/org-reports/minutes/${minuteId}`,
        entityId: minute.entity_id,
      });
      await this.notify(
        tx,
        'org_report.response.submitted',
        minute.issuer_user_id,
        minute.entity_id,
        minute.reference_number,
        minute.subject,
        `/org-reports/minutes/${minuteId}`,
      );
      return this.getMinuteInTx(tx, actor, minuteId);
    });
  }

  async reviewResponse(actor: ActorContext, minuteId: string, input: ReviewResponseInput): Promise<OrgMinuteView> {
    assertCan(actor, 'org_report.minute.review');
    return this.unitOfWork.write(actor, async (tx) => {
      const minute = await this.lockMinute(tx, minuteId);
      assertCan(actor, 'org_report.minute.review', minute.entity_id);
      if (minute.issuer_user_id !== actor.ref) throw new ForbiddenError('Only the Managing Director can review this response.');
      if (minute.row_version !== input.rowVersion) throw new StaleRecordError('This minute has changed.');
      const latest = await tx.client.query<{ id: string; status: OrgResponseStatus }>(
        `SELECT id, status FROM org_minute_responses WHERE minute_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [minuteId],
      );
      const response = latest.rows[0];
      if (input.action === 'reopen') {
        if (!canTransitionOrgMinute(minute.status, 'REOPENED')) {
          throw new ValidationFailedError('This minute cannot be reopened.');
        }
        await tx.client.query(
          `UPDATE org_minutes SET status = 'REOPENED', completed_at = NULL, updated_by = $1 WHERE id = $2`,
          [actor.ref, minuteId],
        );
      } else {
        if (!response) throw new ValidationFailedError('There is no response to review.');
        if (input.action === 'accept') {
          await tx.client.query(
            `UPDATE org_minute_responses SET status = 'ACCEPTED', reviewed_at = now(), review_note = $1, updated_by = $2 WHERE id = $3`,
            [input.note?.trim() || null, actor.ref, response.id],
          );
          await tx.client.query(
            `UPDATE org_minutes SET status = 'COMPLETED', completed_at = now(), updated_by = $1 WHERE id = $2`,
            [actor.ref, minuteId],
          );
          await this.notify(
            tx,
            'org_report.minute.completed',
            minute.to_user_id ?? actor.ref,
            minute.entity_id,
            minute.reference_number,
            minute.subject,
            `/org-reports/minutes/${minuteId}`,
          );
        } else {
          await tx.client.query(
            `UPDATE org_minute_responses SET status = 'FURTHER_ACTION_REQUIRED', reviewed_at = now(), review_note = $1, updated_by = $2 WHERE id = $3`,
            [input.note?.trim() || null, actor.ref, response.id],
          );
          await tx.client.query(
            `UPDATE org_minutes SET status = 'FURTHER_ACTION_REQUIRED', updated_by = $1 WHERE id = $2`,
            [actor.ref, minuteId],
          );
          if (minute.to_user_id) {
            await this.notify(
              tx,
              'org_report.response.returned',
              minute.to_user_id,
              minute.entity_id,
              minute.reference_number,
              minute.subject,
              `/org-reports/minutes/${minuteId}`,
            );
          }
        }
      }
      await tx.audit({
        action: input.action === 'further' ? 'return' : 'approve',
        subjectType: 'org_minute',
        subjectId: minuteId,
        subjectLabel: minute.subject,
        subjectReferenceNumber: minute.reference_number,
        entityId: minute.entity_id,
        reason: input.note?.trim() || undefined,
        newValue: { action: input.action },
      });
      await tx.appendTimeline({
        subjectType: 'ORG_REPORT',
        subjectId: minute.source_report_id,
        text:
          input.action === 'accept'
            ? `Response on ${minute.reference_number} accepted. Minute completed.`
            : input.action === 'further'
              ? `Further action requested on ${minute.reference_number}. Prior responses kept.`
              : `Official minute ${minute.reference_number} reopened.`,
        href: `/org-reports/minutes/${minuteId}`,
        entityId: minute.entity_id,
      });
      return this.getMinuteInTx(tx, actor, minuteId);
    });
  }

  async listResponsesAwaiting(actor: ActorContext): Promise<OrgMinuteListItemView[]> {
    assertCan(actor, 'org_report.minute.review');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query(this.minuteListSql(`WHERE m.issuer_user_id = $1 AND m.status = 'RESPONSE_SUBMITTED'`), [
        actor.ref,
      ]);
      return result.rows.map((row) => this.toMinuteListItem(row));
    });
  }

  async createDecision(actor: ActorContext, reportId: string, input: CreateDecisionInput): Promise<OrgDecisionView> {
    assertCan(actor, 'org_report.decide');
    return this.unitOfWork.write(actor, async (tx) => {
      const report = await this.lockReport(tx, reportId);
      assertCan(actor, 'org_report.decide', report.entity_id);
      if (report.to_user_id !== actor.ref) throw new ForbiddenError('Only the Managing Director can record this decision.');
      const allocated = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('DEC') AS ref`);
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The decision reference was not allocated.');
      const inserted = await tx.client.query<{ id: string; decided_at: Date }>(
        `INSERT INTO org_decisions (reference_number, report_id, minute_id, entity_id, subject, body, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, decided_at`,
        [
          reference,
          reportId,
          input.minuteId ?? null,
          report.entity_id,
          input.subject.trim(),
          input.body.trim(),
          actor.ref,
        ],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error('The decision was not recorded.');
      await tx.audit({
        action: 'create',
        subjectType: 'org_decision',
        subjectId: row.id,
        subjectLabel: input.subject.trim(),
        subjectReferenceNumber: reference,
        entityId: report.entity_id,
      });
      await tx.appendTimeline({
        subjectType: 'ORG_REPORT',
        subjectId: reportId,
        text: `Management decision ${reference} recorded.`,
        href: `/org-reports/${reportId}`,
        entityId: report.entity_id,
      });
      const recipients = await tx.client.query<{ user_id: string }>(
        `SELECT user_id FROM org_report_access WHERE report_id = $1 AND revoked_at IS NULL AND kind IN ('OWNER','TO','MINUTE_TO')`,
        [reportId],
      );
      for (const recipient of recipients.rows) {
        await this.notify(tx, 'org_report.decision.recorded', recipient.user_id, report.entity_id, reference, input.subject.trim(), `/org-reports/${reportId}`);
      }
      return {
        id: row.id,
        referenceNumber: reference,
        reportId,
        minuteId: input.minuteId ?? null,
        subject: input.subject.trim(),
        body: input.body.trim(),
        decidedAt: row.decided_at.toISOString(),
        authorityName: actor.name,
        createdBy: actor.ref,
      };
    });
  }

  async listDecisions(actor: ActorContext): Promise<OrgDecisionView[]> {
    assertCan(actor, 'org_report.decide');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        reference_number: string;
        report_id: string;
        minute_id: string | null;
        subject: string;
        body: string;
        decided_at: Date;
        created_by: string;
        authority_name: string | null;
      }>(
        `SELECT d.id, d.reference_number, d.report_id, d.minute_id, d.subject, d.body, d.decided_at, d.created_by,
                app.user_public_name(r.to_user_id) AS authority_name
           FROM org_decisions d
           JOIN org_reports r ON r.id = d.report_id
          WHERE d.created_by = $1
          ORDER BY d.decided_at DESC`,
        [actor.ref],
      );
      return result.rows.map((row) => ({
        id: row.id,
        referenceNumber: row.reference_number,
        reportId: row.report_id,
        minuteId: row.minute_id,
        subject: row.subject,
        body: row.body,
        decidedAt: row.decided_at.toISOString(),
        authorityName: row.authority_name,
        createdBy: row.created_by,
      }));
    });
  }

  async sendExternal(actor: ActorContext, reportId: string, input: SendExternalInput): Promise<OrgExternalView> {
    assertCan(actor, 'org_report.email');
    const prepared = await this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<OrgExternalRow>(
        `SELECT * FROM org_external_correspondence WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) {
        return { already: this.toExternal(existing.rows[0]) as OrgExternalView, outbound: null as null };
      }
      const report = await this.lockReport(tx, reportId);
      assertCan(actor, 'org_report.email', report.entity_id);
      if (report.to_user_id !== actor.ref) {
        throw new ForbiddenError('External correspondence requires explicit sending authority.');
      }
      const env = loadApiEnv();
      const fromAddress = env.SMTP_FROM?.trim();
      if (!fromAddress) {
        throw new ValidationFailedError('The official sender identity has not been configured.');
      }
      const pdf = await this.buildReportPdf(tx, actor, report);
      const recipient = input.recipientEmail.trim().toLowerCase();
      const subject = input.subject.trim();
      const message = input.message.trim();
      const inserted = await tx.client.query<OrgExternalRow>(
        `INSERT INTO org_external_correspondence (
           report_id, entity_id, recipient_email, subject, body, sender_identity, document_revision_id,
           provider_status, idempotency_key, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9,$9)
         RETURNING *`,
        [
          reportId,
          report.entity_id,
          recipient,
          subject,
          message,
          fromAddress,
          report.current_revision_id,
          input.idempotencyKey,
          actor.ref,
        ],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error('The correspondence record was not created.');
      const outbox = await tx.client.query<{ id: string }>(
        `INSERT INTO mail_outbox (kind, recipient, subject, body, payload, created_by)
         VALUES ('org_report.share', $1, $2, $3, $4::jsonb, $5)
         RETURNING id`,
        [
          recipient,
          subject,
          message,
          JSON.stringify({
            correspondenceId: row.id,
            reference: report.reference_number,
            html: `<p>${escapeHtml(message).replaceAll('\n', '<br/>')}</p>`,
            fromName: actor.name,
            fromAddress,
            filename: `${report.reference_number}.pdf`,
            pdfBase64: pdf.toString('base64'),
          }),
          actor.ref,
        ],
      );
      await tx.client.query(`UPDATE org_external_correspondence SET mail_outbox_id = $1, updated_by = $2 WHERE id = $3`, [
        outbox.rows[0]?.id ?? null,
        actor.ref,
        row.id,
      ]);
      await tx.audit({
        action: 'document_share',
        subjectType: 'org_external',
        subjectId: row.id,
        subjectLabel: subject,
        subjectReferenceNumber: report.reference_number,
        entityId: report.entity_id,
        newValue: { recipient, status: 'queued' },
      });
      await tx.appendTimeline({
        subjectType: 'ORG_REPORT',
        subjectId: reportId,
        text: `External correspondence queued for ${report.reference_number}.`,
        href: `/org-reports/${reportId}`,
        entityId: report.entity_id,
      });
      return {
        already: null as OrgExternalView | null,
        outbound: {
          row,
          reportId,
          reportRef: report.reference_number,
          reportTitle: report.title,
          entityId: report.entity_id,
          fromAddress,
          recipient,
          subject,
          message,
          pdf,
          outboxId: outbox.rows[0]?.id ?? null,
        },
      };
    });

    if (prepared.already) return prepared.already;
    const job = prepared.outbound;
    if (!job) throw new Error('The correspondence record was not created.');

    let status: OrgExternalView['providerStatus'] = 'queued';
    let lastError: string | null = null;
    if (smtpConfigured()) {
      try {
        await sendSmtp({
          fromName: actor.name,
          fromAddress: job.fromAddress,
          to: job.recipient,
          subject: job.subject,
          text: job.message,
          html: `<p>${escapeHtml(job.message).replaceAll('\n', '<br/>')}</p>`,
          attachments: [
            { filename: `${job.reportRef}.pdf`, contentType: 'application/pdf', content: job.pdf },
          ],
        });
        status = 'submitted';
      } catch (error) {
        status = 'failed';
        lastError = error instanceof Error ? error.message : 'The mail provider rejected the message.';
      }
    }

    return this.unitOfWork.write(actor, async (tx) => {
      await tx.client.query(
        `UPDATE org_external_correspondence SET provider_status = $1, last_error = $2, updated_by = $3 WHERE id = $4`,
        [status, lastError, actor.ref, job.row.id],
      );
      if (job.outboxId) {
        await tx.client.query(
          `UPDATE mail_outbox
              SET status = $1, sent_at = CASE WHEN $1 = 'sent' THEN now() ELSE sent_at END,
                  attempt_count = attempt_count + 1, last_error = $2
            WHERE id = $3`,
          [status === 'submitted' ? 'sent' : status === 'failed' ? 'failed' : 'queued', lastError, job.outboxId],
        );
      }
      await this.notify(
        tx,
        status === 'failed' ? 'org_report.email.failed' : 'org_report.email.completed',
        actor.ref,
        job.entityId,
        job.reportRef,
        job.reportTitle,
        `/org-reports/${job.reportId}`,
      );
      return this.toExternal({ ...job.row, provider_status: status, last_error: lastError });
    });
  }

  async listExternal(actor: ActorContext): Promise<OrgExternalView[]> {
    assertCan(actor, 'org_report.email');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<OrgExternalRow>(
        `SELECT * FROM org_external_correspondence WHERE created_by = $1 ORDER BY created_at DESC`,
        [actor.ref],
      );
      return result.rows.map((row) => this.toExternal(row));
    });
  }

  async search(actor: ActorContext, query: string): Promise<OrgReportSearchHitView[]> {
    if (!can(actor, 'org_report.view') && !can(actor, 'org_report.create')) {
      throw new ForbiddenError('You cannot search official reports.');
    }
    const q = `%${query.trim()}%`;
    return this.unitOfWork.read(actor, async (tx) => {
      const reports = await tx.client.query<{
        id: string;
        reference_number: string;
        title: string;
        status: string;
        entity_code: string | null;
      }>(
        `SELECT r.id, r.reference_number, r.title, r.status, e.code AS entity_code
           FROM org_reports r
           JOIN entities e ON e.id = r.entity_id
          WHERE r.reference_number ILIKE $1 OR r.title ILIKE $1
          ORDER BY r.updated_at DESC LIMIT 40`,
        [q],
      );
      const minutes = await tx.client.query<{
        id: string;
        reference_number: string;
        subject: string;
        status: string;
        entity_code: string | null;
      }>(
        `SELECT m.id, m.reference_number, m.subject, m.status, e.code AS entity_code
           FROM org_minutes m
           JOIN entities e ON e.id = m.entity_id
          WHERE m.reference_number ILIKE $1 OR m.subject ILIKE $1
          ORDER BY m.updated_at DESC LIMIT 20`,
        [q],
      );
      const responses = await tx.client.query<{
        id: string;
        reference_number: string;
        subject: string;
        status: string;
        entity_code: string | null;
        minute_id: string;
      }>(
        `SELECT s.id, s.reference_number, s.subject, s.status, e.code AS entity_code, s.minute_id
           FROM org_minute_responses s
           JOIN org_minutes m ON m.id = s.minute_id
           JOIN entities e ON e.id = s.entity_id
          WHERE s.reference_number ILIKE $1 OR s.subject ILIKE $1
          ORDER BY s.created_at DESC LIMIT 20`,
        [q],
      );
      const decisions = await tx.client.query<{
        id: string;
        reference_number: string;
        subject: string;
        report_id: string;
        entity_code: string | null;
      }>(
        `SELECT d.id, d.reference_number, d.subject, d.report_id, e.code AS entity_code
           FROM org_decisions d
           JOIN entities e ON e.id = d.entity_id
          WHERE d.reference_number ILIKE $1 OR d.subject ILIKE $1
          ORDER BY d.decided_at DESC LIMIT 20`,
        [q],
      );
      return [
        ...reports.rows.map((row) => ({
          id: row.id,
          recordType: 'ORG_REPORT' as const,
          referenceNumber: row.reference_number,
          title: row.title,
          status: row.status,
          entityCode: row.entity_code,
          href: `/org-reports/${row.id}`,
        })),
        ...minutes.rows.map((row) => ({
          id: row.id,
          recordType: 'ORG_MINUTE' as const,
          referenceNumber: row.reference_number,
          title: row.subject,
          status: row.status,
          entityCode: row.entity_code,
          href: `/org-reports/minutes/${row.id}`,
        })),
        ...responses.rows.map((row) => ({
          id: row.id,
          recordType: 'ORG_RESPONSE' as const,
          referenceNumber: row.reference_number,
          title: row.subject,
          status: row.status,
          entityCode: row.entity_code,
          href: `/org-reports/minutes/${row.minute_id}`,
        })),
        ...decisions.rows.map((row) => ({
          id: row.id,
          recordType: 'ORG_DECISION' as const,
          referenceNumber: row.reference_number,
          title: row.subject,
          status: 'RECORDED',
          entityCode: row.entity_code,
          href: `/org-reports/${row.report_id}`,
        })),
      ];
    });
  }

  async pdf(actor: ActorContext, id: string): Promise<{ buffer: Buffer; filename: string }> {
    return this.unitOfWork.read(actor, async (tx) => {
      const row = await this.loadReport(tx, id);
      const buffer = await this.buildReportPdf(tx, actor, row);
      return { buffer, filename: `${row.reference_number}.pdf` };
    });
  }

  async minutePdf(actor: ActorContext, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const minute = await this.getMinute(actor, id);
    const buffer = await renderOrgMinutePdf({
      referenceNumber: minute.referenceNumber,
      subject: minute.subject,
      issuedAt: minute.issuedAt ?? minute.issuedAt ?? new Date().toISOString(),
      issuerName: minute.issuerName ?? 'Managing Director',
      toName: minute.toName ?? '',
      ccNames: minute.recipients.filter((item) => item.kind === 'CC').map((item) => item.userName ?? item.userId),
      relatedReport: minute.sourceReportReference,
      instruction: minute.instruction,
      expectedOutcome: minute.expectedOutcome,
      dueAt: minute.dueAt,
      responseRequired: minute.responseRequired,
    });
    return { buffer, filename: `${minute.referenceNumber}.pdf` };
  }

  async responsePdf(actor: ActorContext, responseId: string): Promise<{ buffer: Buffer; filename: string }> {
    return this.unitOfWork.read(actor, async (tx) => {
      const row = await tx.client.query<{
        id: string;
        reference_number: string;
        minute_id: string;
        subject: string;
        body: string;
        outcome: string | null;
        status: string;
        submitted_at: Date | null;
        created_by_name: string | null;
        minute_ref: string;
      }>(
        `SELECT s.id, s.reference_number, s.minute_id, s.subject, s.body, s.outcome, s.status, s.submitted_at,
                app.user_public_name(s.created_by::uuid) AS created_by_name, m.reference_number AS minute_ref
           FROM org_minute_responses s
           JOIN org_minutes m ON m.id = s.minute_id
          WHERE s.id = $1`,
        [responseId],
      );
      const item = row.rows[0];
      if (!item) throw new NotFoundError('That response does not exist.');
      await this.getMinuteInTx(tx, actor, item.minute_id);
      const buffer = await renderOrgResponsePdf({
        referenceNumber: item.reference_number,
        minuteReference: item.minute_ref,
        subject: item.subject,
        officerName: item.created_by_name ?? 'Officer',
        submittedAt: (item.submitted_at ?? new Date()).toISOString(),
        body: item.body,
        outcome: item.outcome,
        status: item.status,
      });
      return { buffer, filename: `${item.reference_number}.pdf` };
    });
  }

  async remindDueMinutes(tx: TxScope, now: Date): Promise<number> {
    const due = await tx.client.query<{
      id: string;
      reference_number: string;
      subject: string;
      entity_id: string;
      to_user_id: string;
    }>(
      `SELECT id, reference_number, subject, entity_id, to_user_id
         FROM org_minutes
        WHERE due_at IS NOT NULL
          AND to_user_id IS NOT NULL
          AND status IN ('ISSUED','ACKNOWLEDGED','IN_PROGRESS','FURTHER_ACTION_REQUIRED','RESPONSE_SUBMITTED')
          AND due_at <= $1::timestamptz + interval '1 day'
          AND (last_reminded_at IS NULL OR last_reminded_at <= $1::timestamptz - interval '1 day')`,
      [now],
    );
    let sent = 0;
    for (const row of due.rows) {
      await this.notify(tx, 'org_report.minute.due', row.to_user_id, row.entity_id, row.reference_number, row.subject, `/org-reports/minutes/${row.id}`);
      await tx.client.query(`UPDATE org_minutes SET last_reminded_at = $1, updated_by = $2 WHERE id = $3`, [
        now,
        tx.actor.ref,
        row.id,
      ]);
      sent += 1;
    }
    return sent;
  }

  private reportSelectSql(): string {
    return `SELECT r.id, r.reference_number, r.template_id, t.key AS template_key, t.title AS template_title,
                   r.entity_id, e.code AS entity_code, e.name AS entity_name, r.title, r.body, r.observations,
                   r.reporting_period, r.report_date::text, r.status, r.sender_user_id,
                   app.user_public_name(r.sender_user_id) AS sender_name, r.to_user_id,
                   app.user_public_name(r.to_user_id) AS to_name, r.current_revision_id, r.submitted_at,
                   r.intended_cc_user_ids, r.idempotency_key, r.created_by, r.updated_at, r.row_version, r.snapshot
              FROM org_reports r
              JOIN org_report_templates t ON t.id = r.template_id
              JOIN entities e ON e.id = r.entity_id`;
  }

  private async loadReport(tx: TxScope, id: string): Promise<ReportRow> {
    const result = await tx.client.query<ReportRow>(`${this.reportSelectSql()} WHERE r.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That official report does not exist.');
    return row;
  }

  private async lockReport(tx: TxScope, id: string): Promise<ReportRow> {
    await tx.client.query(`SELECT id FROM org_reports WHERE id = $1 FOR UPDATE`, [id]);
    return this.loadReport(tx, id);
  }

  private async getInTx(tx: TxScope, actor: ActorContext, id: string): Promise<OrgReportView> {
    const row = await this.loadReport(tx, id);
    const myKind = await this.myReportKind(tx.client, id, actor.ref);
    if (!myKind) throw new NotFoundError('That official report does not exist.');
    const recipients = await tx.client.query<{
      user_id: string;
      user_name: string | null;
      kind: 'TO' | 'CC' | 'FORWARD';
      source_event_id: string | null;
    }>(
      `SELECT rec.user_id, app.user_public_name(rec.user_id) AS user_name, rec.kind, rec.source_event_id
         FROM org_report_recipients rec WHERE rec.report_id = $1 ORDER BY rec.created_at`,
      [id],
    );
    const originalTo = recipients.rows.find((item) => item.kind === 'TO' && !item.source_event_id);
    const originalCc = recipients.rows.filter((item) => item.kind === 'CC' && !item.source_event_id);
    const forwards = await tx.client.query<{
      id: string;
      created_by: string;
      created_by_name: string | null;
      note: string | null;
      document_revision_id: string | null;
      created_at: Date;
    }>(
      `SELECT f.id, f.created_by, app.user_public_name(f.created_by::uuid) AS created_by_name, f.note,
              f.document_revision_id, f.created_at
         FROM org_report_forwards f WHERE f.report_id = $1 ORDER BY f.created_at`,
      [id],
    );
    const forwardViews = [];
    for (const forward of forwards.rows) {
      const people = recipients.rows.filter((item) => item.source_event_id === forward.id);
      forwardViews.push({
        id: forward.id,
        forwardedBy: forward.created_by,
        forwardedByName: forward.created_by_name,
        note: forward.note,
        revisionId: forward.document_revision_id,
        recipients: people.map((item) => ({ id: item.user_id, name: item.user_name ?? item.user_id })),
        createdAt: forward.created_at.toISOString(),
      });
    }
    const minutes = await tx.client.query(this.minuteListSql('WHERE m.source_report_id = $1'), [id]);
    const decisions = await tx.client.query<{
      id: string;
      reference_number: string;
      report_id: string;
      minute_id: string | null;
      subject: string;
      body: string;
      decided_at: Date;
      created_by: string;
      authority_name: string | null;
    }>(
      `SELECT d.id, d.reference_number, d.report_id, d.minute_id, d.subject, d.body, d.decided_at, d.created_by,
              app.user_public_name(d.created_by::uuid) AS authority_name
         FROM org_decisions d WHERE d.report_id = $1 ORDER BY d.decided_at`,
      [id],
    );
    const history = await tx.client.query<{
      occurred_at: Date;
      actor_ref: string | null;
      actor_name: string | null;
      event_text: string;
      href: string | null;
    }>(
      `SELECT occurred_at, actor_ref, actor_name, event_text, href
         FROM timeline_events
        WHERE (subject_type = 'ORG_REPORT' AND subject_id = $1)
           OR (subject_type = 'ORG_MINUTE' AND subject_id IN (SELECT id FROM org_minutes WHERE source_report_id = $1))
        ORDER BY occurred_at`,
      [id],
    );
    const outstanding = minutes.rows.some((item: { status: string }) =>
      ['ISSUED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'FURTHER_ACTION_REQUIRED', 'RESPONSE_SUBMITTED'].includes(item.status),
    );
    return {
      ...(await this.toListItem(tx.client, actor, row, myKind, outstanding)),
      body: row.body,
      observations: row.observations,
      reportingPeriod: row.reporting_period,
      reportDate: row.report_date,
      currentRevisionId: row.current_revision_id,
      rowVersion: row.row_version,
      originalTo: originalTo
        ? { id: originalTo.user_id, name: originalTo.user_name ?? originalTo.user_id }
        : row.to_user_id
          ? { id: row.to_user_id, name: row.to_name ?? row.to_user_id }
          : null,
      originalCc: originalCc.map((item) => ({ id: item.user_id, name: item.user_name ?? item.user_id })),
      recipients: recipients.rows.map((item) => ({
        userId: item.user_id,
        userName: item.user_name,
        kind: item.kind,
        sourceEventId: item.source_event_id,
      })),
      forwards: forwardViews,
      minutes: minutes.rows.map((item: Record<string, unknown>) => this.toMinuteListItem(item)),
      decisions: decisions.rows.map((item) => ({
        id: item.id,
        referenceNumber: item.reference_number,
        reportId: item.report_id,
        minuteId: item.minute_id,
        subject: item.subject,
        body: item.body,
        decidedAt: item.decided_at.toISOString(),
        authorityName: item.authority_name,
        createdBy: item.created_by,
      })),
      attachments: await this.attachments(tx.client, 'org_report', id),
      snapshot: row.snapshot,
      history: history.rows.map((item) => ({
        at: item.occurred_at.toISOString(),
        actor: item.actor_ref,
        actorName: item.actor_name,
        action: item.event_text,
        detail: item.event_text,
        href: item.href,
      })),
    };
  }

  private async toListItem(
    client: PoolClient,
    actor: ActorContext,
    row: ReportRow,
    myKind?: OrgReportAccessKind | null,
    outstanding?: boolean,
  ): Promise<OrgReportListItemView> {
    const kind = myKind ?? (await this.myReportKind(client, row.id, actor.ref));
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      title: row.title,
      templateKey: row.template_key,
      templateTitle: row.template_title,
      status: row.status,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      senderUserId: row.sender_user_id,
      senderName: row.sender_name,
      toUserId: row.to_user_id,
      toName: row.to_name,
      submittedAt: row.submitted_at?.toISOString() ?? null,
      updatedAt: row.updated_at.toISOString(),
      actionOutstanding: outstanding ?? false,
      myKind: kind,
    };
  }

  private minuteListSql(where: string): string {
    return `SELECT m.id, m.reference_number, m.subject, m.status, m.source_report_id, r.reference_number AS source_report_reference,
                   app.user_public_name(m.issuer_user_id) AS issuer_name, m.to_user_id,
                   app.user_public_name(m.to_user_id) AS to_name, m.issued_at, m.due_at, m.response_required, m.entity_id,
                   m.instruction, m.expected_outcome, m.acknowledgement_required, m.priority, m.row_version, m.issuer_user_id, m.created_by
              FROM org_minutes m
              JOIN org_reports r ON r.id = m.source_report_id
              ${where}
              ORDER BY coalesce(m.issued_at, m.created_at) DESC`;
  }

  private toMinuteListItem(row: Record<string, unknown>): OrgMinuteListItemView {
    return {
      id: String(row.id),
      referenceNumber: String(row.reference_number),
      subject: String(row.subject),
      status: row.status as OrgMinuteStatus,
      sourceReportId: String(row.source_report_id),
      sourceReportReference: String(row.source_report_reference),
      issuerName: (row.issuer_name as string | null) ?? null,
      toUserId: (row.to_user_id as string | null) ?? null,
      toName: (row.to_name as string | null) ?? null,
      issuedAt: row.issued_at ? new Date(String(row.issued_at)).toISOString() : null,
      dueAt: row.due_at ? new Date(String(row.due_at)).toISOString() : null,
      responseRequired: Boolean(row.response_required),
      entityId: String(row.entity_id),
    };
  }

  private async lockMinute(tx: TxScope, id: string): Promise<{
    id: string;
    reference_number: string;
    source_report_id: string;
    entity_id: string;
    subject: string;
    status: OrgMinuteStatus;
    issuer_user_id: string;
    to_user_id: string | null;
    acknowledgement_required: boolean;
    row_version: number;
  }> {
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      source_report_id: string;
      entity_id: string;
      subject: string;
      status: OrgMinuteStatus;
      issuer_user_id: string;
      to_user_id: string | null;
      acknowledgement_required: boolean;
      row_version: number;
    }>(
      `SELECT id, reference_number, source_report_id, entity_id, subject, status, issuer_user_id, to_user_id,
              acknowledgement_required, row_version
         FROM org_minutes WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That official minute does not exist.');
    return row;
  }

  private async getMinuteInTx(tx: TxScope, actor: ActorContext, id: string): Promise<OrgMinuteView> {
    const result = await tx.client.query(this.minuteListSql('WHERE m.id = $1'), [id]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new NotFoundError('That official minute does not exist.');
    const recipients = await tx.client.query<{ user_id: string; user_name: string | null; kind: OrgMinuteRecipientKind }>(
      `SELECT user_id, app.user_public_name(user_id) AS user_name, kind FROM org_minute_recipients WHERE minute_id = $1`,
      [id],
    );
    const responses = await tx.client.query<{
      id: string;
      reference_number: string;
      minute_id: string;
      subject: string;
      body: string;
      outcome: string | null;
      status: OrgResponseStatus;
      submitted_at: Date | null;
      reviewed_at: Date | null;
      review_note: string | null;
      created_by: string;
      created_by_name: string | null;
      created_at: Date;
    }>(
      `SELECT s.id, s.reference_number, s.minute_id, s.subject, s.body, s.outcome, s.status, s.submitted_at,
              s.reviewed_at, s.review_note, s.created_by, app.user_public_name(s.created_by::uuid) AS created_by_name,
              s.created_at
         FROM org_minute_responses s WHERE s.minute_id = $1 ORDER BY s.created_at`,
      [id],
    );
    const myKind: OrgMinuteView['myKind'] =
      String(row.issuer_user_id) === actor.ref
        ? 'ISSUER'
        : (recipients.rows.find((item) => item.user_id === actor.ref)?.kind ?? null);
    const responseViews: OrgResponseView[] = [];
    for (const item of responses.rows) {
      responseViews.push({
        id: item.id,
        referenceNumber: item.reference_number,
        minuteId: item.minute_id,
        subject: item.subject,
        body: item.body,
        outcome: item.outcome,
        status: item.status,
        submittedAt: item.submitted_at?.toISOString() ?? null,
        reviewedAt: item.reviewed_at?.toISOString() ?? null,
        reviewNote: item.review_note,
        createdBy: item.created_by,
        createdByName: item.created_by_name,
        createdAt: item.created_at.toISOString(),
        attachments: await this.attachments(tx.client, 'org_response', item.id),
      });
    }
    return {
      ...this.toMinuteListItem(row),
      instruction: String(row.instruction),
      expectedOutcome: (row.expected_outcome as string | null) ?? null,
      acknowledgementRequired: Boolean(row.acknowledgement_required),
      priority: (row.priority as OrgMinutePriority) ?? 'NORMAL',
      rowVersion: Number(row.row_version),
      recipients: recipients.rows.map((item) => ({
        userId: item.user_id,
        userName: item.user_name,
        kind: item.kind,
      })),
      responses: responseViews,
      attachments: await this.attachments(tx.client, 'org_minute', id),
      myKind,
    };
  }

  private async attachments(client: PoolClient, ownerType: string, ownerId: string): Promise<OrgReportAttachmentView[]> {
    const result = await client.query<{
      id: string;
      title: string;
      reference_number: string;
      original_filename: string | null;
      version_number: number | null;
    }>(
      `SELECT d.id, d.title, d.reference_number, v.original_filename, v.version_number
         FROM documents d
         LEFT JOIN document_versions v ON v.id = d.current_version_id
        WHERE d.owner_type = $1 AND d.owner_id = $2
        ORDER BY d.created_at`,
      [ownerType, ownerId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      referenceNumber: row.reference_number,
      originalFilename: row.original_filename,
      versionNumber: row.version_number,
    }));
  }

  private async myReportKind(client: PoolClient, reportId: string, userId: string): Promise<OrgReportAccessKind | null> {
    const result = await client.query<{ kind: OrgReportAccessKind }>(
      `SELECT kind FROM org_report_access
        WHERE report_id = $1 AND user_id = $2 AND revoked_at IS NULL
        ORDER BY CASE kind WHEN 'OWNER' THEN 0 WHEN 'TO' THEN 1 WHEN 'MINUTE_TO' THEN 2 ELSE 3 END
        LIMIT 1`,
      [reportId, userId],
    );
    return result.rows[0]?.kind ?? null;
  }

  private async loadTemplate(tx: TxScope, key: string): Promise<{
    id: string;
    key: string;
    required_permission: PermissionKey;
    available: boolean;
  }> {
    const result = await tx.client.query<{
      id: string;
      key: string;
      required_permission: PermissionKey;
      available: boolean;
    }>(`SELECT id, key, required_permission, available FROM org_report_templates WHERE key = $1`, [key]);
    const row = result.rows[0];
    if (!row) throw new ValidationFailedError('That report type does not exist.');
    return row;
  }

  private async managingDirector(tx: TxScope): Promise<{ id: string; name: string }> {
    const result = await tx.client.query<{ id: string; name: string }>(`SELECT id, name FROM app.org_report_managing_director()`);
    const row = result.rows[0];
    if (!row) throw new ValidationFailedError('The Managing Director recipient is not configured.');
    return row;
  }

  private async assertSelectable(tx: TxScope, actor: ActorContext, userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return;
    const directory = await tx.client.query<{ id: string }>(`SELECT id FROM app.org_report_directory()`);
    const allowed = new Set(directory.rows.map((row) => row.id));
    for (const userId of unique) {
      if (userId === actor.ref) continue;
      if (!allowed.has(userId)) throw new ValidationFailedError(INVALID_RECIPIENT);
    }
  }

  private async grantAccess(
    tx: TxScope,
    reportId: string,
    entityId: string,
    userId: string,
    kind: OrgReportAccessKind,
    actorRef: string,
  ): Promise<void> {
    await tx.client.query(
      `INSERT INTO org_report_access (report_id, entity_id, user_id, kind, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$5)
       ON CONFLICT (report_id, user_id, kind) DO UPDATE SET revoked_at = NULL, revoked_by = NULL, updated_by = EXCLUDED.updated_by`,
      [reportId, entityId, userId, kind, actorRef],
    );
  }

  private async addRecipient(
    tx: TxScope,
    reportId: string,
    entityId: string,
    userId: string,
    kind: 'TO' | 'CC' | 'FORWARD',
    sourceEventId: string | null,
    actorRef: string,
  ): Promise<void> {
    await tx.client.query(
      `INSERT INTO org_report_recipients (report_id, entity_id, user_id, kind, source_event_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT DO NOTHING`,
      [reportId, entityId, userId, kind, sourceEventId, actorRef],
    );
  }

  private async insertRevision(
    tx: TxScope,
    reportId: string,
    entityId: string,
    title: string,
    body: string,
    observations: string | null,
    reason: string,
    actorRef: string,
  ): Promise<string> {
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO org_report_revisions (report_id, entity_id, title, body, observations, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [reportId, entityId, title, body, observations, reason, actorRef],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('The revision was not stored.');
    return id;
  }

  private async notify(
    tx: TxScope,
    eventType: string,
    recipientUserId: string,
    entityId: string,
    reference: string,
    title: string,
    href: string,
  ): Promise<void> {
    if (!recipientUserId || recipientUserId === tx.actor.ref) return;
    await tx.publish({
      eventType,
      subjectType: 'org_report',
      entityId,
      payload: {
        type: eventType,
        recipientUserId,
        reference,
        title,
        href,
      },
    });
  }

  private async buildReportPdf(tx: TxScope, actor: ActorContext, row: ReportRow): Promise<Buffer> {
    const view = await this.getInTx(tx, actor, row.id);
    return renderOrgReportPdf({
      referenceNumber: view.referenceNumber,
      title: view.title,
      templateTitle: view.templateTitle,
      reportDate: view.reportDate,
      entityName: row.entity_name ?? view.entityCode ?? '',
      entityCode: view.entityCode ?? '',
      senderName: view.senderName ?? '',
      toName: view.originalTo?.name ?? view.toName ?? 'Managing Director',
      ccNames: view.originalCc.map((item) => item.name),
      body: view.body,
      observations: view.observations,
      reportingPeriod: view.reportingPeriod,
      forwards: view.forwards.map((item) => ({
        by: item.forwardedByName ?? item.forwardedBy,
        at: item.createdAt,
        recipients: item.recipients.map((person) => person.name).join(', '),
        note: item.note,
      })),
    });
  }

  private toExternal(row: OrgExternalRow): OrgExternalView {
    return {
      id: row.id,
      reportId: row.report_id,
      recipientEmail: row.recipient_email,
      subject: row.subject,
      senderIdentity: row.sender_identity,
      providerStatus: row.provider_status,
      lastError: row.last_error,
      createdAt: new Date(row.created_at).toISOString(),
      createdBy: row.created_by,
    };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface OrgExternalRow {
  id: string;
  report_id: string;
  recipient_email: string;
  subject: string;
  sender_identity: string;
  provider_status: OrgExternalView['providerStatus'];
  last_error: string | null;
  created_at: Date | string;
  created_by: string;
}

export function isOrgReportOwnerType(ownerType: string): boolean {
  return ORG_OWNERS.has(ownerType);
}
