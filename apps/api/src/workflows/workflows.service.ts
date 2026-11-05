import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { isSystemActorRef, snapshotHash } from '@nfc/db';
import {
  BILL_WORKFLOW_KEY,
  BUDGET_WORKFLOW_KEY,
  CLOSE_SHORT_WORKFLOW_KEY,
  DUMMY_WORKFLOW_KEY,
  EDMS_DOCUMENT_WORKFLOW_KEY,
  EXPENSE_WORKFLOW_KEY,
  INCOME_WORKFLOW_KEY,
  INVENTORY_ADJUST_WORKFLOW_KEY,
  INVENTORY_TRANSFER_WORKFLOW_KEY,
  PRODUCTION_COMPLETE_WORKFLOW_KEY,
  SALES_ORDER_WORKFLOW_KEY,
  JOURNAL_WORKFLOW_KEY,
  PAYROLL_RUN_WORKFLOW_KEY,
  PROCUREMENT_WORKFLOW_KEY,
  formatKobo,
  isFundingRoute,
  isPaymentTiming,
  procurementNextAction,
  REQUIRED_VENDOR_COMPLIANCE,
  VENDOR_ONBOARDING_KEY,
  type PermissionKey,
  type ProcurementNextAction,
  type SealAction,
  type WorkflowAction,
  type WorkflowInstanceView,
  type WorkflowPendingView,
  type WorkflowScopeResolver,
  type WorkflowTrackerStageView,
  isWorkflowAction,
  workflowActionRequiresReason,
} from '@nfc/shared';
import { can } from '../auth/can';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ReasonRequiredError,
  StaleRecordError,
  ValidationFailedError,
} from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import { ExpensesService } from '../finance/expenses.service';
import { IncomeService } from '../finance/income.service';
import { LedgerPostingService } from '../finance/ledger-posting.service';
import { PayablesService } from '../finance/payables.service';
import { InventoryService } from '../inventory/inventory.service';
import { ProductionService } from '../inventory/production.service';
import { SalesService } from '../inventory/sales.service';
import { EdmsService } from '../edms/edms.service';
import { HrService } from '../hr/hr.service';
import { PayrollService } from '../payroll/payroll.service';
import { SealsService } from '../seals/seals.service';

interface StageRow {
  id: string;
  key: string;
  label: string;
  sort_order: number;
  required_permission: PermissionKey | null;
  scope_resolver: WorkflowScopeResolver;
  allowed_actions: string[];
  namedUserId?: string | null;
  blockSelfUserId?: string | null;
}

interface InstanceRow {
  id: string;
  definition_id: string;
  definition_key: string;
  subject_type: string;
  subject_id: string;
  subject_version: number;
  entity_id: string;
  entity_code: string | null;
  originator_user_id: string;
  originator_name: string;
  current_stage_id: string | null;
  current_stage_key: string | null;
  status: string;
  archived_from_stage_id: string | null;
  archived_from_stage_key: string | null;
  money_moved: boolean;
  row_version: number;
  title: string;
  reference_number: string;
  snapshot: unknown;
  created_at: Date;
  urgency: string | null;
  amount_kobo: string | null;
  linked_request_id: string | null;
}

