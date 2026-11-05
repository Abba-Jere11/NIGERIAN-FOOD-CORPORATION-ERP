import { Injectable, Optional } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { isInvoiceNumberUsedElsewhere, snapshotHash } from '@nfc/db';
import {
  MEMO_TEMPLATE_VERSION,
  MIN_VENDOR_QUOTATIONS,
  recommendLowestQuote,
  PROCUREMENT_STATUSES,
  PROCUREMENT_URGENCIES,
  PROCUREMENT_URGENCY_LABELS,
  PAYMENT_TIMING_LABELS,
  amountInWords,
  computeDiff,
  formatKobo,
  formatLagosIsoDate,
  isFundingRoute,
  isPaymentTiming,
  isRoleKey,
  isSealAction,
  memoStamps,
  multiplyKoboByQuantity,
  canTakeProcurementAction,
  procurementNextAction,
  renderProcurementMemoHtml,
  ROLES,
  type BudgetLineView,
  type FinancialReviewView,
  type FundingRoute,
  type FundingSourceView,
  type CloseShortView,
  type DeliveryNoteView,
  type FundingTransferView,
  type GoodsReceiptView,
  type PaymentReversalView,
  type ProcurementDeliveryView,
  type ProcurementDocumentAccessView,
  type ProcurementLineView,
  type ProcurementMemoLine,
  type ProcurementCategoryView,
  type ProcurementCommentView,
  type ProcurementListItemView,
  type ProcurementListView,
  type ProcurementMyActionView,
  type ProcurementMemoComparison,
  type ProcurementMemoSnapshot,
  type ProcurementPaymentView,
  type ProcurementInvoiceStage,
  type ProcurementInvoiceVarianceView,
  type ProcurementQuotationComparisonView,
  type ProcurementQuotationView,
  type PermissionKey,
  type ProcurementRelatedHistoryItem,
  type ProcurementVersionHistoryView,
  type ProcurementView,
  type MemoStamp,
  type PaymentTiming,
  type ProjectView,
  type UnitOfMeasureView,
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
import { InventoryService } from '../inventory/inventory.service';
import { VendorValidationService } from '../vendors/vendor-validation.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { buildProgress, type ProgressAction } from './progress';
import { eligibilityFromParts } from './payment-eligibility';
import { FinancialChecksService } from './financial-checks.service';
import { renderProcurementMemoPdf } from './memo-pdf';
import type {
  AcknowledgePaymentTimingInput,
  ChangePaymentTimingInput,
  CommentInput,
  CreateBudgetLineInput,
  CreateProcurementInput,
  CreateProjectInput,
  DiscardProcurementInput,
  InvoiceMetaInput,
  InvoiceVarianceDecisionInput,
  QuotationMetaInput,
  SelectQuotedVendorInput,
  CloneProcurementInput,
  ListProcurementQuery,
  ProcurementActionInput,
  SubmitProcurementInput,
  UpdateBudgetLineInput,
  UpdateProcurementInput,
} from './procurement.dto';

interface LoadedRow {
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
  vendor_id: string | null;
  vendor_name: string | null;
  vendor_cac: string | null;
  vendor_contacts: unknown;
  current_version: number;
  status: string;
  title: string;
  subject: string | null;
  category_id: string | null;
  category_key: string | null;
  category_name: string | null;
  invoice_required: boolean | null;
  reason: string | null;
  description: string | null;
  quantity: number | null;
  unit_id: string | null;
  unit_code: string | null;
  unit_name: string | null;
  unit_price_kobo: string | null;
  total_amount_kobo: string | null;
  required_date: Date | string | null;
  delivery_location: string | null;
  funding_source_id: string | null;
  funding_source_key: string | null;
  funding_source_label: string | null;
  budget_line_id: string | null;
  budget_line_code: string | null;
  budget_line_name: string | null;
  budget_approved_kobo: string | null;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  urgency: string;
  additional_instructions: string | null;
  version_id: string;
  row_version: number;
  created_at: Date;
  invoice_id: string | null;
  invoice_document_id: string | null;
  invoice_document_ref: string | null;
  invoice_number: string | null;
  invoice_date: Date | string | null;
  invoice_amount_kobo: string | null;
  invoice_sha256: string | null;
  invoice_vendor_id: string | null;
  invoice_vendor_name: string | null;
  memo_hash: string | null;
  pdf_document_id: string | null;
  workflow_instance_id: string | null;
  submit_idempotency_key: string | null;
  cloned_from_request_id: string | null;
  cloned_from_reference: string | null;
  archived_from_status: string | null;
  archived_from_stage_key: string | null;
  funding_route: string | null;
  authorized_amount_kobo: string | null;
  paying_account_id: string | null;
  destination_account_id: string | null;
  proposed_payment_timing: string | null;
  final_payment_timing: string | null;
  final_payment_timing_set_at: Date | string | null;
  final_payment_timing_set_by: string | null;
  timing_change_pending_ack: boolean;
  vendor_status: string | null;
  vendor_bank_name: string | null;
  vendor_account_name: string | null;
  vendor_account_number: string | null;
  stock_item: boolean | null;
  asset: boolean | null;
  accepted_quantity_total: number;
  close_short_id: string | null;
  required_delivery_document_set: string[] | null;
  requisition_id: string | null;
  requisition_reference: string | null;
  requisition_status: string | null;
  prepared_by_user_id: string | null;
  prepared_by_name: string | null;
  operations_machinery: boolean;
  price_comparison: string | null;
  recommendation: string | null;
  selection_justification: string | null;
}

interface LoadedLine {
  id: string;
  line_number: number;
  description: string;
  category_id: string | null;
  category_key: string | null;
  category_name: string | null;
  invoice_required: boolean;
  stock_item: boolean;
  asset: boolean;
  quantity: number | null;
  unit_id: string | null;
  unit_code: string | null;
  unit_name: string | null;
  unit_price_kobo: string | null;
  line_amount_kobo: string | null;
  budget_line_id: string | null;
  budget_line_code: string | null;
  budget_line_name: string | null;
  budget_approved_kobo: string | null;
  required_delivery_document_set: string[] | null;
  accepted_quantity: number;
  received_quantity: number;
  rejected_quantity: number;
  second_batch_due_on: Date | string | null;
}

type LineWrite = {
  description?: string | null;
  categoryId?: string | null;
  quantity?: number | null;
  unitId?: string | null;
  unitPriceKobo?: number | null;
  budgetLineId?: string | null;
};

const LOAD_SQL = `
  SELECT r.id, r.reference_number, r.entity_id, e.code AS entity_code, e.name AS entity_name,
         r.department_id, d.name AS department_name, r.originator_user_id,
         app.user_public_name(r.originator_user_id) AS originator_name,
         u.position AS originator_position, r.vendor_id, ven.legal_name AS vendor_name,
         ven.cac_registration_number AS vendor_cac, ven.contacts AS vendor_contacts,
         r.current_version, r.status, r.row_version, r.created_at,
         v.id AS version_id, v.title, v.subject, v.category_id, c.key AS category_key,
         c.name AS category_name, c.invoice_required, v.reason, v.description, v.quantity,
         v.unit_id, um.code AS unit_code, um.name AS unit_name, v.unit_price_kobo::text,
         v.total_amount_kobo::text, v.required_date, v.delivery_location, v.funding_source_id,
         fs.key AS funding_source_key, fs.label AS funding_source_label, v.budget_line_id,
         bl.code AS budget_line_code, bl.name AS budget_line_name, bl.approved_amount_kobo::text AS budget_approved_kobo,
         v.project_id, p.code AS project_code, p.name AS project_name, v.urgency,
         v.additional_instructions,
         inv.id AS invoice_id, inv.document_id AS invoice_document_id, doc.reference_number AS invoice_document_ref,
         inv.invoice_number, inv.invoice_date, inv.amount_kobo::text AS invoice_amount_kobo,
         dv.sha256 AS invoice_sha256, inv.vendor_id AS invoice_vendor_id, invven.legal_name AS invoice_vendor_name,
         snap.memo_snapshot_hash AS memo_hash,
         snap.pdf_document_id, wi.id AS workflow_instance_id, v.submit_idempotency_key,
         r.cloned_from_request_id, src.reference_number AS cloned_from_reference,
         r.archived_from_status, r.archived_from_stage_key,
         r.funding_route, r.authorized_amount_kobo::text, r.paying_account_id, r.destination_account_id,
         r.proposed_payment_timing, r.final_payment_timing, r.final_payment_timing_set_at,
         r.final_payment_timing_set_by, r.timing_change_pending_ack,
         ven.status AS vendor_status, ven.bank_name AS vendor_bank_name, ven.account_name AS vendor_account_name,
         ven.account_number AS vendor_account_number, c.stock_item, c.asset,
         r.accepted_quantity_total, r.close_short_id, c.required_delivery_document_set,
         r.requisition_id, req.reference_number AS requisition_reference, req.status AS requisition_status,
         r.prepared_by_user_id, app.user_public_name(r.prepared_by_user_id) AS prepared_by_name,
         coalesce(c.operations_machinery, false) AS operations_machinery,
         v.price_comparison, v.recommendation, v.selection_justification
    FROM procurement_requests r
    JOIN entities e ON e.id = r.entity_id
    JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
    LEFT JOIN users u ON u.id = r.originator_user_id
    LEFT JOIN departments d ON d.id = r.department_id
    LEFT JOIN vendors ven ON ven.id = coalesce(r.vendor_id, v.vendor_id)
    LEFT JOIN procurement_categories c ON c.id = v.category_id
    LEFT JOIN units_of_measure um ON um.id = v.unit_id
    LEFT JOIN funding_sources fs ON fs.id = v.funding_source_id
    LEFT JOIN budget_lines bl ON bl.id = v.budget_line_id
    LEFT JOIN projects p ON p.id = v.project_id
    LEFT JOIN procurement_invoices inv ON inv.version_id = v.id
    LEFT JOIN documents doc ON doc.id = inv.document_id
    LEFT JOIN document_versions dv ON dv.id = doc.current_version_id
    LEFT JOIN vendors invven ON invven.id = inv.vendor_id
    LEFT JOIN procurement_memo_snapshots snap ON snap.version_id = v.id
    LEFT JOIN procurement_requests src ON src.id = r.cloned_from_request_id
    LEFT JOIN requisitions req ON req.id = r.requisition_id
    LEFT JOIN LATERAL (
      SELECT id FROM workflow_instances
       WHERE subject_id = r.id AND subject_type = 'PROCUREMENT'
       ORDER BY created_at DESC
       LIMIT 1
    ) wi ON true
`;

@Injectable()
export class ProcurementService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly workflows: WorkflowsService,
    private readonly documents: DocumentsService,
    private readonly vendors: VendorValidationService,
    private readonly checks: FinancialChecksService,
    @Optional() private readonly inventory?: InventoryService,
  ) {}

  async categories(actor: ActorContext): Promise<ProcurementCategoryView[]> {
    this.assertReader(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        key: string;
        name: string;
        invoice_required: boolean;
        stock_item: boolean;
        asset: boolean;
        operations_machinery: boolean;
      }>(
        `SELECT id, key, name, invoice_required, stock_item, asset, operations_machinery
           FROM procurement_categories WHERE status = 'ACTIVE' ORDER BY name`,
      );
      return result.rows.map((row) => ({
        id: row.id,
        key: row.key,
        name: row.name,
        invoiceRequired: row.invoice_required,
        stockItem: row.stock_item,
        asset: row.asset,
        operationsMachinery: row.operations_machinery,
      }));
    });
  }

  async units(actor: ActorContext): Promise<UnitOfMeasureView[]> {
    this.assertReader(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<UnitOfMeasureView>(
        `SELECT id, code, name FROM units_of_measure WHERE status = 'ACTIVE' ORDER BY code`,
      );
      return result.rows;
    });
  }

  async fundingSources(actor: ActorContext): Promise<FundingSourceView[]> {
    this.assertReader(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<FundingSourceView>(
        `SELECT id, key, label FROM funding_sources WHERE status = 'ACTIVE' ORDER BY label`,
      );
      return result.rows;
    });
  }

  urgencies(actor: ActorContext): Array<{ key: string; label: string }> {
    this.assertReader(actor);
    return PROCUREMENT_URGENCIES.map((key) => ({ key, label: PROCUREMENT_URGENCY_LABELS[key] }));
  }

  async projects(actor: ActorContext, entityId?: string): Promise<ProjectView[]> {
    this.assertReader(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        entity_id: string;
        code: string;
        name: string;
        status: string;
        row_version: number;
      }>(
        `SELECT id, entity_id, code, name, status, row_version
           FROM projects
          WHERE status = 'ACTIVE'
            AND ($1::uuid IS NULL OR entity_id = $1)
          ORDER BY code`,
        [entityId ?? null],
      );
      return result.rows.map((row) => ({
        id: row.id,
        entityId: row.entity_id,
        code: row.code,
        name: row.name,
        status: row.status,
        rowVersion: row.row_version,
      }));
    });
  }

  async budgetLines(actor: ActorContext, entityId?: string): Promise<BudgetLineView[]> {
    this.assertReader(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        entity_id: string;
        fiscal_year: number;
        code: string;
        name: string;
        approved_amount_kobo: string;
        available_amount_kobo: string;
        status: string;
        row_version: number;
      }>(
        `SELECT bl.id, bl.entity_id, bl.fiscal_year, bl.code, bl.name, bl.status, bl.row_version,
                bl.approved_amount_kobo::text,
                (bl.approved_amount_kobo - coalesce((
                   SELECT sum(CASE WHEN e.action = 'OPEN' THEN e.amount_kobo ELSE -e.amount_kobo END)
                     FROM procurement_commitment_events e
                    WHERE e.budget_line_id = bl.id
                 ), 0))::text AS available_amount_kobo
           FROM budget_lines bl
          WHERE bl.status = 'ACTIVE'
            AND ($1::uuid IS NULL OR bl.entity_id = $1)
          ORDER BY bl.fiscal_year DESC, bl.code`,
        [entityId ?? null],
      );
      return result.rows.map((row) => ({
        id: row.id,
        entityId: row.entity_id,
        fiscalYear: row.fiscal_year,
        code: row.code,
        name: row.name,
        approvedAmountKobo: Number(row.approved_amount_kobo),
        availableAmountKobo: Number(row.available_amount_kobo),
        status: row.status,
        rowVersion: row.row_version,
      }));
    });
  }

  async createProject(actor: ActorContext, input: CreateProjectInput): Promise<ProjectView> {
    this.assertBudgetManager(actor, input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const inserted = await tx.client.query<ProjectView>(
        `INSERT INTO projects (entity_id, code, name, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $4)
         RETURNING id, entity_id AS "entityId", code, name, status, row_version AS "rowVersion"`,
        [input.entityId, input.code.trim().toUpperCase(), input.name.trim(), actor.ref],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error('The project was not created.');
      await tx.audit({
        action: 'system_configuration_change',
        subjectType: 'project',
        subjectId: row.id,
        subjectLabel: input.name.trim(),
        entityId: input.entityId,
        newValue: { code: input.code, name: input.name },
      });
      return row;
    });
  }

  async createBudgetLine(actor: ActorContext, input: CreateBudgetLineInput): Promise<BudgetLineView> {
    this.assertBudgetManager(actor, input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const inserted = await tx.client.query<{
        id: string;
        entity_id: string;
        fiscal_year: number;
        code: string;
        name: string;
        approved_amount_kobo: string;
        status: string;
        row_version: number;
      }>(
        `INSERT INTO budget_lines (
           entity_id, fiscal_year, code, name, approved_amount_kobo, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING id, entity_id, fiscal_year, code, name, approved_amount_kobo::text, status, row_version`,
        [
          input.entityId,
          input.fiscalYear,
          input.code.trim().toUpperCase(),
          input.name.trim(),
          input.approvedAmountKobo,
          actor.ref,
        ],
      );
      const created = inserted.rows[0];
      if (!created) throw new Error('The budget line was not created.');
      await tx.audit({
        action: 'system_configuration_change',
        subjectType: 'budget_line',
        subjectId: created.id,
        subjectLabel: input.name.trim(),
        entityId: input.entityId,
        newValue: { code: input.code, amountKobo: input.approvedAmountKobo },
      });
      return {
        id: created.id,
        entityId: created.entity_id,
        fiscalYear: created.fiscal_year,
        code: created.code,
        name: created.name,
        approvedAmountKobo: Number(created.approved_amount_kobo),
        availableAmountKobo: Number(created.approved_amount_kobo),
        status: created.status,
        rowVersion: created.row_version,
      };
    });
  }

  async updateBudgetLine(actor: ActorContext, id: string, input: UpdateBudgetLineInput): Promise<BudgetLineView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await tx.client.query<{
        id: string;
        entity_id: string;
        fiscal_year: number;
        code: string;
        name: string;
        approved_amount_kobo: string;
        status: string;
        row_version: number;
      }>(
        `SELECT id, entity_id, fiscal_year, code, name, approved_amount_kobo::text, status, row_version
           FROM budget_lines WHERE id = $1`,
        [id],
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundError('That budget line was not found.');
      this.assertBudgetManager(actor, row.entity_id);
      if (row.row_version !== input.rowVersion) {
        throw new StaleRecordError('This budget line has changed. Refresh and try again.', {
          rowVersion: row.row_version,
        });
      }
      const nextName = input.name?.trim() ?? row.name;
      const nextAmount = input.approvedAmountKobo ?? Number(row.approved_amount_kobo);
      const updated = await tx.client.query<{
        id: string;
        entity_id: string;
        fiscal_year: number;
        code: string;
        name: string;
        approved_amount_kobo: string;
        status: string;
        row_version: number;
      }>(
        `UPDATE budget_lines
            SET name = $1, approved_amount_kobo = $2, updated_by = $3
          WHERE id = $4 AND row_version = $5
          RETURNING id, entity_id, fiscal_year, code, name, approved_amount_kobo::text, status, row_version`,
        [nextName, nextAmount, actor.ref, id, input.rowVersion],
      );
      const after = updated.rows[0];
      if (!after) throw new StaleRecordError('This budget line has changed. Refresh and try again.');
      await tx.audit({
        action: 'edit',
        subjectType: 'budget_line',
        subjectId: after.id,
        subjectLabel: after.name,
        entityId: after.entity_id,
        oldValue: { name: row.name, approvedAmountKobo: Number(row.approved_amount_kobo) },
        newValue: { name: after.name, approvedAmountKobo: Number(after.approved_amount_kobo) },
      });
      const available = await this.budgetAvailable(tx, after.id);
      return {
        id: after.id,
        entityId: after.entity_id,
        fiscalYear: after.fiscal_year,
        code: after.code,
        name: after.name,
        approvedAmountKobo: Number(after.approved_amount_kobo),
        availableAmountKobo: available,
        status: after.status,
        rowVersion: after.row_version,
      };
    });
  }

  async list(actor: ActorContext, query: ListProcurementQuery = { q: undefined }): Promise<ProcurementListView> {
    this.assertReader(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        reference_number: string;
        title: string;
        status: string;
        entity_id: string;
        entity_code: string | null;
        vendor_name: string | null;
        total_amount_kobo: string | null;
        originator_user_id: string;
        originator_name: string | null;
        updated_at: Date;
        created_at: Date;
        current_version: number;
        last_return_reason: string | null;
        outstanding_quantity: number;
        second_batch_due_on: Date | string | null;
        requisition_id: string | null;
        prepared_by_user_id: string | null;
        final_payment_timing: string | null;
        funding_route: string | null;
        invoice_id: string | null;
        invoice_amount_kobo: string | null;
        variance_status: string | null;
        variance_invoice_amount_kobo: string | null;
      }>(
        `SELECT r.id, r.reference_number, v.title, r.status, r.entity_id, e.code AS entity_code,
                ven.legal_name AS vendor_name, v.total_amount_kobo::text, r.updated_at, r.created_at,
                r.current_version, r.requisition_id, r.prepared_by_user_id,
                r.final_payment_timing, r.funding_route, r.originator_user_id,
                inv.id AS invoice_id, inv.amount_kobo::text AS invoice_amount_kobo,
                var.status AS variance_status, var.invoice_amount_kobo::text AS variance_invoice_amount_kobo,
                app.user_public_name(r.originator_user_id) AS originator_name,
                (
                  SELECT a.reason
                    FROM workflow_actions a
                    JOIN workflow_instances i ON i.id = a.instance_id
                   WHERE i.subject_type = 'PROCUREMENT' AND i.subject_id = r.id
                     AND a.action = 'RETURN_FOR_CORRECTION'
                   ORDER BY a.occurred_at DESC
                   LIMIT 1
                ) AS last_return_reason,
                GREATEST(
                  COALESCE((
                    SELECT SUM(COALESCE(l.quantity, 0))
                      FROM procurement_version_lines l
                     WHERE l.version_id = v.id
                  ), 0) - COALESCE(r.accepted_quantity_total, 0),
                  0
                )::int AS outstanding_quantity,
                (
                  SELECT MIN(d.due_on)
                    FROM procurement_shortage_deadlines d
                    JOIN procurement_version_lines l ON l.id = d.line_id
                   WHERE d.request_id = r.id
                     AND COALESCE(l.quantity, 0) > COALESCE((
                       SELECT sum(g.quantity_accepted)
                         FROM procurement_goods_receipts g
                        WHERE g.request_id = r.id
                          AND coalesce(g.line_id, (
                            SELECT first_line.id FROM procurement_version_lines first_line
                             WHERE first_line.version_id = v.id AND first_line.line_number = 1
                          )) = l.id
                          AND NOT EXISTS (
                            SELECT 1 FROM procurement_goods_receipts later WHERE later.supersedes_id = g.id
                          )
                     ), 0)
                ) AS second_batch_due_on
           FROM procurement_requests r
           JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
           JOIN entities e ON e.id = r.entity_id
           LEFT JOIN vendors ven ON ven.id = coalesce(r.vendor_id, v.vendor_id)
           LEFT JOIN procurement_invoices inv ON inv.version_id = v.id
           LEFT JOIN LATERAL (
             SELECT x.status, x.invoice_amount_kobo
               FROM procurement_invoice_variances x
              WHERE x.version_id = v.id AND x.status <> 'SUPERSEDED'
              ORDER BY x.created_at DESC
              LIMIT 1
           ) var ON true
          WHERE ($1::text IS NULL OR r.status = $1)
            AND ($2::text IS NULL OR r.reference_number ILIKE '%' || $2 || '%' OR v.title ILIKE '%' || $2 || '%'
                 OR coalesce(ven.legal_name, '') ILIKE '%' || $2 || '%')
          ORDER BY r.updated_at DESC`,
        [query.status ?? null, query.q ?? null],
      );
      const countsResult = await tx.client.query<{ status: string; n: string }>(
        `SELECT status, count(*)::text AS n FROM procurement_requests GROUP BY status`,
      );
      const counts: Record<string, number> = {};
      for (const status of PROCUREMENT_STATUSES) counts[status] = 0;
      for (const row of countsResult.rows) counts[row.status] = Number(row.n);
      return {
        items: result.rows.map((row) => {
          const totalAmountKobo = row.total_amount_kobo == null ? null : Number(row.total_amount_kobo);
          const outstandingQuantity = Number(row.outstanding_quantity ?? 0);
          const finalPaymentTiming =
            row.final_payment_timing && isPaymentTiming(row.final_payment_timing) ? row.final_payment_timing : null;
          const fundingRoute = row.funding_route && isFundingRoute(row.funding_route) ? row.funding_route : null;
          const invoiceStage = invoiceStageFrom({
            status: row.status,
            invoiceId: row.invoice_id,
            invoiceAmountKobo: row.invoice_amount_kobo == null ? null : Number(row.invoice_amount_kobo),
            totalAmountKobo,
            varianceStatus: row.variance_status,
            varianceInvoiceAmountKobo:
              row.variance_invoice_amount_kobo == null ? null : Number(row.variance_invoice_amount_kobo),
          });
          return {
            id: row.id,
            referenceNumber: row.reference_number,
            title: row.title,
            status: row.status,
            entityId: row.entity_id,
            entityCode: row.entity_code,
            vendorName: row.vendor_name,
            totalAmountKobo,
            originatorUserId: row.originator_user_id,
            originatorName: row.originator_name,
            updatedAt: row.updated_at.toISOString(),
            createdAt: row.created_at.toISOString(),
            currentVersion: row.current_version,
            lastReturnReason: row.last_return_reason,
            requisitionId: row.requisition_id,
            preparedByUserId: row.prepared_by_user_id,
            outstandingQuantity,
            secondBatchDueOn: row.second_batch_due_on ? formatLagosIsoDate(row.second_batch_due_on) : null,
            shortageOverdue: Boolean(
              row.status === 'PARTIALLY_RECEIVED' &&
                row.second_batch_due_on &&
                formatLagosIsoDate(row.second_batch_due_on) < formatLagosIsoDate(new Date()),
            ),
            invoiceStage,
            finalPaymentTiming,
            fundingRoute,
            nextAction: procurementNextAction({
              status: row.status,
              requisitionId: row.requisition_id,
              returned: row.status === 'DRAFT' && Boolean(row.last_return_reason),
              finalPaymentTiming,
              fundingRoute,
              invoiceStage,
              deliveryComplete: outstandingQuantity === 0 && row.status !== 'AWAITING_DELIVERY',
              paymentComplete: false,
            }),
          };
        }),
        counts,
      };
    });
  }

  /** Procurement steps the actor must take next, newest first. */
  async myActions(actor: ActorContext): Promise<ProcurementMyActionView[]> {
    if (
      !can(actor, 'procurement.view') &&
      !can(actor, 'procurement.create') &&
      !can(actor, 'procurement.prepare') &&
      !can(actor, 'requisition.create')
    ) {
      return [];
    }
    const { items } = await this.list(actor);
    const mine: ProcurementMyActionView[] = [];
    for (const item of items) {
      const action = item.nextAction;
      if (!action) continue;
      if (!canTakeProcurementAction(action, actor, item)) continue;
      mine.push({
        requestId: item.id,
        referenceNumber: item.referenceNumber,
        title: item.title,
        entityCode: item.entityCode,
        vendorName: item.vendorName,
        totalAmountKobo: item.totalAmountKobo,
        actionKey: action.key,
        actionLabel: action.label,
        detail: myActionDetail(item),
        href: `/procurement/${item.id}#${action.anchor}`,
        since: item.updatedAt,
      });
    }
    return mine;
  }

  async listFinanceOverrides(actor: ActorContext): Promise<
    Array<{
      id: string;
      requestId: string;
      referenceNumber: string;
      entityCode: string | null;
      overrideReason: string;
      failedChecks: string[];
      approvedAt: string;
      href: string;
    }>
  > {
    if (!can(actor, 'finance.funding.authorize') && !can(actor, 'finance.view')) {
      throw new ForbiddenError('You cannot view finance overrides.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        request_id: string;
        reference_number: string;
        entity_code: string | null;
        override_reason: string;
        checks: unknown;
        created_at: Date;
      }>(
        `SELECT fr.id, fr.request_id, r.reference_number, e.code AS entity_code,
                fr.override_reason, fr.checks, fr.created_at
           FROM procurement_financial_reviews fr
           JOIN procurement_requests r ON r.id = fr.request_id
           JOIN entities e ON e.id = fr.entity_id
          WHERE fr.override_reason IS NOT NULL AND btrim(fr.override_reason) <> ''
          ORDER BY fr.created_at DESC
          LIMIT 25`,
      );
      return result.rows.map((row) => {
        const checks = Array.isArray(row.checks) ? row.checks : [];
        const failedChecks = checks
          .filter((check): check is { key?: string; result?: string; label?: string } => Boolean(check))
          .filter((check) => check.result === 'FAIL')
          .map((check) => check.label ?? check.key ?? 'Check');
        return {
          id: row.id,
          requestId: row.request_id,
          referenceNumber: row.reference_number,
          entityCode: row.entity_code,
          overrideReason: row.override_reason,
          failedChecks,
          approvedAt: row.created_at.toISOString(),
          href: `/procurement/${row.request_id}`,
        };
      });
    });
  }

  async listRecentPayments(
    actor: ActorContext,
    limit = 15,
  ): Promise<
    Array<{
      id: string;
      requestId: string;
      referenceNumber: string;
      procurementReference: string;
      vendorName: string | null;
      entityCode: string | null;
      amountKobo: number;
      paidAt: string;
      href: string;
    }>
  > {
    this.assertReader(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        request_id: string;
        reference_number: string;
        procurement_reference: string;
        vendor_name: string | null;
        entity_code: string | null;
        amount_kobo: string;
        paid_on: string;
      }>(
        `SELECT p.id, p.request_id, p.reference_number, r.reference_number AS procurement_reference,
                ven.legal_name AS vendor_name, e.code AS entity_code, p.amount_kobo::text,
                p.payment_date::text AS paid_on
           FROM procurement_payments p
           JOIN procurement_requests r ON r.id = p.request_id
           JOIN entities e ON e.id = p.entity_id
           LEFT JOIN vendors ven ON ven.id = coalesce(r.vendor_id, p.vendor_id)
          WHERE p.status = 'COMPLETED' AND p.reversed_at IS NULL
          ORDER BY p.payment_date DESC, p.created_at DESC
          LIMIT $1`,
        [limit],
      );
      return result.rows.map((row) => ({
        id: row.id,
        requestId: row.request_id,
        referenceNumber: row.reference_number,
        procurementReference: row.procurement_reference,
        vendorName: row.vendor_name,
        entityCode: row.entity_code,
        amountKobo: Number(row.amount_kobo),
        paidAt: `${row.paid_on}T00:00:00.000Z`,
        href: `/procurement/${row.request_id}`,
      }));
    });
  }

  async get(actor: ActorContext, id: string): Promise<ProcurementView> {
    this.assertReader(actor);
    return this.unitOfWork.read(actor, async (tx) => this.getInTx(tx, actor, id));
  }

  async getInTx(
    tx: TxScope,
    actor: ActorContext,
    id: string,
    opts?: { skipPermission?: boolean },
  ): Promise<ProcurementView> {
    const row = await this.loadRow(tx, id);
    if (
      !opts?.skipPermission &&
      !can(actor, 'procurement.view', row.entity_id) &&
      !can(actor, 'procurement.create', row.entity_id) &&
      !can(actor, 'procurement.prepare', row.entity_id) &&
      !can(actor, 'requisition.create', row.entity_id)
    ) {
      throw new ForbiddenError('You cannot view this procurement request.');
    }
    return this.toView(tx, row, actor);
  }

  async create(actor: ActorContext, input: CreateProcurementInput): Promise<ProcurementView> {
    assertCan(actor, 'procurement.prepare');
    if (!input.requisitionId) {
      throw new ValidationFailedError('A need-approved requisition is required to prepare a proposal.');
    }
    const entityId = input.entityId ?? actor.entityIds[0];
    if (!entityId) throw new ValidationFailedError('An entity is required.');
    assertCan(actor, 'procurement.prepare', entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const allocated = await tx.client.query<{ ref: string }>(
        'SELECT app.next_reference($1, NULL) AS ref',
        ['PR'],
      );
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The procurement reference was not allocated.');
      if (input.departmentId) await this.assertDepartment(tx, input.departmentId, entityId);
      const existing = await tx.client.query<{ id: string; status: string }>(
        `SELECT id, status FROM procurement_requests WHERE requisition_id = $1`,
        [input.requisitionId],
      );
      if (existing.rows[0]) {
        const shell = await this.loadRow(tx, existing.rows[0].id);
        if (shell.status !== 'AWAITING_PREPARATION' && shell.status !== 'DRAFT') {
          throw new ConflictError('This requisition already has a procurement proposal.');
        }
        await tx.client.query(
          `UPDATE procurement_requests SET prepared_by_user_id = coalesce(prepared_by_user_id, $1::uuid), updated_by = $1 WHERE id = $2`,
          [actor.ref, shell.id],
        );
        return this.toView(tx, await this.loadRow(tx, shell.id));
      }
      const need = await tx.client.query<{ status: string; entity_id: string }>(
        `SELECT status, entity_id FROM requisitions WHERE id = $1`,
        [input.requisitionId],
      );
      if (!need.rows[0] || need.rows[0].status !== 'NEED_APPROVED') {
        throw new ValidationFailedError('Only a need-approved requisition can be prepared.');
      }

      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO procurement_requests (
           reference_number, entity_id, department_id, originator_user_id, requisition_id,
           prepared_by_user_id, created_by, updated_by
         ) VALUES ($1, $2, $3, $4::uuid, $5, $4::uuid, $4, $4)
         RETURNING id`,
        [reference, entityId, input.departmentId ?? null, actor.ref, input.requisitionId],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The request was not created.');
      await tx.client.query(
        `INSERT INTO procurement_versions (
           request_id, entity_id, version_number, title, created_by, updated_by
         ) VALUES ($1, $2, 1, $3, $4, $4)`,
        [id, entityId, input.title.trim(), actor.ref],
      );
      await tx.audit({
        action: 'create',
        subjectType: 'procurement_request',
        subjectId: id,
        subjectLabel: input.title.trim(),
        subjectReferenceNumber: reference,
        entityId,
        newValue: { title: input.title.trim(), status: 'DRAFT' },
      });
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: id,
        text: 'GM created procurement',
        href: `/procurement/${id}`,
        entityId,
      });
      await this.indexRequest(tx, await this.loadRow(tx, id));
      return this.toView(tx, await this.loadRow(tx, id));
    });
  }

  async update(actor: ActorContext, id: string, input: UpdateProcurementInput): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.loadRow(tx, id);
      this.assertOriginatorDraft(actor, current, 'procurement.edit_draft');
      if (current.row_version !== input.rowVersion) {
        throw new StaleRecordError('This request has changed. Refresh and try again.', {
          rowVersion: current.row_version,
        });
      }
      if (input.vendorId) {
        await this.vendors.assertSelectableInTx(tx, actor, input.vendorId, 'draft-save');
      }
      if (input.departmentId) await this.assertDepartment(tx, input.departmentId, current.entity_id);
      if (input.requiredDate) this.assertRequiredDate(input.requiredDate);

      const existingLines = await this.loadLines(tx, current.version_id, current.id);
      const linePayload = this.resolveLineInput(input, existingLines);
      if (linePayload) {
        await this.assertQuotationLinesStable(tx, current.version_id, existingLines, linePayload);
        await this.replaceLines(tx, actor, current.version_id, current.entity_id, linePayload);
      }
      const linesAfter = await this.loadLines(tx, current.version_id, current.id);
      const first = linesAfter[0];
      const total = this.sumLineAmounts(linesAfter);
      const nextDepartment = input.departmentId === undefined ? current.department_id : input.departmentId;
      const nextVendor = input.vendorId === undefined ? current.vendor_id : input.vendorId;
      const nextProposed =
        input.proposedPaymentTiming === undefined
          ? current.proposed_payment_timing
          : input.proposedPaymentTiming;

      await tx.client.query(
        `UPDATE procurement_requests
            SET department_id = $1, vendor_id = $2, proposed_payment_timing = $3,
                prepared_by_user_id = coalesce(prepared_by_user_id, $4::uuid), updated_by = $4
          WHERE id = $5 AND row_version = $6`,
        [nextDepartment, nextVendor, nextProposed, actor.ref, id, current.row_version],
      );

      await tx.client.query(
        `UPDATE procurement_versions
            SET title = $1, subject = $2, category_id = $3, reason = $4, description = $5,
                quantity = $6, unit_id = $7, unit_price_kobo = $8, total_amount_kobo = $9,
                required_date = $10, vendor_id = $11, delivery_location = $12,
                funding_source_id = $13, budget_line_id = $14, project_id = $15,
                urgency = $16, additional_instructions = $17, price_comparison = $18,
                recommendation = $19, updated_by = $20
          WHERE id = $21`,
        [
          input.title?.trim() ?? current.title,
          input.subject === undefined ? current.subject : input.subject,
          first?.category_id ?? null,
          input.reason === undefined ? current.reason : input.reason,
          input.description === undefined ? current.description : input.description,
          first?.quantity ?? null,
          first?.unit_id ?? null,
          first?.unit_price_kobo == null ? null : Number(first.unit_price_kobo),
          total,
          input.requiredDate === undefined ? dateOnly(current.required_date) : input.requiredDate,
          nextVendor,
          input.deliveryLocation === undefined ? current.delivery_location : input.deliveryLocation,
          input.fundingSourceId === undefined ? current.funding_source_id : input.fundingSourceId,
          first?.budget_line_id ?? null,
          input.projectId === undefined ? current.project_id : input.projectId,
          input.urgency ?? current.urgency,
          input.additionalInstructions === undefined
            ? current.additional_instructions
            : input.additionalInstructions,
          input.priceComparison === undefined ? current.price_comparison : input.priceComparison,
          input.recommendation === undefined ? current.recommendation : input.recommendation,
          actor.ref,
          current.version_id,
        ],
      );

      const after = await this.loadRow(tx, id);
      const beforeRecord = this.diffable(current);
      const afterRecord = this.diffable(after);
      const changed = computeDiff(beforeRecord, afterRecord);
      if (changed.changedFields.length > 0) {
        await tx.audit({
          action: 'edit',
          subjectType: 'procurement_request',
          subjectId: id,
          subjectLabel: after.title,
          subjectReferenceNumber: after.reference_number,
          entityId: after.entity_id,
          oldValue: changed.oldValue,
          newValue: changed.newValue,
        });
      }
      await this.indexRequest(tx, after);
      return this.toView(tx, after);
    });
  }

  /**
   * Cheap checks made before the invoice file is stored. Requisition proposals
   * take their invoice at the ED Finance stage, from the approved vendor only.
   */
  assertInvoiceUploadAllowed(view: ProcurementView, input: InvoiceMetaInput): void {
    if (view.status === 'AWAITING_ED_FINANCE') {
      if (input.vendorId && view.vendorId && input.vendorId !== view.vendorId) {
        throw new ValidationFailedError(
          `The invoice must be from the approved vendor, ${view.vendorName ?? 'the selected vendor'}.`,
        );
      }
      return;
    }
    if (view.requisitionId) {
      throw new ValidationFailedError(
        'The invoice is requested at the ED Finance stage, after the MD approves the proposal.',
      );
    }
  }

  async attachInvoice(
    actor: ActorContext,
    id: string,
    input: InvoiceMetaInput,
    documentId: string,
  ): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.loadRow(tx, id);
      if (current.status === 'AWAITING_ED_FINANCE') {
        return this.attachFinanceInvoiceInTx(tx, actor, current, input, documentId);
      }
      if (current.requisition_id) {
        throw new ValidationFailedError(
          'The invoice is requested at the ED Finance stage, after the MD approves the proposal.',
        );
      }
      this.assertOriginatorDraft(actor, current, 'procurement.edit_draft');
      if (current.invoice_id && !input.reason?.trim()) {
        throw new ValidationFailedError('A reason is required to replace an invoice.');
      }
      if (current.invoice_id) {
        await tx.client.query(
          `UPDATE procurement_invoices
              SET document_id = $1, invoice_number = $2, invoice_date = $3, amount_kobo = $4, updated_by = $5
            WHERE id = $6`,
          [documentId, input.invoiceNumber.trim(), input.invoiceDate, input.amountKobo, actor.ref, current.invoice_id],
        );
      } else {
        await tx.client.query(
          `INSERT INTO procurement_invoices (
             request_id, version_id, entity_id, document_id, invoice_number, invoice_date, amount_kobo,
             vendor_id, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
          [
            id,
            current.version_id,
            current.entity_id,
            documentId,
            input.invoiceNumber.trim(),
            input.invoiceDate,
            input.amountKobo,
            current.vendor_id,
            actor.ref,
          ],
        );
      }
      await tx.audit({
        action: 'upload',
        subjectType: 'procurement_invoice',
        subjectId: id,
        subjectLabel: current.title,
        subjectReferenceNumber: current.reference_number,
        entityId: current.entity_id,
        reason: input.reason?.trim() || null,
        newValue: { invoiceNumber: input.invoiceNumber, amountKobo: input.amountKobo },
      });
      return this.toView(tx, await this.loadRow(tx, id));
    });
  }

  /**
   * The Procurement Manager attaches the approved vendor's invoice while the
   * request waits at ED Finance. The workflow does not move: a matching amount
   * releases ED Finance to continue; any other amount waits for the MD.
   */
  private async attachFinanceInvoiceInTx(
    tx: TxScope,
    actor: ActorContext,
    current: LoadedRow,
    input: InvoiceMetaInput,
    documentId: string,
  ): Promise<ProcurementView> {
    const mayUpload = current.requisition_id
      ? can(actor, 'procurement.prepare', current.entity_id) &&
        (!current.prepared_by_user_id || current.prepared_by_user_id === actor.ref)
      : current.originator_user_id === actor.ref && can(actor, 'procurement.edit_draft', current.entity_id);
    if (!mayUpload) {
      throw new ForbiddenError('Only the Procurement Manager who prepared this proposal can upload its invoice.');
    }
    if (await this.financeDecisionRecorded(tx, current.version_id)) {
      throw new ConflictError('ED Finance has already approved this request. The invoice can no longer change.');
    }
    if (!current.vendor_id) throw new ConflictError('This request has no approved vendor.');
    if (input.vendorId && input.vendorId !== current.vendor_id) {
      throw new ValidationFailedError(
        `The invoice must be from the approved vendor, ${current.vendor_name ?? 'the selected vendor'}.`,
      );
    }
    if (current.invoice_id && !input.reason?.trim()) {
      throw new ValidationFailedError('A reason is required to replace an invoice.');
    }

    let invoiceId = current.invoice_id;
    if (invoiceId) {
      await tx.client.query(
        `UPDATE procurement_invoices
            SET document_id = $1, invoice_number = $2, invoice_date = $3, amount_kobo = $4,
                vendor_id = $5, updated_by = $6
          WHERE id = $7`,
        [documentId, input.invoiceNumber.trim(), input.invoiceDate, input.amountKobo, current.vendor_id, actor.ref, invoiceId],
      );
    } else {
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO procurement_invoices (
           request_id, version_id, entity_id, document_id, invoice_number, invoice_date, amount_kobo,
           vendor_id, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         RETURNING id`,
        [
          current.id,
          current.version_id,
          current.entity_id,
          documentId,
          input.invoiceNumber.trim(),
          input.invoiceDate,
          input.amountKobo,
          current.vendor_id,
          actor.ref,
        ],
      );
      invoiceId = inserted.rows[0]?.id ?? null;
    }
    if (!invoiceId) throw new Error('The invoice was not stored.');

    await tx.client.query(
      `INSERT INTO vendor_invoice_claims (vendor_id, entity_id, invoice_number, procurement_ref, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [current.vendor_id, current.entity_id, input.invoiceNumber.trim(), current.reference_number, actor.ref],
    );

    await tx.client.query(
      `UPDATE procurement_invoice_variances
          SET status = 'SUPERSEDED', updated_by = $2
        WHERE version_id = $1 AND status IN ('PENDING', 'REJECTED')`,
      [current.version_id, actor.ref],
    );

    const approved = current.total_amount_kobo === null ? 0 : Number(current.total_amount_kobo);
    const matches = input.amountKobo === approved;
    let varianceId: string | null = null;
    if (!matches) {
      const variance = await tx.client.query<{ id: string }>(
        `INSERT INTO procurement_invoice_variances (
           request_id, version_id, invoice_id, entity_id, approved_amount_kobo, invoice_amount_kobo,
           invoice_number, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         RETURNING id`,
        [
          current.id,
          current.version_id,
          invoiceId,
          current.entity_id,
          approved,
          input.amountKobo,
          input.invoiceNumber.trim(),
          actor.ref,
        ],
      );
      varianceId = variance.rows[0]?.id ?? null;
    }

    await tx.audit({
      action: 'upload',
      subjectType: 'procurement_invoice',
      subjectId: current.id,
      subjectLabel: current.title,
      subjectReferenceNumber: current.reference_number,
      entityId: current.entity_id,
      reason: input.reason?.trim() || null,
      newValue: {
        stage: 'ed-finance',
        invoiceNumber: input.invoiceNumber,
        amountKobo: input.amountKobo,
        approvedAmountKobo: approved,
        variance: !matches,
      },
    });
    const amountText = formatKobo(BigInt(input.amountKobo));
    const approvedText = formatKobo(BigInt(approved));
    await tx.appendTimeline({
      subjectType: 'PROCUREMENT',
      subjectId: current.id,
      text: matches
        ? `Vendor invoice ${input.invoiceNumber.trim()} uploaded for ${amountText}`
        : `Vendor invoice ${input.invoiceNumber.trim()} for ${amountText} differs from the approved ${approvedText}; MD approval requested`,
      href: `/procurement/${current.id}`,
      entityId: current.entity_id,
    });

    if (matches) {
      await this.notifyPermissionHolders(tx, 'procurement.review.finance', current, 'procurement.invoice_uploaded', {
        summary: `Invoice ${input.invoiceNumber.trim()} for ${amountText} matches the approved amount.`,
        tag: invoiceId,
      });
      await this.workflows.activateCurrentStageInTx(tx, actor, current.id, { notify: false });
    } else {
      await this.notifyPermissionHolders(tx, 'procurement.approve.final', current, 'procurement.invoice_variance', {
        summary: `Approved ${approvedText}; invoice ${input.invoiceNumber.trim()} is ${amountText}.`,
        tag: varianceId ?? invoiceId,
      });
    }
    return this.toView(tx, await this.loadRow(tx, current.id));
  }

  /**
   * The MD approves or rejects an invoice amount that differs from the approved
   * total. Approval moves the budget commitment to the invoiced amount and lets
   * ED Finance continue; rejection asks the Procurement Manager for a corrected
   * invoice. The workflow stays at ED Finance either way.
   */
  async decideInvoiceVariance(
    actor: ActorContext,
    id: string,
    input: InvoiceVarianceDecisionInput,
  ): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.loadRow(tx, id);
      if (!can(actor, 'procurement.approve.final', current.entity_id)) {
        throw new ForbiddenError('Only the Managing Director can decide an invoice variance.');
      }
      if (current.status !== 'AWAITING_ED_FINANCE') {
        throw new ConflictError('This request is not waiting at ED Finance.');
      }
      const variance = await this.loadInvoiceVariance(tx, current.version_id);
      if (!variance || variance.status !== 'PENDING') {
        throw new ConflictError('There is no invoice variance waiting for a decision.');
      }
      const reason = input.reason?.trim() || null;
      if (input.decision === 'REJECT' && !reason) {
        throw new ValidationFailedError('A reason is required to reject the invoice amount.', {
          fieldErrors: { reason: ['A reason is required to reject the invoice amount.'] },
        });
      }
      const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await tx.client.query(
        `UPDATE procurement_invoice_variances
            SET status = $2, decided_by = $3, decided_at = now(), reason = $4, updated_by = $3
          WHERE id = $1`,
        [variance.id, status, actor.ref, reason],
      );
      const invoiceText = formatKobo(BigInt(variance.invoiceAmountKobo));
      const approvedText = formatKobo(BigInt(variance.approvedAmountKobo));
      if (status === 'APPROVED') {
        await this.adjustCommitment(tx, actor, current, variance.invoiceAmountKobo - variance.approvedAmountKobo);
      }
      await tx.audit({
        action: input.decision === 'APPROVE' ? 'approve' : 'reject',
        subjectType: 'procurement_invoice_variance',
        subjectId: current.id,
        subjectLabel: current.title,
        subjectReferenceNumber: current.reference_number,
        entityId: current.entity_id,
        reason,
        oldValue: { approvedAmountKobo: variance.approvedAmountKobo },
        newValue: { invoiceAmountKobo: variance.invoiceAmountKobo, status },
      });
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: current.id,
        text:
          status === 'APPROVED'
            ? `MD approved the invoiced amount ${invoiceText} (was ${approvedText})`
            : `MD rejected the invoiced amount ${invoiceText}: ${reason}`,
        href: `/procurement/${current.id}`,
        entityId: current.entity_id,
      });
      if (status === 'APPROVED') {
        await this.notifyPermissionHolders(tx, 'procurement.review.finance', current, 'procurement.invoice_uploaded', {
          summary: `The MD approved the invoiced amount ${invoiceText} (approved ${approvedText}).`,
          tag: variance.id,
        });
        await this.workflows.activateCurrentStageInTx(tx, actor, current.id, { notify: false });
      } else if (current.prepared_by_user_id || current.originator_user_id) {
        await this.notifyUser(
          tx,
          current.prepared_by_user_id ?? current.originator_user_id,
          current,
          'procurement.invoice_variance_rejected',
          { reason: reason ?? '', tag: variance.id },
        );
      }
      return this.toView(tx, await this.loadRow(tx, id));
    });
  }

  /**
   * Runs when the MD's approval moves the request to ED Finance. Without an
   * invoice the Procurement Manager is asked for one; an invoice carried over
   * from an earlier version that no longer matches goes to the MD as a variance.
   */
  private async requestFinanceInvoice(tx: TxScope, actor: ActorContext, row: LoadedRow): Promise<void> {
    const approved = row.total_amount_kobo === null ? 0 : Number(row.total_amount_kobo);
    if (!row.invoice_id) {
      const recipient = row.prepared_by_user_id ?? row.originator_user_id;
      await this.notifyUser(tx, recipient, row, 'procurement.invoice_requested', {
        summary: row.vendor_name ?? 'the approved vendor',
      });
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: row.id,
        text: `Vendor invoice requested from the Procurement Manager for ED Finance review`,
        href: `/procurement/${row.id}`,
        entityId: row.entity_id,
      });
      return;
    }
    const invoiceAmount = Number(row.invoice_amount_kobo ?? 0);
    if (invoiceAmount === approved) return;
    const existing = await this.loadInvoiceVariance(tx, row.version_id);
    if (existing && (existing.status === 'PENDING' || existing.invoiceAmountKobo === invoiceAmount)) return;
    const variance = await tx.client.query<{ id: string }>(
      `INSERT INTO procurement_invoice_variances (
         request_id, version_id, invoice_id, entity_id, approved_amount_kobo, invoice_amount_kobo,
         invoice_number, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING id`,
      [row.id, row.version_id, row.invoice_id, row.entity_id, approved, invoiceAmount, row.invoice_number ?? '', actor.ref],
    );
    await this.notifyPermissionHolders(tx, 'procurement.approve.final', row, 'procurement.invoice_variance', {
      summary: `Approved ${formatKobo(BigInt(approved))}; invoice ${row.invoice_number ?? ''} is ${formatKobo(BigInt(invoiceAmount))}.`,
      tag: variance.rows[0]?.id ?? null,
    });
  }

  /**
   * ED Finance may approve only with the approved vendor's invoice attached and
   * its amount either equal to the approved total or approved by the MD.
   * Returns the amount to authorise.
   */
  private async assertFinanceInvoiceReady(tx: TxScope, current: LoadedRow): Promise<number> {
    const approved = current.total_amount_kobo === null ? 0 : Number(current.total_amount_kobo);
    if (!current.invoice_id) {
      throw new ValidationFailedError(
        'The vendor invoice has not been uploaded. The Procurement Manager has been asked to attach it.',
      );
    }
    if (current.invoice_vendor_id && current.vendor_id && current.invoice_vendor_id !== current.vendor_id) {
      throw new ValidationFailedError('The invoice is not from the approved vendor. A corrected invoice is required.');
    }
    const invoiceAmount = Number(current.invoice_amount_kobo ?? 0);
    if (invoiceAmount === approved) return approved;
    const variance = await this.loadInvoiceVariance(tx, current.version_id);
    if (variance?.status === 'APPROVED' && variance.invoiceAmountKobo === invoiceAmount) return invoiceAmount;
    if (variance?.status === 'REJECTED') {
      throw new ValidationFailedError(
        'The MD rejected the invoiced amount. The Procurement Manager must upload a corrected invoice.',
      );
    }
    throw new ValidationFailedError(
      'The invoice amount differs from the approved amount and is waiting for the MD to approve it.',
    );
  }

  /** Records the difference between the approved and the invoiced amount on the largest budget line. */
  private async adjustCommitment(tx: TxScope, actor: ActorContext, current: LoadedRow, delta: number): Promise<void> {
    if (delta === 0) return;
    const lines = await this.loadLines(tx, current.version_id, current.id);
    const budgetLineId =
      [...lines]
        .filter((line) => line.budget_line_id)
        .sort((a, b) => Number(b.line_amount_kobo ?? 0) - Number(a.line_amount_kobo ?? 0))[0]?.budget_line_id ??
      current.budget_line_id;
    const action = delta > 0 ? 'OPEN' : 'RELEASE';
    const amount = Math.abs(delta);
    await tx.client.query(
      `INSERT INTO procurement_commitment_events (
         request_id, entity_id, budget_line_id, action, amount_kobo, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [current.id, current.entity_id, budgetLineId, action, amount, actor.ref],
    );
    await tx.client.query(
      `INSERT INTO budget_commitment_events (
         request_id, entity_id, budget_line_id, action, amount_kobo, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [current.id, current.entity_id, budgetLineId, action === 'OPEN' ? 'COMMIT' : 'RELEASE', amount, actor.ref],
    );
  }

  private async financeDecisionRecorded(tx: TxScope, versionId: string): Promise<boolean> {
    const result = await tx.client.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM procurement_financial_reviews WHERE version_id = $1) AS ok`,
      [versionId],
    );
    return Boolean(result.rows[0]?.ok);
  }

  private async loadInvoiceVariance(tx: TxScope, versionId: string): Promise<ProcurementInvoiceVarianceView | null> {
    const result = await tx.client.query<{
      id: string;
      approved_amount_kobo: string;
      invoice_amount_kobo: string;
      invoice_number: string;
      status: ProcurementInvoiceVarianceView['status'];
      reason: string | null;
      decided_by_name: string | null;
      decided_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, approved_amount_kobo::text, invoice_amount_kobo::text, invoice_number, status, reason,
              app.user_public_name(
                CASE WHEN decided_by ~ '^[0-9a-f-]{36}$' THEN decided_by::uuid ELSE NULL END
              ) AS decided_by_name,
              decided_at, created_at
         FROM procurement_invoice_variances
        WHERE version_id = $1 AND status <> 'SUPERSEDED'
        ORDER BY created_at DESC
        LIMIT 1`,
      [versionId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      approvedAmountKobo: Number(row.approved_amount_kobo),
      invoiceAmountKobo: Number(row.invoice_amount_kobo),
      differenceKobo: Number(row.invoice_amount_kobo) - Number(row.approved_amount_kobo),
      invoiceNumber: row.invoice_number,
      status: row.status,
      reason: row.reason,
      decidedByName: row.decided_by_name,
      decidedAt: row.decided_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    };
  }

  private async notifyPermissionHolders(
    tx: TxScope,
    permission: PermissionKey,
    current: LoadedRow,
    type: string,
    extra: { summary?: string; reason?: string; tag?: string | null },
  ): Promise<void> {
    const holders = await tx.client.query<{ user_id: string }>(
      `SELECT user_id FROM app.users_holding_permission($1, $2::uuid, 'ALL')`,
      [permission, current.entity_id],
    );
    for (const holder of holders.rows) {
      await this.notifyUser(tx, holder.user_id, current, type, extra);
    }
  }

  private async notifyUser(
    tx: TxScope,
    userId: string,
    current: LoadedRow,
    type: string,
    extra: { summary?: string; reason?: string; tag?: string | null },
  ): Promise<void> {
    // The tag keeps each new invoice or variance its own notification; repeats of the same one are deduplicated.
    const href = extra.tag ? `/procurement/${current.id}?invoice=${extra.tag}` : `/procurement/${current.id}`;
    await tx.publish({
      eventType: type,
      subjectType: 'PROCUREMENT',
      subjectId: current.id,
      entityId: current.entity_id,
      payload: {
        type,
        reference: current.reference_number,
        title: current.title,
        summary: extra.summary ?? '',
        reason: extra.reason ?? '',
        recipientUserId: userId,
        href,
      },
    });
  }

  async attachQuotation(
    actor: ActorContext,
    id: string,
    documentId: string,
    input: QuotationMetaInput,
  ): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.loadRow(tx, id);
      this.assertOriginatorDraft(actor, current, 'procurement.edit_draft');
      await this.vendors.assertSelectableInTx(tx, actor, input.vendorId, 'quotation');
      const duplicate = await tx.client.query<{ id: string }>(
        `SELECT id FROM procurement_quotations WHERE version_id = $1 AND vendor_id = $2`,
        [current.version_id, input.vendorId],
      );
      if (duplicate.rows[0]) {
        throw new ConflictError(
          'This vendor already has a quotation in the comparison. Remove it first to replace it.',
        );
      }
      const lines = await this.loadLines(tx, current.version_id, id);
      if (lines.length === 0 || lines.some((line) => !line.quantity || line.quantity <= 0)) {
        throw new ValidationFailedError('Add a quantity for every item before recording a quotation.');
      }
      const priced = this.quotationLineAmounts(lines, input.lines);
      const amountKobo = Number(priced.reduce((sum, line) => sum + BigInt(line.lineAmountKobo), 0n));
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO procurement_quotations (
           request_id, version_id, entity_id, document_id, vendor_id, unit_price_kobo, amount_kobo, notes, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $8)
         RETURNING id`,
        [
          id,
          current.version_id,
          current.entity_id,
          documentId,
          input.vendorId,
          amountKobo,
          input.notes?.trim() || null,
          actor.ref,
        ],
      );
      const quotationId = inserted.rows[0]?.id;
      if (!quotationId) throw new Error('The quotation was not recorded.');
      for (const line of priced) {
        await tx.client.query(
          `INSERT INTO procurement_quotation_lines (
             quotation_id, entity_id, line_number, unit_price_kobo, line_amount_kobo, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
          [quotationId, current.entity_id, line.lineNumber, line.unitPriceKobo, line.lineAmountKobo, actor.ref],
        );
      }
      await tx.audit({
        action: 'upload',
        subjectType: 'procurement_quotation',
        subjectId: id,
        subjectLabel: current.title,
        subjectReferenceNumber: current.reference_number,
        entityId: current.entity_id,
        newValue: { vendorId: input.vendorId, amountKobo, lines: priced },
      });
      return this.toView(tx, await this.loadRow(tx, id));
    });
  }

  async removeQuotation(actor: ActorContext, id: string, quotationId: string): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.loadRow(tx, id);
      this.assertOriginatorDraft(actor, current, 'procurement.edit_draft');
      const removed = await tx.client.query<{ vendor_id: string | null; amount_kobo: string | null }>(
        `DELETE FROM procurement_quotations
          WHERE id = $1 AND version_id = $2
        RETURNING vendor_id, amount_kobo::text`,
        [quotationId, current.version_id],
      );
      const row = removed.rows[0];
      if (!row) throw new NotFoundError('That quotation was not found on this draft.');
      if (row.vendor_id && current.requisition_id && row.vendor_id === current.vendor_id) {
        await this.writeVendorSelection(tx, actor, current, null, null);
      }
      await tx.audit({
        action: 'edit',
        subjectType: 'procurement_quotation',
        subjectId: id,
        subjectLabel: current.title,
        subjectReferenceNumber: current.reference_number,
        entityId: current.entity_id,
        oldValue: { vendorId: row.vendor_id, amountKobo: row.amount_kobo === null ? null : Number(row.amount_kobo) },
        newValue: { removed: true },
      });
      return this.toView(tx, await this.loadRow(tx, id));
    });
  }

  /**
   * Awards the proposal to one of the quoted vendors. Choosing a vendor that is
   * not the lowest price needs a written justification, which the memo shows.
   */
  async selectQuotedVendor(
    actor: ActorContext,
    id: string,
    input: SelectQuotedVendorInput,
  ): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.loadRow(tx, id);
      this.assertOriginatorDraft(actor, current, 'procurement.edit_draft');
      if (current.row_version !== input.rowVersion) {
        throw new StaleRecordError('This request has changed. Refresh and try again.', {
          rowVersion: current.row_version,
        });
      }
      const quotes = await this.loadQuotations(tx, current.version_id);
      const quoted = quotes.find((quote) => quote.vendorId === input.vendorId && quote.amountKobo !== null);
      if (!quoted) {
        throw new ValidationFailedError('Choose a vendor that has a priced quotation in the comparison.');
      }
      await this.vendors.assertSelectableInTx(tx, actor, input.vendorId, 'quotation-award');
      const justification = input.justification?.trim() || null;
      if (!quoted.isLowest && !justification) {
        throw new ValidationFailedError(
          'This vendor is not the lowest price. Explain why it should be awarded the order.',
          { fieldErrors: { justification: ['A justification is required when the lowest price is not chosen.'] } },
        );
      }
      await this.writeVendorSelection(tx, actor, current, input.vendorId, quoted.isLowest ? null : justification);
      return this.toView(tx, await this.loadRow(tx, id));
    });
  }

  private async writeVendorSelection(
    tx: TxScope,
    actor: ActorContext,
    current: LoadedRow,
    vendorId: string | null,
    justification: string | null,
  ): Promise<void> {
    await tx.client.query(
      `UPDATE procurement_requests
          SET vendor_id = $1, prepared_by_user_id = coalesce(prepared_by_user_id, $2::uuid), updated_by = $2
        WHERE id = $3`,
      [vendorId, actor.ref, current.id],
    );
    await tx.client.query(
      `UPDATE procurement_versions
          SET vendor_id = $1, selection_justification = $2, updated_by = $3
        WHERE id = $4`,
      [vendorId, justification, actor.ref, current.version_id],
    );
    await tx.audit({
      action: 'edit',
      subjectType: 'procurement_request',
      subjectId: current.id,
      subjectLabel: current.title,
      subjectReferenceNumber: current.reference_number,
      entityId: current.entity_id,
      oldValue: { vendorId: current.vendor_id, selectionJustification: current.selection_justification },
      newValue: { vendorId, selectionJustification: justification },
    });
  }

  async submit(actor: ActorContext, id: string, input: SubmitProcurementInput): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      await tx.client.query(`SELECT id FROM procurement_requests WHERE id = $1 FOR UPDATE`, [id]);
      const current = await this.loadRow(tx, id);
      const openProposal = current.status === 'DRAFT' || current.status === 'AWAITING_PREPARATION';
      if (!openProposal) {
        if (input.idempotencyKey && current.submit_idempotency_key === input.idempotencyKey) {
          return this.toView(tx, current);
        }
        throw new ConflictError('This request has already been submitted.');
      }
      this.assertOriginatorDraft(actor, current, 'procurement.submit');
      if (current.row_version !== input.rowVersion) {
        throw new StaleRecordError('This request has changed. Refresh and try again.', {
          rowVersion: current.row_version,
        });
      }
      const lines = await this.loadLines(tx, current.version_id, current.id);
      this.assertReadyToSubmit(current, lines);
      const quotes = await this.loadQuotations(tx, current.version_id);
      if (current.requisition_id) this.assertQuotationComparison(current, quotes, lines);
      if (!current.vendor_id) throw new ValidationFailedError('A vendor is required.');
      await this.vendors.assertSelectableInTx(tx, actor, current.vendor_id, 'submit');
      // Requisition proposals are priced from quotations; their invoice is requested at ED Finance.
      const invoiceRequired = !current.requisition_id && lines.some((line) => line.invoice_required);
      if (invoiceRequired && !current.invoice_id) {
        throw new ValidationFailedError('This category requires an invoice before submission.');
      }
      if (current.required_date) this.assertRequiredDate(dateOnly(current.required_date) ?? '');
      const budgetIds = [...new Set(lines.map((line) => line.budget_line_id).filter((id): id is string => Boolean(id)))];
      for (const budgetId of budgetIds) {
        await this.assertBudgetLine(tx, budgetId, current.entity_id);
      }

      const summed = this.sumLineAmounts(lines);
      const total = summed ?? 0;
      const available = await this.budgetAvailable(tx, lines[0]?.budget_line_id ?? current.budget_line_id);
      const snapshot = this.buildSnapshot(current, total, available, lines, quotes);

      await tx.client.query(
        `UPDATE procurement_versions
            SET total_amount_kobo = $1, submitted_at = now(), submit_idempotency_key = coalesce($2, submit_idempotency_key), updated_by = $3
          WHERE id = $4`,
        [summed, input.idempotencyKey ?? `submit:${id}:${current.current_version}`, actor.ref, current.version_id],
      );
      await tx.client.query(
        `UPDATE procurement_requests
            SET vendor_id = $1, prepared_by_user_id = coalesce(prepared_by_user_id, $2::uuid), updated_by = $2
          WHERE id = $3`,
        [current.vendor_id, actor.ref, id],
      );

      const pdf = await renderProcurementMemoPdf(snapshot);
      const stored = await this.documents.storeGeneratedPdfInTx(tx, actor, {
        title: `Memo ${current.reference_number}`,
        entityId: current.entity_id,
        ownerType: 'procurement_request',
        ownerId: id,
        buffer: pdf,
        filename: `${current.reference_number}-memo.pdf`,
      });

      await tx.client.query(
        `INSERT INTO procurement_memo_snapshots (
           request_id, version_id, entity_id, memo_template_version, canonical_json, memo_snapshot_hash,
           pdf_document_id, pdf_hash, budget_available_kobo, created_by
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
        [
          id,
          current.version_id,
          current.entity_id,
          MEMO_TEMPLATE_VERSION,
          JSON.stringify(snapshot),
          snapshotHash(snapshot),
          stored.documentId,
          stored.sha256,
          available,
          actor.ref,
        ],
      );

      if (current.invoice_number && current.vendor_id) {
        await tx.client.query(
          `INSERT INTO vendor_invoice_claims (vendor_id, entity_id, invoice_number, procurement_ref, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [current.vendor_id, current.entity_id, current.invoice_number, current.reference_number, actor.ref],
        );
      }

      const opsFlag = await this.categoryIsMachinery(tx, lines, current);
      if (current.requisition_id) {
        await this.workflows.prepareProposalInTx(tx, actor, {
          requestId: id,
          snapshot,
          operationsMachinery: opsFlag,
        });
      } else {
        await tx.client.query(
          `UPDATE procurement_requests SET status = 'AWAITING_OPERATIONS', updated_by = $1 WHERE id = $2`,
          [actor.ref, id],
        );
        await this.workflows.startProcurementInTx(tx, actor, { requestId: id, snapshot });
      }
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: id,
        text: current.requisition_id ? 'Procurement Manager submitted proposal' : 'GM submitted request',
        href: `/procurement/${id}`,
        entityId: current.entity_id,
      });
      await tx.audit({
        action: 'create',
        subjectType: 'procurement_memo_snapshot',
        subjectId: id,
        subjectLabel: current.title,
        subjectReferenceNumber: current.reference_number,
        entityId: current.entity_id,
        newValue: { hash: stored.sha256, status: 'AWAITING_OPERATIONS' },
      });
      const after = await this.loadRow(tx, id);
      await this.indexRequest(tx, after);
      return this.toView(tx, after);
    });
  }

  async discard(actor: ActorContext, id: string, input: DiscardProcurementInput): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.loadRow(tx, id);
      this.assertOriginatorDraft(actor, current, 'procurement.discard_draft');
      if (current.current_version > 1 || current.workflow_instance_id) {
        throw new ConflictError('A request that has entered review cannot be discarded.');
      }
      if (current.row_version !== input.rowVersion) {
        throw new StaleRecordError('This request has changed. Refresh and try again.', {
          rowVersion: current.row_version,
        });
      }
      await tx.client.query(
        `UPDATE procurement_requests SET status = 'DISCARDED', updated_by = $1 WHERE id = $2`,
        [actor.ref, id],
      );
      await tx.audit({
        action: 'archive',
        subjectType: 'procurement_request',
        subjectId: id,
        subjectLabel: current.title,
        subjectReferenceNumber: current.reference_number,
        entityId: current.entity_id,
        oldValue: { status: 'DRAFT' },
        newValue: { status: 'DISCARDED' },
      });
      return this.toView(tx, await this.loadRow(tx, id));
    });
  }

  async act(actor: ActorContext, id: string, input: ProcurementActionInput): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.loadRow(tx, id);
      if (!can(actor, 'procurement.view', current.entity_id) && !can(actor, 'procurement.create', current.entity_id)) {
        throw new ForbiddenError('You cannot act on this procurement request.');
      }
      if (!current.workflow_instance_id) {
        throw new ConflictError('This request is not in review.');
      }
      const stage = await tx.client.query<{ key: string | null }>(
        `SELECT s.key
           FROM workflow_instances i
           LEFT JOIN workflow_stages s ON s.id = i.current_stage_id
          WHERE i.id = $1`,
        [current.workflow_instance_id],
      );
      const stageKey = stage.rows[0]?.key ?? null;
      if (input.finalPaymentTiming && (input.action !== 'APPROVE' || stageKey !== 'md')) {
        throw new ValidationFailedError('Payment timing can only be set at Managing Director approval.');
      }
      if (input.action === 'APPROVE' && stageKey === 'md') {
        await this.applyMdPaymentTiming(tx, actor, current, input.finalPaymentTiming);
        await this.applyMdApprovedQuotationPrices(tx, actor, current);
      }
      if (input.action === 'APPROVE' && stageKey === 'ed-finance') {
        if (current.timing_change_pending_ack && !input.timingAcknowledged) {
          throw new ValidationFailedError(
            'ED Finance must acknowledge the updated payment-timing decision.',
          );
        }
        await this.recordFinanceDecision(tx, actor, current, input);
        if (current.timing_change_pending_ack) {
          await this.clearTimingPendingAck(tx, actor, current);
        }
      }
      await this.workflows.actInTx(tx, actor, {
        instanceId: current.workflow_instance_id,
        action: input.action,
        reason: input.reason,
        rowVersion: input.rowVersion,
        idempotencyKey: input.idempotencyKey,
        fundingRoute: input.fundingRoute,
        sourceAccountId: input.sourceAccountId,
        destinationAccountId: input.destinationAccountId,
      });
      if (input.action === 'RETURN_FOR_CORRECTION') {
        await this.clearFinalPaymentTiming(tx, actor, current.id);
      }
      const after = await this.loadRow(tx, id);
      if (input.action === 'APPROVE' && stageKey === 'md' && after.status === 'AWAITING_ED_FINANCE') {
        await this.requestFinanceInvoice(tx, actor, after);
      }
      return this.toView(tx, after, actor);
    });
  }

  async clone(actor: ActorContext, id: string, _input: CloneProcurementInput = {}): Promise<ProcurementView> {
    if (!can(actor, 'procurement.prepare') && !can(actor, 'procurement.create')) {
      throw new ForbiddenError('You cannot clone a procurement request.');
    }
    return this.unitOfWork.write(actor, async (tx) => {
      const source = await this.loadRow(tx, id);
      if (
        !can(actor, 'procurement.prepare', source.entity_id) &&
        !can(actor, 'procurement.create', source.entity_id)
      ) {
        throw new ForbiddenError('You cannot clone this procurement request.');
      }
      if (source.status !== 'REJECTED') {
        throw new ConflictError('Only a rejected request can be cloned as a new draft.');
      }
      const allocated = await tx.client.query<{ ref: string }>(
        'SELECT app.next_reference($1, NULL) AS ref',
        ['PR'],
      );
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The procurement reference was not allocated.');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO procurement_requests (
           reference_number, entity_id, department_id, originator_user_id, vendor_id,
           current_version, status, cloned_from_request_id, proposed_payment_timing,
           created_by, updated_by
         ) VALUES ($1, $2, $3, $4::uuid, $5, 1, 'DRAFT', $6, $7, $4, $4)
         RETURNING id`,
        [
          reference,
          source.entity_id,
          source.department_id,
          actor.ref,
          source.vendor_id,
          source.id,
          source.proposed_payment_timing,
        ],
      );
      const cloneId = inserted.rows[0]?.id;
      if (!cloneId) throw new Error('The cloned request was not created.');
      const version = await tx.client.query<{ id: string }>(
        `INSERT INTO procurement_versions (
           request_id, entity_id, version_number, title, subject, category_id, reason, description,
           quantity, unit_id, unit_price_kobo, total_amount_kobo, required_date, vendor_id,
           delivery_location, funding_source_id, budget_line_id, project_id, urgency,
           additional_instructions, created_by, updated_by
         ) VALUES (
           $1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $20
         ) RETURNING id`,
        [
          cloneId,
          source.entity_id,
          source.title,
          source.subject,
          source.category_id,
          source.reason,
          source.description,
          source.quantity,
          source.unit_id,
          source.unit_price_kobo == null ? null : Number(source.unit_price_kobo),
          source.total_amount_kobo == null ? null : Number(source.total_amount_kobo),
          dateOnly(source.required_date),
          source.vendor_id,
          source.delivery_location,
          source.funding_source_id,
          source.budget_line_id,
          source.project_id,
          source.urgency,
          source.additional_instructions,
          actor.ref,
        ],
      );
      const versionId = version.rows[0]?.id;
      if (versionId) {
        await this.copyLines(tx, source.version_id, versionId, actor.ref);
      }
      if (versionId && source.invoice_id && source.invoice_document_id && source.invoice_number) {
        await tx.client.query(
          `INSERT INTO procurement_invoices (
             request_id, version_id, entity_id, document_id, invoice_number, invoice_date,
             amount_kobo, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
          [
            cloneId,
            versionId,
            source.entity_id,
            source.invoice_document_id,
            source.invoice_number,
            dateOnly(source.invoice_date),
            Number(source.invoice_amount_kobo ?? 0),
            actor.ref,
          ],
        );
      }
      await tx.audit({
        action: 'create',
        subjectType: 'procurement_request',
        subjectId: cloneId,
        subjectLabel: source.title,
        subjectReferenceNumber: reference,
        entityId: source.entity_id,
        newValue: { clonedFrom: source.reference_number, status: 'DRAFT' },
      });
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: cloneId,
        text: `Cloned from rejected request ${source.reference_number}.`,
        href: `/procurement/${cloneId}`,
        entityId: source.entity_id,
      });
      await this.indexRequest(tx, await this.loadRow(tx, cloneId));
      return this.toView(tx, await this.loadRow(tx, cloneId));
    });
  }

  async changePaymentTiming(
    actor: ActorContext,
    id: string,
    input: ChangePaymentTimingInput,
  ): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      await tx.client.query(`SELECT id FROM procurement_requests WHERE id = $1 FOR UPDATE`, [id]);
      const current = await this.loadRow(tx, id);
      assertCan(actor, 'procurement.approve.final', current.entity_id);
      if (current.row_version !== input.rowVersion) {
        throw new StaleRecordError('This request has changed. Refresh and try again.', {
          rowVersion: current.row_version,
        });
      }
      const existingFinal = asPaymentTiming(current.final_payment_timing);
      if (!existingFinal) {
        throw new ConflictError('Payment timing is set when the MD approves.');
      }
      if (current.status === 'AWAITING_MD') {
        throw new ConflictError('Set payment timing when approving this request.');
      }
      if (['COMPLETED', 'REJECTED', 'ARCHIVED', 'DISCARDED'].includes(current.status)) {
        throw new ConflictError('Payment timing cannot be changed on a closed request.');
      }
      if (await this.hasRecordedPayment(tx, current.id)) {
        throw new ConflictError('Payment timing cannot change after a payment has been recorded.');
      }
      if (input.timing === existingFinal) {
        throw new ValidationFailedError('Choose a different payment timing.');
      }
      const pendingAck = financeReviewHasStarted(current.status);
      await this.writeFinalPaymentTiming(tx, actor, current.id, input.timing, pendingAck);
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: current.id,
        text: `MD changed payment timing from ${PAYMENT_TIMING_LABELS[existingFinal]} to ${PAYMENT_TIMING_LABELS[input.timing]}.${
          pendingAck ? ' Awaiting ED Finance acknowledgement.' : ''
        }`,
        href: `/procurement/${current.id}`,
        entityId: current.entity_id,
      });
      await tx.audit({
        action: 'edit',
        subjectType: 'procurement_request',
        subjectId: current.id,
        subjectLabel: current.title,
        subjectReferenceNumber: current.reference_number,
        entityId: current.entity_id,
        reason: input.reason.trim(),
        oldValue: { finalPaymentTiming: existingFinal },
        newValue: { finalPaymentTiming: input.timing, timingChangePendingAck: pendingAck },
      });
      return this.toView(tx, await this.loadRow(tx, id), actor);
    });
  }

  async acknowledgePaymentTiming(
    actor: ActorContext,
    id: string,
    input: AcknowledgePaymentTimingInput,
  ): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      await tx.client.query(`SELECT id FROM procurement_requests WHERE id = $1 FOR UPDATE`, [id]);
      const current = await this.loadRow(tx, id);
      assertCan(actor, 'procurement.review.finance', current.entity_id);
      if (current.row_version !== input.rowVersion) {
        throw new StaleRecordError('This request has changed. Refresh and try again.', {
          rowVersion: current.row_version,
        });
      }
      if (!current.timing_change_pending_ack) {
        throw new ConflictError('There is no payment-timing change waiting for acknowledgement.');
      }
      await this.clearTimingPendingAck(tx, actor, current);
      return this.toView(tx, await this.loadRow(tx, id), actor);
    });
  }

  private async recordFinanceDecision(
    tx: TxScope,
    actor: ActorContext,
    current: LoadedRow,
    input: ProcurementActionInput,
  ): Promise<void> {
    if (!can(actor, 'procurement.review.finance', current.entity_id)) {
      throw new ForbiddenError('You cannot complete the finance review.');
    }
    const authorized = await this.assertFinanceInvoiceReady(tx, current);
    if (!input.checklistAcknowledged) {
      throw new ValidationFailedError('ED Finance must acknowledge the financial checklist.');
    }
    if (!input.fundingRoute || !isFundingRoute(input.fundingRoute)) {
      throw new ValidationFailedError('A funding route is required.');
    }
    const checks = await this.checks.evaluateInTx(tx, current.id);
    const failed = checks.filter((check) => check.result === 'FAIL');
    if (failed.length > 0 && !input.overrideReason?.trim()) {
      throw new ValidationFailedError('Approving over a FAIL requires an override reason.');
    }
    await tx.client.query(
      `INSERT INTO procurement_financial_reviews (
         request_id, version_id, entity_id, checks, checklist_acknowledged, override_reason,
         funding_route, source_account_id, destination_account_id, authorized_amount_kobo, created_by
       ) VALUES ($1, $2, $3, $4::jsonb, true, $5, $6, $7, $8, $9, $10)`,
      [
        current.id,
        current.version_id,
        current.entity_id,
        JSON.stringify(checks),
        input.overrideReason?.trim() || null,
        input.fundingRoute,
        input.sourceAccountId ?? null,
        input.destinationAccountId ?? null,
        authorized,
        actor.ref,
      ],
    );
    await tx.client.query(
      `UPDATE procurement_requests
          SET funding_route = $1,
              authorized_amount_kobo = $2,
              paying_account_id = $3,
              destination_account_id = $4,
              updated_by = $5
        WHERE id = $6`,
      [
        input.fundingRoute,
        authorized,
        input.fundingRoute === 'corporate_allocation'
          ? (input.destinationAccountId ?? null)
          : (input.sourceAccountId ?? null),
        input.destinationAccountId ?? null,
        actor.ref,
        current.id,
      ],
    );
    const stockLines = (await this.loadLines(tx, current.version_id, current.id)).filter(
      (line) => line.stock_item || line.asset,
    );
    for (const line of stockLines) {
      await this.inventory?.applyExpectedInTx(tx, actor, {
        requestId: current.id,
        lineId: line.id,
        entityId: current.entity_id,
      });
      await tx.publish({
        eventType: 'inventory.expected_stock.requested',
        subjectType: 'PROCUREMENT',
        subjectId: current.id,
        entityId: current.entity_id,
        payload: {
          type: 'inventory.expected_stock.requested',
          reference: current.reference_number,
          title: current.title,
          href: `/procurement/${current.id}`,
          lineId: line.id,
          lineNumber: line.line_number,
        },
      });
    }
  }

  async comments(actor: ActorContext, id: string): Promise<ProcurementCommentView[]> {
    const view = await this.get(actor, id);
    return view.comments;
  }

  async addComment(actor: ActorContext, id: string, input: CommentInput): Promise<ProcurementView> {
    this.assertReader(actor);
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.loadRow(tx, id);
      if (!can(actor, 'procurement.view', current.entity_id) && !can(actor, 'procurement.create', current.entity_id)) {
        throw new ForbiddenError('You cannot comment on this request.');
      }
      await tx.client.query(
        `INSERT INTO procurement_comments (request_id, entity_id, body, created_by)
         VALUES ($1, $2, $3, $4)`,
        [id, current.entity_id, input.body.trim(), actor.ref],
      );
      return this.toView(tx, await this.loadRow(tx, id));
    });
  }

  async memoHtml(actor: ActorContext, id: string): Promise<{ html: string }> {
    const view = await this.get(actor, id);
    await this.unitOfWork.write(actor, async (tx) => {
      const row = await this.loadRow(tx, id);
      await tx.audit({
        action: 'document_access',
        subjectType: 'procurement_memo',
        subjectId: id,
        subjectLabel: row.title,
        subjectReferenceNumber: row.reference_number,
        entityId: row.entity_id,
        newValue: { preview: true },
      });
    });
    const snapshot = await this.snapshotFor(actor, id, view);
    const stamps = await this.liveMemoStamps(actor, id, snapshot, view);
    return { html: renderProcurementMemoHtml(snapshot, stamps) };
  }

  async memoPdf(actor: ActorContext, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const view = await this.get(actor, id);
    const snapshot = await this.snapshotFor(actor, id, view);
    const stamps = await this.liveMemoStamps(actor, id, snapshot, view);
    const buffer = await renderProcurementMemoPdf(snapshot, stamps);
    return { buffer, filename: `${view.referenceNumber}-memo.pdf` };
  }

  private async liveMemoStamps(
    actor: ActorContext,
    id: string,
    snapshot: ProcurementMemoSnapshot,
    view: ProcurementView,
  ): Promise<MemoStamp[]> {
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        action: string;
        approver_name: string | null;
        approver_role: string | null;
        occurred_at: Date;
      }>(
        `SELECT s.action, app.user_public_name(s.approver_id) AS approver_name,
                s.approver_role, s.occurred_at
           FROM seals s
          WHERE s.subject_type = 'PROCUREMENT' AND s.subject_id = $1
          ORDER BY s.occurred_at`,
        [id],
      );
      return memoStamps({
        originatorName: snapshot.originatorName,
        originatorPosition: snapshot.originatorPosition,
        templateVersion: snapshot.templateVersion,
        includeOperations: Boolean(view.operationsMachinery),
        seals: result.rows.flatMap((row) =>
          isSealAction(row.action)
            ? [
                {
                  action: row.action,
                  approverName: row.approver_name ?? snapshot.originatorName,
                  approverRole: row.approver_role,
                  approverRoleLabel:
                    row.approver_role && isRoleKey(row.approver_role)
                      ? ROLES[row.approver_role].name
                      : null,
                  occurredAt: row.occurred_at.toISOString(),
                },
              ]
            : [],
        ),
        financeReviewerName: view.financialReview?.createdByName ?? null,
        financeReviewerRole: view.financialReview ? ROLES.ed_finance.name : null,
      });
    });
  }

  private async snapshotFor(
    actor: ActorContext,
    id: string,
    view: ProcurementView,
  ): Promise<ProcurementMemoSnapshot> {
    return this.unitOfWork.read(actor, async (tx) => {
      const frozen = await tx.client.query<{ canonical_json: ProcurementMemoSnapshot }>(
        `SELECT canonical_json FROM procurement_memo_snapshots s
           JOIN procurement_versions v ON v.id = s.version_id
           JOIN procurement_requests r ON r.id = v.request_id
          WHERE r.id = $1 AND v.version_number = r.current_version`,
        [id],
      );
      if (frozen.rows[0]) return frozen.rows[0].canonical_json;
      const row = await this.loadRow(tx, id);
      const lines = await this.loadLines(tx, row.version_id, row.id);
      const total = this.sumLineAmounts(lines) ?? 0;
      const available = await this.budgetAvailable(tx, lines[0]?.budget_line_id ?? row.budget_line_id);
      void view;
      const quotes = await this.loadQuotations(tx, row.version_id);
      return this.buildSnapshot(row, total, available, lines, quotes);
    });
  }

  private buildSnapshot(
    row: LoadedRow,
    total: number,
    available: number,
    lines: LoadedLine[] = [],
    quotes: ProcurementQuotationView[] = [],
  ): ProcurementMemoSnapshot {
    const contact = firstContact(row.vendor_contacts);
    const first = lines[0];
    const memoLines: ProcurementMemoLine[] = lines.map((line) => ({
      lineNumber: line.line_number,
      description: line.description || line.category_name || row.title,
      categoryName: line.category_name ?? '',
      quantity: line.quantity ?? 0,
      unitCode: line.unit_code ?? '',
      unitName: line.unit_name ?? '',
      unitPriceKobo: Number(line.unit_price_kobo ?? 0),
      lineAmountKobo: Number(line.line_amount_kobo ?? 0),
      budgetLineCode: line.budget_line_code ?? '',
      budgetLineName: line.budget_line_name ?? '',
    }));
    return {
      templateVersion: MEMO_TEMPLATE_VERSION,
      referenceNumber: row.reference_number,
      title: row.title,
      subject: row.subject ?? row.title,
      memoDate: new Date().toISOString(),
      originatorName: row.originator_name ?? 'General Manager',
      originatorPosition: row.originator_position ?? 'General Manager',
      entityCode: row.entity_code ?? '',
      entityName: row.entity_name ?? '',
      departmentName: row.department_name ?? '',
      categoryName: first?.category_name ?? row.category_name ?? '',
      reason: row.reason ?? '',
      description: row.description ?? '',
      quantity: first?.quantity ?? row.quantity ?? 0,
      unitCode: first?.unit_code ?? row.unit_code ?? '',
      unitName: first?.unit_name ?? row.unit_name ?? '',
      unitPriceKobo: Number(first?.unit_price_kobo ?? row.unit_price_kobo ?? 0),
      totalAmountKobo: total,
      amountInWords: amountInWords(BigInt(total)),
      requiredDate: dateOnly(row.required_date) ?? new Date().toISOString().slice(0, 10),
      vendor: {
        id: row.vendor_id ?? '',
        name: row.vendor_name ?? '',
        cac: row.vendor_cac ?? '',
        contactName: contact?.name ?? null,
        contactPhone: contact?.phone ?? null,
        contactEmail: contact?.email ?? null,
      },
      deliveryLocation: row.delivery_location ?? '',
      fundingSource: row.funding_source_label ?? '',
      budgetLineCode: first?.budget_line_code ?? row.budget_line_code ?? '',
      budgetLineName: first?.budget_line_name ?? row.budget_line_name ?? '',
      budgetApprovedKobo: Number(first?.budget_approved_kobo ?? row.budget_approved_kobo ?? 0),
      budgetAvailableKobo: available,
      projectCode: row.project_code,
      projectName: row.project_name,
      urgency: row.urgency,
      additionalInstructions: row.additional_instructions,
      proposedPaymentTiming: asPaymentTiming(row.proposed_payment_timing),
      invoices:
        row.invoice_id && row.invoice_number
          ? [
              {
                documentId: row.invoice_document_id ?? '',
                documentReference: row.invoice_document_ref ?? '',
                invoiceNumber: row.invoice_number,
                invoiceDate: dateOnly(row.invoice_date) ?? '',
                amountKobo: Number(row.invoice_amount_kobo ?? 0),
                sha256: row.invoice_sha256 ?? '',
              },
            ]
          : [],
      version: row.current_version,
      lines: memoLines,
      quotationComparison: row.requisition_id ? this.memoComparison(row, quotes) : null,
    };
  }

  private memoComparison(row: LoadedRow, quotes: ProcurementQuotationView[]): ProcurementMemoComparison | null {
    const priced = quotes.filter(
      (quote): quote is ProcurementQuotationView & { vendorId: string; amountKobo: number } =>
        quote.vendorId !== null && quote.amountKobo !== null,
    );
    if (priced.length === 0) return null;
    const { lowestAmountKobo } = recommendLowestQuote(priced);
    return {
      quotations: priced.map((quote) => ({
        vendorId: quote.vendorId,
        vendorName: quote.vendorName ?? '',
        vendorReference: quote.vendorReference ?? '',
        amountKobo: quote.amountKobo,
        unitPriceKobo: quote.unitPriceKobo,
        lines: quote.lines.map((line) => ({
          lineNumber: line.lineNumber,
          description: line.description,
          quantity: line.quantity,
          unitCode: line.unitCode ?? '',
          unitPriceKobo: line.unitPriceKobo,
          lineAmountKobo: line.lineAmountKobo,
        })),
        recommended: quote.isLowest,
        selected: quote.vendorId === row.vendor_id,
        documentReference: quote.referenceNumber,
      })),
      lowestAmountKobo,
      selectedVendorId: row.vendor_id,
      selectionJustification: row.selection_justification,
    };
  }

  private comparisonView(row: LoadedRow, quotes: ProcurementQuotationView[]): ProcurementQuotationComparisonView {
    const { lowestAmountKobo, recommendedVendorIds } = recommendLowestQuote(quotes);
    const pricedCount = new Set(
      quotes.filter((quote) => this.quoteHasPrices(quote)).map((quote) => quote.vendorId),
    ).size;
    return {
      minimumQuotations: MIN_VENDOR_QUOTATIONS,
      pricedCount,
      lowestAmountKobo,
      recommendedVendorIds,
      selectedVendorId: row.vendor_id,
      selectionIsRecommended: row.vendor_id !== null && recommendedVendorIds.includes(row.vendor_id),
      selectionJustification: row.selection_justification,
    };
  }

  private async toView(tx: TxScope, row: LoadedRow, actor?: ActorContext): Promise<ProcurementView> {
    const quotations = await this.loadQuotations(tx, row.version_id);
    const invoiceVariance = await this.loadInvoiceVariance(tx, row.version_id);
    const comments = await tx.client.query<{
      id: string;
      body: string;
      created_by: string;
      created_by_name: string | null;
      created_at: Date;
    }>(
      `SELECT id, body, created_by, app.user_public_name(
              CASE WHEN created_by ~ '^[0-9a-f-]{36}$' THEN created_by::uuid ELSE NULL END
            ) AS created_by_name, created_at
         FROM procurement_comments WHERE request_id = $1 ORDER BY created_at`,
      [row.id],
    );
    const total = row.total_amount_kobo == null ? null : Number(row.total_amount_kobo);
    const invoiceAmount = row.invoice_amount_kobo == null ? null : Number(row.invoice_amount_kobo);
    const varianceApproved =
      invoiceVariance?.status === 'APPROVED' && invoiceVariance.invoiceAmountKobo === invoiceAmount;
    const mismatch = total != null && invoiceAmount != null && invoiceAmount !== total && !varianceApproved;
    const duplicate =
      row.vendor_id && row.invoice_number
        ? await isInvoiceNumberUsedElsewhere(
            tx.client,
            row.vendor_id,
            row.invoice_number,
            row.status === 'DRAFT' ? row.reference_number : `${row.reference_number}-exclude-self`,
          )
        : false;
    const warnings: string[] = [];
    if (mismatch) warnings.push('Invoice amount does not match the request total.');
    if (duplicate && row.status === 'DRAFT') warnings.push('This invoice number has been used for this vendor before.');
    const lines = await this.loadLines(tx, row.version_id, row.id);
    const first = lines[0];
    const lineViews = this.toLineViews(lines);
    const orderedQty = lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
    const available = await this.budgetAvailable(tx, first?.budget_line_id ?? row.budget_line_id);
    const contact = firstContact(row.vendor_contacts);
    const versions = await this.loadVersionHistory(tx, row.id);
    const lastReturn = [...versions].reverse().find((version) => version.returnReason);
    const related = await this.loadRelatedHistory(tx, row);
    const relatedHistory = related.items;
    const vendorSpendToDateKobo = related.spendKobo;
    const receipts = await this.loadReceipts(tx, row.id);
    const view: ProcurementView = {
      id: row.id,
      referenceNumber: row.reference_number,
      requisitionId: row.requisition_id,
      requisitionReference: row.requisition_reference,
      requisitionStatus: row.requisition_status,
      preparedByUserId: row.prepared_by_user_id,
      preparedByName: row.prepared_by_name,
      operationsMachinery: Boolean(row.operations_machinery),
      priceComparison: row.price_comparison,
      recommendation: row.recommendation,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      entityName: row.entity_name,
      departmentId: row.department_id,
      departmentName: row.department_name,
      originatorUserId: row.originator_user_id,
      originatorName: row.originator_name,
      originatorPosition: row.originator_position,
      vendorId: row.vendor_id,
      vendorName: row.vendor_name,
      vendorCac: row.vendor_cac,
      vendorContactName: contact?.name ?? null,
      vendorContactPhone: contact?.phone ?? null,
      vendorContactEmail: contact?.email ?? null,
      currentVersion: row.current_version,
      status: row.status,
      title: row.title,
      subject: row.subject,
      categoryId: first?.category_id ?? null,
      categoryKey: first?.category_key ?? null,
      categoryName: first?.category_name ?? null,
      invoiceRequired: lines.some((line) => line.invoice_required),
      reason: row.reason,
      description: row.description,
      quantity: first?.quantity ?? null,
      unitId: first?.unit_id ?? null,
      unitCode: first?.unit_code ?? null,
      unitName: first?.unit_name ?? null,
      unitPriceKobo: first?.unit_price_kobo == null ? null : Number(first.unit_price_kobo),
      totalAmountKobo: this.sumLineAmounts(lines) ?? total,
      requiredDate: dateOnly(row.required_date),
      deliveryLocation: row.delivery_location,
      fundingSourceId: row.funding_source_id,
      fundingSourceKey: row.funding_source_key,
      fundingSourceLabel: row.funding_source_label,
      budgetLineId: first?.budget_line_id ?? null,
      budgetLineCode: first?.budget_line_code ?? null,
      budgetLineName: first?.budget_line_name ?? null,
      budgetAvailableKobo: available,
      projectId: row.project_id,
      projectCode: row.project_code,
      projectName: row.project_name,
      urgency: row.urgency,
      additionalInstructions: row.additional_instructions,
      versionId: row.version_id,
      rowVersion: row.row_version,
      createdAt: row.created_at.toISOString(),
      invoice: row.invoice_id
        ? {
            id: row.invoice_id,
            documentId: row.invoice_document_id ?? '',
            documentReference: row.invoice_document_ref,
            invoiceNumber: row.invoice_number ?? '',
            invoiceDate: dateOnly(row.invoice_date) ?? '',
            amountKobo: invoiceAmount ?? 0,
            vendorId: row.invoice_vendor_id,
            vendorName: row.invoice_vendor_name,
          }
        : null,
      invoiceStage: invoiceStageFor(row, invoiceVariance),
      invoiceVariance,
      invoiceAmountMismatch: mismatch,
      duplicateInvoiceNumber: Boolean(duplicate && row.status === 'DRAFT'),
      memoSnapshotHash: row.memo_hash,
      pdfDocumentId: row.pdf_document_id,
      workflowInstanceId: row.workflow_instance_id,
      comments: comments.rows.map((item) => ({
        id: item.id,
        body: item.body,
        createdBy: item.created_by,
        createdByName: item.created_by_name,
        createdAt: item.created_at.toISOString(),
      })),
      warnings,
      versions,
      lastReturnReason: lastReturn?.returnReason ?? null,
      lastReturnAt: lastReturn?.returnedAt ?? null,
      lastReturnedByName: lastReturn?.returnedByName ?? null,
      clonedFromId: row.cloned_from_request_id,
      clonedFromReference: row.cloned_from_reference,
      archivedFrom:
        row.archived_from_status || row.archived_from_stage_key
          ? { status: row.archived_from_status, stageKey: row.archived_from_stage_key }
          : null,
      relatedHistory,
      vendorSpendToDateKobo,
      proposedPaymentTiming: asPaymentTiming(row.proposed_payment_timing),
      finalPaymentTiming: asPaymentTiming(row.final_payment_timing),
      finalPaymentTimingSetAt: row.final_payment_timing_set_at
        ? typeof row.final_payment_timing_set_at === 'string'
          ? row.final_payment_timing_set_at
          : row.final_payment_timing_set_at.toISOString()
        : null,
      finalPaymentTimingSetBy: row.final_payment_timing_set_by,
      timingChangePendingAck: Boolean(row.timing_change_pending_ack),
      fundingRoute: isFundingRoute(row.funding_route ?? '') ? (row.funding_route as FundingRoute) : null,
      authorizedAmountKobo:
        row.authorized_amount_kobo == null ? null : Number(row.authorized_amount_kobo),
      payingAccountId: row.paying_account_id,
      destinationAccountId: row.destination_account_id,
      vendorStatus: row.vendor_status,
      vendorBankName: row.vendor_bank_name,
      vendorAccountName: row.vendor_account_name,
      vendorAccountNumber:
        actor && can(actor, 'vendor.view_bank_details')
          ? row.vendor_account_number
          : row.vendor_account_number
            ? `••••${row.vendor_account_number.slice(-4)}`
            : null,
      financialReview: await this.loadFinancialReview(tx, row.id),
      transfers: await this.loadTransfers(tx, row.id),
      payments: await this.loadPayments(tx, row.id),
      reversals: await this.loadReversals(tx, row.id),
      moneyMoved: await this.moneyHasMoved(tx, row.id),
      paidAmountKobo: 0,
      payableAmountKobo: 0,
      deliveryComplete: false,
      paymentComplete: false,
      receipts,
      deliveries: await this.loadDeliveries(tx, row.id, receipts, lineViews),
      deliveryNotes: await this.loadDeliveryNotes(tx, row.id),
      closeShort: await this.loadCloseShort(tx, row.id),
      quotations,
      quotationComparison: this.comparisonView(row, quotations),
      lines: lineViews,
      acceptedQuantityTotal: row.accepted_quantity_total ?? 0,
      outstandingQuantity: Math.max(orderedQty - (row.accepted_quantity_total ?? 0), 0),
      requiredDeliveryDocumentSet: [
        ...new Set(lines.flatMap((line) => line.required_delivery_document_set ?? [])),
      ],
      nextAction: null,
      progress: [],
      documents: await this.loadProcurementDocuments(tx, row.id),
    };
    const paidAmountKobo = view.payments
      .filter((payment) => !payment.reversedAt && payment.status === 'COMPLETED')
      .reduce((sum, payment) => sum + payment.amountKobo, 0);
    const acceptedValueKobo = lineViews.reduce(
      (sum, line) => sum + line.acceptedQuantity * line.unitPriceKobo,
      0,
    );
    const eligibility = eligibilityFromParts({
      authorizedKobo: view.authorizedAmountKobo ?? 0,
      paidKobo: paidAmountKobo,
      acceptedValueKobo,
      anyOutstanding: view.outstandingQuantity > 0,
      timing: view.finalPaymentTiming,
      fundingRoute: view.fundingRoute,
      funded: view.transfers.length > 0,
      closeShortApproved: view.closeShort?.status === 'APPROVED',
    });
    view.paidAmountKobo = eligibility.paidKobo;
    view.payableAmountKobo = eligibility.payableKobo;
    view.deliveryComplete = eligibility.deliveryComplete;
    view.paymentComplete = eligibility.paymentComplete;
    view.nextAction = procurementNextAction({
      status: view.status,
      requisitionId: view.requisitionId,
      returned: view.status === 'DRAFT' && Boolean(view.lastReturnReason),
      finalPaymentTiming: view.finalPaymentTiming,
      fundingRoute: view.fundingRoute,
      invoiceStage: view.invoiceStage,
      deliveryComplete: view.deliveryComplete,
      paymentComplete: view.paymentComplete,
    });
    view.progress = buildProgress(view, await this.loadProgressActions(tx, row.id));
    return view;
  }

  private async loadProgressActions(tx: TxScope, requestId: string): Promise<ProgressAction[]> {
    const result = await tx.client.query<{
      stage_key: string;
      action: string;
      actor_name: string | null;
      occurred_at: Date;
      subject_version: number;
    }>(
      `SELECT s.key AS stage_key, a.action, app.user_public_name(a.actor_id) AS actor_name,
              a.occurred_at, a.subject_version
         FROM workflow_actions a
         JOIN workflow_stages s ON s.id = a.stage_id
         JOIN workflow_instances i ON i.id = a.instance_id
        WHERE i.subject_type = 'PROCUREMENT' AND i.subject_id = $1
        ORDER BY a.occurred_at`,
      [requestId],
    );
    return result.rows.map((row) => ({
      stageKey: row.stage_key,
      action: row.action,
      actorName: row.actor_name,
      occurredAt: row.occurred_at.toISOString(),
      subjectVersion: row.subject_version,
    }));
  }

  private async loadFinancialReview(tx: TxScope, requestId: string): Promise<FinancialReviewView | null> {
    const result = await tx.client.query<{
      id: string;
      checks: FinancialReviewView['checks'];
      checklist_acknowledged: boolean;
      override_reason: string | null;
      funding_route: FundingRoute;
      source_account_id: string | null;
      destination_account_id: string | null;
      authorized_amount_kobo: string;
      created_at: Date;
      created_by_name: string | null;
    }>(
      `SELECT id, checks, checklist_acknowledged, override_reason, funding_route,
              source_account_id, destination_account_id, authorized_amount_kobo::text, created_at,
              app.user_public_name(
                CASE WHEN created_by ~ '^[0-9a-f-]{36}$' THEN created_by::uuid ELSE NULL END
              ) AS created_by_name
         FROM procurement_financial_reviews
        WHERE request_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [requestId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      checks: row.checks,
      checklistAcknowledged: row.checklist_acknowledged,
      overrideReason: row.override_reason,
      fundingRoute: row.funding_route,
      sourceAccountId: row.source_account_id,
      destinationAccountId: row.destination_account_id,
      authorizedAmountKobo: Number(row.authorized_amount_kobo),
      createdAt: row.created_at.toISOString(),
      createdByName: row.created_by_name,
    };
  }

  private async loadTransfers(tx: TxScope, requestId: string): Promise<FundingTransferView[]> {
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      request_id: string;
      procurement_reference: string | null;
      source_entity_code: string | null;
      destination_entity_code: string | null;
      source_account_name: string | null;
      destination_account_name: string | null;
      amount_kobo: string;
      purpose: string;
      transfer_date: Date | string;
      transfer_method: string;
      bank_reference: string;
      proof_document_id: string;
      status: string;
      created_at: Date;
    }>(
      `SELECT t.id, t.reference_number, t.request_id, r.reference_number AS procurement_reference,
              se.code AS source_entity_code, de.code AS destination_entity_code,
              sa.name AS source_account_name, da.name AS destination_account_name,
              t.amount_kobo::text, t.purpose, t.transfer_date, t.transfer_method, t.bank_reference,
              t.proof_document_id, t.status, t.created_at
         FROM funding_transfer_records t
         JOIN procurement_requests r ON r.id = t.request_id
         JOIN entities se ON se.id = t.source_entity_id
         JOIN entities de ON de.id = t.destination_entity_id
         JOIN entity_bank_accounts sa ON sa.id = t.source_account_id
         JOIN entity_bank_accounts da ON da.id = t.destination_account_id
        WHERE t.request_id = $1
        ORDER BY t.created_at`,
      [requestId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      referenceNumber: row.reference_number,
      requestId: row.request_id,
      procurementReference: row.procurement_reference,
      sourceEntityCode: row.source_entity_code,
      destinationEntityCode: row.destination_entity_code,
      sourceAccountName: row.source_account_name,
      destinationAccountName: row.destination_account_name,
      amountKobo: Number(row.amount_kobo),
      purpose: row.purpose,
      transferDate: typeof row.transfer_date === 'string' ? row.transfer_date.slice(0, 10) : row.transfer_date.toISOString().slice(0, 10),
      transferMethod: row.transfer_method,
      bankReference: row.bank_reference,
      proofDocumentId: row.proof_document_id,
      status: row.status,
      createdAt: row.created_at.toISOString(),
    }));
  }

  private async loadPayments(tx: TxScope, requestId: string): Promise<ProcurementPaymentView[]> {
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      request_id: string;
      amount_kobo: string;
      method: string;
      bank_reference: string;
      payment_date: Date | string;
      paying_account_name: string | null;
      proof_document_id: string | null;
      status: string;
      reversed_at: Date | null;
      created_at: Date;
    }>(
      `SELECT p.id, p.reference_number, p.request_id, p.amount_kobo::text, p.method, p.bank_reference,
              p.payment_date, a.name AS paying_account_name, p.proof_document_id, p.status,
              p.reversed_at, p.created_at
         FROM procurement_payments p
         JOIN entity_bank_accounts a ON a.id = p.paying_account_id
        WHERE p.request_id = $1
        ORDER BY p.created_at`,
      [requestId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      referenceNumber: row.reference_number,
      requestId: row.request_id,
      amountKobo: Number(row.amount_kobo),
      method: row.method,
      bankReference: row.bank_reference,
      paymentDate:
        typeof row.payment_date === 'string'
          ? row.payment_date.slice(0, 10)
          : row.payment_date.toISOString().slice(0, 10),
      payingAccountName: row.paying_account_name,
      proofDocumentId: row.proof_document_id,
      status: row.status,
      reversedAt: row.reversed_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    }));
  }

  private async loadReversals(tx: TxScope, requestId: string): Promise<PaymentReversalView[]> {
    const result = await tx.client.query<{
      id: string;
      payment_id: string;
      reason: string;
      status: string;
      requested_by_name: string | null;
      approved_by_name: string | null;
      replacement_payment_id: string | null;
      created_at: Date;
    }>(
      `SELECT id, payment_id, reason, status,
              app.user_public_name(
                CASE WHEN requested_by ~ '^[0-9a-f-]{36}$' THEN requested_by::uuid ELSE NULL END
              ) AS requested_by_name,
              app.user_public_name(
                CASE WHEN approved_by ~ '^[0-9a-f-]{36}$' THEN approved_by::uuid ELSE NULL END
              ) AS approved_by_name,
              replacement_payment_id, created_at
         FROM procurement_payment_reversals
        WHERE request_id = $1
        ORDER BY created_at`,
      [requestId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      paymentId: row.payment_id,
      reason: row.reason,
      status: row.status,
      requestedByName: row.requested_by_name,
      approvedByName: row.approved_by_name,
      replacementPaymentId: row.replacement_payment_id,
      createdAt: row.created_at.toISOString(),
    }));
  }

  private async moneyHasMoved(tx: TxScope, requestId: string): Promise<boolean> {
    const result = await tx.client.query<{ moved: boolean }>(
      `SELECT (
         EXISTS (SELECT 1 FROM funding_transfer_records WHERE request_id = $1 AND reversed_transfer_id IS NULL)
         OR EXISTS (SELECT 1 FROM procurement_payments WHERE request_id = $1 AND status = 'COMPLETED')
       ) AS moved`,
      [requestId],
    );
    return Boolean(result.rows[0]?.moved);
  }

  private async loadVersionHistory(tx: TxScope, requestId: string): Promise<ProcurementVersionHistoryView[]> {
    const versions = await tx.client.query<{
      version_number: number;
      submitted_at: Date | null;
    }>(
      `SELECT version_number, submitted_at
         FROM procurement_versions
        WHERE request_id = $1
        ORDER BY version_number`,
      [requestId],
    );
    const actions = await tx.client.query<{
      subject_version: number;
      action: string;
      reason: string | null;
      occurred_at: Date;
      actor_name: string | null;
    }>(
      `SELECT a.subject_version, a.action, a.reason, a.occurred_at,
              app.user_public_name(a.actor_id) AS actor_name
         FROM workflow_actions a
         JOIN workflow_instances i ON i.id = a.instance_id
        WHERE i.subject_type = 'PROCUREMENT' AND i.subject_id = $1
        ORDER BY a.occurred_at`,
      [requestId],
    );
    const versionNumbers = versions.rows.map((row) => row.version_number);
    const actionOnVersion = (action: string, versionNumber: number) => {
      const matches = actions.rows.filter((row) => row.action === action);
      const exact = matches.filter((row) => row.subject_version === versionNumber);
      if (exact.length > 0) return exact[exact.length - 1];
      return matches.find((row) => {
        const target = versionNumbers.filter((number) => number <= row.subject_version).at(-1);
        return target === versionNumber;
      });
    };
    return versions.rows.map((version) => {
      const submit = actionOnVersion('APPROVE', version.version_number);
      const returned = actionOnVersion('RETURN_FOR_CORRECTION', version.version_number);
      const rejected = actionOnVersion('REJECT', version.version_number);
      return {
        versionNumber: version.version_number,
        submittedAt: version.submitted_at?.toISOString() ?? null,
        submittedByName: submit?.actor_name ?? null,
        returnedAt: returned?.occurred_at.toISOString() ?? null,
        returnedByName: returned?.actor_name ?? null,
        returnReason: returned?.reason ?? null,
        rejectedAt: rejected?.occurred_at.toISOString() ?? null,
        rejectedByName: rejected?.actor_name ?? null,
        rejectReason: rejected?.reason ?? null,
      };
    });
  }

  private async loadRelatedHistory(
    tx: TxScope,
    row: LoadedRow,
  ): Promise<{ items: ProcurementRelatedHistoryItem[]; spendKobo: number }> {
    if (!row.vendor_id) return { items: [], spendKobo: 0 };
    const history = await tx.client.query<{
      id: string;
      reference_number: string;
      title: string;
      status: string;
      total_amount_kobo: string | null;
      occurred_at: Date;
    }>(
      `SELECT r.id, h.reference_number, h.title, h.status, v.total_amount_kobo::text, h.occurred_at
         FROM vendor_procurement_history_v h
         JOIN procurement_requests r ON r.reference_number = h.reference_number
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
        WHERE h.vendor_id = $1 AND h.entity_id = $2 AND r.id <> $3
        ORDER BY h.occurred_at DESC
        LIMIT 12`,
      [row.vendor_id, row.entity_id, row.id],
    );
    const spend = await tx.client.query<{ total: string }>(
      `SELECT coalesce(sum(v.total_amount_kobo), 0)::text AS total
         FROM procurement_requests r
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
        WHERE r.vendor_id = $1
          AND r.entity_id = $2
          AND r.status NOT IN ('DRAFT', 'DISCARDED', 'REJECTED')`,
      [row.vendor_id, row.entity_id],
    );
    return {
      items: history.rows.map((item) => ({
        id: item.id,
        referenceNumber: item.reference_number,
        title: item.title,
        status: item.status,
        totalAmountKobo: item.total_amount_kobo == null ? null : Number(item.total_amount_kobo),
        occurredAt: item.occurred_at.toISOString(),
      })),
      spendKobo: Number(spend.rows[0]?.total ?? 0),
    };
  }

  private async loadRow(tx: TxScope, id: string): Promise<LoadedRow> {
    const result = await tx.client.query<LoadedRow>(`${LOAD_SQL} WHERE r.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That procurement request was not found.');
    return row;
  }

  private async indexRequest(tx: TxScope, row: LoadedRow): Promise<void> {
    await tx.indexSearch({
      recordType: 'PROCUREMENT',
      recordId: row.id,
      referenceNumber: row.reference_number,
      title: row.title,
      searchableText: `${row.reference_number} ${row.title} ${row.vendor_name ?? ''} ${row.total_amount_kobo ?? ''} ${row.entity_code ?? ''}`,
      entityId: row.entity_id,
      permissionKey: 'procurement.view',
    });
  }

  private async budgetAvailable(tx: TxScope, budgetLineId: string | null): Promise<number> {
    if (!budgetLineId) return 0;
    const result = await tx.client.query<{ available: string }>(
      `SELECT (bl.approved_amount_kobo - coalesce((
                 SELECT sum(CASE WHEN e.action = 'OPEN' THEN e.amount_kobo ELSE -e.amount_kobo END)
                   FROM procurement_commitment_events e
                  WHERE e.budget_line_id = bl.id
               ), 0))::text AS available
         FROM budget_lines bl WHERE bl.id = $1`,
      [budgetLineId],
    );
    return Number(result.rows[0]?.available ?? 0);
  }

  private async assertDepartment(tx: TxScope, departmentId: string, entityId: string): Promise<void> {
    const result = await tx.client.query<{ entity_id: string }>(
      `SELECT entity_id FROM departments WHERE id = $1 AND status = 'ACTIVE'`,
      [departmentId],
    );
    if (!result.rows[0] || result.rows[0].entity_id !== entityId) {
      throw new ValidationFailedError('That department does not belong to this subsidiary.');
    }
  }

  private async assertBudgetLine(tx: TxScope, budgetLineId: string, entityId: string): Promise<void> {
    const result = await tx.client.query<{ entity_id: string; fiscal_year: number }>(
      `SELECT entity_id, fiscal_year FROM budget_lines WHERE id = $1 AND status = 'ACTIVE'`,
      [budgetLineId],
    );
    const row = result.rows[0];
    if (!row || row.entity_id !== entityId) {
      throw new ValidationFailedError('That budget line does not belong to this subsidiary.');
    }
    const year = Number(formatLagosIsoDate(new Date()).slice(0, 4));
    if (row.fiscal_year !== year) {
      throw new ValidationFailedError('That budget line is not for the current fiscal year.');
    }
  }

  private resolveLineInput(input: UpdateProcurementInput, existing: LoadedLine[]): LineWrite[] | null {
    if (input.lines !== undefined) return input.lines;
    const hasFlat =
      input.categoryId !== undefined ||
      input.quantity !== undefined ||
      input.unitId !== undefined ||
      input.unitPriceKobo !== undefined ||
      input.budgetLineId !== undefined;
    if (!hasFlat) return null;
    const first = existing[0];
    return [
      {
        description: first?.description ?? '',
        categoryId: input.categoryId !== undefined ? input.categoryId : (first?.category_id ?? null),
        quantity: input.quantity !== undefined ? input.quantity : (first?.quantity ?? null),
        unitId: input.unitId !== undefined ? input.unitId : (first?.unit_id ?? null),
        unitPriceKobo:
          input.unitPriceKobo !== undefined
            ? input.unitPriceKobo
            : first?.unit_price_kobo == null
              ? null
              : Number(first.unit_price_kobo),
        budgetLineId: input.budgetLineId !== undefined ? input.budgetLineId : (first?.budget_line_id ?? null),
      },
    ];
  }

  private async replaceLines(
    tx: TxScope,
    actor: ActorContext,
    versionId: string,
    entityId: string,
    lines: LineWrite[],
  ): Promise<void> {
    if (lines.length === 0) {
      throw new ValidationFailedError('At least one line is required once commercial fields are entered.');
    }
    for (const line of lines) {
      if (line.budgetLineId) await this.assertBudgetLine(tx, line.budgetLineId, entityId);
    }
    await tx.client.query(`DELETE FROM procurement_version_lines WHERE version_id = $1`, [versionId]);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const amount =
        line.quantity != null && line.unitPriceKobo != null
          ? Number(multiplyKoboByQuantity(BigInt(line.unitPriceKobo), line.quantity))
          : null;
      await tx.client.query(
        `INSERT INTO procurement_version_lines (
           version_id, entity_id, line_number, description, category_id, quantity, unit_id,
           unit_price_kobo, line_amount_kobo, budget_line_id, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
        [
          versionId,
          entityId,
          index + 1,
          line.description?.trim() ?? '',
          line.categoryId ?? null,
          line.quantity ?? null,
          line.unitId ?? null,
          line.unitPriceKobo ?? null,
          amount,
          line.budgetLineId ?? null,
          actor.ref,
        ],
      );
    }
  }

  private async copyLines(
    tx: TxScope,
    sourceVersionId: string,
    targetVersionId: string,
    actorRef: string,
  ): Promise<void> {
    await tx.client.query(
      `INSERT INTO procurement_version_lines (
         version_id, entity_id, line_number, description, category_id, quantity, unit_id,
         unit_price_kobo, line_amount_kobo, budget_line_id, created_by, updated_by
       )
       SELECT $1, entity_id, line_number, description, category_id, quantity, unit_id,
              unit_price_kobo, line_amount_kobo, budget_line_id, $2, $2
         FROM procurement_version_lines
        WHERE version_id = $3
        ORDER BY line_number`,
      [targetVersionId, actorRef, sourceVersionId],
    );
  }

  private async loadLines(tx: TxScope, versionId: string, requestId: string): Promise<LoadedLine[]> {
    const result = await tx.client.query<LoadedLine>(
      `SELECT l.id, l.line_number, l.description, l.category_id, c.key AS category_key,
              c.name AS category_name, coalesce(c.invoice_required, false) AS invoice_required,
              coalesce(c.stock_item, false) AS stock_item, coalesce(c.asset, false) AS asset,
              l.quantity, l.unit_id, um.code AS unit_code, um.name AS unit_name,
              l.unit_price_kobo::text, l.line_amount_kobo::text, l.budget_line_id,
              bl.code AS budget_line_code, bl.name AS budget_line_name,
              bl.approved_amount_kobo::text AS budget_approved_kobo,
              c.required_delivery_document_set,
              received.accepted_quantity, received.received_quantity, received.rejected_quantity,
              d.due_on AS second_batch_due_on
         FROM procurement_version_lines l
         LEFT JOIN LATERAL (
           SELECT coalesce(sum(g.quantity_accepted), 0)::int AS accepted_quantity,
                  coalesce(sum(g.quantity_received), 0)::int AS received_quantity,
                  coalesce(sum(g.quantity_rejected), 0)::int AS rejected_quantity
             FROM procurement_goods_receipts g
            WHERE g.request_id = $2
              AND coalesce(g.line_id, (
                SELECT first_line.id FROM procurement_version_lines first_line
                 WHERE first_line.version_id = l.version_id AND first_line.line_number = 1
              )) = l.id
              AND NOT EXISTS (
                SELECT 1 FROM procurement_goods_receipts later WHERE later.supersedes_id = g.id
              )
         ) received ON true
         LEFT JOIN procurement_categories c ON c.id = l.category_id
         LEFT JOIN units_of_measure um ON um.id = l.unit_id
         LEFT JOIN budget_lines bl ON bl.id = l.budget_line_id
         LEFT JOIN procurement_shortage_deadlines d ON d.line_id = l.id
        WHERE l.version_id = $1
        ORDER BY l.line_number`,
      [versionId, requestId],
    );
    return result.rows;
  }

  private sumLineAmounts(lines: LoadedLine[]): number | null {
    if (lines.length === 0) return null;
    let total = 0;
    let any = false;
    for (const line of lines) {
      if (line.line_amount_kobo == null) continue;
      any = true;
      total += Number(line.line_amount_kobo);
    }
    return any ? total : null;
  }

  private toLineViews(lines: LoadedLine[]): ProcurementLineView[] {
    return lines.map((line) => {
      const quantity = line.quantity ?? 0;
      const accepted = Number(line.accepted_quantity ?? 0);
      return {
        id: line.id,
        lineNumber: line.line_number,
        description: line.description,
        categoryId: line.category_id,
        categoryKey: line.category_key,
        categoryName: line.category_name,
        invoiceRequired: line.invoice_required,
        stockItem: line.stock_item,
        asset: line.asset,
        quantity,
        unitId: line.unit_id,
        unitCode: line.unit_code,
        unitName: line.unit_name,
        unitPriceKobo: Number(line.unit_price_kobo ?? 0),
        lineAmountKobo: Number(line.line_amount_kobo ?? 0),
        budgetLineId: line.budget_line_id,
        budgetLineCode: line.budget_line_code,
        budgetLineName: line.budget_line_name,
        receivedQuantity: Number(line.received_quantity ?? 0),
        acceptedQuantity: accepted,
        rejectedQuantity: Number(line.rejected_quantity ?? 0),
        outstandingQuantity: Math.max(quantity - accepted, 0),
        secondBatchDueOn: line.second_batch_due_on ? formatLagosIsoDate(line.second_batch_due_on) : null,
      };
    });
  }

  private assertRequiredDate(isoDate: string): void {
    if (!isoDate) throw new ValidationFailedError('A required date is needed.');
    const today = formatLagosIsoDate(new Date());
    if (isoDate < today) {
      throw new ValidationFailedError('The required date cannot be in the past.');
    }
  }

  private assertReadyToSubmit(row: LoadedRow, lines: LoadedLine[]): void {
    const missing: string[] = [];
    if (!row.title.trim()) missing.push('title');
    if (!row.subject?.trim()) missing.push('subject');
    if (!row.department_id) missing.push('department');
    if (!row.reason?.trim()) missing.push('reason');
    if (!row.description?.trim()) missing.push('description');
    if (!row.required_date) missing.push('required date');
    if (!row.vendor_id && !row.requisition_id) missing.push('vendor');
    if (!row.delivery_location?.trim()) missing.push('delivery location');
    if (!row.funding_source_id) missing.push('funding source');
    if (!asPaymentTiming(row.proposed_payment_timing)) missing.push('proposed payment timing');
    if (lines.length === 0) missing.push('lines');
    const proposalFromQuotations = Boolean(row.requisition_id);
    for (const line of lines) {
      const label = `line ${line.line_number}`;
      if (!line.category_id) missing.push(`${label} category`);
      if (!line.quantity || line.quantity <= 0) missing.push(`${label} quantity`);
      if (!line.unit_id) missing.push(`${label} unit`);
      // Proposal memos take unit price from the approved quotation after MD approval.
      if (!proposalFromQuotations && (!line.unit_price_kobo || Number(line.unit_price_kobo) <= 0)) {
        missing.push(`${label} unit price`);
      }
      if (!line.budget_line_id) missing.push(`${label} budget line`);
    }
    if (missing.length > 0) {
      throw new ValidationFailedError(`Complete the request before submitting: ${missing.join(', ')}.`);
    }
  }

  /**
   * Prices already recorded against this version. Changing quantities or the
   * number of lines would leave those unit prices pointing at the wrong items.
   */
  private async assertQuotationLinesStable(
    tx: TxScope,
    versionId: string,
    existing: LoadedLine[],
    next: LineWrite[],
  ): Promise<void> {
    const quotes = await tx.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM procurement_quotations WHERE version_id = $1`,
      [versionId],
    );
    if (!quotes.rows[0]?.n) return;
    const before = existing.map((line) => `${line.line_number}:${line.quantity ?? ''}`).join('|');
    const after = next.map((line, index) => `${index + 1}:${line.quantity ?? ''}`).join('|');
    if (before !== after) {
      throw new ValidationFailedError(
        'Remove the vendor quotations before changing item quantities or the number of lines.',
      );
    }
  }

  /** One positive unit price for each current memo line, and no extras. */
  private quotationLineAmounts(
    memoLines: LoadedLine[],
    quoted: Array<{ lineNumber: number; unitPriceKobo: number }>,
  ): Array<{ lineNumber: number; unitPriceKobo: number; lineAmountKobo: number }> {
    const byNumber = new Map<number, number>();
    for (const line of quoted) {
      if (byNumber.has(line.lineNumber)) {
        throw new ValidationFailedError('Each item can only be priced once.');
      }
      byNumber.set(line.lineNumber, line.unitPriceKobo);
    }
    if (memoLines.some((line) => !byNumber.has(line.line_number))) {
      throw new ValidationFailedError('Enter a unit price for every item.');
    }
    for (const lineNumber of byNumber.keys()) {
      if (!memoLines.some((line) => line.line_number === lineNumber)) {
        throw new ValidationFailedError('A quoted item is not on this memo.');
      }
    }
    return memoLines.map((line) => {
      const unitPriceKobo = byNumber.get(line.line_number)!;
      return {
        lineNumber: line.line_number,
        unitPriceKobo,
        lineAmountKobo: Number(multiplyKoboByQuantity(BigInt(unitPriceKobo), Number(line.quantity))),
      };
    });
  }

  private quoteHasPrices(
    quote: ProcurementQuotationView,
  ): quote is ProcurementQuotationView & { vendorId: string; amountKobo: number } {
    return (
      quote.vendorId !== null &&
      quote.amountKobo !== null &&
      quote.amountKobo > 0 &&
      (quote.lines.length > 0 || (quote.unitPriceKobo !== null && quote.unitPriceKobo > 0))
    );
  }

  private quoteCoversLines(quote: ProcurementQuotationView, lines: LoadedLine[]): boolean {
    if (!this.quoteHasPrices(quote)) return false;
    if (quote.lines.length > 0) {
      return lines.every((line) =>
        quote.lines.some((priced) => priced.lineNumber === line.line_number && priced.unitPriceKobo > 0),
      );
    }
    return quote.unitPriceKobo !== null && quote.unitPriceKobo > 0;
  }

  /**
   * A priced proposal compares quotations from registered vendors. It needs at
   * least MIN_VENDOR_QUOTATIONS priced quotes from different vendors, an award
   * to one of them, and a justification when that vendor is not the lowest.
   */
  private assertQuotationComparison(
    row: LoadedRow,
    quotes: ProcurementQuotationView[],
    lines: LoadedLine[],
  ): void {
    const pricedVendors = new Set(
      quotes.filter((quote) => this.quoteCoversLines(quote, lines)).map((quote) => quote.vendorId),
    );
    if (pricedVendors.size < MIN_VENDOR_QUOTATIONS) {
      throw new ValidationFailedError(
        `Add priced quotations from at least ${MIN_VENDOR_QUOTATIONS} registered vendors before submitting the proposal.`,
      );
    }
    const selected = quotes.find((quote) => quote.vendorId && quote.vendorId === row.vendor_id);
    if (!selected) {
      throw new ValidationFailedError('Select the vendor to award in the price comparison before submitting.');
    }
    if (!this.quoteCoversLines(selected, lines)) {
      throw new ValidationFailedError(
        'The selected vendor quotation needs a unit price for every item before the proposal can be submitted.',
      );
    }
    if (!selected.isLowest && !row.selection_justification?.trim()) {
      throw new ValidationFailedError(
        'The selected vendor is not the lowest price. Add a justification in the price comparison.',
      );
    }
  }

  private async categoryIsMachinery(
    tx: TxScope,
    lines: LoadedLine[],
    row: LoadedRow,
  ): Promise<boolean> {
    const categoryId = lines[0]?.category_id ?? row.category_id;
    if (!categoryId) return Boolean(row.operations_machinery);
    const result = await tx.client.query<{ operations_machinery: boolean }>(
      `SELECT operations_machinery FROM procurement_categories WHERE id = $1`,
      [categoryId],
    );
    return Boolean(result.rows[0]?.operations_machinery);
  }

  private assertOriginatorDraft(
    actor: ActorContext,
    row: LoadedRow,
    permission: 'procurement.edit_draft' | 'procurement.submit' | 'procurement.discard_draft',
  ): void {
    assertCan(actor, permission, row.entity_id);
    const dualApproval = Boolean(row.requisition_id) || Boolean(row.prepared_by_user_id);
    if (dualApproval) {
      if (row.requisition_id && row.requisition_status && row.requisition_status !== 'NEED_APPROVED') {
        throw new ConflictError('Need must be approved before the proposal can be prepared.');
      }
      if (row.prepared_by_user_id && actor.ref !== row.prepared_by_user_id) {
        throw new ForbiddenError('Only the Procurement Manager who prepared this proposal may change it.');
      }
      if (row.status !== 'DRAFT' && row.status !== 'AWAITING_PREPARATION') {
        throw new ConflictError('Only a draft proposal can be changed.');
      }
      return;
    }
    if (actor.ref !== row.originator_user_id) {
      throw new ForbiddenError('Only the originator may change a draft request.');
    }
    if (row.status !== 'DRAFT') {
      throw new ConflictError('Only a draft request can be changed.');
    }
  }

  private assertReader(actor: ActorContext): void {
    if (
      !can(actor, 'procurement.view') &&
      !can(actor, 'procurement.create') &&
      !can(actor, 'procurement.prepare') &&
      !can(actor, 'requisition.create')
    ) {
      throw new ForbiddenError('You cannot view procurement.');
    }
  }

  private assertBudgetManager(actor: ActorContext, entityId: string): void {
    if (can(actor, 'finance.funding.authorize', entityId)) return;
    if (can(actor, 'finance.payment.execute', entityId)) return;
    throw new ForbiddenError('You cannot manage budget lines or projects.');
  }

  /** Quotations for a version, priced ones sorted lowest first, legacy file-only ones last. */
  private async loadQuotations(tx: TxScope, versionId: string): Promise<ProcurementQuotationView[]> {
    const result = await tx.client.query<{
      id: string;
      document_id: string;
      title: string | null;
      reference_number: string | null;
      vendor_id: string | null;
      vendor_name: string | null;
      vendor_reference: string | null;
      unit_price_kobo: string | null;
      amount_kobo: string | null;
      notes: string | null;
    }>(
      `SELECT q.id, q.document_id, d.title, d.reference_number, q.vendor_id,
              ven.legal_name AS vendor_name, ven.reference_number AS vendor_reference,
              q.unit_price_kobo::text, q.amount_kobo::text, q.notes
         FROM procurement_quotations q
         LEFT JOIN documents d ON d.id = q.document_id
         LEFT JOIN vendors ven ON ven.id = q.vendor_id
        WHERE q.version_id = $1
        ORDER BY q.amount_kobo ASC NULLS LAST, q.created_at`,
      [versionId],
    );
    const lineRows = await tx.client.query<{
      quotation_id: string;
      line_number: number;
      unit_price_kobo: string;
      line_amount_kobo: string;
      description: string | null;
      quantity: number | null;
      unit_code: string | null;
    }>(
      `SELECT ql.quotation_id, ql.line_number, ql.unit_price_kobo::text, ql.line_amount_kobo::text,
              vl.description, vl.quantity, um.code AS unit_code
         FROM procurement_quotation_lines ql
         JOIN procurement_quotations q ON q.id = ql.quotation_id
         LEFT JOIN procurement_version_lines vl
           ON vl.version_id = q.version_id AND vl.line_number = ql.line_number
         LEFT JOIN units_of_measure um ON um.id = vl.unit_id
        WHERE q.version_id = $1
        ORDER BY ql.line_number`,
      [versionId],
    );
    const linesByQuote = new Map<string, ProcurementQuotationView['lines']>();
    for (const line of lineRows.rows) {
      const list = linesByQuote.get(line.quotation_id) ?? [];
      list.push({
        lineNumber: line.line_number,
        description: line.description ?? '',
        quantity: line.quantity ?? 0,
        unitCode: line.unit_code,
        unitPriceKobo: Number(line.unit_price_kobo),
        lineAmountKobo: Number(line.line_amount_kobo),
      });
      linesByQuote.set(line.quotation_id, list);
    }
    const rows = result.rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      title: row.title,
      referenceNumber: row.reference_number,
      vendorId: row.vendor_id,
      vendorName: row.vendor_name,
      vendorReference: row.vendor_reference,
      unitPriceKobo: row.unit_price_kobo === null ? null : Number(row.unit_price_kobo),
      amountKobo: row.amount_kobo === null ? null : Number(row.amount_kobo),
      lines: linesByQuote.get(row.id) ?? [],
      notes: row.notes,
    }));
    const { recommendedVendorIds } = recommendLowestQuote(rows);
    return rows.map((row) => ({
      ...row,
      isLowest: row.vendorId !== null && row.amountKobo !== null && recommendedVendorIds.includes(row.vendorId),
    }));
  }

  private async loadReceipts(tx: TxScope, requestId: string): Promise<GoodsReceiptView[]> {
    const rows = await tx.client.query<{
      id: string;
      reference_number: string;
      received_date: Date | string;
      location: string;
      line_id: string | null;
      delivery_id: string | null;
      line_number: number | null;
      quantity_ordered: number;
      quantity_received: number;
      quantity_accepted: number;
      quantity_rejected: number;
      reject_reason: string | null;
      condition_notes: string | null;
      supersedes_id: string | null;
      created_at: Date;
      created_by_name: string | null;
      superseded: boolean;
    }>(
      `SELECT g.id, g.reference_number, g.received_date, g.location, g.line_id, g.delivery_id, l.line_number,
              g.quantity_ordered, g.quantity_received, g.quantity_accepted, g.quantity_rejected,
              g.reject_reason, g.condition_notes, g.supersedes_id, g.created_at,
              app.user_public_name(
                CASE WHEN g.created_by ~ '^[0-9a-f-]{36}$' THEN g.created_by::uuid ELSE NULL END
              ) AS created_by_name,
              EXISTS (SELECT 1 FROM procurement_goods_receipts later WHERE later.supersedes_id = g.id) AS superseded
         FROM procurement_goods_receipts g
         LEFT JOIN procurement_version_lines l ON l.id = g.line_id
        WHERE g.request_id = $1
        ORDER BY g.created_at`,
      [requestId],
    );
    const docs = await tx.client.query<{
      grn_id: string;
      document_id: string;
      kind: string;
      title: string | null;
    }>(
      `SELECT d.grn_id, d.document_id, d.kind, doc.title
         FROM procurement_receipt_documents d
         LEFT JOIN documents doc ON doc.id = d.document_id
        WHERE d.request_id = $1 AND d.grn_id IS NOT NULL`,
      [requestId],
    );
    return rows.rows.map((row) => ({
      id: row.id,
      deliveryId: row.delivery_id,
      referenceNumber: row.reference_number,
      receivedDate: dateOnly(row.received_date) ?? '',
      location: row.location,
      lineId: row.line_id,
      lineNumber: row.line_number,
      quantityOrdered: row.quantity_ordered,
      quantityReceived: row.quantity_received,
      quantityAccepted: row.quantity_accepted,
      quantityRejected: row.quantity_rejected,
      rejectReason: row.reject_reason,
      conditionNotes: row.condition_notes,
      supersedesId: row.supersedes_id,
      superseded: row.superseded,
      documents: docs.rows
        .filter((doc) => doc.grn_id === row.id)
        .map((doc) => ({ documentId: doc.document_id, kind: doc.kind, title: doc.title })),
      createdAt: row.created_at.toISOString(),
      createdByName: row.created_by_name,
    }));
  }

  private async loadDeliveries(
    tx: TxScope,
    requestId: string,
    receipts: GoodsReceiptView[],
    lines: ProcurementLineView[],
  ): Promise<ProcurementDeliveryView[]> {
    const rows = await tx.client.query<{
      id: string;
      reference_number: string;
      received_date: Date | string;
      location: string;
      document_kind: string;
      notes: string | null;
      created_at: Date;
      created_by_name: string | null;
    }>(
      `SELECT id, reference_number, received_date, location, document_kind, notes, created_at,
              app.user_public_name(
                CASE WHEN created_by ~ '^[0-9a-f-]{36}$' THEN created_by::uuid ELSE NULL END
              ) AS created_by_name
         FROM procurement_deliveries
        WHERE request_id = $1
        ORDER BY created_at`,
      [requestId],
    );
    if (rows.rows.length === 0) return [];
    const docs = await tx.client.query<{ delivery_id: string; document_id: string; kind: string; title: string | null }>(
      `SELECT d.delivery_id, d.document_id, d.kind, doc.title
         FROM procurement_receipt_documents d
         LEFT JOIN documents doc ON doc.id = d.document_id
        WHERE d.request_id = $1 AND d.delivery_id IS NOT NULL`,
      [requestId],
    );
    const lineById = new Map(lines.map((line) => [line.id, line]));
    return rows.rows.map((row) => ({
      id: row.id,
      referenceNumber: row.reference_number,
      receivedDate: dateOnly(row.received_date) ?? '',
      location: row.location,
      documentKind: row.document_kind,
      notes: row.notes,
      documents: docs.rows
        .filter((doc) => doc.delivery_id === row.id)
        .map((doc) => ({ documentId: doc.document_id, kind: doc.kind, title: doc.title })),
      items: receipts
        .filter((receipt) => receipt.deliveryId === row.id)
        .sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0))
        .map((receipt) => {
          const line = receipt.lineId ? lineById.get(receipt.lineId) : undefined;
          return { ...receipt, description: line?.description ?? null, unitCode: line?.unitCode ?? null };
        }),
      createdAt: row.created_at.toISOString(),
      createdByName: row.created_by_name,
    }));
  }

  private async loadDeliveryNotes(tx: TxScope, requestId: string): Promise<DeliveryNoteView[]> {
    const result = await tx.client.query<{
      id: string;
      note: string;
      next_reminder_at: Date | null;
      created_at: Date;
      created_by_name: string | null;
    }>(
      `SELECT id, note, next_reminder_at, created_at,
              app.user_public_name(
                CASE WHEN created_by ~ '^[0-9a-f-]{36}$' THEN created_by::uuid ELSE NULL END
              ) AS created_by_name
         FROM procurement_delivery_notes
        WHERE request_id = $1
        ORDER BY created_at`,
      [requestId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      note: row.note,
      nextReminderAt: row.next_reminder_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      createdByName: row.created_by_name,
    }));
  }

  private async loadCloseShort(tx: TxScope, requestId: string): Promise<CloseShortView | null> {
    const result = await tx.client.query<{
      id: string;
      outstanding_quantity: number;
      outstanding_amount_kobo: string;
      reason: string;
      status: CloseShortView['status'];
      workflow_instance_id: string | null;
      created_at: Date;
      workflow_reference: string | null;
    }>(
      `SELECT c.id, c.outstanding_quantity, c.outstanding_amount_kobo::text, c.reason, c.status,
              c.workflow_instance_id, c.created_at, pr.reference_number AS workflow_reference
         FROM procurement_close_short_requests c
         LEFT JOIN procurement_requests pr ON pr.id = c.request_id
        WHERE c.request_id = $1
        ORDER BY c.created_at DESC
        LIMIT 1`,
      [requestId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const approvals =
      row.workflow_instance_id == null
        ? []
        : (
            await tx.client.query<{
              stage_label: string;
              action: string;
              actor_name: string | null;
              reason: string | null;
              occurred_at: Date;
            }>(
              `SELECT s.label AS stage_label, a.action,
                      app.user_public_name(a.actor_id) AS actor_name, a.reason, a.occurred_at
                 FROM workflow_actions a
                 JOIN workflow_stages s ON s.id = a.stage_id
                WHERE a.instance_id = $1
                ORDER BY a.occurred_at ASC, a.id ASC`,
              [row.workflow_instance_id],
            )
          ).rows.map((item) => ({
            stageLabel: item.stage_label,
            action: item.action,
            actorName: item.actor_name ?? 'Unknown',
            occurredAt: item.occurred_at.toISOString(),
            reason: item.reason,
          }));
    const claim = await tx.client.query<{
      quantity: number;
      amount_kobo: string;
      reason: string;
      recovery_id: string | null;
    }>(
      `SELECT quantity, amount_kobo::text, reason, recovery_id
         FROM vendor_open_claims
        WHERE close_short_id = $1`,
      [row.id],
    );
    const claimRow = claim.rows[0];
    return {
      id: row.id,
      outstandingQuantity: row.outstanding_quantity,
      outstandingAmountKobo: Number(row.outstanding_amount_kobo),
      reason: row.reason,
      status: row.status,
      workflowInstanceId: row.workflow_instance_id,
      createdAt: row.created_at.toISOString(),
      referenceNumber: row.workflow_reference,
      approvals,
      vendorOpenClaim: claimRow
        ? {
            quantity: claimRow.quantity,
            amountKobo: Number(claimRow.amount_kobo),
            reason: claimRow.reason,
            recoveryId: claimRow.recovery_id,
          }
        : null,
    };
  }

  private async loadProcurementDocuments(
    tx: TxScope,
    requestId: string,
  ): Promise<ProcurementDocumentAccessView[]> {
    const docs = await tx.client.query<{
      id: string;
      reference_number: string;
      title: string;
      category: string;
      kind: string | null;
    }>(
      `SELECT DISTINCT d.id, d.reference_number, d.title, d.category, rd.kind
         FROM documents d
         LEFT JOIN procurement_receipt_documents rd ON rd.document_id = d.id
        WHERE d.owner_type = 'procurement_request' AND d.owner_id = $1
        ORDER BY d.reference_number`,
      [requestId],
    );
    const result: ProcurementDocumentAccessView[] = [];
    for (const doc of docs.rows) {
      const versions = await tx.client.query<{
        version_number: number;
        sha256: string;
        original_filename: string;
        uploaded_at: Date;
      }>(
        `SELECT version_number, sha256, original_filename, uploaded_at
           FROM document_versions WHERE document_id = $1 ORDER BY version_number`,
        [doc.id],
      );
      const access = await tx.client.query<{
        actor_name: string | null;
        action: string;
        occurred_at: Date;
      }>(
        `SELECT app.user_public_name(
                  CASE WHEN actor_ref ~ '^[0-9a-f-]{36}$' THEN actor_ref::uuid ELSE NULL END
                ) AS actor_name,
                action, occurred_at
           FROM document_access_log
          WHERE document_id = $1
          ORDER BY occurred_at DESC
          LIMIT 20`,
        [doc.id],
      );
      result.push({
        documentId: doc.id,
        referenceNumber: doc.reference_number,
        title: doc.title,
        category: doc.category,
        kind: doc.kind,
        versions: versions.rows.map((version) => ({
          versionNumber: version.version_number,
          sha256: version.sha256,
          originalFilename: version.original_filename,
          uploadedAt: version.uploaded_at.toISOString(),
        })),
        access: access.rows.map((item) => ({
          actorName: item.actor_name,
          action: item.action,
          occurredAt: item.occurred_at.toISOString(),
        })),
      });
    }
    return result;
  }

  private diffable(row: LoadedRow): Record<string, unknown> {
    return {
      title: row.title,
      subject: row.subject,
      quantity: row.quantity,
      unitPriceKobo: row.unit_price_kobo,
      vendorId: row.vendor_id,
      requiredDate: dateOnly(row.required_date),
      urgency: row.urgency,
      proposedPaymentTiming: row.proposed_payment_timing,
    };
  }

  /**
   * After MD approves the recommendation, copy the selected vendor's unit price
   * onto every memo line and refresh the frozen memo snapshot / PDF.
   */
  private async applyMdApprovedQuotationPrices(
    tx: TxScope,
    actor: ActorContext,
    current: LoadedRow,
  ): Promise<void> {
    if (!current.requisition_id || !current.vendor_id) return;
    const quotes = await this.loadQuotations(tx, current.version_id);
    const selected = quotes.find((quote) => quote.vendorId === current.vendor_id && this.quoteHasPrices(quote));
    if (!selected) {
      throw new ValidationFailedError(
        'The approved vendor quotation has no unit prices. Return the proposal for correction.',
      );
    }
    const lines = await this.loadLines(tx, current.version_id, current.id);
    await tx.client.query(`SELECT set_config('app.allow_md_price_fill', 'on', true)`);
    const priceByNumber = new Map(selected.lines.map((line) => [line.lineNumber, line.unitPriceKobo]));
    const legacyUnit =
      selected.lines.length === 0 && selected.unitPriceKobo && selected.unitPriceKobo > 0
        ? selected.unitPriceKobo
        : null;
    for (const line of lines) {
      const unitPrice = priceByNumber.get(line.line_number) ?? legacyUnit;
      if (!unitPrice || unitPrice <= 0) {
        throw new ValidationFailedError(
          'The approved vendor quotation is missing a unit price for one or more items. Return the proposal for correction.',
        );
      }
      const qty = Number(line.quantity ?? 0);
      const lineAmount = qty > 0 ? Number(multiplyKoboByQuantity(BigInt(unitPrice), qty)) : null;
      await tx.client.query(
        `UPDATE procurement_version_lines
            SET unit_price_kobo = $1, line_amount_kobo = $2, updated_by = $3
          WHERE id = $4`,
        [unitPrice, lineAmount, actor.ref, line.id],
      );
    }
    const refreshed = await this.loadLines(tx, current.version_id, current.id);
    const total = this.sumLineAmounts(refreshed) ?? 0;
    const headerUnit = refreshed.length === 1 ? Number(refreshed[0]?.unit_price_kobo ?? 0) || null : null;
    await tx.client.query(
      `UPDATE procurement_versions
          SET unit_price_kobo = $1, total_amount_kobo = $2, updated_by = $3
        WHERE id = $4`,
      [headerUnit, total, actor.ref, current.version_id],
    );

    const available = await this.budgetAvailable(tx, refreshed[0]?.budget_line_id ?? current.budget_line_id);
    const row = await this.loadRow(tx, current.id);
    const snapshot = this.buildSnapshot(row, total, available, refreshed, quotes);
    const pdf = await renderProcurementMemoPdf(snapshot);
    const stored = await this.documents.storeGeneratedPdfInTx(tx, actor, {
      title: `Memo ${current.reference_number}`,
      entityId: current.entity_id,
      ownerType: 'procurement_request',
      ownerId: current.id,
      buffer: pdf,
      filename: `${current.reference_number}-memo.pdf`,
    });
    await tx.client.query(
      `UPDATE procurement_memo_snapshots
          SET canonical_json = $1::jsonb,
              memo_snapshot_hash = $2,
              pdf_document_id = $3,
              pdf_hash = $4,
              budget_available_kobo = $5
        WHERE version_id = $6`,
      [
        JSON.stringify(snapshot),
        snapshotHash(snapshot),
        stored.documentId,
        stored.sha256,
        available,
        current.version_id,
      ],
    );
    await tx.appendTimeline({
      subjectType: 'PROCUREMENT',
      subjectId: current.id,
      text: `MD approved ${selected.vendorName ?? 'the selected vendor'} at ${formatKobo(BigInt(total))}.`,
      href: `/procurement/${current.id}`,
      entityId: current.entity_id,
    });
  }

  private async applyMdPaymentTiming(
    tx: TxScope,
    actor: ActorContext,
    current: LoadedRow,
    inputFinal: PaymentTiming | undefined,
  ): Promise<void> {
    const proposed = asPaymentTiming(current.proposed_payment_timing);
    if (!proposed) {
      throw new ValidationFailedError('This request has no proposed payment timing.');
    }
    const final = inputFinal ?? proposed;
    await this.writeFinalPaymentTiming(tx, actor, current.id, final, false);
    const changed = final !== proposed;
    await tx.appendTimeline({
      subjectType: 'PROCUREMENT',
      subjectId: current.id,
      text: changed
        ? `MD set payment timing to ${PAYMENT_TIMING_LABELS[final]} (GM proposed ${PAYMENT_TIMING_LABELS[proposed]}).`
        : `MD retained payment timing: ${PAYMENT_TIMING_LABELS[final]}.`,
      href: `/procurement/${current.id}`,
      entityId: current.entity_id,
    });
    await tx.audit({
      action: 'approve',
      subjectType: 'procurement_request',
      subjectId: current.id,
      subjectLabel: current.title,
      subjectReferenceNumber: current.reference_number,
      entityId: current.entity_id,
      oldValue: { proposedPaymentTiming: proposed, finalPaymentTiming: current.final_payment_timing },
      newValue: { finalPaymentTiming: final, retained: !changed },
    });
  }

  private async writeFinalPaymentTiming(
    tx: TxScope,
    actor: ActorContext,
    requestId: string,
    timing: PaymentTiming,
    pendingAck: boolean,
  ): Promise<void> {
    await tx.client.query(
      `UPDATE procurement_requests
          SET final_payment_timing = $1,
              final_payment_timing_set_at = now(),
              final_payment_timing_set_by = $2,
              timing_change_pending_ack = $3,
              updated_by = $2
        WHERE id = $4`,
      [timing, actor.ref, pendingAck, requestId],
    );
  }

  private async clearFinalPaymentTiming(tx: TxScope, actor: ActorContext, requestId: string): Promise<void> {
    await tx.client.query(
      `UPDATE procurement_requests
          SET final_payment_timing = NULL,
              final_payment_timing_set_at = NULL,
              final_payment_timing_set_by = NULL,
              timing_change_pending_ack = false,
              updated_by = $1
        WHERE id = $2`,
      [actor.ref, requestId],
    );
  }

  private async clearTimingPendingAck(tx: TxScope, actor: ActorContext, current: LoadedRow): Promise<void> {
    await tx.client.query(
      `UPDATE procurement_requests
          SET timing_change_pending_ack = false, updated_by = $1
        WHERE id = $2`,
      [actor.ref, current.id],
    );
    await tx.appendTimeline({
      subjectType: 'PROCUREMENT',
      subjectId: current.id,
      text: 'ED Finance acknowledged the payment-timing decision.',
      href: `/procurement/${current.id}`,
      entityId: current.entity_id,
    });
    await tx.audit({
      action: 'approve',
      subjectType: 'procurement_request',
      subjectId: current.id,
      subjectLabel: current.title,
      subjectReferenceNumber: current.reference_number,
      entityId: current.entity_id,
      oldValue: { timingChangePendingAck: true },
      newValue: { timingChangePendingAck: false },
    });
  }

  private async hasRecordedPayment(tx: TxScope, requestId: string): Promise<boolean> {
    const result = await tx.client.query<{ id: string }>(
      `SELECT id FROM procurement_payments WHERE request_id = $1 LIMIT 1`,
      [requestId],
    );
    return Boolean(result.rows[0]);
  }
}

function asPaymentTiming(value: string | null | undefined): PaymentTiming | null {
  if (!value) return null;
  return isPaymentTiming(value) ? value : null;
}

function financeReviewHasStarted(status: string): boolean {
  return ![
    'DRAFT',
    'DISCARDED',
    'AWAITING_NEED_APPROVAL',
    'AWAITING_PREPARATION',
    'AWAITING_OPERATIONS',
    'AWAITING_MD',
    'REJECTED',
    'ARCHIVED',
  ].includes(status);
}

function myActionDetail(item: ProcurementListItemView): string {
  const parts: string[] = [];
  if (item.entityCode) parts.push(item.entityCode);
  if (item.vendorName) parts.push(item.vendorName);
  if (item.totalAmountKobo != null && item.nextAction?.key !== 'approve_need') {
    parts.push(formatKobo(BigInt(item.totalAmountKobo)));
  }
  switch (item.nextAction?.key) {
    case 'upload_invoice':
      parts.push('ED Finance cannot approve until the invoice is attached');
      break;
    case 'decide_invoice_variance':
      parts.push('the invoice differs from the approved amount');
      break;
    case 'verify_delivery':
      parts.push(`${item.outstandingQuantity} outstanding`);
      if (item.secondBatchDueOn) parts.push(`second batch due ${item.secondBatchDueOn}`);
      break;
    case 'pay_vendor':
      parts.push(item.finalPaymentTiming === 'after_delivery' ? 'delivery verified' : 'pay before delivery');
      break;
    default:
      break;
  }
  return parts.join(' · ');
}

function invoiceStageFor(
  row: LoadedRow,
  variance: ProcurementInvoiceVarianceView | null,
): ProcurementInvoiceStage {
  return invoiceStageFrom({
    status: row.status,
    invoiceId: row.invoice_id,
    invoiceAmountKobo: row.invoice_amount_kobo == null ? null : Number(row.invoice_amount_kobo),
    totalAmountKobo: row.total_amount_kobo == null ? null : Number(row.total_amount_kobo),
    varianceStatus: variance?.status ?? null,
    varianceInvoiceAmountKobo: variance?.invoiceAmountKobo ?? null,
  });
}

function invoiceStageFrom(input: {
  status: string;
  invoiceId: string | null;
  invoiceAmountKobo: number | null;
  totalAmountKobo: number | null;
  varianceStatus: string | null;
  varianceInvoiceAmountKobo: number | null;
}): ProcurementInvoiceStage {
  if (input.status !== 'AWAITING_ED_FINANCE') return 'not_requested';
  if (!input.invoiceId) return 'awaiting_invoice';
  const invoiceAmount = input.invoiceAmountKobo ?? 0;
  if (invoiceAmount === (input.totalAmountKobo ?? 0)) return 'ready';
  if (input.varianceStatus === 'APPROVED' && input.varianceInvoiceAmountKobo === invoiceAmount) return 'ready';
  if (input.varianceStatus === 'REJECTED') return 'variance_rejected';
  return 'variance_pending';
}

/**
 * node-postgres parses a DATE as local midnight; `toISOString()` would shift it
 * to the previous day east of UTC, and every autosave would move it back again.
 */
function dateOnly(value: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return formatLagosIsoDate(value);
}

function firstContact(raw: unknown): { name?: string; phone?: string | null; email?: string | null } | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0] as Record<string, unknown>;
  return {
    name: typeof first.name === 'string' ? first.name : undefined,
    phone: typeof first.phone === 'string' ? first.phone : null,
    email: typeof first.email === 'string' ? first.email : null,
  };
}