const SEAL_FOR_ACTION: Partial<Record<WorkflowAction, SealAction>> = {
  APPROVE: 'approved',
  REJECT: 'rejected',
  RETURN_FOR_CORRECTION: 'returned',
};

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly seals: SealsService,
    @Optional() @Inject(forwardRef(() => IncomeService)) private readonly income?: IncomeService,
    @Optional() @Inject(forwardRef(() => ExpensesService)) private readonly expenses?: ExpensesService,
    @Optional() @Inject(forwardRef(() => PayablesService)) private readonly payables?: PayablesService,
    @Optional() @Inject(forwardRef(() => LedgerPostingService)) private readonly ledger?: LedgerPostingService,
    @Optional() @Inject(forwardRef(() => InventoryService)) private readonly inventory?: InventoryService,
    @Optional() @Inject(forwardRef(() => ProductionService)) private readonly production?: ProductionService,
    @Optional() @Inject(forwardRef(() => SalesService)) private readonly sales?: SalesService,
    @Optional() @Inject(forwardRef(() => EdmsService)) private readonly edms?: EdmsService,
    @Optional() @Inject(forwardRef(() => HrService)) private hr?: HrService,
    @Optional() @Inject(forwardRef(() => PayrollService)) private payroll?: PayrollService,
  ) {}

  attachHr(hr: HrService): void {
    this.hr = hr;
  }

  attachPayroll(payroll: PayrollService): void {
    this.payroll = payroll;
  }

  async submit(
    actor: ActorContext,
    input: { subjectId: string; definitionKey?: string },
  ): Promise<WorkflowInstanceView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const definitionKey = input.definitionKey ?? PROCUREMENT_WORKFLOW_KEY;
      const subject = await this.loadSubject(tx, input.subjectId);
      if (subject.originator_user_id !== actor.ref && !can(actor, 'procurement.create', subject.entity_id)) {
        throw new ForbiddenError('Only the originator can submit this request.');
      }
      const existing = await tx.client.query<{ id: string; status: string }>(
        `SELECT id, status FROM workflow_instances
          WHERE subject_type = 'DEMO_PROCUREMENT' AND subject_id = $1
            AND status IN ('IN_PROGRESS', 'DRAFT')`,
        [subject.id],
      );
      if (existing.rows[0]?.status === 'IN_PROGRESS') {
        throw new ConflictError('This request is already in progress.');
      }
      if (existing.rows[0]?.status === 'DRAFT') {
        return this.resubmitInTx(tx, actor, existing.rows[0].id, subject.row_version);
      }

      const definition = await this.loadDefinition(tx, definitionKey);
      const firstApproval = this.firstApprovalStage(definition.stages, 'DEMO_PROCUREMENT', definitionKey);
      if (!firstApproval) throw new Error('The workflow has no approval stage.');

      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO workflow_instances (
           definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
           current_stage_id, status, created_by, updated_by
         ) VALUES ($1, 'DEMO_PROCUREMENT', $2, $3, $4, $5::uuid, $6, 'IN_PROGRESS', $5::text, $5::text)
         RETURNING id`,
        [
          definition.id,
          subject.id,
          subject.current_version,
          subject.entity_id,
          actor.ref,
          firstApproval.id,
        ],
      );
      const instanceId = inserted.rows[0]?.id;
      if (!instanceId) throw new Error('The workflow instance was not created.');

      await this.writeCommitment(tx, subject.id, subject.entity_id, 'OPEN', actor.ref);
      await this.seals.create(tx, {
        actor,
        entityId: subject.entity_id,
        subjectType: 'DEMO_PROCUREMENT',
        subjectId: subject.id,
        subjectVersion: subject.current_version,
        snapshot: subject.snapshot,
        action: 'submitted',
      });
      await tx.publish({
        eventType: 'procurement.submitted',
        subjectType: 'DEMO_PROCUREMENT',
        subjectId: subject.id,
        entityId: subject.entity_id,
        payload: {
          type: 'procurement.approved',
          reference: subject.reference_number,
          title: subject.title,
          recipientUserId: actor.ref,
          href: `/workflows/${instanceId}`,
        },
      });
      await tx.appendTimeline({
        subjectType: 'DEMO_PROCUREMENT',
        subjectId: subject.id,
        text: `Submitted. Now at ${firstApproval.label}.`,
        href: `/workflows/${instanceId}`,
        entityId: subject.entity_id,
      });
      await this.replaceHolds(tx, {
        instanceId,
        subjectType: 'DEMO_PROCUREMENT',
        subjectId: subject.id,
        reference: subject.reference_number,
        title: subject.title,
        entityId: subject.entity_id,
        stage: firstApproval,
        status: 'IN_PROGRESS',
        originatorUserId: subject.originator_user_id,
        createdBy: actor.ref,
      });
      await tx.audit({
        action: 'create',
        subjectType: 'workflow_instance',
        subjectId: instanceId,
        subjectLabel: subject.title,
        subjectReferenceNumber: subject.reference_number,
        entityId: subject.entity_id,
        newValue: { status: 'IN_PROGRESS', stage: firstApproval.key },
      });
      return this.loadView(tx, actor, instanceId);
    });
  }

  async act(
    actor: ActorContext,
    input: {
      instanceId: string;
      action: string;
      reason?: string;
      rowVersion: number;
      idempotencyKey?: string;
      fundingRoute?: string;
      sourceAccountId?: string;
      destinationAccountId?: string;
    },
  ): Promise<WorkflowInstanceView> {
    return this.unitOfWork.write(actor, (tx) => this.actInTx(tx, actor, input));
  }

  async actInTx(
    tx: TxScope,
    actor: ActorContext,
    input: {
      instanceId: string;
      action: string;
      reason?: string;
      rowVersion: number;
      idempotencyKey?: string;
      fundingRoute?: string;
      sourceAccountId?: string;
      destinationAccountId?: string;
    },
  ): Promise<WorkflowInstanceView> {
    if (!isWorkflowAction(input.action)) {
      throw new ValidationFailedError(`Unknown workflow action "${input.action}".`);
    }
    const action = input.action;
    if (workflowActionRequiresReason(action) && !input.reason?.trim()) {
      throw new ReasonRequiredError(action.toLowerCase().replaceAll('_', ' '));
    }
    const instance = await this.lockInstance(tx, input.instanceId);
    if (instance.row_version !== input.rowVersion) {
      throw new StaleRecordError('This workflow has changed. Refresh and try again.', {
        rowVersion: instance.row_version,
      });
    }

    if (action === 'RESTORE') {
      return this.restoreInTx(tx, actor, instance, input.reason ?? '');
    }

    if (instance.status !== 'IN_PROGRESS' && action !== 'ARCHIVE') {
      throw new ConflictError('This workflow is not awaiting an action.');
    }
    if (
      (instance.money_moved || (await this.procurementMoneyHasMoved(tx, instance))) &&
      ['REJECT', 'RETURN_FOR_CORRECTION', 'ARCHIVE'].includes(action)
    ) {
      throw new ConflictError('Money has already moved. Use the financial correction process.');
    }

    const stages = await this.loadStages(tx, instance.definition_id);
    const current = stages.find((stage) => stage.id === instance.current_stage_id);
    if (!current) throw new ConflictError('This workflow has no current stage.');

    await this.hydrateStage(tx, instance, current);
    await this.assertActorMayAct(actor, instance, current, action);
    if (action === 'APPROVE' && current.key === 'finance-head' && instance.subject_type === 'PROCUREMENT') {
      throw new ConflictError('Record the vendor payment; do not approve the Finance Head stage.');
    }
    if (action === 'APPROVE' && current.key === 'ed-finance' && instance.subject_type === 'PROCUREMENT') {
      // The finance decision (invoice, checklist, funding route) is recorded by the procurement
      // service before it calls this; approving from anywhere else would skip the invoice gate.
      const decided = await tx.client.query<{ ok: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM procurement_financial_reviews f
             JOIN procurement_requests r ON r.id = f.request_id
             JOIN procurement_versions v ON v.id = f.version_id AND v.version_number = r.current_version
            WHERE r.id = $1
         ) AS ok`,
        [instance.subject_id],
      );
      if (!decided.rows[0]?.ok) {
        throw new ConflictError('Approve funding from the procurement record so the invoice and checks are verified.');
      }
    }

      if (action === 'APPROVE') {
        if (
          instance.originator_user_id === actor.ref &&
          !this.hr?.allowsOriginatorApproval(instance.subject_type)
        ) {
          throw new ForbiddenError('The originator cannot approve their own item.');
        }
        if (instance.subject_type === 'VENDOR') {
          const creator = await tx.client.query<{ created_by: string }>(
            `SELECT created_by FROM vendors WHERE id = $1`,
            [instance.subject_id],
          );
          if (creator.rows[0]?.created_by === actor.ref) {
            throw new ForbiddenError('The user who created this vendor cannot activate it.');
          }
        }
        const prior = await tx.client.query<{ id: string }>(
          `SELECT id FROM workflow_actions
            WHERE instance_id = $1 AND actor_id = $2 AND subject_version = $3 AND action = 'APPROVE'`,
          [instance.id, actor.ref, instance.subject_version],
        );
        if (prior.rows[0]) {
          throw new ForbiddenError('The same user cannot approve two stages of the same version.');
        }
      }

      let next = this.nextState(current, stages, action, instance);
      if (action === 'APPROVE' && next.status === 'IN_PROGRESS' && next.currentStageId) {
        const resolved = await this.skipUnassignedNamedStages(tx, instance.id, stages, next.currentStageId);
        next = resolved
          ? { ...next, currentStageId: resolved.id, currentStageKey: resolved.key }
          : { status: 'COMPLETED', currentStageId: current.id, currentStageKey: current.key, archivedFromStageId: null };
      }
      if (
        action === 'APPROVE' &&
        current.key === 'finance-head' &&
        instance.subject_type === 'PAYROLL_RUN' &&
        next.status === 'IN_PROGRESS'
      ) {
        const net = await this.payroll?.netKoboInTx(tx, instance.subject_id);
        const threshold = await this.payroll?.thresholdKoboInTx(tx);
        if (net != null && threshold != null && net < threshold) {
          next = {
            status: 'COMPLETED',
            currentStageId: current.id,
            currentStageKey: current.key,
            archivedFromStageId: null,
          };
        }
      }
      if (
        action === 'APPROVE' &&
        current.key === 'ed-finance' &&
        instance.subject_type === 'PROCUREMENT'
      ) {
        const route = input.fundingRoute;
        if (route !== 'subsidiary_operating' && route !== 'nfc_holding' && route !== 'corporate_allocation') {
          throw new ValidationFailedError('A funding route is required to approve at Finance review.');
        }
        if (route !== 'subsidiary_operating') {
          next = {
            status: 'IN_PROGRESS',
            currentStageId: current.id,
            currentStageKey: current.key,
            archivedFromStageId: null,
          };
        }
      }
      const snapshot = await this.snapshotForProcurementAction(tx, instance, current.key, instance.snapshot);
      const hash = snapshotHash(snapshot);
      const idempotencyKey = input.idempotencyKey ?? randomUUID();

      try {
        await tx.client.query(
          `INSERT INTO workflow_actions (
             instance_id, stage_id, entity_id, action, actor_id, actor_permission, reason,
             previous_status, new_status, subject_version, snapshot_hash, idempotency_key, created_by
           ) VALUES ($1, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10, $11, $12, $5::text)`,
          [
            instance.id,
            current.id,
            instance.entity_id,
            action,
            actor.ref,
            current.required_permission,
            input.reason?.trim() ?? null,
            instance.status,
            next.status,
            instance.subject_version,
            hash,
            idempotencyKey,
          ],
        );
      } catch (error) {
        const pg = error as { code?: string };
        if (pg.code === '23505') {
          return this.loadView(tx, actor, instance.id);
        }
        throw error;
      }

      const sealAction = this.sealActionFor(action, instance.subject_type, current.key);
      if (
        sealAction &&
        instance.subject_type !== 'VENDOR' &&
        instance.subject_type !== 'CLOSE_SHORT' &&
        instance.subject_type !== 'EDMS_DOCUMENT' &&
        !instance.subject_type.startsWith('HR_')
      ) {
        await this.seals.create(tx, {
          actor,
          entityId: instance.entity_id,
          subjectType: instance.subject_type,
          subjectId: instance.subject_id,
          subjectVersion: instance.subject_version,
          snapshot,
          action: sealAction,
          reason: input.reason?.trim() ?? null,
        });
      }

      if (action === 'RETURN_FOR_CORRECTION') {
        await this.bumpSubjectVersion(tx, instance.subject_id, actor.ref);
        if (instance.subject_type === 'PROCUREMENT' && current.key === 'need-approval') {
          await this.bumpLinkedRequisition(tx, instance.subject_id, actor.ref);
        }
      }
      if (
        ['REJECT', 'RETURN_FOR_CORRECTION', 'ARCHIVE'].includes(action) &&
        !(instance.subject_type === 'PROCUREMENT' && current.key === 'need-approval')
      ) {
        await this.writeCommitment(tx, instance.subject_id, instance.entity_id, 'RELEASE', actor.ref);
      }

      await this.applyVendorOnboardingOutcome(tx, actor, instance, action, next.status);
      await this.applyProcurementOutcome(tx, actor, instance, action, next, input.fundingRoute);
      await this.applyJournalOutcome(tx, actor, instance, action, next.status);
      await this.applyBudgetOutcome(tx, actor, instance, action, next.status);
      await this.applyIncomeOutcome(tx, actor, instance, action, next.status);
      await this.applyExpenseOutcome(tx, actor, instance, action, next.status);
      await this.applyBillOutcome(tx, actor, instance, action, next.status);
      await this.applyInventoryAdjustmentOutcome(tx, actor, instance, action, next.status);
      await this.applyInventoryTransferOutcome(tx, actor, instance, action, next.status);
      await this.applyProductionOutcome(tx, actor, instance, action, next.status);
      await this.applySalesOrderOutcome(tx, actor, instance, action, next.status);
      await this.applyEdmsDocumentOutcome(tx, instance, action, next.status);
      await this.applyHrOutcome(tx, actor, instance, action, next.status, current.key);
      await this.applyPayrollOutcome(tx, actor, instance, action, next.status);
      await this.applyCloseShortOutcome(
        tx,
        actor,
        instance,
        action,
        next.status,
        current,
        input.reason?.trim() ?? null,
      );

      await tx.client.query(
        `UPDATE workflow_instances
            SET status = $1,
                current_stage_id = $2,
                archived_from_stage_id = $3,
                subject_version = $4,
                updated_by = $5
          WHERE id = $6 AND row_version = $7`,
        [
          next.status,
          next.currentStageId,
          next.archivedFromStageId,
          action === 'RETURN_FOR_CORRECTION' ? instance.subject_version + 1 : instance.subject_version,
          actor.ref,
          instance.id,
          instance.row_version,
        ],
      );

      const eventType = this.eventTypeFor(instance, action, next.status);
      const href = this.subjectHref(
        instance.subject_type,
        instance.subject_id,
        instance.id,
        instance.linked_request_id,
      );
      await tx.publish({
        eventType,
        subjectType: instance.subject_type,
        subjectId: instance.subject_id,
        entityId: instance.entity_id,
        payload: {
          type: eventType,
          reference: instance.reference_number,
          title: instance.title,
          reason: input.reason?.trim() ?? '',
          summary: this.approvalSummary(action, current.key),
          recipientUserId: instance.originator_user_id,
          href,
        },
      });
      await tx.appendTimeline({
        subjectType: instance.subject_type,
        subjectId: instance.subject_id,
        text: this.timelineText(action, current.label, input.reason),
        href,
        entityId: instance.entity_id,
      });
      await tx.audit({
        action:
          action === 'APPROVE'
            ? 'approve'
            : action === 'REJECT'
              ? 'reject'
              : action === 'RETURN_FOR_CORRECTION'
                ? 'return'
                : 'archive',
        subjectType: 'workflow_instance',
        subjectId: instance.id,
        subjectLabel: instance.title,
        subjectReferenceNumber: instance.reference_number,
        entityId: instance.entity_id,
        reason: input.reason?.trim() ?? null,
        oldValue: { status: instance.status, stage: current.key },
        newValue: { status: next.status, stage: next.currentStageKey },
      });

      const holdStage = next.currentStageId
        ? stages.find((stage) => stage.id === next.currentStageId) ?? null
        : null;
      await this.replaceHolds(tx, {
        instanceId: instance.id,
        subjectType: instance.subject_type,
        subjectId: instance.subject_id,
        reference: instance.reference_number,
        title: instance.title,
        entityId: instance.entity_id,
        stage: holdStage,
        status: next.status,
        originatorUserId: instance.originator_user_id,
        createdBy: actor.ref,
      });
      if (next.status === 'IN_PROGRESS') {
        await this.notifyNextApprovers(tx, instance, holdStage, href);
      }

      return this.loadView(tx, actor, instance.id);
  }

  async get(actor: ActorContext, id: string): Promise<WorkflowInstanceView> {
    return this.unitOfWork.write(actor, async (tx) => this.loadView(tx, actor, id));
  }

  async getBySubject(actor: ActorContext, subjectId: string): Promise<WorkflowInstanceView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const found = await tx.client.query<{ id: string }>(
        `SELECT id FROM workflow_instances
          WHERE subject_id = $1
            AND subject_type IN ('DEMO_PROCUREMENT', 'VENDOR', 'PROCUREMENT', 'CLOSE_SHORT', 'JOURNAL', 'BUDGET', 'INCOME', 'EXPENSE', 'BILL', 'INVENTORY_ADJUSTMENT', 'INVENTORY_TRANSFER', 'PRODUCTION_ORDER', 'SALES_ORDER', 'EDMS_DOCUMENT', 'HR_CHANGE', 'HR_LEAVE', 'HR_OVERTIME', 'HR_PERFORMANCE', 'HR_DISCIPLINARY', 'PAYROLL_RUN')
          ORDER BY created_at DESC
          LIMIT 1`,
        [subjectId],
      );
      const id = found.rows[0]?.id;
      if (!id) throw new NotFoundError('That workflow does not exist.');
      return this.loadView(tx, actor, id);
    });
  }

  async pending(actor: ActorContext): Promise<WorkflowPendingView[]> {
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<InstanceRow>(
        `${this.instanceSelectSql({ archived: false })}
          WHERE i.status IN ('IN_PROGRESS', 'DRAFT')
            AND (sub.id IS NOT NULL OR v.id IS NOT NULL OR pr.id IS NOT NULL OR cs.id IS NOT NULL OR jnl.id IS NOT NULL OR bud.id IS NOT NULL OR inc.id IS NOT NULL OR exp.id IS NOT NULL OR bill.id IS NOT NULL OR adj.id IS NOT NULL OR trf.id IS NOT NULL OR prd.id IS NOT NULL OR so.id IS NOT NULL OR edoc.id IS NOT NULL OR hrchg.id IS NOT NULL OR hrvac.id IS NOT NULL OR hroff.id IS NOT NULL OR hrlv.id IS NOT NULL OR hrot.id IS NOT NULL OR hrapp.id IS NOT NULL OR hrdisc.id IS NOT NULL OR prl.id IS NOT NULL)
          ORDER BY i.created_at`,
      );
      const pending: WorkflowPendingView[] = [];
      for (const row of result.rows) {
        if (row.status === 'DRAFT' && row.originator_user_id === actor.ref) {
          pending.push(this.toPending(row, 'Returned to originator'));
          continue;
        }
        if (row.status !== 'IN_PROGRESS' || !row.current_stage_id) continue;
        const stages = await this.loadStages(tx, row.definition_id);
        const current = stages.find((stage) => stage.id === row.current_stage_id);
        if (!current) continue;
        await this.hydrateStage(tx, row, current);
        if (
          this.actorMatchesStage(actor, row.entity_id, current) &&
          (row.originator_user_id !== actor.ref || this.hr?.allowsOriginatorApproval(row.subject_type))
        ) {
          let label = current.label;
          if (row.subject_type === 'PROCUREMENT') {
            const state = await this.procurementWaitState(tx, row.subject_id);
            if (state && (state.status === 'AWAITING_DELIVERY' || state.status === 'PARTIALLY_RECEIVED')) continue;
            if (state?.deferred) label = `${current.label} — waiting for the vendor invoice`;
            else if (state?.action) label = `${current.label} — ${state.action.label}`;
          }
          pending.push(this.toPending(row, label));
        }
      }
      return pending;
    });
  }

  async createAndSubmit(
    actor: ActorContext,
    title: string,
    definitionKey = DUMMY_WORKFLOW_KEY,
  ): Promise<WorkflowInstanceView> {
    const entityId = actor.entityIds[0];
    if (!entityId) throw new ValidationFailedError('An entity is required.');
    if (!can(actor, 'procurement.create', entityId)) {
      throw new ForbiddenError('You cannot start this workflow.');
    }
    return this.unitOfWork.write(actor, async (tx) => {
      const id = randomUUID();
      const snapshot = { title, version: 1, dummy: definitionKey === DUMMY_WORKFLOW_KEY };
      await tx.client.query(
        `INSERT INTO workflow_demo_subjects (
           id, reference_number, entity_id, originator_user_id, title, current_version, snapshot, status, created_by, updated_by
         ) VALUES ($1, $2, $3, $4::uuid, $5, 1, $6::jsonb, 'DRAFT', $4::text, $4::text)`,
        [id, `PR-DEMO-${id.slice(0, 8)}`, entityId, actor.ref, title, JSON.stringify(snapshot)],
      );
      await tx.client.query(
        `INSERT INTO workflow_demo_subject_versions (subject_id, entity_id, version, snapshot, created_by)
         VALUES ($1, $2, 1, $3::jsonb, $4)`,
        [id, entityId, JSON.stringify(snapshot), actor.ref],
      );
      return this.submitInDefinition(tx, actor, id, definitionKey);
    });
  }

  async startVendorOnboarding(actor: ActorContext, vendorId: string): Promise<WorkflowInstanceView> {
    if (!can(actor, 'vendor.create')) {
      throw new ForbiddenError('Your role does not permit this action.', { permission: 'vendor.create' });
    }
    return this.unitOfWork.write(actor, async (tx) => {
      const vendor = await tx.client.query<{
        id: string;
        reference_number: string;
        entity_id: string;
        legal_name: string;
        status: string;
        created_by: string;
        row_version: number;
        bank_name: string | null;
        account_name: string | null;
        account_number: string | null;
      }>(
        `SELECT id, reference_number, entity_id, legal_name, status, created_by, row_version,
                bank_name, account_name, account_number
           FROM vendors WHERE id = $1 FOR UPDATE`,
        [vendorId],
      );
      const row = vendor.rows[0];
      if (!row) throw new NotFoundError('That vendor was not found.');
      if (row.status !== 'DRAFT') {
        throw new ConflictError('Only a draft vendor can be submitted for onboarding.');
      }
      if (!row.bank_name || !row.account_name || !row.account_number) {
        throw new ValidationFailedError('Bank details are required before onboarding.');
      }
      const docs = await tx.client.query<{ compliance_type: string }>(
        `SELECT DISTINCT compliance_type FROM vendor_compliance_documents WHERE vendor_id = $1`,
        [vendorId],
      );
      const present = new Set(docs.rows.map((item) => item.compliance_type));
      const missing = REQUIRED_VENDOR_COMPLIANCE.filter((type) => !present.has(type));
      if (missing.length > 0) {
        throw new ValidationFailedError(
          `Required compliance documents are missing: ${missing.join(', ')}.`,
        );
      }

      const existing = await tx.client.query<{ id: string; status: string }>(
        `SELECT id, status FROM workflow_instances
          WHERE subject_type = 'VENDOR' AND subject_id = $1
            AND status IN ('IN_PROGRESS', 'DRAFT')`,
        [vendorId],
      );
      if (existing.rows[0]?.status === 'IN_PROGRESS') {
        throw new ConflictError('This vendor is already in onboarding review.');
      }
      if (existing.rows[0]?.status === 'DRAFT') {
        const view = await this.resubmitInTx(tx, actor, existing.rows[0].id, row.row_version);
        await tx.client.query(
          `UPDATE vendors SET status = 'PENDING_REVIEW', updated_by = $1 WHERE id = $2`,
          [actor.ref, vendorId],
        );
        return view;
      }

      const definition = await this.loadDefinition(tx, VENDOR_ONBOARDING_KEY);
      const firstApproval = definition.stages.find((stage) => stage.required_permission);
      if (!firstApproval) throw new Error('The workflow has no approval stage.');
      const snapshot = {
        legalName: row.legal_name,
        reference: row.reference_number,
        version: row.row_version,
      };
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO workflow_instances (
           definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
           current_stage_id, status, created_by, updated_by
         ) VALUES ($1, 'VENDOR', $2, $3, $4, $5::uuid, $6, 'IN_PROGRESS', $5::text, $5::text)
         RETURNING id`,
        [definition.id, row.id, row.row_version, row.entity_id, actor.ref, firstApproval.id],
      );
      const instanceId = inserted.rows[0]?.id;
      if (!instanceId) throw new Error('The workflow instance was not created.');
      await tx.client.query(
        `UPDATE vendors SET status = 'PENDING_REVIEW', updated_by = $1 WHERE id = $2`,
        [actor.ref, vendorId],
      );
      await this.replaceHolds(tx, {
        instanceId,
        subjectType: 'VENDOR',
        subjectId: row.id,
        reference: row.reference_number,
        title: row.legal_name,
        entityId: row.entity_id,
        stage: firstApproval,
        status: 'IN_PROGRESS',
        originatorUserId: actor.ref,
        createdBy: actor.ref,
      });
      await tx.publish({
        eventType: 'vendor.submitted',
        subjectType: 'VENDOR',
        subjectId: row.id,
        entityId: row.entity_id,
        payload: {
          type: 'vendor.submitted',
          reference: row.reference_number,
          title: row.legal_name,
          reason: '',
          href: `/vendors/${row.id}`,
        },
      });
      await tx.appendTimeline({
        subjectType: 'VENDOR',
        subjectId: row.id,
        text: 'Submitted for onboarding review.',
        href: `/vendors/${row.id}`,
        entityId: row.entity_id,
      });
      await tx.audit({
        action: 'edit',
        subjectType: 'vendor',
        subjectId: row.id,
        subjectLabel: row.legal_name,
        subjectReferenceNumber: row.reference_number,
        entityId: row.entity_id,
        oldValue: { status: 'DRAFT' },
        newValue: { status: 'PENDING_REVIEW' },
      });
      void snapshot;
      return this.loadView(tx, actor, instanceId);
    });
  }

  async startProcurementInTx(
    tx: TxScope,
    actor: ActorContext,
    input: {
      requestId: string;
      snapshot: unknown;
    },
  ): Promise<WorkflowInstanceView> {
    const request = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      current_version: number;
      title: string;
    }>(
      `SELECT r.id, r.reference_number, r.entity_id, r.originator_user_id, r.current_version,
              v.title
         FROM procurement_requests r
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
        WHERE r.id = $1
        FOR UPDATE OF r`,
      [input.requestId],
    );
    const row = request.rows[0];
    if (!row) throw new NotFoundError('That procurement request was not found.');

    const existing = await tx.client.query<{ id: string; status: string }>(
      `SELECT id, status FROM workflow_instances
        WHERE subject_type = 'PROCUREMENT' AND subject_id = $1
          AND status IN ('IN_PROGRESS', 'DRAFT')`,
      [row.id],
    );
    if (existing.rows[0]?.status === 'IN_PROGRESS') {
      throw new ConflictError('This request is already in review.');
    }
    if (existing.rows[0]?.status === 'DRAFT') {
      return this.resubmitInTx(tx, actor, existing.rows[0].id, 0);
    }

    const definition = await this.loadDefinition(tx, PROCUREMENT_WORKFLOW_KEY);
    const firstApproval =
      definition.stages.find((stage) => stage.key === 'ed-operations') ??
      definition.stages.find((stage) => stage.required_permission);
    if (!firstApproval) throw new Error('The workflow has no approval stage.');

    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO workflow_instances (
         definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
         current_stage_id, status, created_by, updated_by
       ) VALUES ($1, 'PROCUREMENT', $2, $3, $4, $5::uuid, $6, 'IN_PROGRESS', $7, $7)
       RETURNING id`,
      [
        definition.id,
        row.id,
        row.current_version,
        row.entity_id,
        row.originator_user_id,
        firstApproval.id,
        actor.ref,
      ],
    );
    const instanceId = inserted.rows[0]?.id;
    if (!instanceId) throw new Error('The workflow instance was not created.');

    await this.seals.create(tx, {
      actor,
      entityId: row.entity_id,
      subjectType: 'PROCUREMENT',
      subjectId: row.id,
      subjectVersion: row.current_version,
      snapshot: input.snapshot,
      action: 'submitted',
    });
    await this.writeCommitment(tx, row.id, row.entity_id, 'OPEN', actor.ref);
    await tx.publish({
      eventType: 'procurement.submitted',
      subjectType: 'PROCUREMENT',
      subjectId: row.id,
      entityId: row.entity_id,
      payload: {
        type: 'procurement.submitted',
        reference: row.reference_number,
        title: row.title,
        reason: '',
        href: `/procurement/${row.id}`,
      },
    });
    await this.replaceHolds(tx, {
      instanceId,
      subjectType: 'PROCUREMENT',
      subjectId: row.id,
      reference: row.reference_number,
      title: row.title,
      entityId: row.entity_id,
      stage: firstApproval,
      status: 'IN_PROGRESS',
      originatorUserId: row.originator_user_id,
      createdBy: actor.ref,
    });
    await this.notifyNextApprovers(
      tx,
      {
        subject_type: 'PROCUREMENT',
        subject_id: row.id,
        reference_number: row.reference_number,
        title: row.title,
        entity_id: row.entity_id,
      },
      firstApproval,
      `/procurement/${row.id}`,
    );
    await tx.audit({
      action: 'create',
      subjectType: 'workflow_instance',
      subjectId: instanceId,
      subjectLabel: row.title,
      subjectReferenceNumber: row.reference_number,
      entityId: row.entity_id,
      newValue: { status: 'IN_PROGRESS', stage: firstApproval.key },
    });
    return this.loadView(tx, actor, instanceId);
  }

  async startRequisitionInTx(
    tx: TxScope,
    actor: ActorContext,
    input: { requestId: string; snapshot: unknown },
  ): Promise<WorkflowInstanceView> {
    const request = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      current_version: number;
      title: string;
      requisition_id: string | null;
    }>(
      `SELECT r.id, r.reference_number, r.entity_id, r.originator_user_id, r.current_version, v.title,
              r.requisition_id
         FROM procurement_requests r
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
        WHERE r.id = $1
        FOR UPDATE OF r`,
      [input.requestId],
    );
    const row = request.rows[0];
    if (!row) throw new NotFoundError('That procurement request was not found.');
    const href = row.requisition_id ? `/requisitions/${row.requisition_id}` : `/procurement/${row.id}`;
    const existing = await tx.client.query<{ id: string; status: string }>(
      `SELECT id, status FROM workflow_instances
        WHERE subject_type = 'PROCUREMENT' AND subject_id = $1
          AND status IN ('IN_PROGRESS', 'DRAFT')`,
      [row.id],
    );
    if (existing.rows[0]?.status === 'IN_PROGRESS') {
      throw new ConflictError('This request is already in review.');
    }
    const definition = await this.loadDefinition(tx, PROCUREMENT_WORKFLOW_KEY);
    const need = definition.stages.find((stage) => stage.key === 'need-approval');
    if (!need) throw new Error('The workflow has no need-approval stage.');
    if (existing.rows[0]?.status === 'DRAFT') {
      await tx.client.query(
        `UPDATE workflow_instances
            SET status = 'IN_PROGRESS', current_stage_id = $1, subject_version = $2, updated_by = $3
          WHERE id = $4`,
        [need.id, row.current_version, actor.ref, existing.rows[0].id],
      );
      await this.seals.create(tx, {
        actor,
        entityId: row.entity_id,
        subjectType: 'PROCUREMENT',
        subjectId: row.id,
        subjectVersion: row.current_version,
        snapshot: input.snapshot,
        action: 'submitted',
      });
      await this.replaceHolds(tx, {
        instanceId: existing.rows[0].id,
        subjectType: 'PROCUREMENT',
        subjectId: row.id,
        reference: row.reference_number,
        title: row.title,
        entityId: row.entity_id,
        stage: need,
        status: 'IN_PROGRESS',
        originatorUserId: row.originator_user_id,
        createdBy: actor.ref,
      });
      await this.notifyNextApprovers(
        tx,
        {
          subject_type: 'PROCUREMENT',
          subject_id: row.id,
          reference_number: row.reference_number,
          title: row.title,
          entity_id: row.entity_id,
        },
        need,
        href,
      );
      return this.loadView(tx, actor, existing.rows[0].id);
    }
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO workflow_instances (
         definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
         current_stage_id, status, created_by, updated_by
       ) VALUES ($1, 'PROCUREMENT', $2, $3, $4, $5::uuid, $6, 'IN_PROGRESS', $7, $7)
       RETURNING id`,
      [definition.id, row.id, row.current_version, row.entity_id, row.originator_user_id, need.id, actor.ref],
    );
    const instanceId = inserted.rows[0]?.id;
    if (!instanceId) throw new Error('The workflow instance was not created.');
    await this.seals.create(tx, {
      actor,
      entityId: row.entity_id,
      subjectType: 'PROCUREMENT',
      subjectId: row.id,
      subjectVersion: row.current_version,
      snapshot: input.snapshot,
      action: 'submitted',
    });
    await tx.publish({
      eventType: 'requisition.submitted',
      subjectType: 'PROCUREMENT',
      subjectId: row.id,
      entityId: row.entity_id,
      payload: {
        type: 'requisition.submitted',
        reference: row.reference_number,
        title: row.title,
        reason: '',
        href,
      },
    });
    await this.replaceHolds(tx, {
      instanceId,
      subjectType: 'PROCUREMENT',
      subjectId: row.id,
      reference: row.reference_number,
      title: row.title,
      entityId: row.entity_id,
      stage: need,
      status: 'IN_PROGRESS',
      originatorUserId: row.originator_user_id,
      createdBy: actor.ref,
    });
    await this.notifyNextApprovers(
      tx,
      {
        subject_type: 'PROCUREMENT',
        subject_id: row.id,
        reference_number: row.reference_number,
        title: row.title,
        entity_id: row.entity_id,
      },
      need,
      href,
    );
    return this.loadView(tx, actor, instanceId);
  }

  async prepareProposalInTx(
    tx: TxScope,
    actor: ActorContext,
    input: { requestId: string; snapshot: unknown; operationsMachinery: boolean },
  ): Promise<WorkflowInstanceView> {
    const request = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      current_version: number;
      title: string;
    }>(
      `SELECT r.id, r.reference_number, r.entity_id, r.originator_user_id, r.current_version, v.title
         FROM procurement_requests r
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
        WHERE r.id = $1
        FOR UPDATE OF r`,
      [input.requestId],
    );
    const row = request.rows[0];
    if (!row) throw new NotFoundError('That procurement request was not found.');
    const existing = await tx.client.query<{ id: string; status: string; subject_version: number }>(
      `SELECT id, status, subject_version FROM workflow_instances
        WHERE subject_type = 'PROCUREMENT' AND subject_id = $1
          AND status IN ('IN_PROGRESS', 'DRAFT')`,
      [row.id],
    );
    const instance = existing.rows[0];
    if (!instance) throw new ConflictError('Need approval must complete before a proposal is submitted.');
    const definition = await this.loadDefinition(tx, PROCUREMENT_WORKFLOW_KEY);
    const nextStage = input.operationsMachinery
      ? definition.stages.find((stage) => stage.key === 'ed-operations')
      : definition.stages.find((stage) => stage.key === 'md');
    if (!nextStage) throw new Error('The workflow is missing a review stage.');
    const nextStatus = input.operationsMachinery ? 'AWAITING_OPERATIONS' : 'AWAITING_MD';
    const nextVersion = Math.max(row.current_version, instance.subject_version + 1);
    await tx.client.query(
      `UPDATE workflow_instances
          SET status = 'IN_PROGRESS',
              current_stage_id = $1,
              subject_version = $2,
              updated_by = $3
        WHERE id = $4`,
      [nextStage.id, nextVersion, actor.ref, instance.id],
    );
    await tx.client.query(
      `UPDATE procurement_requests SET status = $1, updated_by = $2 WHERE id = $3`,
      [nextStatus, actor.ref, row.id],
    );
    await this.seals.create(tx, {
      actor,
      entityId: row.entity_id,
      subjectType: 'PROCUREMENT',
      subjectId: row.id,
      subjectVersion: nextVersion,
      snapshot: input.snapshot,
      action: 'prepared',
    });
    await this.writeCommitment(tx, row.id, row.entity_id, 'OPEN', actor.ref);
    await tx.publish({
      eventType: 'procurement.prepared',
      subjectType: 'PROCUREMENT',
      subjectId: row.id,
      entityId: row.entity_id,
      payload: {
        type: 'procurement.prepared',
        reference: row.reference_number,
        title: row.title,
        href: `/procurement/${row.id}`,
      },
    });
    await this.replaceHolds(tx, {
      instanceId: instance.id,
      subjectType: 'PROCUREMENT',
      subjectId: row.id,
      reference: row.reference_number,
      title: row.title,
      entityId: row.entity_id,
      stage: nextStage,
      status: 'IN_PROGRESS',
      originatorUserId: row.originator_user_id,
      createdBy: actor.ref,
    });
    await this.notifyNextApprovers(
      tx,
      {
        subject_type: 'PROCUREMENT',
        subject_id: row.id,
        reference_number: row.reference_number,
        title: row.title,
        entity_id: row.entity_id,
      },
      nextStage,
      `/procurement/${row.id}`,
    );
    return this.loadView(tx, actor, instance.id);
  }

  private async snapshotForProcurementAction(
    tx: TxScope,
    instance: InstanceRow,
    stageKey: string,
    fallback: unknown,
  ): Promise<unknown> {
    if (instance.subject_type !== 'PROCUREMENT' || stageKey !== 'need-approval') return fallback;
    const frozen = await tx.client.query<{ canonical_json: unknown }>(
      `SELECT s.canonical_json
         FROM procurement_requests r
         JOIN requisitions q ON q.id = r.requisition_id
         JOIN requisition_versions v ON v.requisition_id = q.id AND v.version_number = q.current_version
         JOIN requisition_memo_snapshots s ON s.version_id = v.id
        WHERE r.id = $1
        LIMIT 1`,
      [instance.subject_id],
    );
    return frozen.rows[0]?.canonical_json ?? fallback;
  }

  private async bumpLinkedRequisition(tx: TxScope, requestId: string, actorRef: string): Promise<void> {
    const linked = await tx.client.query<{ requisition_id: string }>(
      `SELECT requisition_id FROM procurement_requests WHERE id = $1 AND requisition_id IS NOT NULL`,
      [requestId],
    );
    const requisitionId = linked.rows[0]?.requisition_id;
    if (!requisitionId) return;
    const current = await tx.client.query<{ id: string; entity_id: string; current_version: number }>(
      `SELECT id, entity_id, current_version FROM requisitions WHERE id = $1 FOR UPDATE`,
      [requisitionId],
    );
    const requisition = current.rows[0];
    if (!requisition) return;
    const nextVersion = requisition.current_version + 1;
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO requisition_versions (
         requisition_id, entity_id, version_number, title, background, justification, prayer,
         category_id, required_date, urgency, delivery_location, created_by, updated_by
       )
       SELECT requisition_id, entity_id, $2, title, background, justification, prayer,
              category_id, required_date, urgency, delivery_location, $3, $3
         FROM requisition_versions
        WHERE requisition_id = $1 AND version_number = $4
       RETURNING id`,
      [requisitionId, nextVersion, actorRef, requisition.current_version],
    );
    const nextId = inserted.rows[0]?.id;
    if (nextId) {
      const previous = await tx.client.query<{ id: string }>(
        `SELECT id FROM requisition_versions WHERE requisition_id = $1 AND version_number = $2`,
        [requisitionId, requisition.current_version],
      );
      if (previous.rows[0]) {
        await tx.client.query(
          `INSERT INTO requisition_lines (
             version_id, entity_id, line_number, description, quantity, unit_id, created_by, updated_by
           )
           SELECT $1, entity_id, line_number, description, quantity, unit_id, $2, $2
             FROM requisition_lines WHERE version_id = $3 ORDER BY line_number`,
          [nextId, actorRef, previous.rows[0].id],
        );
      }
    }
    await tx.client.query(
      `UPDATE requisitions SET current_version = $1, status = 'DRAFT', updated_by = $2 WHERE id = $3`,
      [nextVersion, actorRef, requisitionId],
    );
  }

  private async submitInDefinition(
    tx: TxScope,
    actor: ActorContext,
    subjectId: string,
    definitionKey: string,
  ): Promise<WorkflowInstanceView> {
    const subject = await this.loadSubject(tx, subjectId);
    const definition = await this.loadDefinition(tx, definitionKey);
    const firstApproval = this.firstApprovalStage(definition.stages, 'DEMO_PROCUREMENT', definitionKey);
    if (!firstApproval) throw new Error('The workflow has no approval stage.');
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO workflow_instances (
         definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
         current_stage_id, status, created_by, updated_by
       ) VALUES ($1, 'DEMO_PROCUREMENT', $2, $3, $4, $5::uuid, $6, 'IN_PROGRESS', $5::text, $5::text)
       RETURNING id`,
      [definition.id, subject.id, subject.current_version, subject.entity_id, actor.ref, firstApproval.id],
    );
    const instanceId = inserted.rows[0]?.id;
    if (!instanceId) throw new Error('The workflow instance was not created.');
    await this.writeCommitment(tx, subject.id, subject.entity_id, 'OPEN', actor.ref);
    await this.seals.create(tx, {
      actor,
      entityId: subject.entity_id,
      subjectType: 'DEMO_PROCUREMENT',
      subjectId: subject.id,
      subjectVersion: subject.current_version,
      snapshot: subject.snapshot,
      action: 'submitted',
    });
    await this.replaceHolds(tx, {
      instanceId,
      subjectType: 'DEMO_PROCUREMENT',
      subjectId: subject.id,
      reference: subject.reference_number,
      title: subject.title,
      entityId: subject.entity_id,
      stage: firstApproval,
      status: 'IN_PROGRESS',
      originatorUserId: subject.originator_user_id,
      createdBy: actor.ref,
    });
    return this.loadView(tx, actor, instanceId);
  }

  private async resubmitInTx(
    tx: TxScope,
    actor: ActorContext,
    instanceId: string,
    _rowVersion: number,
  ): Promise<WorkflowInstanceView> {
    const instance = await this.lockInstance(tx, instanceId);
    if (instance.status !== 'DRAFT') {
      throw new ConflictError('Only a returned draft can be resubmitted.');
    }
    if (instance.originator_user_id !== actor.ref) {
      throw new ForbiddenError('Only the originator can resubmit this request.');
    }
    const stages = await this.loadStages(tx, instance.definition_id);
    const subject = await this.loadSubject(tx, instance.subject_id, instance.subject_type);
    let firstApproval = this.firstApprovalStage(stages, instance.subject_type, instance.definition_key);
    let openCommitment = true;
    if (instance.subject_type === 'PROCUREMENT') {
      const linked = await tx.client.query<{ requisition_id: string | null; prepared_by_user_id: string | null }>(
        `SELECT requisition_id, prepared_by_user_id FROM procurement_requests WHERE id = $1`,
        [instance.subject_id],
      );
      const row = linked.rows[0];
      if (row?.requisition_id && instance.current_stage_key === 'need-approval') {
        firstApproval = stages.find((stage) => stage.key === 'need-approval') ?? firstApproval;
        openCommitment = false;
      } else if (row?.prepared_by_user_id) {
        throw new ConflictError('Resubmit the priced proposal from Procurement.');
      } else {
        firstApproval = stages.find((stage) => stage.key === 'ed-operations') ?? firstApproval;
      }
    }
    if (!firstApproval) throw new Error('The workflow has no approval stage.');
    await tx.client.query(
      `UPDATE workflow_instances
          SET status = 'IN_PROGRESS',
              current_stage_id = $1,
              subject_version = $2,
              updated_by = $3
        WHERE id = $4`,
      [firstApproval.id, subject.current_version, actor.ref, instance.id],
    );
    if (openCommitment) {
      await this.writeCommitment(tx, subject.id, subject.entity_id, 'OPEN', actor.ref);
    }
    if (instance.subject_type !== 'VENDOR') {
      await this.seals.create(tx, {
        actor,
        entityId: subject.entity_id,
        subjectType: instance.subject_type,
        subjectId: subject.id,
        subjectVersion: subject.current_version,
        snapshot: subject.snapshot,
        action: 'submitted',
      });
    }
    const href = this.subjectHref(instance.subject_type, subject.id, instance.id);
    await this.replaceHolds(tx, {
      instanceId: instance.id,
      subjectType: instance.subject_type,
      subjectId: subject.id,
      reference: subject.reference_number,
      title: subject.title,
      entityId: subject.entity_id,
      stage: firstApproval,
      status: 'IN_PROGRESS',
      originatorUserId: subject.originator_user_id,
      createdBy: actor.ref,
    });
    await this.notifyNextApprovers(tx, instance, firstApproval, href);
    await tx.appendTimeline({
      subjectType: instance.subject_type,
      subjectId: subject.id,
      text: `Resubmitted as version ${subject.current_version}. Restarted at ${firstApproval.label}.`,
      href,
      entityId: subject.entity_id,
    });
    return this.loadView(tx, actor, instance.id);
  }

  async resubmit(actor: ActorContext, instanceId: string, rowVersion: number): Promise<WorkflowInstanceView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const instance = await this.lockInstance(tx, instanceId);
      if (instance.row_version !== rowVersion) {
        throw new StaleRecordError('This workflow has changed. Refresh and try again.');
      }
      return this.resubmitInTx(tx, actor, instanceId, rowVersion);
    });
  }

  private async restoreInTx(
    tx: TxScope,
    actor: ActorContext,
    instance: InstanceRow,
    reason: string,
  ): Promise<WorkflowInstanceView> {
    if (
      !can(actor, 'workflow.restore', instance.entity_id) &&
      !can(actor, 'procurement.restore', instance.entity_id)
    ) {
      throw new ForbiddenError('Only the Managing Director can restore an archived workflow.');
    }
    if (instance.status !== 'ARCHIVED') {
      throw new ConflictError('Only an archived workflow can be restored.');
    }
    await tx.client.query(
      `INSERT INTO workflow_actions (
         instance_id, stage_id, entity_id, action, actor_id, actor_permission, reason,
         previous_status, new_status, subject_version, snapshot_hash, idempotency_key, created_by
       ) VALUES ($1, $2, $3, 'RESTORE', $4::uuid, 'workflow.restore', $5, 'ARCHIVED', 'IN_PROGRESS', $6, $7, $8, $4::text)`,
      [
        instance.id,
        instance.archived_from_stage_id ?? instance.current_stage_id,
        instance.entity_id,
        actor.ref,
        reason.trim(),
        instance.subject_version,
        snapshotHash(instance.snapshot),
        randomUUID(),
      ],
    );
    await tx.client.query(
      `UPDATE workflow_instances
          SET status = 'IN_PROGRESS',
              current_stage_id = coalesce(archived_from_stage_id, current_stage_id),
              archived_from_stage_id = NULL,
              updated_by = $1
        WHERE id = $2`,
      [actor.ref, instance.id],
    );
    await tx.audit({
      action: 'edit',
      subjectType: 'workflow_instance',
      subjectId: instance.id,
      subjectLabel: instance.title,
      subjectReferenceNumber: instance.reference_number,
      entityId: instance.entity_id,
      reason: reason.trim(),
      oldValue: { status: 'ARCHIVED' },
      newValue: { status: 'IN_PROGRESS' },
    });
    await this.applyProcurementRestore(tx, actor, instance);
    const stages = await this.loadStages(tx, instance.definition_id);
    const restoredStage = stages.find(
      (stage) => stage.id === (instance.archived_from_stage_id ?? instance.current_stage_id),
    );
    await this.replaceHolds(tx, {
      instanceId: instance.id,
      subjectType: instance.subject_type,
      subjectId: instance.subject_id,
      reference: instance.reference_number,
      title: instance.title,
      entityId: instance.entity_id,
      stage: restoredStage ?? null,
      status: 'IN_PROGRESS',
      originatorUserId: instance.originator_user_id,
      createdBy: actor.ref,
    });
    return this.loadView(tx, actor, instance.id);
  }

  private async assertActorMayAct(
    actor: ActorContext,
    instance: InstanceRow,
    stage: StageRow,
    action: WorkflowAction,
  ): Promise<void> {
    if (action === 'ARCHIVE') {
      const atOwnStage = this.actorMatchesStage(actor, instance.entity_id, stage);
      const mdArchive =
        can(actor, 'workflow.archive', instance.entity_id) ||
        can(actor, 'procurement.archive', instance.entity_id);
      if (!atOwnStage && !mdArchive) {
        throw new ForbiddenError('You cannot archive this workflow.');
      }
      if (instance.status !== 'IN_PROGRESS' && instance.status !== 'DRAFT') {
        throw new ConflictError('This workflow cannot be archived in its current status.');
      }
      return;
    }
    if (!this.actorMatchesStage(actor, instance.entity_id, stage)) {
      throw new ForbiddenError('You do not hold the permission for the current stage.');
    }
    if (!stage.allowed_actions.includes(action)) {
      throw new ForbiddenError('That action is not allowed at this stage.');
    }
  }

  private firstApprovalStage(
    stages: StageRow[],
    subjectType: string,
    definitionKey?: string,
  ): StageRow | undefined {
    if (subjectType === 'DEMO_PROCUREMENT' || definitionKey === PROCUREMENT_WORKFLOW_KEY) {
      const operations = stages.find((stage) => stage.key === 'ed-operations');
      if (subjectType === 'DEMO_PROCUREMENT' && operations) return operations;
    }
    return stages.find((stage) => stage.required_permission);
  }

  private actorMatchesStage(actor: ActorContext, entityId: string, stage: StageRow): boolean {
    if (stage.blockSelfUserId && stage.blockSelfUserId === actor.ref) return false;
    if (stage.scope_resolver === 'NAMED_ASSIGNEE') return stage.namedUserId === actor.ref;
    if (!stage.required_permission) return false;
    if (!can(actor, stage.required_permission, entityId)) return false;
    if (stage.scope_resolver === 'CORPORATE') return actor.isCorporate;
    if (stage.scope_resolver === 'SAME_ENTITY') {
      return !actor.isCorporate && actor.entityIds.includes(entityId);
    }
    return true;
  }

  private async hydrateStage(
    tx: TxScope,
    instance: { id: string; subject_id: string; subject_type: string; definition_key: string },
    stage: StageRow,
  ): Promise<void> {
    if (stage.scope_resolver === 'NAMED_ASSIGNEE') {
      const row = await tx.client.query<{ user_id: string }>(
        `SELECT user_id FROM workflow_stage_assignees WHERE instance_id = $1 AND stage_key = $2`,
        [instance.id, stage.key],
      );
      stage.namedUserId = row.rows[0]?.user_id ?? null;
    }
    if (instance.subject_type === 'HR_LEAVE' && instance.definition_key === 'hr-leave-v2') {
      const row = await tx.client.query<{ user_id: string | null }>(
        `SELECT e.user_id
           FROM hr_leave_requests l
           JOIN hr_employees e ON e.id = l.employee_id
          WHERE l.id = $1`,
        [instance.subject_id],
      );
      stage.blockSelfUserId = row.rows[0]?.user_id ?? null;
    }
  }

  private async skipUnassignedNamedStages(
    tx: TxScope,
    instanceId: string,
    stages: StageRow[],
    stageId: string,
  ): Promise<StageRow | null> {
    let stage = stages.find((row) => row.id === stageId) ?? null;
    while (stage?.scope_resolver === 'NAMED_ASSIGNEE') {
      const found = await tx.client.query<{ user_id: string }>(
        `SELECT user_id FROM workflow_stage_assignees WHERE instance_id = $1 AND stage_key = $2`,
        [instanceId, stage.key],
      );
      if (found.rows[0]) {
        stage.namedUserId = found.rows[0].user_id;
        return stage;
      }
      const sortOrder = stage.sort_order;
      stage = stages.find((row) => row.sort_order === sortOrder + 1) ?? null;
    }
    return stage;
  }

  private sealActionFor(
    action: WorkflowAction,
    subjectType: string,
    stageKey: string,
  ): SealAction | undefined {
    if (action === 'APPROVE' && subjectType === 'PROCUREMENT') {
      if (stageKey === 'need-approval') return 'need_approved';
      if (stageKey === 'ed-operations') return 'operations_reviewed';
      if (stageKey === 'md') return 'procurement_approved';
      if (stageKey === 'ed-finance') return 'approved';
    }
    return SEAL_FOR_ACTION[action];
  }

  private nextState(
    current: StageRow,
    stages: StageRow[],
    action: WorkflowAction,
    instance?: { subject_type: string },
  ): {
    status: string;
    currentStageId: string | null;
    currentStageKey: string | null;
    archivedFromStageId: string | null;
  } {
    if (action === 'REJECT') {
      return { status: 'REJECTED', currentStageId: current.id, currentStageKey: current.key, archivedFromStageId: null };
    }
    if (action === 'ARCHIVE') {
      return {
        status: 'ARCHIVED',
        currentStageId: current.id,
        currentStageKey: current.key,
        archivedFromStageId: current.id,
      };
    }
    if (action === 'RETURN_FOR_CORRECTION') {
      if (instance?.subject_type === 'PROCUREMENT') {
        if (current.key === 'need-approval') {
          return {
            status: 'DRAFT',
            currentStageId: current.id,
            currentStageKey: current.key,
            archivedFromStageId: null,
          };
        }
        const prepared = stages.find((stage) => stage.key === 'prepared');
        if (prepared && ['ed-operations', 'md', 'ed-finance'].includes(current.key)) {
          return {
            status: 'DRAFT',
            currentStageId: prepared.id,
            currentStageKey: prepared.key,
            archivedFromStageId: null,
          };
        }
      }
      const entry = stages.find((stage) => !stage.required_permission) ?? current;
      return { status: 'DRAFT', currentStageId: entry.id, currentStageKey: entry.key, archivedFromStageId: null };
    }
    const next = stages.find((stage) => stage.sort_order === current.sort_order + 1);
    if (!next) {
      return { status: 'COMPLETED', currentStageId: current.id, currentStageKey: current.key, archivedFromStageId: null };
    }
    return { status: 'IN_PROGRESS', currentStageId: next.id, currentStageKey: next.key, archivedFromStageId: null };
  }

  private async bumpSubjectVersion(tx: TxScope, subjectId: string, actorRef: string): Promise<void> {
    const document = await tx.client.query<{ id: string }>(
      `SELECT id FROM documents WHERE id = $1`,
      [subjectId],
    );
    if (document.rows[0]) return;
    const procurement = await tx.client.query<{ id: string }>(
      `SELECT id FROM procurement_requests WHERE id = $1`,
      [subjectId],
    );
    if (procurement.rows[0]) {
      await this.bumpProcurementVersion(tx, subjectId, actorRef);
      return;
    }
    const demo = await tx.client.query<{ id: string }>(
      `SELECT id FROM workflow_demo_subjects WHERE id = $1`,
      [subjectId],
    );
    if (!demo.rows[0]) {
      await tx.client.query(
        `UPDATE vendors SET updated_by = $1 WHERE id = $2`,
        [actorRef, subjectId],
      );
      return;
    }
    const current = await this.loadSubject(tx, subjectId);
    const nextVersion = current.current_version + 1;
    const nextSnapshot = { ...(current.snapshot as Record<string, unknown>), version: nextVersion };
    await tx.client.query(
      `INSERT INTO workflow_demo_subject_versions (subject_id, entity_id, version, snapshot, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [subjectId, current.entity_id, nextVersion, JSON.stringify(nextSnapshot), actorRef],
    );
    await tx.client.query(
      `UPDATE workflow_demo_subjects
          SET current_version = $1, snapshot = $2::jsonb, status = 'DRAFT', updated_by = $3
        WHERE id = $4`,
      [nextVersion, JSON.stringify(nextSnapshot), actorRef, subjectId],
    );
  }

  private async writeCommitment(
    tx: TxScope,
    subjectId: string,
    entityId: string,
    action: 'OPEN' | 'RELEASE',
    actorRef: string,
  ): Promise<void> {
    const demo = await tx.client.query<{ id: string }>(
      `SELECT id FROM workflow_demo_subjects WHERE id = $1`,
      [subjectId],
    );
    if (demo.rows[0]) {
      await tx.client.query(
        `INSERT INTO demo_commitment_events (subject_id, entity_id, action, amount_kobo, created_by)
         VALUES ($1, $2, $3, 0, $4)`,
        [subjectId, entityId, action, actorRef],
      );
      return;
    }
    const proc = await tx.client.query<{ id: string; version_id: string }>(
      `SELECT r.id, v.id AS version_id
         FROM procurement_requests r
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
        WHERE r.id = $1`,
      [subjectId],
    );
    const row = proc.rows[0];
    if (!row) return;
    const groups = await tx.client.query<{ budget_line_id: string | null; amount: string }>(
      `SELECT budget_line_id, coalesce(sum(line_amount_kobo), 0)::text AS amount
         FROM procurement_version_lines
        WHERE version_id = $1
        GROUP BY budget_line_id`,
      [row.version_id],
    );
    const splits =
      groups.rows.length > 0
        ? groups.rows
        : (
            await tx.client.query<{ budget_line_id: string | null; amount: string }>(
              `SELECT v.budget_line_id, coalesce(v.total_amount_kobo, 0)::text AS amount
                 FROM procurement_versions v WHERE v.id = $1`,
              [row.version_id],
            )
          ).rows;
    for (const split of splits) {
      const amount = Number(split.amount ?? 0);
      await tx.client.query(
        `INSERT INTO procurement_commitment_events (
           request_id, entity_id, budget_line_id, action, amount_kobo, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.id, entityId, split.budget_line_id, action, amount, actorRef],
      );
      await tx.client.query(
        `INSERT INTO budget_commitment_events (
           request_id, entity_id, budget_line_id, action, amount_kobo, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.id, entityId, split.budget_line_id, action === 'OPEN' ? 'COMMIT' : 'RELEASE', amount, actorRef],
      );
    }
    const request = await tx.client.query<{ reference_number: string; title: string }>(
      `SELECT r.reference_number, v.title
         FROM procurement_requests r
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
        WHERE r.id = $1`,
      [row.id],
    );
    const meta = request.rows[0];
    await tx.publish({
      eventType: action === 'OPEN' ? 'procurement.committed' : 'procurement.commitment_released',
      subjectType: 'PROCUREMENT',
      subjectId: row.id,
      entityId,
      payload: {
        type: action === 'OPEN' ? 'procurement.committed' : 'procurement.commitment_released',
        reference: meta?.reference_number ?? '',
        title: meta?.title ?? '',
        href: `/procurement/${row.id}`,
      },
    });
  }

  private async replaceHolds(
    tx: TxScope,
    input: {
      instanceId: string;
      subjectType: string;
      subjectId: string;
      reference: string;
      title: string;
      entityId: string;
      stage: StageRow | null;
      status: string;
      originatorUserId: string;
      createdBy: string;
    },
  ): Promise<void> {
    await tx.client.query(
      `UPDATE workflow_holds
          SET status = 'cleared', updated_by = $2
        WHERE subject_type = $1 AND subject_id = $3 AND status = 'open'`,
      [input.subjectType, input.createdBy, input.subjectId],
    );
    if (input.status === 'DRAFT') {
      await this.insertHold(tx, input, input.originatorUserId);
      return;
    }
    if (input.status !== 'IN_PROGRESS' || !input.stage) return;
    if (input.stage.scope_resolver === 'NAMED_ASSIGNEE') {
      const holders = await tx.client.query<{ user_id: string }>(
        `SELECT user_id FROM workflow_stage_assignees WHERE instance_id = $1 AND stage_key = $2`,
        [input.instanceId, input.stage.key],
      );
      for (const holder of holders.rows) await this.insertHold(tx, input, holder.user_id);
      return;
    }
    if (!input.stage.required_permission) return;
    if (input.subjectType === 'PROCUREMENT') {
      const state = await this.procurementWaitState(tx, input.subjectId);
      if (state?.deferred) return;
    }
    const holders = await tx.client.query<{ user_id: string }>(
      `SELECT user_id FROM app.users_holding_permission($1, $2::uuid, $3)`,
      [input.stage.required_permission, input.entityId, input.stage.scope_resolver],
    );
    for (const holder of holders.rows) {
      await this.insertHold(tx, input, holder.user_id);
    }
  }

  private async insertHold(
    tx: TxScope,
    input: {
      instanceId: string;
      subjectType: string;
      subjectId: string;
      reference: string;
      title: string;
      entityId: string;
      createdBy: string;
    },
    holderUserId: string,
  ): Promise<void> {
    await tx.client.query(
      `INSERT INTO workflow_holds (
         subject_type, subject_id, reference_number, title, holder_user_id, entity_id,
         pending_since, status, created_by, updated_by, workflow_instance_id
       ) VALUES ($1, $2, $3, $4, $5, $6, now(), 'open', $7, $7, $8)`,
      [
        input.subjectType,
        input.subjectId,
        input.reference,
        input.title,
        holderUserId,
        input.entityId,
        input.createdBy,
        input.instanceId,
      ],
    );
  }

  private async loadView(tx: TxScope, actor: ActorContext, id: string): Promise<WorkflowInstanceView> {
    const instance = await this.lockInstance(tx, id, false);
    if (
      !isSystemActorRef(actor.ref) &&
      !can(actor, 'document.view', instance.entity_id) &&
      !this.canSeeWorkflow(actor, instance)
    ) {
      throw new ForbiddenError('You cannot view this workflow.');
    }
    const stages = await this.loadStages(tx, instance.definition_id);
    const actions = await tx.client.query<{
      id: string;
      stage_key: string;
      action: string;
      actor_id: string;
      actor_name: string;
      reason: string | null;
      previous_status: string;
      new_status: string;
      subject_version: number;
      snapshot_hash: string;
      occurred_at: Date;
    }>(
      `SELECT a.id, s.key AS stage_key, a.action, a.actor_id,
              app.user_public_name(a.actor_id) AS actor_name, a.reason,
              a.previous_status, a.new_status, a.subject_version, a.snapshot_hash, a.occurred_at
         FROM workflow_actions a
         JOIN workflow_stages s ON s.id = a.stage_id
        WHERE a.instance_id = $1
        ORDER BY a.occurred_at`,
      [id],
    );
    const subject = await this.loadSubject(tx, instance.subject_id, instance.subject_type);
    const snapshotsByVersion = new Map<number, unknown>();
    if (instance.subject_type === 'DEMO_PROCUREMENT') {
      const versionRows = await tx.client.query<{ version: number; snapshot: unknown }>(
        `SELECT version, snapshot FROM workflow_demo_subject_versions WHERE subject_id = $1`,
        [instance.subject_id],
      );
      for (const row of versionRows.rows) snapshotsByVersion.set(row.version, row.snapshot);
    }
    const frozenSnapshots: unknown[] = [];
    if (instance.subject_type === 'PROCUREMENT') {
      const versionRows = await tx.client.query<{ version_number: number; canonical_json: unknown }>(
        `SELECT v.version_number, s.canonical_json
           FROM procurement_memo_snapshots s
           JOIN procurement_versions v ON v.id = s.version_id
          WHERE s.request_id = $1`,
        [instance.subject_id],
      );
      for (const row of versionRows.rows) {
        snapshotsByVersion.set(row.version_number, row.canonical_json);
        frozenSnapshots.push(row.canonical_json);
      }
      const requisitionRows = await tx.client.query<{ canonical_json: unknown }>(
        `SELECT s.canonical_json
           FROM procurement_requests r
           JOIN requisition_memo_snapshots s ON s.requisition_id = r.requisition_id
          WHERE r.id = $1`,
        [instance.subject_id],
      );
      for (const row of requisitionRows.rows) frozenSnapshots.push(row.canonical_json);
    }
    snapshotsByVersion.set(subject.current_version, subject.snapshot);
    const seals = await this.seals.verifyAll(
      tx,
      instance.subject_type,
      instance.subject_id,
      subject.current_version,
      subject.snapshot,
      actor,
      snapshotsByVersion,
      frozenSnapshots,
    );
    const current = stages.find((stage) => stage.id === instance.current_stage_id) ?? null;
    if (current) await this.hydrateStage(tx, instance, current);
    let financeDecided = false;
    if (instance.subject_type === 'PROCUREMENT') {
      const request = await tx.client.query<{ status: string }>(
        `SELECT status FROM procurement_requests WHERE id = $1`,
        [instance.subject_id],
      );
      financeDecided = [
        'FUNDING_PENDING',
        'AWAITING_PAYMENT',
        'AWAITING_DELIVERY',
        'PARTIALLY_RECEIVED',
        'COMPLETED',
      ].includes(request.rows[0]?.status ?? '');
    }
    const allowed = this.allowedActionsFor(actor, instance, current, financeDecided);
    return {
      id: instance.id,
      definitionKey: instance.definition_key,
      subjectType: instance.subject_type,
      subjectId: instance.subject_id,
      subjectVersion: subject.current_version,
      referenceNumber: instance.reference_number,
      title: instance.title,
      entityId: instance.entity_id,
      entityCode: instance.entity_code,
      originatorUserId: instance.originator_user_id,
      originatorName: instance.originator_name,
      currentStageKey: instance.current_stage_key,
      status: instance.status,
      archivedFromStageKey: instance.archived_from_stage_key,
      moneyMoved: instance.money_moved,
      rowVersion: instance.row_version,
      allowedActions: allowed,
      tracker: this.tracker(instance, stages, actions.rows),
      history: actions.rows.map((row) => ({
        id: row.id,
        stageKey: row.stage_key,
        action: row.action,
        actorId: row.actor_id,
        actorName: row.actor_name,
        reason: row.reason,
        previousStatus: row.previous_status,
        newStatus: row.new_status,
        subjectVersion: row.subject_version,
        snapshotHash: row.snapshot_hash,
        occurredAt: row.occurred_at.toISOString(),
      })),
      seals,
    };
  }

  private canSeeWorkflow(actor: ActorContext, instance: InstanceRow): boolean {
    if (instance.originator_user_id === actor.ref) return true;
    if (instance.subject_type === 'HR_DISCIPLINARY') {
      return can(actor, 'hr.disciplinary.approve') || can(actor, 'hr.disciplinary.view');
    }
    if (instance.subject_type === 'PAYROLL_RUN') {
      return (
        can(actor, 'payroll.view', instance.entity_id) ||
        can(actor, 'payroll.run.approve', instance.entity_id) ||
        can(actor, 'payroll.pay', instance.entity_id)
      );
    }
    if (instance.subject_type.startsWith('HR_')) {
      return (
        can(actor, 'hr.employee.view') ||
        can(actor, 'hr.change.approve') ||
        can(actor, 'hr.leave.approve') ||
        can(actor, 'hr.attendance.manage') ||
        can(actor, 'hr.performance.manage')
      );
    }
    if (instance.subject_type === 'VENDOR') {
      return (
        can(actor, 'vendor.activate') ||
        can(actor, 'vendor.view') ||
        can(actor, 'vendor.create') ||
        can(actor, 'oversight.overdue.view')
      );
    }
    if (can(actor, 'oversight.overdue.view', instance.entity_id)) return true;
    if (can(actor, 'procurement.view', instance.entity_id)) return true;
    if (can(actor, 'procurement.create', instance.entity_id)) return true;
    if (can(actor, 'procurement.approve.operations', instance.entity_id)) return true;
    if (can(actor, 'procurement.approve.final', instance.entity_id)) return true;
    if (can(actor, 'procurement.review.finance', instance.entity_id)) return true;
    if (can(actor, 'finance.payment.execute', instance.entity_id)) return true;
    if (can(actor, 'finance.payment.execute.corporate')) return true;
    if (can(actor, 'finance.view', instance.entity_id)) return true;
    if (can(actor, 'finance.journal.approve', instance.entity_id)) return true;
    if (can(actor, 'finance.budget.approve', instance.entity_id)) return true;
    return can(actor, 'workflow.archive', instance.entity_id);
  }

  private allowedActionsFor(
    actor: ActorContext,
    instance: InstanceRow,
    current: StageRow | null,
    financeDecided = false,
  ): string[] {
    if (instance.status === 'DRAFT' && instance.originator_user_id === actor.ref) {
      return ['RESUBMIT'];
    }
    if (
      instance.status === 'ARCHIVED' &&
      (can(actor, 'workflow.restore', instance.entity_id) ||
        can(actor, 'procurement.restore', instance.entity_id))
    ) {
      return ['RESTORE'];
    }
    if (instance.status !== 'IN_PROGRESS' || !current) return [];
    const actions: string[] = [];
    if (this.actorMatchesStage(actor, instance.entity_id, current)) {
      actions.push(
        ...current.allowed_actions.filter((action) => {
          if (action === 'ARCHIVE' && instance.money_moved) return false;
          if (
            action === 'APPROVE' &&
            instance.subject_type === 'PROCUREMENT' &&
            (current.key === 'finance-head' || instance.money_moved || financeDecided)
          ) {
            return false;
          }
          return true;
        }),
      );
    } else if (
      (can(actor, 'workflow.archive', instance.entity_id) ||
        can(actor, 'procurement.archive', instance.entity_id)) &&
      !instance.money_moved
    ) {
      actions.push('ARCHIVE');
    }
    return [...new Set(actions)];
  }

  private tracker(
    instance: InstanceRow,
    stages: StageRow[],
    actions: Array<{ stage_key: string; action: string; actor_name: string; occurred_at: Date; subject_version: number }>,
  ): WorkflowTrackerStageView[] {
    const version = instance.subject_version;
    return stages.map((stage) => {
      const approve = [...actions]
        .reverse()
        .find((row) => row.stage_key === stage.key && row.action === 'APPROVE' && row.subject_version === version);
      const reject = actions.find(
        (row) => row.stage_key === stage.key && row.action === 'REJECT' && row.subject_version === version,
      );
      const returned = actions.find(
        (row) =>
          row.stage_key === stage.key &&
          row.action === 'RETURN_FOR_CORRECTION' &&
          row.subject_version === version,
      );
      let state: WorkflowTrackerStageView['state'] = 'pending';
      if (!stage.required_permission && instance.status !== 'DRAFT') state = 'done';
      if (approve) state = 'done';
      if (instance.status === 'DRAFT' && returned && stage.key === instance.current_stage_key) state = 'returned';
      if (reject) state = 'rejected';
      if (instance.status === 'IN_PROGRESS' && stage.id === instance.current_stage_id) state = 'current';
      if (instance.status === 'ARCHIVED' && stage.id === instance.archived_from_stage_id) state = 'current';
      const last = approve ?? reject ?? returned;
      return {
        key: stage.key,
        label: stage.label,
        state,
        actor: last?.actor_name ?? null,
        at: last ? last.occurred_at.toISOString() : null,
      };
    });
  }

  private toPending(row: InstanceRow, stageLabel: string): WorkflowPendingView {
    const waitingSince = row.created_at.toISOString();
    const daysPending = Math.floor((Date.now() - row.created_at.getTime()) / 86_400_000);
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      title: row.title,
      status: row.status,
      currentStageKey: row.current_stage_key,
      currentStageLabel: stageLabel,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      waitingSince,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      href: this.subjectHref(row.subject_type, row.subject_id, row.id, row.linked_request_id),
      urgency: row.urgency,
      amountKobo: row.amount_kobo == null ? null : Number(row.amount_kobo),
      daysPending,
    };
  }

  private timelineText(action: WorkflowAction, stageLabel: string, reason?: string): string {
    if (action === 'APPROVE') return `Approved at ${stageLabel}.`;
    if (action === 'REJECT') return `Rejected at ${stageLabel}. ${reason ?? ''}`.trim();
    if (action === 'RETURN_FOR_CORRECTION') {
      return `Returned for correction from ${stageLabel}. ${reason ?? ''}`.trim();
    }
    return `Archived from ${stageLabel}. ${reason ?? ''}`.trim();
  }

  private async lockInstance(tx: TxScope, id: string, forUpdate = true): Promise<InstanceRow> {
    const sql = `
      ${this.instanceSelectSql({ archived: true })}
       WHERE i.id = $1
         AND (sub.id IS NOT NULL OR v.id IS NOT NULL OR pr.id IS NOT NULL OR cs.id IS NOT NULL OR jnl.id IS NOT NULL OR bud.id IS NOT NULL OR inc.id IS NOT NULL OR exp.id IS NOT NULL OR bill.id IS NOT NULL OR adj.id IS NOT NULL OR trf.id IS NOT NULL OR prd.id IS NOT NULL OR so.id IS NOT NULL OR edoc.id IS NOT NULL OR hrchg.id IS NOT NULL OR hrvac.id IS NOT NULL OR hroff.id IS NOT NULL OR hrlv.id IS NOT NULL OR hrot.id IS NOT NULL OR hrapp.id IS NOT NULL OR hrdisc.id IS NOT NULL OR prl.id IS NOT NULL OR i.subject_type LIKE 'HR_%')
       ${forUpdate ? 'FOR UPDATE OF i' : ''}`;
    const result = await tx.client.query<InstanceRow>(sql, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That workflow does not exist.');
    return row;
  }

  private async loadDefinition(
    tx: TxScope,
    key: string,
  ): Promise<{ id: string; stages: StageRow[] }> {
    const def = await tx.client.query<{ id: string }>(
      `SELECT id FROM workflow_definitions WHERE key = $1`,
      [key],
    );
    const id = def.rows[0]?.id;
    if (!id) throw new NotFoundError(`Workflow definition ${key} is not seeded.`);
    return { id, stages: await this.loadStages(tx, id) };
  }

  private async loadStages(tx: TxScope, definitionId: string): Promise<StageRow[]> {
    const result = await tx.client.query<StageRow>(
      `SELECT id, key, label, sort_order, required_permission, scope_resolver, allowed_actions
         FROM workflow_stages
        WHERE definition_id = $1
        ORDER BY sort_order`,
      [definitionId],
    );
    return result.rows;
  }

  private async loadHrDisciplinarySubject(
    tx: TxScope,
    id: string,
  ): Promise<{
    id: string;
    reference_number: string;
    entity_id: string;
    originator_user_id: string;
    title: string;
    current_version: number;
    snapshot: unknown;
    row_version: number;
  } | null> {
    const viaHelper = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      title: string;
      current_version: number;
      snapshot: unknown;
      row_version: number;
    }>(`SELECT * FROM app.hr_disciplinary_workflow_subject($1::uuid)`, [id]);
    if (viaHelper.rows[0]) return viaHelper.rows[0];
    const direct = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      title: string;
      current_version: number;
      snapshot: unknown;
      row_version: number;
    }>(
      `SELECT id, reference_number, entity_id, created_by AS originator_user_id, reference_number AS title,
              1 AS current_version, row_version, jsonb_build_object('reference', reference_number) AS snapshot
         FROM hr_disciplinary_cases WHERE id = $1`,
      [id],
    );
    return direct.rows[0] ?? null;
  }

  private async loadSubject(
    tx: TxScope,
    id: string,
    subjectType?: string,
  ): Promise<{
    id: string;
    reference_number: string;
    entity_id: string;
    originator_user_id: string;
    title: string;
    current_version: number;
    snapshot: unknown;
    row_version: number;
  }> {
    if (subjectType === 'HR_DISCIPLINARY') {
      const disc = await this.loadHrDisciplinarySubject(tx, id);
      if (!disc) throw new NotFoundError('That subject does not exist.');
      return disc;
    }
    if (subjectType === 'PAYROLL_RUN') {
      const payroll = await tx.client.query<{
        id: string;
        reference_number: string;
        entity_id: string;
        originator_user_id: string;
        title: string;
        current_version: number;
        snapshot: unknown;
        row_version: number;
      }>(
        `SELECT id, reference_number, entity_id, created_by AS originator_user_id, reference_number AS title,
                1 AS current_version, row_version,
                jsonb_build_object('reference', reference_number, 'status', status, 'netKobo', net_kobo) AS snapshot
           FROM payroll_runs WHERE id = $1`,
        [id],
      );
      if (!payroll.rows[0]) throw new NotFoundError('That subject does not exist.');
      return payroll.rows[0];
    }
    const demo = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      title: string;
      current_version: number;
      snapshot: unknown;
      row_version: number;
    }>(
      `SELECT id, reference_number, entity_id, originator_user_id, title, current_version, snapshot, row_version
         FROM workflow_demo_subjects WHERE id = $1`,
      [id],
    );
    if (demo.rows[0]) return demo.rows[0];
    const vendor = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      title: string;
      current_version: number;
      snapshot: unknown;
      row_version: number;
    }>(
      `SELECT id, reference_number, entity_id, created_by AS originator_user_id,
              legal_name AS title, row_version AS current_version, row_version,
              jsonb_build_object(
                'legalName', legal_name,
                'cac', cac_registration_number,
                'status', status,
                'version', row_version
              ) AS snapshot
         FROM vendors WHERE id = $1`,
      [id],
    );
    if (vendor.rows[0]) return vendor.rows[0];

    const closeShort = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      title: string;
      current_version: number;
      snapshot: unknown;
      row_version: number;
    }>(
      `SELECT cs.id, r.reference_number, cs.entity_id, r.originator_user_id,
              v.title, r.current_version, cs.row_version,
              coalesce(s.canonical_json, jsonb_build_object(
                'title', v.title,
                'reference', r.reference_number,
                'closeShort', cs.id
              )) AS snapshot
         FROM procurement_close_short_requests cs
         JOIN procurement_requests r ON r.id = cs.request_id
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
         LEFT JOIN procurement_memo_snapshots s ON s.version_id = v.id
        WHERE cs.id = $1`,
      [id],
    );
    if (closeShort.rows[0]) return closeShort.rows[0];

    const journal = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      title: string;
      current_version: number;
      snapshot: unknown;
      row_version: number;
    }>(
      `SELECT id, reference_number, entity_id, created_by AS originator_user_id,
              narration AS title, 1 AS current_version, row_version,
              jsonb_build_object('reference', reference_number, 'narration', narration) AS snapshot
         FROM journals WHERE id = $1`,
      [id],
    );
    if (journal.rows[0]) return journal.rows[0];

    const budget = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      title: string;
      current_version: number;
      snapshot: unknown;
      row_version: number;
    }>(
      `SELECT id, reference_number, entity_id, created_by AS originator_user_id,
              reference_number AS title, version_number AS current_version, row_version,
              jsonb_build_object('reference', reference_number, 'version', version_number) AS snapshot
         FROM budgets WHERE id = $1`,
      [id],
    );
    if (budget.rows[0]) return budget.rows[0];

    const income = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      title: string;
      current_version: number;
      snapshot: unknown;
      row_version: number;
    }>(
      `SELECT id, reference_number, entity_id, created_by AS originator_user_id,
              narration AS title, 1 AS current_version, row_version,
              jsonb_build_object('reference', reference_number, 'narration', narration) AS snapshot
         FROM income_entries WHERE id = $1`,
      [id],
    );
    if (income.rows[0]) return income.rows[0];

    const expense = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      title: string;
      current_version: number;
      snapshot: unknown;
      row_version: number;
    }>(
      `SELECT id, reference_number, entity_id, created_by AS originator_user_id,
              narration AS title, 1 AS current_version, row_version,
              jsonb_build_object('reference', reference_number, 'narration', narration) AS snapshot
         FROM expense_entries WHERE id = $1`,
      [id],
    );
    if (expense.rows[0]) return expense.rows[0];

    const bill = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      title: string;
      current_version: number;
      snapshot: unknown;
      row_version: number;
    }>(
      `SELECT id, reference_number, entity_id, created_by AS originator_user_id,
              coalesce(narration, reference_number) AS title, 1 AS current_version, row_version,
              jsonb_build_object('reference', reference_number) AS snapshot
         FROM payable_invoices WHERE id = $1`,
      [id],
    );
    if (bill.rows[0]) return bill.rows[0];

    const adjustment = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      title: string;
      current_version: number;
      snapshot: unknown;
      row_version: number;
    }>(
      `SELECT id, reference_number, entity_id, created_by AS originator_user_id,
              reference_number AS title, 1 AS current_version, row_version,
              jsonb_build_object('reference', reference_number, 'reason', reason) AS snapshot
         FROM stock_adjustments WHERE id = $1`,
      [id],
    );
    if (adjustment.rows[0]) return adjustment.rows[0];

    const transfer = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      title: string;
      current_version: number;
      snapshot: unknown;
      row_version: number;
    }>(
      `SELECT id, reference_number, source_entity_id AS entity_id, created_by AS originator_user_id,
              reference_number AS title, 1 AS current_version, row_version,
              jsonb_build_object('reference', reference_number, 'reason', reason) AS snapshot
         FROM stock_transfers WHERE id = $1`,
      [id],
    );
    if (transfer.rows[0]) return transfer.rows[0];

    const production = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      title: string;
      current_version: number;
      snapshot: unknown;
      row_version: number;
    }>(
      `SELECT id, reference_number, entity_id, created_by AS originator_user_id,
              reference_number AS title, 1 AS current_version, row_version,
              jsonb_build_object('reference', reference_number) AS snapshot
         FROM production_orders WHERE id = $1`,
      [id],
    );
    if (production.rows[0]) return production.rows[0];

    const sales = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      title: string;
      current_version: number;
      snapshot: unknown;
      row_version: number;
    }>(
      `SELECT id, reference_number, entity_id, created_by AS originator_user_id,
              reference_number AS title, 1 AS current_version, row_version,
              jsonb_build_object('reference', reference_number) AS snapshot
         FROM sales_orders WHERE id = $1`,
      [id],
    );
    if (sales.rows[0]) return sales.rows[0];

    const edmsDocument = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      title: string;
      current_version: number;
      snapshot: unknown;
      row_version: number;
    }>(
      `SELECT id, reference_number, entity_id,
              CASE WHEN created_by ~ '^[0-9a-f-]{36}$' THEN created_by::uuid ELSE NULL END AS originator_user_id,
              title, 1 AS current_version, row_version,
              jsonb_build_object('title', title, 'reference', reference_number) AS snapshot
         FROM documents WHERE id = $1`,
      [id],
    );
    if (edmsDocument.rows[0]) {
      const row = edmsDocument.rows[0];
      if (!row.originator_user_id) {
        const originator = await tx.client.query<{ originator_user_id: string }>(
          `SELECT originator_user_id FROM workflow_instances
            WHERE subject_type = 'EDMS_DOCUMENT' AND subject_id = $1
            ORDER BY created_at DESC LIMIT 1`,
          [id],
        );
        row.originator_user_id = originator.rows[0]?.originator_user_id ?? row.originator_user_id;
      }
      return row;
    }

    const hrShape = {
      id: '',
      reference_number: '',
      entity_id: '',
      originator_user_id: '',
      title: '',
      current_version: 1,
      snapshot: {},
      row_version: 1,
    };
    const hrChange = await tx.client.query<typeof hrShape>(
      `SELECT c.id, emp.reference_number, c.entity_id, c.created_by AS originator_user_id,
              c.kind AS title, 1 AS current_version, c.row_version,
              jsonb_build_object('kind', c.kind) AS snapshot
         FROM hr_employment_changes c
         JOIN hr_employees emp ON emp.id = c.employee_id
        WHERE c.id = $1`,
      [id],
    );
    if (hrChange.rows[0]) return hrChange.rows[0];
    const hrVacancy = await tx.client.query<typeof hrShape>(
      `SELECT id, reference_number, entity_id, created_by AS originator_user_id, title,
              1 AS current_version, row_version, jsonb_build_object('title', title) AS snapshot
         FROM hr_vacancies WHERE id = $1`,
      [id],
    );
    if (hrVacancy.rows[0]) return hrVacancy.rows[0];
    const hrOffer = await tx.client.query<typeof hrShape>(
      `SELECT o.id, v.reference_number, v.entity_id, o.created_by AS originator_user_id,
              ('Offer ' || v.title) AS title, 1 AS current_version, o.row_version,
              jsonb_build_object('title', v.title) AS snapshot
         FROM hr_offers o JOIN hr_vacancies v ON v.id = o.vacancy_id
        WHERE o.id = $1`,
      [id],
    );
    if (hrOffer.rows[0]) return hrOffer.rows[0];
    const hrLeave = await tx.client.query<typeof hrShape>(
      `SELECT id, reference_number, entity_id, created_by AS originator_user_id, reference_number AS title,
              1 AS current_version, row_version, jsonb_build_object('reference', reference_number) AS snapshot
         FROM hr_leave_requests WHERE id = $1`,
      [id],
    );
    if (hrLeave.rows[0]) return hrLeave.rows[0];
    const hrOvertime = await tx.client.query<typeof hrShape>(
      `SELECT o.id, emp.reference_number, o.entity_id, o.created_by AS originator_user_id,
              'Overtime' AS title, 1 AS current_version, o.row_version,
              jsonb_build_object('hours', o.hours) AS snapshot
         FROM hr_overtime_requests o JOIN hr_employees emp ON emp.id = o.employee_id
        WHERE o.id = $1`,
      [id],
    );
    if (hrOvertime.rows[0]) return hrOvertime.rows[0];
    const hrAppraisal = await tx.client.query<typeof hrShape>(
      `SELECT a.id, emp.reference_number, a.entity_id, a.created_by AS originator_user_id,
              'Appraisal' AS title, 1 AS current_version, a.row_version,
              jsonb_build_object('rating', a.rating) AS snapshot
         FROM hr_appraisals a JOIN hr_employees emp ON emp.id = a.employee_id
        WHERE a.id = $1`,
      [id],
    );
    if (hrAppraisal.rows[0]) return hrAppraisal.rows[0];
    const hrDisc = await this.loadHrDisciplinarySubject(tx, id);
    if (hrDisc) return hrDisc;
    const payrollRun = await tx.client.query<typeof hrShape>(
      `SELECT id, reference_number, entity_id, created_by AS originator_user_id, reference_number AS title,
              1 AS current_version, row_version,
              jsonb_build_object('reference', reference_number, 'status', status) AS snapshot
         FROM payroll_runs WHERE id = $1`,
      [id],
    );
    if (payrollRun.rows[0]) return payrollRun.rows[0];

    const procurement = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      title: string;
      current_version: number;
      snapshot: unknown;
      row_version: number;
    }>(
      `SELECT r.id, r.reference_number, r.entity_id, r.originator_user_id,
              v.title, r.current_version, r.row_version,
              coalesce(s.canonical_json, jsonb_build_object(
                'title', v.title,
                'reference', r.reference_number,
                'version', r.current_version
              )) AS snapshot
         FROM procurement_requests r
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
         LEFT JOIN procurement_memo_snapshots s ON s.version_id = v.id
        WHERE r.id = $1`,
      [id],
    );
    const row = procurement.rows[0];
    if (!row) throw new NotFoundError('That subject does not exist.');
    return row;
  }

  private instanceSelectSql(opts: { archived: boolean }): string {
    return `
      SELECT i.*, d.key AS definition_key, s.key AS current_stage_key,
             ${opts.archived ? 'af.key' : 'NULL::text'} AS archived_from_stage_key, e.code AS entity_code,
             app.user_public_name(i.originator_user_id) AS originator_name,
             coalesce(sub.title, v.legal_name, pv.title, csv.title, jnl.narration, bud.reference_number, inc.narration, exp.narration, bill.narration, bill.reference_number, adj.reference_number, trf.reference_number, prd.reference_number, so.reference_number, edoc.title, hrvac.title, hremp.first_name || ' ' || hremp.last_name, hrlv.reference_number, hrdisc.reference_number, prl.reference_number, hrot.id::text, hrapp.id::text) AS title,
             coalesce(sub.reference_number, v.reference_number, pr.reference_number, csr.reference_number, jnl.reference_number, bud.reference_number, inc.reference_number, exp.reference_number, bill.reference_number, adj.reference_number, trf.reference_number, prd.reference_number, so.reference_number, edoc.reference_number, hrvac.reference_number, hremp.reference_number, hrlv.reference_number, hrdisc.reference_number, prl.reference_number, hrot.id::text, hrapp.id::text) AS reference_number,
             coalesce(pv.urgency, csv.urgency) AS urgency,
             coalesce(pv.total_amount_kobo, csv.total_amount_kobo, prl.net_kobo)::text AS amount_kobo,
             coalesce(pr.id, csr.id) AS linked_request_id,
             coalesce(sub.snapshot, snap.canonical_json, jsonb_build_object(
               'legalName', v.legal_name,
               'cac', v.cac_registration_number,
               'status', v.status,
               'version', v.row_version
             )) AS snapshot
        FROM workflow_instances i
        JOIN workflow_definitions d ON d.id = i.definition_id
        JOIN entities e ON e.id = i.entity_id
        LEFT JOIN workflow_demo_subjects sub
          ON sub.id = i.subject_id AND i.subject_type = 'DEMO_PROCUREMENT'
        LEFT JOIN vendors v
          ON v.id = i.subject_id AND i.subject_type = 'VENDOR'
        LEFT JOIN procurement_requests pr
          ON pr.id = i.subject_id AND i.subject_type = 'PROCUREMENT'
        LEFT JOIN procurement_versions pv
          ON pv.request_id = pr.id AND pv.version_number = pr.current_version
        LEFT JOIN procurement_memo_snapshots snap
          ON snap.version_id = pv.id
        LEFT JOIN procurement_close_short_requests cs
          ON cs.id = i.subject_id AND i.subject_type = 'CLOSE_SHORT'
        LEFT JOIN procurement_requests csr ON csr.id = cs.request_id
        LEFT JOIN procurement_versions csv
          ON csv.request_id = csr.id AND csv.version_number = csr.current_version
        LEFT JOIN journals jnl
          ON jnl.id = i.subject_id AND i.subject_type = 'JOURNAL'
        LEFT JOIN budgets bud
          ON bud.id = i.subject_id AND i.subject_type = 'BUDGET'
        LEFT JOIN income_entries inc
          ON inc.id = i.subject_id AND i.subject_type = 'INCOME'
        LEFT JOIN expense_entries exp
          ON exp.id = i.subject_id AND i.subject_type = 'EXPENSE'
        LEFT JOIN payable_invoices bill
          ON bill.id = i.subject_id AND i.subject_type = 'BILL'
        LEFT JOIN stock_adjustments adj
          ON adj.id = i.subject_id AND i.subject_type = 'INVENTORY_ADJUSTMENT'
        LEFT JOIN stock_transfers trf
          ON trf.id = i.subject_id AND i.subject_type = 'INVENTORY_TRANSFER'
        LEFT JOIN production_orders prd
          ON prd.id = i.subject_id AND i.subject_type = 'PRODUCTION_ORDER'
        LEFT JOIN sales_orders so
          ON so.id = i.subject_id AND i.subject_type = 'SALES_ORDER'
        LEFT JOIN documents edoc
          ON edoc.id = i.subject_id AND i.subject_type = 'EDMS_DOCUMENT'
        LEFT JOIN hr_employment_changes hrchg
          ON hrchg.id = i.subject_id AND i.subject_type = 'HR_CHANGE'
        LEFT JOIN hr_vacancies hrvac
          ON hrvac.id = i.subject_id AND i.subject_type = 'HR_CHANGE'
        LEFT JOIN hr_offers hroff
          ON hroff.id = i.subject_id AND i.subject_type = 'HR_CHANGE'
        LEFT JOIN hr_employees hremp
          ON hremp.id = coalesce(hrchg.employee_id)
        LEFT JOIN hr_leave_requests hrlv
          ON hrlv.id = i.subject_id AND i.subject_type = 'HR_LEAVE'
        LEFT JOIN hr_overtime_requests hrot
          ON hrot.id = i.subject_id AND i.subject_type = 'HR_OVERTIME'
        LEFT JOIN hr_appraisals hrapp
          ON hrapp.id = i.subject_id AND i.subject_type = 'HR_PERFORMANCE'
        LEFT JOIN hr_disciplinary_cases hrdisc
          ON hrdisc.id = i.subject_id AND i.subject_type = 'HR_DISCIPLINARY'
        LEFT JOIN payroll_runs prl
          ON prl.id = i.subject_id AND i.subject_type = 'PAYROLL_RUN'
        LEFT JOIN workflow_stages s ON s.id = i.current_stage_id
        ${opts.archived ? 'LEFT JOIN workflow_stages af ON af.id = i.archived_from_stage_id' : ''}`;
  }

  private eventTypeFor(instance: InstanceRow, action: WorkflowAction, nextStatus: string): string {
    if (instance.subject_type === 'VENDOR') {
      if (action === 'APPROVE' && nextStatus === 'COMPLETED') return 'vendor.activated';
      if (action === 'REJECT' || action === 'RETURN_FOR_CORRECTION') return 'vendor.rejected';
      return 'vendor.submitted';
    }
    if (instance.subject_type === 'JOURNAL') {
      if (action === 'APPROVE' && nextStatus === 'COMPLETED') return 'journal.approved';
      if (action === 'REJECT') return 'journal.rejected';
      return 'journal.submitted';
    }
    if (instance.subject_type === 'BUDGET') {
      if (action === 'APPROVE' && nextStatus === 'COMPLETED') return 'budget.approved';
      if (action === 'REJECT') return 'budget.rejected';
      return 'budget.submitted';
    }
    if (instance.subject_type === 'INCOME') {
      if (action === 'APPROVE' && nextStatus === 'COMPLETED') return 'income.approved';
      if (action === 'REJECT') return 'income.rejected';
      return 'income.submitted';
    }
    if (instance.subject_type === 'EXPENSE') {
      if (action === 'APPROVE' && nextStatus === 'COMPLETED') return 'expense.approved';
      if (action === 'REJECT') return 'expense.rejected';
      return 'expense.submitted';
    }
    if (instance.subject_type === 'BILL') {
      if (action === 'APPROVE' && nextStatus === 'COMPLETED') return 'bill.approved';
      if (action === 'REJECT') return 'bill.rejected';
      return 'bill.submitted';
    }
    if (instance.subject_type === 'INVENTORY_ADJUSTMENT') {
      if (action === 'APPROVE' && nextStatus === 'COMPLETED') return 'inventory.adjustment.approved';
      if (action === 'REJECT') return 'inventory.adjustment.rejected';
      return 'inventory.adjustment.submitted';
    }
    if (instance.subject_type === 'INVENTORY_TRANSFER') {
      if (action === 'APPROVE' && nextStatus === 'COMPLETED') return 'inventory.transfer.approved';
      if (action === 'REJECT') return 'inventory.transfer.rejected';
      return 'inventory.transfer.submitted';
    }
    if (instance.subject_type === 'PRODUCTION_ORDER') {
      if (action === 'APPROVE' && nextStatus === 'COMPLETED') return 'production.approved';
      if (action === 'REJECT') return 'production.rejected';
      return 'production.submitted';
    }
    if (instance.subject_type === 'SALES_ORDER') {
      if (action === 'APPROVE' && nextStatus === 'COMPLETED') return 'sales.order.approved';
      if (action === 'REJECT') return 'sales.order.rejected';
      return 'sales.order.submitted';
    }
    if (instance.subject_type === 'EDMS_DOCUMENT') {
      if (action === 'APPROVE' && nextStatus === 'COMPLETED') return 'edms.approved';
      if (action === 'REJECT') return 'edms.rejected';
      return 'edms.submitted';
    }
    if (instance.subject_type === 'HR_CHANGE') {
      if (action === 'APPROVE' && nextStatus === 'COMPLETED') return 'hr.change.approved';
      if (action === 'REJECT') return 'hr.change.rejected';
      return 'hr.change.submitted';
    }
    if (instance.subject_type === 'HR_LEAVE') {
      if (action === 'APPROVE' && nextStatus === 'COMPLETED') return 'hr.leave.approved';
      if (action === 'REJECT') return 'hr.leave.rejected';
      return 'hr.leave.submitted';
    }
    if (instance.subject_type === 'HR_DISCIPLINARY') {
      if (action === 'APPROVE' && nextStatus === 'COMPLETED') return 'hr.disciplinary.decided';
      return 'hr.disciplinary.submitted';
    }
    if (instance.subject_type === 'PAYROLL_RUN') {
      if (action === 'APPROVE' && nextStatus === 'COMPLETED') return 'payroll.approved';
      if (action === 'REJECT') return 'payroll.rejected';
      return 'payroll.submitted';
    }
    if (action === 'APPROVE') return 'procurement.approved';
    if (action === 'REJECT') return 'procurement.rejected';
    if (action === 'RETURN_FOR_CORRECTION') return 'procurement.returned';
    return 'procurement.archived';
  }

  private async applyVendorOnboardingOutcome(
    tx: TxScope,
    actor: ActorContext,
    instance: InstanceRow,
    action: WorkflowAction,
    nextStatus: string,
  ): Promise<void> {
    if (instance.subject_type !== 'VENDOR' || instance.definition_key !== VENDOR_ONBOARDING_KEY) {
      return;
    }
    if (action === 'APPROVE' && nextStatus === 'COMPLETED') {
      await tx.client.query(
        `UPDATE vendors
            SET status = 'ACTIVE',
                activated_at = now(),
                activated_by = $1,
                updated_by = $1
          WHERE id = $2`,
        [actor.ref, instance.subject_id],
      );
      const vendor = await tx.client.query<{
        legal_name: string;
        cac_registration_number: string;
        category_key: string;
        entity_id: string;
        reference_number: string;
      }>(
        `SELECT v.legal_name, v.cac_registration_number, c.key AS category_key, v.entity_id, v.reference_number
           FROM vendors v JOIN vendor_categories c ON c.id = v.category_id
          WHERE v.id = $1`,
        [instance.subject_id],
      );
      const row = vendor.rows[0];
      if (row) {
        await tx.indexSearch({
          recordType: 'VENDOR',
          recordId: instance.subject_id,
          referenceNumber: row.reference_number,
          title: row.legal_name,
          searchableText: `${row.legal_name} ${row.cac_registration_number} ${row.category_key} ${row.reference_number}`,
          entityId: row.entity_id,
          permissionKey: 'vendor.view',
        });
      }
      return;
    }
    if (action === 'REJECT' || action === 'RETURN_FOR_CORRECTION') {
      await tx.client.query(
        `UPDATE vendors SET status = 'DRAFT', updated_by = $1 WHERE id = $2`,
        [actor.ref, instance.subject_id],
      );
    }
  }

  private async applyProcurementOutcome(
    tx: TxScope,
    actor: ActorContext,
    instance: InstanceRow,
    action: WorkflowAction,
    _next: { status: string; currentStageKey: string | null },
    fundingRoute?: string,
  ): Promise<void> {
    if (instance.subject_type !== 'PROCUREMENT') return;
    const current = await tx.client.query<{ status: string; final_payment_timing: string | null }>(
      `SELECT status, final_payment_timing FROM procurement_requests WHERE id = $1`,
      [instance.subject_id],
    );
    const previousStatus = current.rows[0]?.status ?? instance.status;
    let status: string | null = null;
    if (action === 'REJECT') status = 'REJECTED';
    if (action === 'RETURN_FOR_CORRECTION') status = 'DRAFT';
    if (action === 'ARCHIVE') status = 'ARCHIVED';
    if (action === 'APPROVE' && instance.current_stage_key === 'need-approval') status = 'AWAITING_PREPARATION';
    if (action === 'APPROVE' && instance.current_stage_key === 'ed-operations') status = 'AWAITING_MD';
    if (action === 'APPROVE' && instance.current_stage_key === 'md') status = 'AWAITING_ED_FINANCE';
    if (action === 'APPROVE' && instance.current_stage_key === 'ed-finance') {
      const afterDelivery = current.rows[0]?.final_payment_timing === 'after_delivery';
      if (fundingRoute === 'corporate_allocation') {
        status = 'FUNDING_PENDING';
      } else if (afterDelivery) {
        status = 'AWAITING_DELIVERY';
      } else {
        status = 'AWAITING_PAYMENT';
      }
      const version = await tx.client.query<{ id: string }>(
        `SELECT v.id
           FROM procurement_requests r
           JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
          WHERE r.id = $1`,
        [instance.subject_id],
      );
      const groups = version.rows[0]
        ? await tx.client.query<{ budget_line_id: string | null; amount: string }>(
            `SELECT budget_line_id, coalesce(sum(line_amount_kobo), 0)::text AS amount
               FROM procurement_version_lines
              WHERE version_id = $1
              GROUP BY budget_line_id`,
            [version.rows[0].id],
          )
        : { rows: [] as Array<{ budget_line_id: string | null; amount: string }> };
      const splits =
        groups.rows.length > 0
          ? groups.rows
          : (
              await tx.client.query<{ budget_line_id: string | null; amount: string }>(
                `SELECT v.budget_line_id, coalesce(v.total_amount_kobo, 0)::text AS amount
                   FROM procurement_versions v WHERE v.id = $1`,
                [version.rows[0]?.id],
              )
            ).rows;
      for (const split of splits) {
        await tx.client.query(
          `INSERT INTO budget_commitment_events (
             request_id, entity_id, budget_line_id, action, amount_kobo, created_by
           ) VALUES ($1, $2, $3, 'APPROVE_FINANCE', $4, $5)`,
          [instance.subject_id, instance.entity_id, split.budget_line_id, Number(split.amount ?? 0), actor.ref],
        );
      }
    }
    if (!status) return;

    await tx.client.query(
      `UPDATE procurement_requests
          SET status = $1,
              archived_from_status = $2,
              archived_from_stage_key = $3,
              updated_by = $4
        WHERE id = $5`,
      [
        status,
        action === 'ARCHIVE' ? previousStatus : null,
        action === 'ARCHIVE' ? instance.current_stage_key : null,
        actor.ref,
        instance.subject_id,
      ],
    );
    let requisitionStatus: string | null = null;
    if (action === 'APPROVE' && instance.current_stage_key === 'need-approval') requisitionStatus = 'NEED_APPROVED';
    if (action === 'RETURN_FOR_CORRECTION' && instance.current_stage_key === 'need-approval') {
      requisitionStatus = 'DRAFT';
    }
    if (action === 'REJECT' && instance.current_stage_key === 'need-approval') requisitionStatus = 'REJECTED';
    if (action === 'ARCHIVE' && instance.current_stage_key === 'need-approval') requisitionStatus = 'ARCHIVED';
    if (requisitionStatus) {
      await tx.client.query(
        `UPDATE requisitions q
            SET status = $1, updated_by = $2
           FROM procurement_requests r
          WHERE r.id = $3 AND r.requisition_id = q.id`,
        [requisitionStatus, actor.ref, instance.subject_id],
      );
    }
  }

  private async applyProcurementRestore(
    tx: TxScope,
    actor: ActorContext,
    instance: InstanceRow,
  ): Promise<void> {
    if (instance.subject_type !== 'PROCUREMENT') return;
    const current = await tx.client.query<{ archived_from_status: string | null }>(
      `SELECT archived_from_status FROM procurement_requests WHERE id = $1`,
      [instance.subject_id],
    );
    const restored = current.rows[0]?.archived_from_status ?? 'AWAITING_OPERATIONS';
    await tx.client.query(
      `UPDATE procurement_requests
          SET status = $1,
              archived_from_status = NULL,
              archived_from_stage_key = NULL,
              updated_by = $2
        WHERE id = $3`,
      [restored, actor.ref, instance.subject_id],
    );
  }

  private async bumpProcurementVersion(tx: TxScope, requestId: string, actorRef: string): Promise<void> {
    const current = await tx.client.query<{
      id: string;
      entity_id: string;
      current_version: number;
    }>(
      `SELECT id, entity_id, current_version FROM procurement_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const request = current.rows[0];
    if (!request) return;
    const nextVersion = request.current_version + 1;
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO procurement_versions (
         request_id, entity_id, version_number, title, subject, category_id, reason, description,
         quantity, unit_id, unit_price_kobo, total_amount_kobo, required_date, vendor_id,
         delivery_location, funding_source_id, budget_line_id, project_id, urgency,
         additional_instructions, price_comparison, recommendation, selection_justification,
         created_by, updated_by
       )
       SELECT request_id, entity_id, $2, title, subject, category_id, reason, description,
              quantity, unit_id, unit_price_kobo, total_amount_kobo, required_date, vendor_id,
              delivery_location, funding_source_id, budget_line_id, project_id, urgency,
              additional_instructions, price_comparison, recommendation, selection_justification,
              $3, $3
         FROM procurement_versions
        WHERE request_id = $1 AND version_number = $4
       RETURNING id`,
      [requestId, nextVersion, actorRef, request.current_version],
    );
    const nextId = inserted.rows[0]?.id;
    if (nextId) {
      const previous = await tx.client.query<{ id: string }>(
        `SELECT id FROM procurement_versions WHERE request_id = $1 AND version_number = $2`,
        [requestId, request.current_version],
      );
      if (previous.rows[0]) {
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
          [nextId, actorRef, previous.rows[0].id],
        );
      }
      await tx.client.query(
        `INSERT INTO procurement_invoices (
           request_id, version_id, entity_id, document_id, invoice_number, invoice_date,
           amount_kobo, vendor_id, created_by, updated_by
         )
         SELECT request_id, $1, entity_id, document_id, invoice_number, invoice_date,
                amount_kobo, vendor_id, $2, $2
           FROM procurement_invoices
          WHERE request_id = $3
            AND version_id = (
              SELECT id FROM procurement_versions
               WHERE request_id = $3 AND version_number = $4
            )`,
        [nextId, actorRef, requestId, request.current_version],
      );
      await tx.client.query(
        `INSERT INTO procurement_quotations (
           request_id, version_id, entity_id, document_id, vendor_id, amount_kobo, notes, created_by, updated_by
         )
         SELECT request_id, $1, entity_id, document_id, vendor_id, amount_kobo, notes, $2, $2
           FROM procurement_quotations
          WHERE request_id = $3
            AND version_id = (
              SELECT id FROM procurement_versions
               WHERE request_id = $3 AND version_number = $4
            )`,
        [nextId, actorRef, requestId, request.current_version],
      );
    }
    await tx.client.query(
      `UPDATE procurement_requests
          SET current_version = $1, status = 'DRAFT', updated_by = $2
        WHERE id = $3`,
      [nextVersion, actorRef, requestId],
    );
  }

  async moveToFinanceHeadInTx(tx: TxScope, actor: ActorContext, requestId: string): Promise<void> {
    const instance = await tx.client.query<InstanceRow>(
      `SELECT i.*, d.key AS definition_key, s.key AS current_stage_key,
              NULL::text AS archived_from_stage_key, e.code AS entity_code,
              app.user_public_name(i.originator_user_id) AS originator_name,
              coalesce(pr.reference_number, '') AS reference_number,
              coalesce(pv.title, '') AS title, NULL::jsonb AS snapshot,
              NULL::text AS urgency, NULL::text AS amount_kobo, NULL::uuid AS linked_request_id
         FROM workflow_instances i
         JOIN workflow_definitions d ON d.id = i.definition_id
         JOIN entities e ON e.id = i.entity_id
         LEFT JOIN workflow_stages s ON s.id = i.current_stage_id
         LEFT JOIN procurement_requests pr ON pr.id = i.subject_id
         LEFT JOIN procurement_versions pv
           ON pv.request_id = pr.id AND pv.version_number = pr.current_version
        WHERE i.subject_type = 'PROCUREMENT' AND i.subject_id = $1 AND i.status = 'IN_PROGRESS'
        FOR UPDATE OF i`,
      [requestId],
    );
    const row = instance.rows[0];
    if (!row) throw new ConflictError('This request is not awaiting a funding transfer.');
    const stages = await this.loadStages(tx, row.definition_id);
    const financeHead = stages.find((stage) => stage.key === 'finance-head');
    if (!financeHead) throw new Error('procurement-v1 is missing the Finance Head stage.');
    await tx.client.query(
      `UPDATE workflow_instances
          SET current_stage_id = $1, money_moved = true, updated_by = $2
        WHERE id = $3`,
      [financeHead.id, actor.ref, row.id],
    );
    const href = this.subjectHref('PROCUREMENT', requestId, row.id);
    await this.replaceHolds(tx, {
      instanceId: row.id,
      subjectType: 'PROCUREMENT',
      subjectId: requestId,
      reference: row.reference_number,
      title: row.title,
      entityId: row.entity_id,
      stage: financeHead,
      status: 'IN_PROGRESS',
      originatorUserId: row.originator_user_id,
      createdBy: actor.ref,
    });
    await this.notifyNextApprovers(tx, row, financeHead, href);
  }

  async completePaymentInTx(
    tx: TxScope,
    actor: ActorContext,
    input: {
      requestId: string;
      paymentRef: string;
      snapshot: unknown;
      paymentSettled: boolean;
      requestCompleted: boolean;
    },
  ): Promise<void> {
    const instance = await this.lockProcurementInstance(tx, input.requestId);
    const row = instance;
    if (row) {
      await tx.client.query(
        `UPDATE workflow_instances
            SET money_moved = true, updated_by = $1
          WHERE id = $2`,
        [actor.ref, row.id],
      );
    }
    if (input.paymentSettled) {
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM seals WHERE subject_type = 'PROCUREMENT' AND subject_id = $1 AND action = 'paid' LIMIT 1`,
        [input.requestId],
      );
      if (!existing.rows[0]) {
        await this.seals.create(tx, {
          actor,
          entityId: row?.entity_id ?? (await this.requestEntityId(tx, input.requestId)),
          subjectType: 'PROCUREMENT',
          subjectId: input.requestId,
          subjectVersion: row?.subject_version ?? 1,
          snapshot: input.snapshot,
          action: 'paid',
          paymentRef: input.paymentRef,
        });
      }
    }
    if (input.requestCompleted) {
      await this.completeProcurementInstanceInTx(tx, actor, input.requestId);
    }
  }

  async completeProcurementInstanceInTx(tx: TxScope, actor: ActorContext, requestId: string): Promise<void> {
    const row = await this.lockProcurementInstance(tx, requestId);
    if (!row || row.status === 'COMPLETED') return;
    await tx.client.query(
      `UPDATE workflow_instances
          SET status = 'COMPLETED', money_moved = true, updated_by = $1
        WHERE id = $2`,
      [actor.ref, row.id],
    );
    await this.replaceHolds(tx, {
      instanceId: row.id,
      subjectType: 'PROCUREMENT',
      subjectId: requestId,
      reference: '',
      title: '',
      entityId: row.entity_id,
      stage: null,
      status: 'COMPLETED',
      originatorUserId: row.originator_user_id,
      createdBy: actor.ref,
    });
  }

  private async lockProcurementInstance(tx: TxScope, requestId: string): Promise<InstanceRow | null> {
    const instance = await tx.client.query<InstanceRow>(
      `SELECT i.*, d.key AS definition_key, s.key AS current_stage_key,
              NULL::text AS archived_from_stage_key, NULL::text AS entity_code,
              ''::text AS originator_name, ''::text AS title, ''::text AS reference_number,
              NULL::jsonb AS snapshot, NULL::text AS urgency, NULL::text AS amount_kobo,
              NULL::uuid AS linked_request_id
         FROM workflow_instances i
         JOIN workflow_definitions d ON d.id = i.definition_id
         LEFT JOIN workflow_stages s ON s.id = i.current_stage_id
        WHERE i.subject_type = 'PROCUREMENT' AND i.subject_id = $1
        ORDER BY i.created_at DESC
        LIMIT 1
        FOR UPDATE OF i`,
      [requestId],
    );
    return instance.rows[0] ?? null;
  }

  async startCloseShortInTx(
    tx: TxScope,
    actor: ActorContext,
    input: { closeShortId: string; requestId: string; snapshot: unknown },
  ): Promise<WorkflowInstanceView> {
    const definition = await this.loadDefinition(tx, CLOSE_SHORT_WORKFLOW_KEY);
    const first = definition.stages[0];
    if (!first) throw new Error('close-short-v1 has no stages.');
    const request = await tx.client.query<{
      reference_number: string;
      entity_id: string;
      originator_user_id: string;
      title: string;
    }>(
      `SELECT r.reference_number, r.entity_id, r.originator_user_id, v.title
         FROM procurement_requests r
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
        WHERE r.id = $1`,
      [input.requestId],
    );
    const row = request.rows[0];
    if (!row) throw new NotFoundError('That procurement request was not found.');
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO workflow_instances (
         definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
         current_stage_id, status, created_by, updated_by
       ) VALUES ($1, 'CLOSE_SHORT', $2, 1, $3, $4::uuid, $5, 'IN_PROGRESS', $6, $6)
       RETURNING id`,
      [definition.id, input.closeShortId, row.entity_id, row.originator_user_id, first.id, actor.ref],
    );
    const instanceId = inserted.rows[0]?.id;
    if (!instanceId) throw new Error('The close-short workflow was not created.');
    await this.replaceHolds(tx, {
      instanceId,
      subjectType: 'CLOSE_SHORT',
      subjectId: input.closeShortId,
      reference: row.reference_number,
      title: `Close-short ${row.reference_number}`,
      entityId: row.entity_id,
      stage: first,
      status: 'IN_PROGRESS',
      originatorUserId: row.originator_user_id,
      createdBy: actor.ref,
    });
    await this.notifyNextApprovers(
      tx,
      {
        subject_type: 'CLOSE_SHORT',
        subject_id: input.closeShortId,
        reference_number: row.reference_number,
        title: row.title,
        entity_id: row.entity_id,
      },
      first,
      `/procurement/${input.requestId}`,
    );
    void input.snapshot;
    return this.loadView(tx, actor, instanceId);
  }

  async startJournalInTx(
    tx: TxScope,
    actor: ActorContext,
    input: { journalId: string; snapshot: unknown },
  ): Promise<WorkflowInstanceView> {
    const definition = await this.loadDefinition(tx, JOURNAL_WORKFLOW_KEY);
    const first = definition.stages[0];
    if (!first) throw new Error('journal-v1 has no stages.');
    const journal = await tx.client.query<{
      reference_number: string;
      entity_id: string;
      narration: string;
    }>(`SELECT reference_number, entity_id, narration FROM journals WHERE id = $1`, [input.journalId]);
    const row = journal.rows[0];
    if (!row) throw new NotFoundError('That journal was not found.');
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO workflow_instances (
         definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
         current_stage_id, status, created_by, updated_by
       ) VALUES ($1, 'JOURNAL', $2, 1, $3, $4::uuid, $5, 'IN_PROGRESS', $4, $4)
       RETURNING id`,
      [definition.id, input.journalId, row.entity_id, actor.ref, first.id],
    );
    const instanceId = inserted.rows[0]?.id;
    if (!instanceId) throw new Error('The journal workflow was not created.');
    await this.replaceHolds(tx, {
      instanceId,
      subjectType: 'JOURNAL',
      subjectId: input.journalId,
      reference: row.reference_number,
      title: row.narration,
      entityId: row.entity_id,
      stage: first,
      status: 'IN_PROGRESS',
      originatorUserId: actor.ref,
      createdBy: actor.ref,
    });
    await this.notifyNextApprovers(
      tx,
      {
        subject_type: 'JOURNAL',
        subject_id: input.journalId,
        reference_number: row.reference_number,
        title: row.narration,
        entity_id: row.entity_id,
      },
      first,
      `/finance/journals/${input.journalId}`,
    );
    void input.snapshot;
    return this.loadView(tx, actor, instanceId);
  }

  async startBudgetInTx(
    tx: TxScope,
    actor: ActorContext,
    input: { budgetId: string; snapshot: unknown },
  ): Promise<WorkflowInstanceView> {
    const definition = await this.loadDefinition(tx, BUDGET_WORKFLOW_KEY);
    const first = definition.stages[0];
    if (!first) throw new Error('budget-v1 has no stages.');
    const budget = await tx.client.query<{
      reference_number: string;
      entity_id: string;
    }>(`SELECT reference_number, entity_id FROM budgets WHERE id = $1`, [input.budgetId]);
    const row = budget.rows[0];
    if (!row) throw new NotFoundError('That budget was not found.');
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO workflow_instances (
         definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
         current_stage_id, status, created_by, updated_by
       ) VALUES ($1, 'BUDGET', $2, 1, $3, $4::uuid, $5, 'IN_PROGRESS', $4, $4)
       RETURNING id`,
      [definition.id, input.budgetId, row.entity_id, actor.ref, first.id],
    );
    const instanceId = inserted.rows[0]?.id;
    if (!instanceId) throw new Error('The budget workflow was not created.');
    await this.replaceHolds(tx, {
      instanceId,
      subjectType: 'BUDGET',
      subjectId: input.budgetId,
      reference: row.reference_number,
      title: row.reference_number,
      entityId: row.entity_id,
      stage: first,
      status: 'IN_PROGRESS',
      originatorUserId: actor.ref,
      createdBy: actor.ref,
    });
    await this.notifyNextApprovers(
      tx,
      {
        subject_type: 'BUDGET',
        subject_id: input.budgetId,
        reference_number: row.reference_number,
        title: row.reference_number,
        entity_id: row.entity_id,
      },
      first,
      `/finance/budgets/${input.budgetId}`,
    );
    void input.snapshot;
    return this.loadView(tx, actor, instanceId);
  }

  async startIncomeInTx(
    tx: TxScope,
    actor: ActorContext,
    input: { incomeId: string; snapshot: unknown },
  ): Promise<WorkflowInstanceView> {
    return this.startFinanceDocInTx(tx, actor, {
      definitionKey: INCOME_WORKFLOW_KEY,
      subjectType: 'INCOME',
      subjectId: input.incomeId,
      table: 'income_entries',
      href: `/finance/income/${input.incomeId}`,
      snapshot: input.snapshot,
    });
  }

  async startExpenseInTx(
    tx: TxScope,
    actor: ActorContext,
    input: { expenseId: string; snapshot: unknown },
  ): Promise<WorkflowInstanceView> {
    return this.startFinanceDocInTx(tx, actor, {
      definitionKey: EXPENSE_WORKFLOW_KEY,
      subjectType: 'EXPENSE',
      subjectId: input.expenseId,
      table: 'expense_entries',
      href: `/finance/expenses/${input.expenseId}`,
      snapshot: input.snapshot,
    });
  }

  async startBillInTx(
    tx: TxScope,
    actor: ActorContext,
    input: { billId: string; snapshot: unknown },
  ): Promise<WorkflowInstanceView> {
    return this.startFinanceDocInTx(tx, actor, {
      definitionKey: BILL_WORKFLOW_KEY,
      subjectType: 'BILL',
      subjectId: input.billId,
      table: 'payable_invoices',
      href: `/finance/payables/${input.billId}`,
      snapshot: input.snapshot,
    });
  }

  async startInventoryAdjustmentInTx(
    tx: TxScope,
    actor: ActorContext,
    input: { adjustmentId: string },
  ): Promise<WorkflowInstanceView> {
    const definition = await this.loadDefinition(tx, INVENTORY_ADJUST_WORKFLOW_KEY);
    const first = definition.stages[0];
    if (!first) throw new Error('inventory-adjust-v1 has no stages.');
    const row = (
      await tx.client.query<{
        reference_number: string;
        entity_id: string;
        reason: string;
      }>(`SELECT reference_number, entity_id, reason FROM stock_adjustments WHERE id = $1`, [input.adjustmentId])
    ).rows[0];
    if (!row) throw new NotFoundError('That adjustment was not found.');
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO workflow_instances (
         definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
         current_stage_id, status, created_by, updated_by
       ) VALUES ($1, 'INVENTORY_ADJUSTMENT', $2, 1, $3, $4::uuid, $5, 'IN_PROGRESS', $4, $4)
       RETURNING id`,
      [definition.id, input.adjustmentId, row.entity_id, actor.ref, first.id],
    );
    const instanceId = inserted.rows[0]?.id;
    if (!instanceId) throw new Error('The adjustment workflow was not created.');
    await this.replaceHolds(tx, {
      instanceId,
      subjectType: 'INVENTORY_ADJUSTMENT',
      subjectId: input.adjustmentId,
      reference: row.reference_number,
      title: row.reason,
      entityId: row.entity_id,
      stage: first,
      status: 'IN_PROGRESS',
      originatorUserId: actor.ref,
      createdBy: actor.ref,
    });
    await this.notifyNextApprovers(
      tx,
      {
        subject_type: 'INVENTORY_ADJUSTMENT',
        subject_id: input.adjustmentId,
        reference_number: row.reference_number,
        title: row.reason,
        entity_id: row.entity_id,
      },
      first,
      `/inventory/adjustments`,
    );
    return this.loadView(tx, actor, instanceId);
  }

  async startInventoryTransferInTx(
    tx: TxScope,
    actor: ActorContext,
    input: { transferId: string },
  ): Promise<WorkflowInstanceView> {
    const definition = await this.loadDefinition(tx, INVENTORY_TRANSFER_WORKFLOW_KEY);
    const first = definition.stages[0];
    if (!first) throw new Error('inventory-transfer-v1 has no stages.');
    const row = (
      await tx.client.query<{
        reference_number: string;
        source_entity_id: string;
        reason: string;
      }>(`SELECT reference_number, source_entity_id, reason FROM stock_transfers WHERE id = $1`, [input.transferId])
    ).rows[0];
    if (!row) throw new NotFoundError('That transfer was not found.');
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO workflow_instances (
         definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
         current_stage_id, status, created_by, updated_by
       ) VALUES ($1, 'INVENTORY_TRANSFER', $2, 1, $3, $4::uuid, $5, 'IN_PROGRESS', $4, $4)
       RETURNING id`,
      [definition.id, input.transferId, row.source_entity_id, actor.ref, first.id],
    );
    const instanceId = inserted.rows[0]?.id;
    if (!instanceId) throw new Error('The transfer workflow was not created.');
    await this.replaceHolds(tx, {
      instanceId,
      subjectType: 'INVENTORY_TRANSFER',
      subjectId: input.transferId,
      reference: row.reference_number,
      title: row.reason,
      entityId: row.source_entity_id,
      stage: first,
      status: 'IN_PROGRESS',
      originatorUserId: actor.ref,
      createdBy: actor.ref,
    });
    await this.notifyNextApprovers(
      tx,
      {
        subject_type: 'INVENTORY_TRANSFER',
        subject_id: input.transferId,
        reference_number: row.reference_number,
        title: row.reason,
        entity_id: row.source_entity_id,
      },
      first,
      `/inventory/transfers`,
    );
    return this.loadView(tx, actor, instanceId);
  }

  async startProductionCompleteInTx(
    tx: TxScope,
    actor: ActorContext,
    input: { orderId: string },
  ): Promise<WorkflowInstanceView> {
    const definition = await this.loadDefinition(tx, PRODUCTION_COMPLETE_WORKFLOW_KEY);
    const first = definition.stages[0];
    if (!first) throw new Error('production-complete-v1 has no stages.');
    const row = (
      await tx.client.query<{
        reference_number: string;
        entity_id: string;
      }>(`SELECT reference_number, entity_id FROM production_orders WHERE id = $1`, [input.orderId])
    ).rows[0];
    if (!row) throw new NotFoundError('That production order was not found.');
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO workflow_instances (
         definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
         current_stage_id, status, created_by, updated_by
       ) VALUES ($1, 'PRODUCTION_ORDER', $2, 1, $3, $4::uuid, $5, 'IN_PROGRESS', $4, $4)
       RETURNING id`,
      [definition.id, input.orderId, row.entity_id, actor.ref, first.id],
    );
    const instanceId = inserted.rows[0]?.id;
    if (!instanceId) throw new Error('The production workflow was not created.');
    await this.replaceHolds(tx, {
      instanceId,
      subjectType: 'PRODUCTION_ORDER',
      subjectId: input.orderId,
      reference: row.reference_number,
      title: row.reference_number,
      entityId: row.entity_id,
      stage: first,
      status: 'IN_PROGRESS',
      originatorUserId: actor.ref,
      createdBy: actor.ref,
    });
    await this.notifyNextApprovers(
      tx,
      {
        subject_type: 'PRODUCTION_ORDER',
        subject_id: input.orderId,
        reference_number: row.reference_number,
        title: row.reference_number,
        entity_id: row.entity_id,
      },
      first,
      `/inventory/production/${input.orderId}`,
    );
    await tx.publish({
      eventType: 'production.submitted',
      subjectType: 'PRODUCTION_ORDER',
      subjectId: input.orderId,
      entityId: row.entity_id,
      payload: {
        type: 'production.submitted',
        reference: row.reference_number,
        title: row.reference_number,
        href: `/inventory/production/${input.orderId}`,
      },
    });
    return this.loadView(tx, actor, instanceId);
  }

  async startSalesOrderInTx(
    tx: TxScope,
    actor: ActorContext,
    input: { orderId: string },
  ): Promise<WorkflowInstanceView> {
    const definition = await this.loadDefinition(tx, SALES_ORDER_WORKFLOW_KEY);
    const first = definition.stages[0];
    if (!first) throw new Error('sales-order-v1 has no stages.');
    const row = (
      await tx.client.query<{
        reference_number: string;
        entity_id: string;
      }>(`SELECT reference_number, entity_id FROM sales_orders WHERE id = $1`, [input.orderId])
    ).rows[0];
    if (!row) throw new NotFoundError('That sales order was not found.');
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO workflow_instances (
         definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
         current_stage_id, status, created_by, updated_by
       ) VALUES ($1, 'SALES_ORDER', $2, 1, $3, $4::uuid, $5, 'IN_PROGRESS', $4, $4)
       RETURNING id`,
      [definition.id, input.orderId, row.entity_id, actor.ref, first.id],
    );
    const instanceId = inserted.rows[0]?.id;
    if (!instanceId) throw new Error('The sales order workflow was not created.');
    await this.replaceHolds(tx, {
      instanceId,
      subjectType: 'SALES_ORDER',
      subjectId: input.orderId,
      reference: row.reference_number,
      title: row.reference_number,
      entityId: row.entity_id,
      stage: first,
      status: 'IN_PROGRESS',
      originatorUserId: actor.ref,
      createdBy: actor.ref,
    });
    await this.notifyNextApprovers(
      tx,
      {
        subject_type: 'SALES_ORDER',
        subject_id: input.orderId,
        reference_number: row.reference_number,
        title: row.reference_number,
        entity_id: row.entity_id,
      },
      first,
      `/inventory/sales/${input.orderId}`,
    );
    await tx.publish({
      eventType: 'sales.order.submitted',
      subjectType: 'SALES_ORDER',
      subjectId: input.orderId,
      entityId: row.entity_id,
      payload: {
        type: 'sales.order.submitted',
        reference: row.reference_number,
        title: row.reference_number,
        href: `/inventory/sales/${input.orderId}`,
      },
    });
    return this.loadView(tx, actor, instanceId);
  }

  async startEdmsDocumentInTx(
    tx: TxScope,
    actor: ActorContext,
    input: { documentId: string; title: string; reference: string; entityId: string },
  ): Promise<WorkflowInstanceView> {
    const definition = await this.loadDefinition(tx, EDMS_DOCUMENT_WORKFLOW_KEY);
    const first = definition.stages[0];
    if (!first) throw new Error('edms-document-v1 has no stages.');
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO workflow_instances (
         definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
         current_stage_id, status, created_by, updated_by
       ) VALUES ($1, 'EDMS_DOCUMENT', $2, 1, $3, $4::uuid, $5, 'IN_PROGRESS', $4, $4)
       RETURNING id`,
      [definition.id, input.documentId, input.entityId, actor.ref, first.id],
    );
    const instanceId = inserted.rows[0]?.id;
    if (!instanceId) throw new Error('The EDMS document workflow was not created.');
    await this.replaceHolds(tx, {
      instanceId,
      subjectType: 'EDMS_DOCUMENT',
      subjectId: input.documentId,
      reference: input.reference,
      title: input.title,
      entityId: input.entityId,
      stage: first,
      status: 'IN_PROGRESS',
      originatorUserId: actor.ref,
      createdBy: actor.ref,
    });
    await this.notifyNextApprovers(
      tx,
      {
        subject_type: 'EDMS_DOCUMENT',
        subject_id: input.documentId,
        reference_number: input.reference,
        title: input.title,
        entity_id: input.entityId,
      },
      first,
      `/edms/documents/${input.documentId}`,
    );
    return this.loadView(tx, actor, instanceId);
  }

  private async startFinanceDocInTx(
    tx: TxScope,
    actor: ActorContext,
    input: {
      definitionKey: string;
      subjectType: string;
      subjectId: string;
      table: string;
      href: string;
      snapshot: unknown;
    },
  ): Promise<WorkflowInstanceView> {
    const definition = await this.loadDefinition(tx, input.definitionKey);
    const first = definition.stages[0];
    if (!first) throw new Error(`${input.definitionKey} has no stages.`);
    const subject = await tx.client.query<{
      reference_number: string;
      entity_id: string;
      title: string;
    }>(
      input.table === 'payable_invoices'
        ? `SELECT reference_number, entity_id, coalesce(narration, reference_number) AS title FROM payable_invoices WHERE id = $1`
        : `SELECT reference_number, entity_id, narration AS title FROM ${input.table} WHERE id = $1`,
      [input.subjectId],
    );
    const row = subject.rows[0];
    if (!row) throw new NotFoundError('That record was not found.');
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO workflow_instances (
         definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
         current_stage_id, status, created_by, updated_by
       ) VALUES ($1, $2, $3, 1, $4, $5::uuid, $6, 'IN_PROGRESS', $5, $5)
       RETURNING id`,
      [definition.id, input.subjectType, input.subjectId, row.entity_id, actor.ref, first.id],
    );
    const instanceId = inserted.rows[0]?.id;
    if (!instanceId) throw new Error('The workflow was not created.');
    await this.replaceHolds(tx, {
      instanceId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      reference: row.reference_number,
      title: row.title,
      entityId: row.entity_id,
      stage: first,
      status: 'IN_PROGRESS',
      originatorUserId: actor.ref,
      createdBy: actor.ref,
    });
    await this.notifyNextApprovers(
      tx,
      {
        subject_type: input.subjectType,
        subject_id: input.subjectId,
        reference_number: row.reference_number,
        title: row.title,
        entity_id: row.entity_id,
      },
      first,
      input.href,
    );
    void input.snapshot;
    return this.loadView(tx, actor, instanceId);
  }

  async completeVerificationInTx(
    tx: TxScope,
    actor: ActorContext,
    input: { requestId: string; snapshot: unknown; subjectVersion: number },
  ): Promise<void> {
    const entityId = await this.requestEntityId(tx, input.requestId);
    await this.seals.create(tx, {
      actor,
      entityId,
      subjectType: 'PROCUREMENT',
      subjectId: input.requestId,
      subjectVersion: input.subjectVersion,
      snapshot: input.snapshot,
      action: 'verified',
    });
  }

  private async applyCloseShortOutcome(
    tx: TxScope,
    actor: ActorContext,
    instance: InstanceRow,
    action: WorkflowAction,
    nextStatus: string,
    stage: StageRow,
    reason: string | null,
  ): Promise<void> {
    if (instance.subject_type !== 'CLOSE_SHORT') return;
    const close = await tx.client.query<{
      id: string;
      request_id: string;
      entity_id: string;
      outstanding_quantity: number;
      outstanding_amount_kobo: string;
      reason: string;
    }>(
      `SELECT id, request_id, entity_id, outstanding_quantity, outstanding_amount_kobo::text, reason
         FROM procurement_close_short_requests WHERE id = $1 FOR UPDATE`,
      [instance.subject_id],
    );
    const row = close.rows[0];
    if (!row) return;
    const request = await tx.client.query<{
      reference_number: string;
      title: string;
      originator_user_id: string;
      vendor_id: string | null;
    }>(
      `SELECT r.reference_number, v.title, r.originator_user_id,
              coalesce(r.vendor_id, v.vendor_id) AS vendor_id
         FROM procurement_requests r
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
        WHERE r.id = $1`,
      [row.request_id],
    );
    const linked = request.rows[0];
    const href = `/procurement/${row.request_id}`;
    if (action === 'REJECT') {
      await tx.client.query(
        `UPDATE procurement_close_short_requests SET status = 'REJECTED', updated_by = $1 WHERE id = $2`,
        [actor.ref, row.id],
      );
      const rejectText = reason
        ? `Close-short rejected at ${stage.label}. ${reason}`
        : `Close-short rejected at ${stage.label}.`;
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: row.request_id,
        text: rejectText,
        href,
        entityId: row.entity_id,
      });
      if (linked) {
        await tx.publish({
          eventType: 'procurement.close_short.rejected',
          subjectType: 'PROCUREMENT',
          subjectId: row.request_id,
          entityId: row.entity_id,
          payload: {
            type: 'procurement.close_short.rejected',
            reference: linked.reference_number,
            title: linked.title,
            recipientUserId: linked.originator_user_id,
            href,
          },
        });
      }
      return;
    }
    if (action === 'APPROVE' && nextStatus === 'IN_PROGRESS' && stage.key === 'ed-operations') {
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: row.request_id,
        text: `Close-short reviewed by ${actor.name} (${stage.label}).`,
        href,
        entityId: row.entity_id,
      });
      return;
    }
    if (action === 'APPROVE' && nextStatus === 'COMPLETED') {
      await tx.client.query(
        `UPDATE procurement_close_short_requests SET status = 'APPROVED', updated_by = $1 WHERE id = $2`,
        [actor.ref, row.id],
      );
      if (linked?.vendor_id) {
        const paid = await tx.client.query<{ amount: string }>(
          `SELECT coalesce(sum(amount_kobo), 0)::text AS amount
             FROM procurement_payments
            WHERE request_id = $1 AND reversed_at IS NULL AND status = 'COMPLETED'`,
          [row.request_id],
        );
        const accepted = await tx.client.query<{ amount: string }>(
          `SELECT coalesce(sum(
                    COALESCE((
                      SELECT sum(g.quantity_accepted)
                        FROM procurement_goods_receipts g
                       WHERE g.request_id = r.id
                         AND coalesce(g.line_id, (
                           SELECT first_line.id FROM procurement_version_lines first_line
                            WHERE first_line.version_id = l.version_id AND first_line.line_number = 1
                         )) = l.id
                         AND NOT EXISTS (
                           SELECT 1 FROM procurement_goods_receipts later WHERE later.supersedes_id = g.id
                         )
                    ), 0) * coalesce(l.unit_price_kobo, 0)
                  ), 0)::text AS amount
             FROM procurement_requests r
             JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
             JOIN procurement_version_lines l ON l.version_id = v.id
            WHERE r.id = $1`,
          [row.request_id],
        );
        const recoveryKobo = Math.max(Number(paid.rows[0]?.amount ?? 0) - Number(accepted.rows[0]?.amount ?? 0), 0);
        let recoveryId: string | null = null;
        if (recoveryKobo > 0) {
          const recovery = await tx.client.query<{ id: string }>(
            `INSERT INTO procurement_recoveries (
               entity_id, request_id, close_short_id, vendor_id, amount_kobo, created_by, updated_by
             ) VALUES ($1, $2, $3, $4, $5, $6, $6)
             ON CONFLICT (close_short_id) DO UPDATE SET amount_kobo = procurement_recoveries.amount_kobo
             RETURNING id`,
            [row.entity_id, row.request_id, row.id, linked.vendor_id, recoveryKobo, actor.ref],
          );
          recoveryId = recovery.rows[0]?.id ?? null;
        }
        await tx.client.query(
          `INSERT INTO vendor_open_claims (
             vendor_id, entity_id, request_id, close_short_id, quantity, amount_kobo, reason, created_by,
             recovery_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (close_short_id) DO NOTHING`,
          [
            linked.vendor_id,
            row.entity_id,
            row.request_id,
            row.id,
            row.outstanding_quantity,
            Number(row.outstanding_amount_kobo),
            row.reason,
            actor.ref,
            recoveryId,
          ],
        );
        if (recoveryId && recoveryKobo > 0 && this.ledger) {
          const existingInvoice = await tx.client.query<{ id: string }>(
            `SELECT id FROM receivable_invoices WHERE recovery_id = $1`,
            [recoveryId],
          );
          let invoiceId = existingInvoice.rows[0]?.id ?? null;
          if (!invoiceId) {
            const arRef = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('ARI') AS ref`);
            const today = new Date().toISOString().slice(0, 10);
            const invoice = await tx.client.query<{ id: string }>(
              `INSERT INTO receivable_invoices (
                 reference_number, entity_id, customer_id, vendor_id, recovery_id, invoice_date, due_date,
                 amount_kobo, created_by, updated_by
               ) VALUES ($1, $2, NULL, $3, $4, $5, $5, $6, $7, $7)
               RETURNING id`,
              [
                arRef.rows[0]?.ref,
                row.entity_id,
                linked.vendor_id,
                recoveryId,
                today,
                recoveryKobo,
                actor.ref,
              ],
            );
            invoiceId = invoice.rows[0]?.id ?? null;
          }
          if (invoiceId) {
            const journal = await this.ledger.postProcurementRecovery(tx, actor, {
              recoveryId,
              requestId: row.request_id,
              entityId: row.entity_id,
              vendorId: linked.vendor_id,
              amountKobo: recoveryKobo,
              occurredOn: new Date().toISOString().slice(0, 10),
              narration: `Vendor recovery ${linked.reference_number}`,
              receivableInvoiceId: invoiceId,
            });
            await tx.client.query(
              `UPDATE receivable_invoices SET journal_id = $1, updated_by = $2 WHERE id = $3`,
              [journal.id, actor.ref, invoiceId],
            );
          }
        }
      }
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: row.request_id,
        text: `Close-short approved by ${actor.name} (${stage.label}). The GM may complete the request.`,
        href,
        entityId: row.entity_id,
      });
      const amountLabel = formatKobo(BigInt(row.outstanding_amount_kobo));
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: row.request_id,
        text: `Vendor open claim recorded: ${row.outstanding_quantity} units outstanding (${amountLabel}). ${row.reason}`,
        href,
        entityId: row.entity_id,
      });
      if (linked) {
        await tx.publish({
          eventType: 'procurement.close_short.approved',
          subjectType: 'PROCUREMENT',
          subjectId: row.request_id,
          entityId: row.entity_id,
          payload: {
            type: 'procurement.close_short.approved',
            reference: linked.reference_number,
            title: linked.title,
            recipientUserId: linked.originator_user_id,
            href,
          },
        });
      }
    }
  }

  private async requestEntityId(tx: TxScope, requestId: string): Promise<string> {
    const result = await tx.client.query<{ entity_id: string }>(
      `SELECT entity_id FROM procurement_requests WHERE id = $1`,
      [requestId],
    );
    const entityId = result.rows[0]?.entity_id;
    if (!entityId) throw new NotFoundError('That procurement request was not found.');
    return entityId;
  }

  private async procurementMoneyHasMoved(tx: TxScope, instance: InstanceRow): Promise<boolean> {
    if (instance.subject_type !== 'PROCUREMENT') return false;
    const result = await tx.client.query<{ moved: boolean }>(
      `SELECT (
         EXISTS (
           SELECT 1 FROM funding_transfer_records
            WHERE request_id = $1 AND reversed_transfer_id IS NULL
         )
         OR EXISTS (
           SELECT 1 FROM procurement_payments
            WHERE request_id = $1 AND status = 'COMPLETED'
         )
       ) AS moved`,
      [instance.subject_id],
    );
    return Boolean(result.rows[0]?.moved);
  }

  private subjectHref(
    subjectType: string,
    subjectId: string,
    instanceId: string,
    linkedRequestId?: string | null,
  ): string {
    if (subjectType === 'CLOSE_SHORT' && linkedRequestId) return `/procurement/${linkedRequestId}`;
    if (subjectType === 'PROCUREMENT') return `/procurement/${subjectId}`;
    if (subjectType === 'VENDOR') return `/vendors/${subjectId}`;
    if (subjectType === 'JOURNAL') return `/finance/journals/${subjectId}`;
    if (subjectType === 'BUDGET') return `/finance/budgets/${subjectId}`;
    if (subjectType === 'INCOME') return `/finance/income/${subjectId}`;
    if (subjectType === 'EXPENSE') return `/finance/expenses/${subjectId}`;
    if (subjectType === 'BILL') return `/finance/payables/${subjectId}`;
    if (subjectType === 'INVENTORY_ADJUSTMENT') return `/inventory/adjustments`;
    if (subjectType === 'INVENTORY_TRANSFER') return `/inventory/transfers`;
    if (subjectType === 'PRODUCTION_ORDER') return `/inventory/production/${subjectId}`;
    if (subjectType === 'SALES_ORDER') return `/inventory/sales/${subjectId}`;
    if (subjectType === 'EDMS_DOCUMENT') return `/edms/documents/${subjectId}`;
    if (subjectType === 'HR_CHANGE') return `/hr/employees`;
    if (subjectType === 'HR_LEAVE') return `/hr/leave`;
    if (subjectType === 'HR_OVERTIME') return `/hr/attendance`;
    if (subjectType === 'HR_PERFORMANCE') return `/hr/performance`;
    if (subjectType === 'HR_DISCIPLINARY') return `/hr/disciplinary/${subjectId}`;
    if (subjectType === 'PAYROLL_RUN') return `/hr/payroll/${subjectId}`;
    return `/workflows/${instanceId}`;
  }

  private approvalSummary(action: WorkflowAction, stageKey: string): string {
    if (action !== 'APPROVE') return '';
    if (stageKey === 'ed-operations') {
      return 'has been approved by ED Operations and is awaiting MD approval.';
    }
    if (stageKey === 'md') {
      return 'has been approved by the MD and is awaiting Finance review.';
    }
    if (stageKey === 'ed-finance') {
      return 'has been approved by ED Finance.';
    }
    return 'has been approved.';
  }

  private async applyJournalOutcome(
    tx: TxScope,
    actor: ActorContext,
    instance: InstanceRow,
    action: WorkflowAction,
    nextStatus: string,
  ): Promise<void> {
    if (instance.subject_type !== 'JOURNAL') return;
    if (action === 'APPROVE' && nextStatus === 'COMPLETED') {
      await tx.client.query(
        `UPDATE journals
            SET status = 'POSTED', posted_at = now(), posted_by = $1, updated_by = $1
          WHERE id = $2 AND status = 'PENDING_APPROVAL'`,
        [actor.ref, instance.subject_id],
      );
      const original = await tx.client.query<{ reverses_journal_id: string | null }>(
        `SELECT reverses_journal_id FROM journals WHERE id = $1`,
        [instance.subject_id],
      );
      if (original.rows[0]?.reverses_journal_id) {
        await tx.client.query(
          `UPDATE journals SET status = 'REVERSED', updated_by = $1 WHERE id = $2 AND status = 'POSTED'`,
          [actor.ref, original.rows[0].reverses_journal_id],
        );
      }
      await tx.appendTimeline({
        subjectType: 'JOURNAL',
        subjectId: instance.subject_id,
        text: `Journal posted by ${actor.name}.`,
        href: `/finance/journals/${instance.subject_id}`,
        entityId: instance.entity_id,
      });
      return;
    }
    if (action === 'REJECT') {
      await tx.client.query(
        `UPDATE journals SET status = 'DRAFT', updated_by = $1 WHERE id = $2`,
        [actor.ref, instance.subject_id],
      );
    }
  }

  private async applyBudgetOutcome(
    tx: TxScope,
    actor: ActorContext,
    instance: InstanceRow,
    action: WorkflowAction,
    nextStatus: string,
  ): Promise<void> {
    if (instance.subject_type !== 'BUDGET') return;
    if (action === 'APPROVE' && nextStatus === 'COMPLETED') {
      await tx.client.query(
        `UPDATE budgets SET status = 'APPROVED', updated_by = $1 WHERE id = $2`,
        [actor.ref, instance.subject_id],
      );
      await tx.client.query(
        `INSERT INTO budget_lines (
           entity_id, fiscal_year, code, name, approved_amount_kobo, budget_id, department_id, created_by, updated_by
         )
         SELECT b.entity_id, y.year, vl.code, vl.name, vl.approved_amount_kobo, b.id, vl.department_id, $1, $1
           FROM budget_version_lines vl
           JOIN budgets b ON b.id = vl.budget_id
           JOIN fiscal_years y ON y.id = b.fiscal_year_id
          WHERE vl.budget_id = $2
         ON CONFLICT (entity_id, fiscal_year, code) DO UPDATE
           SET approved_amount_kobo = EXCLUDED.approved_amount_kobo,
               name = EXCLUDED.name,
               budget_id = EXCLUDED.budget_id,
               department_id = EXCLUDED.department_id,
               updated_by = EXCLUDED.updated_by`,
        [actor.ref, instance.subject_id],
      );
      await tx.appendTimeline({
        subjectType: 'BUDGET',
        subjectId: instance.subject_id,
        text: `Budget approved by ${actor.name}.`,
        href: `/finance/budgets/${instance.subject_id}`,
        entityId: instance.entity_id,
      });
      return;
    }
    if (action === 'REJECT') {
      await tx.client.query(
        `UPDATE budgets SET status = 'REJECTED', updated_by = $1 WHERE id = $2`,
        [actor.ref, instance.subject_id],
      );
    }
  }

  private async applyIncomeOutcome(
    tx: TxScope,
    actor: ActorContext,
    instance: InstanceRow,
    action: WorkflowAction,
    nextStatus: string,
  ): Promise<void> {
    if (instance.subject_type !== 'INCOME') return;
    if (action === 'APPROVE' && nextStatus === 'COMPLETED') {
      await this.income?.postApprovedInTx(tx, actor, instance.subject_id);
      return;
    }
    if (action === 'REJECT') await this.income?.rejectInTx(tx, actor, instance.subject_id);
  }

  private async applyExpenseOutcome(
    tx: TxScope,
    actor: ActorContext,
    instance: InstanceRow,
    action: WorkflowAction,
    nextStatus: string,
  ): Promise<void> {
    if (instance.subject_type !== 'EXPENSE') return;
    if (action === 'APPROVE' && nextStatus === 'COMPLETED') {
      await this.expenses?.postApprovedInTx(tx, actor, instance.subject_id);
      await tx.client.query(
        `UPDATE hr_training_sessions
            SET status = 'SCHEDULED', actual_cost_kobo = estimated_cost_kobo, updated_by = $1
          WHERE expense_entry_id = $2 AND status = 'AWAITING_FINANCE'`,
        [actor.ref, instance.subject_id],
      );
      return;
    }
    if (action === 'REJECT') {
      await this.expenses?.rejectInTx(tx, actor, instance.subject_id);
      await tx.client.query(
        `UPDATE hr_training_sessions SET status = 'PROPOSED', updated_by = $1
          WHERE expense_entry_id = $2 AND status = 'AWAITING_FINANCE'`,
        [actor.ref, instance.subject_id],
      );
    }
  }

  async startHrInTx(
    tx: TxScope,
    actor: ActorContext,
    input: {
      definitionKey: string;
      subjectType: string;
      subjectId: string;
      entityId: string;
      reference: string;
      title: string;
      href: string;
      assignees?: Array<{ stageKey: string; userId: string }>;
    },
  ): Promise<WorkflowInstanceView> {
    const definition = await this.loadDefinition(tx, input.definitionKey);
    const first = definition.stages[0];
    if (!first) throw new Error(`${input.definitionKey} has no stages.`);
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO workflow_instances (
         definition_id, subject_type, subject_id, subject_version, entity_id, originator_user_id,
         current_stage_id, status, created_by, updated_by
       ) VALUES ($1, $2, $3, 1, $4, $5::uuid, $6, 'IN_PROGRESS', $5, $5)
       RETURNING id`,
      [definition.id, input.subjectType, input.subjectId, input.entityId, actor.ref, first.id],
    );
    const instanceId = inserted.rows[0]?.id;
    if (!instanceId) throw new Error('The HR workflow was not created.');
    for (const assignee of input.assignees ?? []) {
      await tx.client.query(
        `INSERT INTO workflow_stage_assignees (instance_id, stage_key, user_id, created_by)
         VALUES ($1, $2, $3::uuid, $4)
         ON CONFLICT (instance_id, stage_key) DO UPDATE SET user_id = EXCLUDED.user_id`,
        [instanceId, assignee.stageKey, assignee.userId, actor.ref],
      );
    }
    const stage = (await this.skipUnassignedNamedStages(tx, instanceId, definition.stages, first.id)) ?? first;
    if (stage.id !== first.id) {
      await tx.client.query(`UPDATE workflow_instances SET current_stage_id = $2, updated_by = $3 WHERE id = $1`, [
        instanceId,
        stage.id,
        actor.ref,
      ]);
    }
    await this.replaceHolds(tx, {
      instanceId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      reference: input.reference,
      title: input.title,
      entityId: input.entityId,
      stage,
      status: 'IN_PROGRESS',
      originatorUserId: actor.ref,
      createdBy: actor.ref,
    });
    await this.notifyNextApprovers(
      tx,
      {
        subject_type: input.subjectType,
        subject_id: input.subjectId,
        reference_number: input.reference,
        title: input.title,
        entity_id: input.entityId,
      },
      stage,
      input.href,
    );
    return this.loadView(tx, actor, instanceId);
  }

  async startPayrollRunInTx(
    tx: TxScope,
    actor: ActorContext,
    input: { subjectId: string; entityId: string; reference: string; title: string },
  ): Promise<WorkflowInstanceView> {
    return this.startHrInTx(tx, actor, {
      definitionKey: PAYROLL_RUN_WORKFLOW_KEY,
      subjectType: 'PAYROLL_RUN',
      subjectId: input.subjectId,
      entityId: input.entityId,
      reference: input.reference,
      title: input.title,
      href: `/hr/payroll/${input.subjectId}`,
    });
  }

  private async applyPayrollOutcome(
    tx: TxScope,
    actor: ActorContext,
    instance: InstanceRow,
    action: WorkflowAction,
    nextStatus: string,
  ): Promise<void> {
    if (instance.subject_type !== 'PAYROLL_RUN') return;
    if (action !== 'APPROVE' && action !== 'REJECT') return;
    if (action === 'APPROVE' && nextStatus !== 'COMPLETED') return;
    await this.payroll?.applyOutcomeInTx(tx, actor, instance.subject_id, action);
  }

  private async applyHrOutcome(
    tx: TxScope,
    actor: ActorContext,
    instance: InstanceRow,
    action: WorkflowAction,
    nextStatus: string,
    stageKey: string,
  ): Promise<void> {
    if (!instance.subject_type.startsWith('HR_')) return;
    if (instance.subject_type === 'HR_LEAVE' && stageKey === 'relief' && (action === 'APPROVE' || action === 'REJECT')) {
      await this.hr?.noteReliefInTx(tx, actor, instance.subject_id, action);
    }
    if (action !== 'APPROVE' && action !== 'REJECT') return;
    if (action === 'APPROVE' && nextStatus !== 'COMPLETED') return;
    await this.hr?.applyHrOutcomeInTx(tx, actor, instance.subject_type, instance.subject_id, action);
  }

  private async applyBillOutcome(
    tx: TxScope,
    actor: ActorContext,
    instance: InstanceRow,
    action: WorkflowAction,
    nextStatus: string,
  ): Promise<void> {
    if (instance.subject_type !== 'BILL') return;
    if (action === 'APPROVE' && nextStatus === 'COMPLETED') {
      await this.payables?.postApprovedInTx(tx, actor, instance.subject_id);
      return;
    }
    if (action === 'REJECT') await this.payables?.rejectInTx(tx, actor, instance.subject_id);
  }

  private async applyInventoryAdjustmentOutcome(
    tx: TxScope,
    actor: ActorContext,
    instance: InstanceRow,
    action: WorkflowAction,
    nextStatus: string,
  ): Promise<void> {
    if (instance.subject_type !== 'INVENTORY_ADJUSTMENT') return;
    if (action === 'APPROVE' && nextStatus === 'COMPLETED') {
      await this.inventory?.postAdjustmentInTx(tx, actor, instance.subject_id);
      return;
    }
    if (action === 'REJECT') await this.inventory?.rejectAdjustmentInTx(tx, actor, instance.subject_id);
  }

  private async applyInventoryTransferOutcome(
    tx: TxScope,
    actor: ActorContext,
    instance: InstanceRow,
    action: WorkflowAction,
    nextStatus: string,
  ): Promise<void> {
    if (instance.subject_type !== 'INVENTORY_TRANSFER') return;
    if (action === 'APPROVE' && nextStatus === 'COMPLETED') {
      await this.inventory?.postTransferOutInTx(tx, actor, instance.subject_id);
      return;
    }
    if (action === 'REJECT') await this.inventory?.rejectTransferInTx(tx, actor, instance.subject_id);
  }

  private async applyProductionOutcome(
    tx: TxScope,
    actor: ActorContext,
    instance: InstanceRow,
    action: WorkflowAction,
    nextStatus: string,
  ): Promise<void> {
    if (instance.subject_type !== 'PRODUCTION_ORDER') return;
    if (action === 'APPROVE' && nextStatus === 'COMPLETED') {
      await this.production?.completeOnApproveInTx(tx, actor, instance.subject_id);
      return;
    }
    if (action === 'REJECT') await this.production?.rejectInTx(tx, actor, instance.subject_id);
  }

  private async applySalesOrderOutcome(
    tx: TxScope,
    actor: ActorContext,
    instance: InstanceRow,
    action: WorkflowAction,
    nextStatus: string,
  ): Promise<void> {
    if (instance.subject_type !== 'SALES_ORDER') return;
    if (action === 'APPROVE' && nextStatus === 'COMPLETED') {
      await this.sales?.approveInTx(tx, actor, instance.subject_id);
      return;
    }
    if (action === 'REJECT') await this.sales?.rejectInTx(tx, actor, instance.subject_id);
  }

  private async applyEdmsDocumentOutcome(
    tx: TxScope,
    instance: InstanceRow,
    action: WorkflowAction,
    nextStatus: string,
  ): Promise<void> {
    if (instance.subject_type !== 'EDMS_DOCUMENT') return;
    if (action === 'APPROVE' && nextStatus === 'COMPLETED') {
      await this.edms?.markDocumentListed(tx, instance.subject_id, true);
      return;
    }
    if (action === 'REJECT') await this.edms?.markDocumentListed(tx, instance.subject_id, false);
  }

  private async notifyNextApprovers(
    tx: TxScope,
    instance: {
      subject_type: string;
      subject_id: string;
      entity_id: string;
      reference_number: string;
      title: string;
    },
    stage: StageRow | null,
    href: string,
  ): Promise<void> {
    if (!stage || instance.subject_type === 'VENDOR') return;
    if (stage.scope_resolver === 'NAMED_ASSIGNEE') {
      const holders = await tx.client.query<{ user_id: string }>(
        `SELECT a.user_id
           FROM workflow_stage_assignees a
           JOIN workflow_instances i ON i.id = a.instance_id
          WHERE i.subject_id = $1 AND i.subject_type = $2 AND a.stage_key = $3`,
        [instance.subject_id, instance.subject_type, stage.key],
      );
      for (const holder of holders.rows) {
        await tx.publish({
          eventType: 'procurement.awaiting_review',
          subjectType: instance.subject_type,
          subjectId: instance.subject_id,
          entityId: instance.entity_id,
          payload: {
            type: 'procurement.awaiting_review',
            reference: instance.reference_number,
            title: instance.title,
            stage: stage.label,
            action: `act at ${stage.label}`,
            recipientUserId: holder.user_id,
            href,
          },
        });
      }
      return;
    }
    if (!stage.required_permission) return;
    let action = `act at ${stage.label}`;
    let target = href;
    if (instance.subject_type === 'PROCUREMENT') {
      const state = await this.procurementWaitState(tx, instance.subject_id);
      if (state?.deferred) return;
      if (state?.action) {
        action = state.action.label.charAt(0).toLowerCase() + state.action.label.slice(1);
        target = `/procurement/${instance.subject_id}?step=${randomUUID().slice(0, 8)}#${state.action.anchor}`;
      }
    }
    const holders = await tx.client.query<{ user_id: string }>(
      `SELECT user_id FROM app.users_holding_permission($1, $2::uuid, $3)`,
      [stage.required_permission, instance.entity_id, stage.scope_resolver],
    );
    for (const holder of holders.rows) {
      await tx.publish({
        eventType: 'procurement.awaiting_review',
        subjectType: instance.subject_type,
        subjectId: instance.subject_id,
        entityId: instance.entity_id,
        payload: {
          type: 'procurement.awaiting_review',
          reference: instance.reference_number,
          title: instance.title,
          stage: stage.label,
          action,
          recipientUserId: holder.user_id,
          href: target,
        },
      });
    }
  }

  /**
   * Where a procurement stands for its workflow holds. `deferred` is true while
   * nobody on the current stage can act yet: during delivery verification
   * (a Procurement Manager task, not a workflow stage) and while ED Finance
   * waits for the vendor invoice.
   */
  private async procurementWaitState(
    tx: TxScope,
    requestId: string,
  ): Promise<{ status: string; deferred: boolean; action: ProcurementNextAction | null } | null> {
    const result = await tx.client.query<{
      status: string;
      requisition_id: string | null;
      final_payment_timing: string | null;
      funding_route: string | null;
      invoice_ready: boolean;
    }>(
      `SELECT r.status, r.requisition_id, r.final_payment_timing, r.funding_route,
              (
                r.requisition_id IS NULL
                OR (inv.id IS NOT NULL AND (
                  inv.amount_kobo = coalesce(v.total_amount_kobo, 0)
                  OR EXISTS (
                    SELECT 1 FROM procurement_invoice_variances x
                     WHERE x.version_id = v.id AND x.status = 'APPROVED' AND x.invoice_amount_kobo = inv.amount_kobo
                  )
                ))
              ) AS invoice_ready
         FROM procurement_requests r
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
         LEFT JOIN procurement_invoices inv ON inv.version_id = v.id
        WHERE r.id = $1`,
      [requestId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const awaitingInvoice = row.status === 'AWAITING_ED_FINANCE' && !row.invoice_ready;
    const action = procurementNextAction({
      status: row.status,
      requisitionId: row.requisition_id,
      returned: false,
      finalPaymentTiming:
        row.final_payment_timing && isPaymentTiming(row.final_payment_timing) ? row.final_payment_timing : null,
      fundingRoute: row.funding_route && isFundingRoute(row.funding_route) ? row.funding_route : null,
      invoiceStage: awaitingInvoice ? 'awaiting_invoice' : 'ready',
      deliveryComplete: false,
      paymentComplete: false,
    });
    const deferred = awaitingInvoice || row.status === 'AWAITING_DELIVERY' || row.status === 'PARTIALLY_RECEIVED';
    return { status: row.status, deferred, action };
  }

  /**
   * Opens holds for, and notifies, whoever acts on the current stage once a
   * deferred procurement becomes actionable again: after delivery verification
   * for pay-after-delivery requests, or once the vendor invoice is ready.
   */
  async activateCurrentStageInTx(
    tx: TxScope,
    actor: ActorContext,
    requestId: string,
    opts: { notify: boolean },
  ): Promise<void> {
    const row = await this.lockProcurementInstance(tx, requestId);
    if (!row || row.status !== 'IN_PROGRESS' || !row.current_stage_id) return;
    const state = await this.procurementWaitState(tx, requestId);
    if (!state || state.deferred) return;
    const stages = await this.loadStages(tx, row.definition_id);
    const stage = stages.find((item) => item.id === row.current_stage_id) ?? null;
    const reference = await tx.client.query<{ reference_number: string; title: string }>(
      `SELECT r.reference_number, v.title
         FROM procurement_requests r
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
        WHERE r.id = $1`,
      [requestId],
    );
    const subject = {
      subject_type: 'PROCUREMENT',
      subject_id: requestId,
      entity_id: row.entity_id,
      reference_number: reference.rows[0]?.reference_number ?? '',
      title: reference.rows[0]?.title ?? '',
    };
    await this.replaceHolds(tx, {
      instanceId: row.id,
      subjectType: 'PROCUREMENT',
      subjectId: requestId,
      reference: subject.reference_number,
      title: subject.title,
      entityId: row.entity_id,
      stage,
      status: 'IN_PROGRESS',
      originatorUserId: row.originator_user_id,
      createdBy: actor.ref,
    });
    if (opts.notify) {
      await this.notifyNextApprovers(tx, subject, stage, this.subjectHref('PROCUREMENT', requestId, row.id));
    }
  }

  /** The payer's stage becomes actionable once a pay-after-delivery delivery is verified. */
  async activatePaymentStageInTx(tx: TxScope, actor: ActorContext, requestId: string): Promise<void> {
    await this.activateCurrentStageInTx(tx, actor, requestId, { notify: true });
  }
}
