import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { ActorContext } from '@nfc/db';
import { decryptBlob } from '@nfc/db';
import {
  type PayrollComponent,
  type PayrollDashboardView,
  type PayrollExceptionView,
  type PayrollHrReportView,
  type PayrollLoanView,
  type PayrollOrgSnapshot,
  type PayrollPayeBandView,
  type PayrollPensionRateView,
  type PayrollRemittanceView,
  type PayrollRunLineView,
  type PayrollRunListItemView,
  type PayrollRunView,
  type PayrollSettingsView,
  type PayrollStatutoryView,
  type PayrollStructureView,
} from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import {
  ConflictError,
  NotFoundError,
  StaleRecordError,
  ValidationFailedError,
} from '../common/errors/domain-error';
import { loadApiEnv } from '../config/env';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import { DocumentsService } from '../documents/documents.service';
import { STORAGE_DRIVER, type StorageDriver } from '../documents/storage';
import { JournalsService } from '../finance/journals.service';
import { LedgerPostingService } from '../finance/ledger-posting.service';
import { HrService } from '../hr/hr.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { renderPayslipPdf } from './payroll-pdf';
import type {
  AdjustRunInput,
  CreateLoanInput,
  CreatePayeBandInput,
  CreatePensionInput,
  CreateRunInput,
  CreateStatutoryInput,
  CreateStructureInput,
  PayRunInput,
  RemitInput,
  UpdateSettingsInput,
} from './payroll.dto';

interface PeriodRow {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: string;
  entity_id: string;
}

interface RunRow {
  id: string;
  reference_number: string;
  entity_id: string;
  entity_code: string | null;
  fiscal_period_id: string;
  period_name: string | null;
  period_ends_on: string | null;
  status: string;
  workflow_instance_id: string | null;
  employee_count: number;
  gross_kobo: string;
  net_kobo: string;
  paye_kobo: string;
  pension_employee_kobo: string;
  pension_employer_kobo: string;
  exceptions: PayrollExceptionView[];
  journal_id: string | null;
  row_version: number;
  created_by: string;
}

@Injectable()
export class PayrollService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    @Inject(forwardRef(() => WorkflowsService)) private readonly workflows: WorkflowsService,
    private readonly journals: JournalsService,
    private readonly ledger: LedgerPostingService,
    private readonly documents: DocumentsService,
    @Inject(forwardRef(() => HrService)) private readonly hr: HrService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async dashboard(actor: ActorContext): Promise<PayrollDashboardView> {
    assertCan(actor, 'payroll.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const counts = await tx.client.query<{ calculated: string; submitted: string; locked: string; unremitted: string }>(
        `SELECT
           count(*) FILTER (WHERE status = 'CALCULATED')::text AS calculated,
           count(*) FILTER (WHERE status = 'SUBMITTED')::text AS submitted,
           count(*) FILTER (WHERE status = 'LOCKED')::text AS locked,
           coalesce((SELECT count(*) FROM payroll_remittances r WHERE r.status = 'UNREMITTED'), 0)::text AS unremitted
           FROM payroll_runs`,
      );
      return {
        calculated: Number(counts.rows[0]?.calculated ?? 0),
        submitted: Number(counts.rows[0]?.submitted ?? 0),
        lockedUnpaid: Number(counts.rows[0]?.locked ?? 0),
        unremitted: Number(counts.rows[0]?.unremitted ?? 0),
      };
    });
  }

  async getSettings(actor: ActorContext): Promise<PayrollSettingsView> {
    assertCan(actor, 'payroll.view');
    return this.unitOfWork.read(actor, async (tx) => this.loadSettings(tx));
  }

  async updateSettings(actor: ActorContext, input: UpdateSettingsInput): Promise<PayrollSettingsView> {
    assertCan(actor, 'payroll.config');
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.loadSettings(tx);
      if (current.rowVersion !== input.rowVersion) {
        throw new StaleRecordError('Payroll settings have changed. Refresh and try again.');
      }
      const next = {
        threshold: input.edFinanceThresholdKobo ?? current.edFinanceThresholdKobo,
        ot: input.overtimeMultiplierBps ?? current.overtimeMultiplierBps,
        suspended: input.includeSuspended ?? current.includeSuspended,
        divisor: input.unpaidLeaveDailyDivisor ?? current.unpaidLeaveDailyDivisor,
      };
      await tx.client.query(
        `UPDATE payroll_settings
            SET ed_finance_threshold_kobo = $1, overtime_multiplier_bps = $2,
                include_suspended = $3, unpaid_leave_daily_divisor = $4, updated_by = $5
          WHERE id = $6`,
        [next.threshold, next.ot, next.suspended, next.divisor, actor.ref, current.id],
      );
      await tx.audit({
        action: 'payroll_change',
        subjectType: 'payroll_settings',
        subjectId: current.id,
        subjectLabel: 'Payroll settings',
        oldValue: {
          edFinanceThresholdKobo: current.edFinanceThresholdKobo,
          overtimeMultiplierBps: current.overtimeMultiplierBps,
          includeSuspended: current.includeSuspended,
          unpaidLeaveDailyDivisor: current.unpaidLeaveDailyDivisor,
        },
        newValue: next,
      });
      return this.loadSettings(tx);
    });
  }

  async listPaye(actor: ActorContext): Promise<PayrollPayeBandView[]> {
    assertCan(actor, 'payroll.view');
    return this.unitOfWork.read(actor, async (tx) => this.listPayeInTx(tx));
  }

  async createPaye(actor: ActorContext, input: CreatePayeBandInput): Promise<PayrollPayeBandView[]> {
    assertCan(actor, 'payroll.config');
    return this.unitOfWork.write(actor, async (tx) => {
      await tx.client.query(
        `INSERT INTO payroll_paye_bands (effective_on, from_kobo, to_kobo, rate_bps, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [input.effectiveOn, input.fromKobo, input.toKobo ?? null, input.rateBps, actor.ref],
      );
      await tx.audit({
        action: 'payroll_change',
        subjectType: 'payroll_paye_bands',
        subjectId: randomUUID(),
        subjectLabel: 'PAYE band',
        newValue: input,
      });
      return this.listPayeInTx(tx);
    });
  }

  async listPension(actor: ActorContext): Promise<PayrollPensionRateView[]> {
    assertCan(actor, 'payroll.view');
    return this.unitOfWork.read(actor, async (tx) => this.listPensionInTx(tx));
  }

  async createPension(actor: ActorContext, input: CreatePensionInput): Promise<PayrollPensionRateView[]> {
    assertCan(actor, 'payroll.config');
    return this.unitOfWork.write(actor, async (tx) => {
      await tx.client.query(
        `INSERT INTO payroll_pension_rates (effective_on, employee_bps, employer_bps, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $4)`,
        [input.effectiveOn, input.employeeBps, input.employerBps, actor.ref],
      );
      await tx.audit({
        action: 'payroll_change',
        subjectType: 'payroll_pension_rates',
        subjectId: randomUUID(),
        subjectLabel: 'Pension rate',
        newValue: input,
      });
      return this.listPensionInTx(tx);
    });
  }

  async listStatutory(actor: ActorContext): Promise<PayrollStatutoryView[]> {
    assertCan(actor, 'payroll.view');
    return this.unitOfWork.read(actor, async (tx) => this.listStatutoryInTx(tx));
  }

  async createStatutory(actor: ActorContext, input: CreateStatutoryInput): Promise<PayrollStatutoryView[]> {
    assertCan(actor, 'payroll.config');
    if (input.rateBps == null && input.amountKobo == null) {
      throw new ValidationFailedError('A rate or a fixed amount is required.');
    }
    return this.unitOfWork.write(actor, async (tx) => {
      await tx.client.query(
        `INSERT INTO payroll_other_statutory (key, name, effective_on, rate_bps, amount_kobo, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [input.key, input.name, input.effectiveOn, input.rateBps ?? null, input.amountKobo ?? null, actor.ref],
      );
      await tx.audit({
        action: 'payroll_change',
        subjectType: 'payroll_other_statutory',
        subjectId: randomUUID(),
        subjectLabel: input.name,
        newValue: input,
      });
      return this.listStatutoryInTx(tx);
    });
  }

  async listStructures(actor: ActorContext, employeeId?: string): Promise<PayrollStructureView[]> {
    assertCan(actor, 'payroll.view');
    return this.unitOfWork.read(actor, async (tx) => this.listStructuresInTx(tx, employeeId));
  }

  async createStructure(actor: ActorContext, input: CreateStructureInput): Promise<PayrollStructureView> {
    assertCan(actor, 'payroll.structure.manage', input.entityId);
    if (!input.employeeId && !input.gradeKey) {
      throw new ValidationFailedError('A salary structure needs an employee or a grade.');
    }
    return this.unitOfWork.write(actor, async (tx) => {
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO payroll_salary_structures (
           employee_id, grade_key, entity_id, basic_kobo, allowances, overtime_rule, effective_on, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $8)
         RETURNING id`,
        [
          input.employeeId ?? null,
          input.gradeKey ?? null,
          input.entityId,
          input.basicKobo,
          JSON.stringify(input.allowances ?? []),
          input.overtimeRule ?? null,
          input.effectiveOn,
          actor.ref,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The salary structure was not created.');
      await tx.audit({
        action: 'payroll_change',
        subjectType: 'payroll_salary_structure',
        subjectId: id,
        subjectLabel: 'Salary structure',
        entityId: input.entityId,
        newValue: { basicKobo: input.basicKobo, effectiveOn: input.effectiveOn },
      });
      const list = await this.listStructuresInTx(tx, input.employeeId ?? undefined);
      const created = list.find((row) => row.id === id);
      if (!created) throw new Error('The salary structure was not readable.');
      return created;
    });
  }

  async confirmStructure(actor: ActorContext, id: string, rowVersion: number): Promise<PayrollStructureView> {
    assertCan(actor, 'payroll.structure.manage');
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await tx.client.query<{
        id: string;
        employee_id: string | null;
        grade_key: string | null;
        entity_id: string;
        basic_kobo: string;
        allowances: PayrollComponent[];
        status: string;
        row_version: number;
        effective_on: string;
      }>(
        `SELECT id, employee_id, grade_key, entity_id, basic_kobo::text, allowances, status, row_version, effective_on::text
           FROM payroll_salary_structures WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundError('That salary structure does not exist.');
      assertCan(actor, 'payroll.structure.manage', row.entity_id);
      if (row.row_version !== rowVersion) throw new StaleRecordError('This structure has changed.');
      if (row.status !== 'DRAFT') throw new ConflictError('Only a draft structure can be confirmed.');
      const sameDate = await tx.client.query<{ id: string }>(
        `SELECT id FROM payroll_salary_structures
          WHERE status = 'CONFIRMED' AND id <> $1 AND effective_on = $2::date
            AND entity_id = $3
            AND (
              ($4::uuid IS NOT NULL AND employee_id = $4)
              OR ($4::uuid IS NULL AND grade_key IS NOT DISTINCT FROM $5)
            )
          ORDER BY effective_on DESC`,
        [id, row.effective_on, row.entity_id, row.employee_id, row.grade_key ?? null],
      );
      if (sameDate.rows[0]) {
        await tx.client.query(
          `UPDATE payroll_salary_structures SET status = 'SUPERSEDED', updated_by = $1 WHERE id = $2`,
          [actor.ref, sameDate.rows[0].id],
        );
      }
      const predecessor = await tx.client.query<{ id: string }>(
        `SELECT id FROM payroll_salary_structures
          WHERE status = 'CONFIRMED' AND id <> $1 AND effective_on < $2::date
            AND entity_id = $3
            AND (
              ($4::uuid IS NOT NULL AND employee_id = $4)
              OR ($4::uuid IS NULL AND grade_key IS NOT DISTINCT FROM $5)
            )
          ORDER BY effective_on DESC LIMIT 1`,
        [id, row.effective_on, row.entity_id, row.employee_id, row.grade_key ?? null],
      );
      const supersedesId = sameDate.rows[0]?.id ?? predecessor.rows[0]?.id ?? null;
      if (row.employee_id) {
        const allowances = (row.allowances ?? []).reduce((sum, item) => sum + item.amountKobo, 0);
        await tx.client.query(
          `UPDATE hr_employees SET salary_kobo = $1, updated_by = $2 WHERE id = $3`,
          [Number(row.basic_kobo) + allowances, actor.ref, row.employee_id],
        );
      }
      await tx.client.query(
        `UPDATE payroll_salary_structures
            SET status = 'CONFIRMED', supersedes_id = $1, updated_by = $2
          WHERE id = $3`,
        [supersedesId, actor.ref, id],
      );
      await tx.audit({
        action: 'payroll_change',
        subjectType: 'payroll_salary_structure',
        subjectId: id,
        subjectLabel: 'Salary structure confirmed',
        entityId: row.entity_id,
        newValue: { status: 'CONFIRMED', salaryKobo: Number(row.basic_kobo) },
      });
      const list = await this.listStructuresInTx(tx, row.employee_id ?? undefined);
      const confirmed = list.find((item) => item.id === id);
      if (!confirmed) throw new Error('The confirmed structure was not readable.');
      return confirmed;
    });
  }

  async listLoans(actor: ActorContext, employeeId?: string): Promise<PayrollLoanView[]> {
    assertCan(actor, 'payroll.view');
    return this.unitOfWork.read(actor, async (tx) => this.listLoansInTx(tx, employeeId));
  }

  async createLoan(actor: ActorContext, input: CreateLoanInput): Promise<PayrollLoanView> {
    assertCan(actor, 'payroll.structure.manage', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO payroll_loans (
           employee_id, entity_id, principal_kobo, remaining_kobo, installment_kobo, starts_on, created_by, updated_by
         ) VALUES ($1, $2, $3, $3, $4, $5, $6, $6)
         RETURNING id`,
        [input.employeeId, input.entityId, input.principalKobo, input.installmentKobo, input.startsOn, actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The loan was not created.');
      const list = await this.listLoansInTx(tx, input.employeeId);
      const created = list.find((row) => row.id === id);
      if (!created) throw new Error('The loan was not readable.');
      return created;
    });
  }

  async listPeriods(
    actor: ActorContext,
    entityId?: string,
  ): Promise<Array<{ id: string; name: string; entityId: string; entityCode: string | null; startsOn: string; endsOn: string }>> {
    assertCan(actor, 'payroll.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        name: string;
        entity_id: string;
        entity_code: string | null;
        starts_on: string;
        ends_on: string;
      }>(
        `SELECT p.id, p.name, p.entity_id, e.code AS entity_code, p.starts_on::text, p.ends_on::text
           FROM fiscal_periods p
           JOIN entities e ON e.id = p.entity_id
          WHERE p.status = 'OPEN' AND ($1::uuid IS NULL OR p.entity_id = $1)
          ORDER BY e.code, p.period_index`,
        [entityId ?? null],
      );
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        entityId: row.entity_id,
        entityCode: row.entity_code,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
      }));
    });
  }

  async listRuns(actor: ActorContext, entityId?: string): Promise<PayrollRunListItemView[]> {
    assertCan(actor, 'payroll.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        reference_number: string;
        entity_id: string;
        entity_code: string | null;
        period_name: string | null;
        status: PayrollRunListItemView['status'];
        employee_count: number;
        net_kobo: string;
        exception_count: string;
      }>(
        `SELECT r.id, r.reference_number, r.entity_id, e.code AS entity_code, p.name AS period_name,
                r.status, r.employee_count, r.net_kobo::text,
                coalesce(jsonb_array_length(r.exceptions), 0)::text AS exception_count
           FROM payroll_runs r
           JOIN entities e ON e.id = r.entity_id
           JOIN fiscal_periods p ON p.id = r.fiscal_period_id
          WHERE ($1::uuid IS NULL OR r.entity_id = $1)
          ORDER BY r.created_at DESC`,
        [entityId ?? null],
      );
      const showMoney = can(actor, 'payroll.view');
      return result.rows.map((row) => ({
        id: row.id,
        referenceNumber: row.reference_number,
        entityId: row.entity_id,
        entityCode: row.entity_code,
        periodName: row.period_name,
        status: row.status,
        employeeCount: row.employee_count,
        netKobo: showMoney ? Number(row.net_kobo) : null,
        exceptionCount: Number(row.exception_count),
      }));
    });
  }

  async getRun(actor: ActorContext, id: string): Promise<PayrollRunView> {
    assertCan(actor, 'payroll.view');
    return this.unitOfWork.read(actor, async (tx) => this.loadRunView(tx, actor, id));
  }

  async createRun(actor: ActorContext, input: CreateRunInput): Promise<PayrollRunView> {
    assertCan(actor, 'payroll.run.prepare', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM payroll_runs WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) return this.loadRunView(tx, actor, existing.rows[0].id);
      const period = await this.loadPeriod(tx, input.fiscalPeriodId, input.entityId);
      const allocated = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('PRL') AS ref`);
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The payroll reference was not allocated.');
      try {
        const inserted = await tx.client.query<{ id: string }>(
          `INSERT INTO payroll_runs (
             reference_number, entity_id, fiscal_period_id, idempotency_key, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $5)
           RETURNING id`,
          [reference, input.entityId, period.id, input.idempotencyKey, actor.ref],
        );
        const id = inserted.rows[0]?.id;
        if (!id) throw new Error('The payroll run was not created.');
        await this.indexRun(tx, id, reference, input.entityId, period.name);
        await tx.audit({
          action: 'create',
          subjectType: 'payroll_run',
          subjectId: id,
          subjectLabel: reference,
          subjectReferenceNumber: reference,
          entityId: input.entityId,
          newValue: { status: 'DRAFT' },
        });
        return this.loadRunView(tx, actor, id);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === '23505') {
          throw new ConflictError('An open payroll run already exists for this subsidiary period.');
        }
        throw error;
      }
    });
  }

  async calculate(actor: ActorContext, id: string, rowVersion: number): Promise<PayrollRunView> {
    assertCan(actor, 'payroll.run.prepare');
    return this.unitOfWork.write(actor, async (tx) => {
      const run = await this.lockRun(tx, id);
      assertCan(actor, 'payroll.run.prepare', run.entity_id);
      if (run.row_version !== rowVersion) throw new StaleRecordError('This payroll run has changed.');
      if (run.status !== 'DRAFT' && run.status !== 'CALCULATED') {
        throw new ConflictError('Only a draft or calculated run can be recalculated.');
      }
      const period = await this.loadPeriod(tx, run.fiscal_period_id, run.entity_id);
      await this.calculateInTx(tx, actor, run, period);
      return this.loadRunView(tx, actor, id);
    });
  }

  async submit(actor: ActorContext, id: string, rowVersion: number): Promise<PayrollRunView> {
    assertCan(actor, 'payroll.run.prepare');
    return this.unitOfWork.write(actor, async (tx) => {
      const run = await this.lockRun(tx, id);
      assertCan(actor, 'payroll.run.prepare', run.entity_id);
      if (run.row_version !== rowVersion) throw new StaleRecordError('This payroll run has changed.');
      if (run.status !== 'CALCULATED') throw new ConflictError('Calculate the run before submitting it.');
      if ((run.exceptions ?? []).length > 0) {
        throw new ConflictError('Resolve payroll exceptions before submitting the run.');
      }
      const instance = await this.workflows.startPayrollRunInTx(tx, actor, {
        subjectId: run.id,
        entityId: run.entity_id,
        reference: run.reference_number,
        title: `Payroll ${run.reference_number}`,
      });
      await tx.client.query(
        `UPDATE payroll_runs
            SET status = 'SUBMITTED', workflow_instance_id = $1, updated_by = $2
          WHERE id = $3`,
        [instance.id, actor.ref, run.id],
      );
      await tx.audit({
        action: 'edit',
        subjectType: 'payroll_run',
        subjectId: run.id,
        subjectLabel: run.reference_number,
        subjectReferenceNumber: run.reference_number,
        entityId: run.entity_id,
        newValue: { status: 'SUBMITTED' },
      });
      return this.loadRunView(tx, actor, id);
    });
  }

  async applyOutcomeInTx(
    tx: TxScope,
    actor: ActorContext,
    runId: string,
    action: 'APPROVE' | 'REJECT',
  ): Promise<void> {
    const run = await this.lockRun(tx, runId);
    if (action === 'REJECT') {
      await tx.client.query(
        `UPDATE payroll_runs SET status = 'CALCULATED', workflow_instance_id = NULL, updated_by = $1 WHERE id = $2`,
        [actor.ref, run.id],
      );
      return;
    }
    await tx.client.query(
      `UPDATE payroll_runs SET status = 'LOCKED', updated_by = $1 WHERE id = $2 AND status IN ('SUBMITTED', 'APPROVED')`,
      [actor.ref, run.id],
    );
    await this.issuePayslipsInTx(tx, actor, run.id);
  }

  async thresholdKoboInTx(tx: TxScope): Promise<number> {
    const settings = await this.loadSettings(tx);
    return settings.edFinanceThresholdKobo;
  }

  async netKoboInTx(tx: TxScope, runId: string): Promise<number> {
    const run = await tx.client.query<{ net_kobo: string }>(
      `SELECT net_kobo::text FROM payroll_runs WHERE id = $1`,
      [runId],
    );
    return Number(run.rows[0]?.net_kobo ?? 0);
  }

  async pay(actor: ActorContext, id: string, input: PayRunInput): Promise<PayrollRunView> {
    assertCan(actor, 'payroll.pay');
    return this.unitOfWork.write(actor, async (tx) => {
      const run = await this.lockRun(tx, id);
      assertCan(actor, 'payroll.pay', run.entity_id);
      if (run.row_version !== input.rowVersion) throw new StaleRecordError('This payroll run has changed.');
      if (run.status !== 'LOCKED') throw new ConflictError('Only a locked run can be paid.');
      const evidence = await tx.client.query<{ id: string }>(
        `SELECT id FROM documents WHERE id = $1 AND entity_id = $2`,
        [input.evidenceDocumentId, run.entity_id],
      );
      if (!evidence.rows[0]) throw new ValidationFailedError('Payment evidence is required.');
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM payroll_payment_batches WHERE run_id = $1`,
        [run.id],
      );
      if (existing.rows[0] && run.journal_id) return this.loadRunView(tx, actor, id);

      const lines = await this.loadLineRows(tx, run.id);
      const totals = lines.reduce(
        (acc, line) => ({
          gross: acc.gross + Number(line.gross_kobo),
          paye: acc.paye + Number(line.paye_kobo),
          pensionEe: acc.pensionEe + Number(line.pension_employee_kobo),
          pensionEr: acc.pensionEr + Number(line.pension_employer_kobo),
          other: acc.other + Number(line.other_statutory_kobo),
          loan: acc.loan + Number(line.loan_kobo),
          net: acc.net + Number(line.net_kobo),
        }),
        { gross: 0, paye: 0, pensionEe: 0, pensionEr: 0, other: 0, loan: 0, net: 0 },
      );
      const personnel = await this.ledger.accountIdByCode(tx, run.entity_id, '5210');
      const paye = await this.ledger.accountIdByCode(tx, run.entity_id, '2130');
      const pension = await this.ledger.accountIdByCode(tx, run.entity_id, '2140');
      const netSalaries = await this.ledger.accountIdByCode(tx, run.entity_id, '2150');
      const advances = await this.ledger.accountIdByCode(tx, run.entity_id, '1160');
      const otherPay = await this.ledger.accountIdByCode(tx, run.entity_id, '2135');
      const debit = totals.gross + totals.pensionEr;
      const journalLines = [
        { accountId: personnel, debitKobo: debit, creditKobo: 0, narration: 'Payroll cost' },
        { accountId: paye, debitKobo: 0, creditKobo: totals.paye, narration: 'PAYE payable' },
        {
          accountId: pension,
          debitKobo: 0,
          creditKobo: totals.pensionEe + totals.pensionEr,
          narration: 'Pension payable',
        },
        { accountId: netSalaries, debitKobo: 0, creditKobo: totals.net, narration: 'Net salaries payable' },
      ];
      if (totals.loan > 0) {
        journalLines.push({
          accountId: advances,
          debitKobo: 0,
          creditKobo: totals.loan,
          narration: 'Staff advance recovery',
        });
      }
      if (totals.other > 0) {
        journalLines.push({
          accountId: otherPay,
          debitKobo: 0,
          creditKobo: totals.other,
          narration: 'Other statutory payable',
        });
      }
      const journal = await this.journals.postSystemInTx(tx, actor, {
        entityId: run.entity_id,
        fiscalPeriodId: run.fiscal_period_id,
        narration: `Payroll ${run.reference_number}`,
        idempotencyKey: input.idempotencyKey,
        source: 'PAYROLL',
        lines: journalLines.filter((line) => line.debitKobo > 0 || line.creditKobo > 0),
      });
      const csv = lines
        .map(
          (line) =>
            `${line.bank_account_number ?? ''},${line.employee_name ?? ''},${Number(line.net_kobo)}`,
        )
        .join('\n');
      const sha = createHash('sha256').update(csv).digest('hex');
      await tx.client.query(
        `INSERT INTO payroll_payment_batches (
           run_id, entity_id, evidence_document_id, bank_file_name, bank_file_sha256, journal_id, paid_at,
           created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $7)
         ON CONFLICT (run_id) DO UPDATE
           SET evidence_document_id = EXCLUDED.evidence_document_id, journal_id = EXCLUDED.journal_id,
               paid_at = now(), updated_by = EXCLUDED.updated_by`,
        [run.id, run.entity_id, input.evidenceDocumentId, `${run.reference_number}.csv`, sha, journal.id, actor.ref],
      );
      await tx.client.query(
        `INSERT INTO payroll_remittances (run_id, entity_id, kind, amount_kobo, created_by, updated_by)
         VALUES ($1, $2, 'PAYE', $3, $4, $4), ($1, $2, 'PENSION', $5, $4, $4)
         ON CONFLICT (run_id, kind) DO NOTHING`,
        [run.id, run.entity_id, totals.paye, actor.ref, totals.pensionEe + totals.pensionEr],
      );
      await tx.client.query(
        `UPDATE payroll_runs SET status = 'PAID', journal_id = $1, updated_by = $2 WHERE id = $3`,
        [journal.id, actor.ref, run.id],
      );
      for (const line of lines) {
        const loanKobo = Number(line.loan_kobo);
        if (loanKobo <= 0) continue;
        const loan = await tx.client.query<{ id: string }>(
          `SELECT id FROM payroll_loans
            WHERE employee_id = $1 AND status = 'ACTIVE' AND remaining_kobo > 0
            ORDER BY starts_on LIMIT 1`,
          [line.employee_id],
        );
        const loanId = loan.rows[0]?.id;
        if (!loanId) continue;
        await tx.client.query(
          `UPDATE payroll_loans SET remaining_kobo = remaining_kobo - $1, status = CASE
             WHEN remaining_kobo - $1 <= 0 THEN 'SETTLED' ELSE status END, updated_by = $2
           WHERE id = $3`,
          [loanKobo, actor.ref, loanId],
        );
        await tx.client.query(
          `INSERT INTO payroll_loan_schedule (loan_id, entity_id, due_on, amount_kobo, applied_run_id, created_by)
           VALUES ($1, $2, (timezone('Africa/Lagos', now()))::date, $3, $4, $5)`,
          [loanId, run.entity_id, loanKobo, run.id, actor.ref],
        );
      }
      await tx.audit({
        action: 'payment',
        subjectType: 'payroll_run',
        subjectId: run.id,
        subjectLabel: run.reference_number,
        subjectReferenceNumber: run.reference_number,
        entityId: run.entity_id,
        newValue: { status: 'PAID', journalId: journal.id },
      });
      return this.loadRunView(tx, actor, id);
    });
  }

  async remit(actor: ActorContext, id: string, input: RemitInput): Promise<PayrollRemittanceView[]> {
    assertCan(actor, 'payroll.pay');
    return this.unitOfWork.write(actor, async (tx) => {
      const run = await this.lockRun(tx, id);
      assertCan(actor, 'payroll.pay', run.entity_id);
      const evidence = await tx.client.query<{ id: string }>(
        `SELECT id FROM documents WHERE id = $1`,
        [input.evidenceDocumentId],
      );
      if (!evidence.rows[0]) throw new ValidationFailedError('Remittance evidence is required.');
      await tx.client.query(
        `UPDATE payroll_remittances
            SET status = 'REMITTED', evidence_document_id = $1, remitted_at = now(), updated_by = $2
          WHERE run_id = $3 AND kind = $4 AND status = 'UNREMITTED'`,
        [input.evidenceDocumentId, actor.ref, run.id, input.kind],
      );
      return this.listRemittances(tx, run.id);
    });
  }

  async adjust(actor: ActorContext, id: string, input: AdjustRunInput): Promise<PayrollRunView> {
    assertCan(actor, 'payroll.run.prepare');
    return this.unitOfWork.write(actor, async (tx) => {
      const original = await this.lockRun(tx, id);
      assertCan(actor, 'payroll.run.prepare', original.entity_id);
      if (original.row_version !== input.rowVersion) throw new StaleRecordError('This payroll run has changed.');
      if (original.status !== 'LOCKED' && original.status !== 'PAID') {
        throw new ConflictError('Only a locked or paid run can be adjusted.');
      }
      if (original.journal_id) {
        await this.journals.postSystemInTx(tx, actor, {
          entityId: original.entity_id,
          fiscalPeriodId: original.fiscal_period_id,
          narration: `Reversal of ${original.reference_number}. ${input.reason}`,
          idempotencyKey: `${input.idempotencyKey}-rev`,
          source: 'REVERSAL',
          reversesJournalId: original.journal_id,
          lines: await this.reversalLines(tx, original.journal_id),
        });
      }
      await tx.client.query(
        `UPDATE payroll_runs SET status = 'REVERSED', updated_by = $1 WHERE id = $2`,
        [actor.ref, original.id],
      );
      const allocated = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('PRL') AS ref`);
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The adjustment reference was not allocated.');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO payroll_runs (
           reference_number, entity_id, fiscal_period_id, adjusting_run_id, idempotency_key, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING id`,
        [reference, original.entity_id, original.fiscal_period_id, original.id, input.idempotencyKey, actor.ref],
      );
      const newId = inserted.rows[0]?.id;
      if (!newId) throw new Error('The adjustment run was not created.');
      await tx.client.query(
        `INSERT INTO payroll_adjustments (original_run_id, new_run_id, entity_id, reason, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [original.id, newId, original.entity_id, input.reason, actor.ref],
      );
      await this.indexRun(tx, newId, reference, original.entity_id, original.period_name ?? 'Payroll');
      return this.loadRunView(tx, actor, newId);
    });
  }

  async downloadPayslip(
    actor: ActorContext,
    runId: string,
    employeeId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    assertCan(actor, 'payroll.view');
    return this.unitOfWork.write(actor, async (tx) => {
      const slip = await tx.client.query<{
        document_id: string;
        entity_id: string;
        storage_key: string;
        iv: Buffer;
        auth_tag: Buffer;
        wrapped_key: string;
        original_filename: string;
        run_ref: string;
      }>(
        `SELECT p.document_id, p.entity_id, v.storage_key, v.iv, v.auth_tag, v.wrapped_key, v.original_filename,
                r.reference_number AS run_ref
           FROM payroll_payslips p
           JOIN payroll_runs r ON r.id = p.run_id
           JOIN documents d ON d.id = p.document_id
           JOIN document_versions v ON v.id = d.current_version_id
          WHERE p.run_id = $1 AND p.employee_id = $2`,
        [runId, employeeId],
      );
      const row = slip.rows[0];
      if (!row) throw new NotFoundError('That payslip does not exist.');
      assertCan(actor, 'payroll.view', row.entity_id);
      const ciphertext = await this.storage.get(row.storage_key);
      const buffer = decryptBlob(
        ciphertext,
        row.iv,
        row.auth_tag,
        row.wrapped_key,
        loadApiEnv().DOCUMENT_ENCRYPTION_KEY,
      );
      await tx.audit({
        action: 'download',
        subjectType: 'payroll_payslip',
        subjectId: row.document_id,
        subjectLabel: row.run_ref,
        entityId: row.entity_id,
      });
      return { buffer, filename: row.original_filename };
    });
  }

  async hrOperationalReport(actor: ActorContext, entityId?: string): Promise<PayrollHrReportView> {
    assertCan(actor, 'hr.employee.view');
    return this.unitOfWork.read(actor, async (tx) => this.buildHrSnapshot(tx, entityId));
  }

  async varianceReport(actor: ActorContext, runId?: string): Promise<{
    runReference: string | null;
    priorReference: string | null;
    netKobo: number;
    priorNetKobo: number | null;
    varianceKobo: number | null;
  }> {
    assertCan(actor, 'payroll.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const current = runId
        ? await tx.client.query<RunRow>(`${this.runSelectSql()} WHERE r.id = $1`, [runId])
        : await tx.client.query<RunRow>(
            `${this.runSelectSql()} WHERE r.status IN ('LOCKED', 'PAID') ORDER BY r.created_at DESC LIMIT 1`,
          );
      const run = current.rows[0];
      if (!run) {
        return { runReference: null, priorReference: null, netKobo: 0, priorNetKobo: null, varianceKobo: null };
      }
      const prior = await tx.client.query<{ reference_number: string; net_kobo: string }>(
        `SELECT reference_number, net_kobo::text FROM payroll_runs
          WHERE entity_id = $1 AND fiscal_period_id <> $2 AND status IN ('LOCKED', 'PAID')
          ORDER BY created_at DESC LIMIT 1`,
        [run.entity_id, run.fiscal_period_id],
      );
      const priorNet = prior.rows[0] ? Number(prior.rows[0].net_kobo) : null;
      const net = Number(run.net_kobo);
      return {
        runReference: run.reference_number,
        priorReference: prior.rows[0]?.reference_number ?? null,
        netKobo: net,
        priorNetKobo: priorNet,
        varianceKobo: priorNet == null ? null : net - priorNet,
      };
    });
  }

  async remittanceReport(actor: ActorContext, entityId?: string): Promise<PayrollRemittanceView[]> {
    assertCan(actor, 'payroll.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        run_id: string;
        kind: PayrollRemittanceView['kind'];
        amount_kobo: string;
        status: PayrollRemittanceView['status'];
        evidence_document_id: string | null;
      }>(
        `SELECT id, run_id, kind, amount_kobo::text, status, evidence_document_id
           FROM payroll_remittances
          WHERE ($1::uuid IS NULL OR entity_id = $1)
          ORDER BY created_at DESC`,
        [entityId ?? null],
      );
      return result.rows.map((row) => ({
        id: row.id,
        runId: row.run_id,
        kind: row.kind,
        amountKobo: Number(row.amount_kobo),
        status: row.status,
        evidenceDocumentId: row.evidence_document_id,
      }));
    });
  }

  async orgSnapshot(actor: ActorContext, templateKey: string, entityId?: string): Promise<PayrollOrgSnapshot> {
    return this.unitOfWork.read(actor, async (tx) => this.buildOrgSnapshot(tx, templateKey, entityId));
  }

  async stampOrgSnapshotInTx(
    tx: TxScope,
    templateKey: string,
    entityId: string,
  ): Promise<PayrollOrgSnapshot | null> {
    if (templateKey !== 'hr_staff' && templateKey !== 'payroll') return null;
    return this.buildOrgSnapshot(tx, templateKey, entityId);
  }

  async remindOpenDraftsInTx(tx: TxScope, now: Date): Promise<number> {
    const due = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      created_by: string;
    }>(
      `SELECT r.id, r.reference_number, r.entity_id, r.created_by
         FROM payroll_runs r
         JOIN fiscal_periods p ON p.id = r.fiscal_period_id
        WHERE r.status = 'DRAFT'
          AND p.status = 'OPEN'
          AND p.ends_on <= ($1::date + interval '5 days')`,
      [now.toISOString().slice(0, 10)],
    );
    for (const row of due.rows) {
      await tx.publish({
        eventType: 'payroll.period_close_reminder',
        subjectType: 'PAYROLL_RUN',
        subjectId: row.id,
        entityId: row.entity_id,
        payload: {
          type: 'payroll.period_close_reminder',
          reference: row.reference_number,
          title: row.reference_number,
          recipientUserId: row.created_by,
          href: `/hr/payroll/${row.id}`,
        },
      });
    }
    return due.rows.length;
  }

  private async calculateInTx(
    tx: TxScope,
    actor: ActorContext,
    run: RunRow,
    period: PeriodRow,
  ): Promise<void> {
    const settings = await this.loadSettings(tx);
    const statuses = settings.includeSuspended
      ? ['ACTIVE', 'PROBATION', 'CONFIRMED', 'SUSPENDED']
      : ['ACTIVE', 'PROBATION', 'CONFIRMED'];
    const employees = await tx.client.query<{
      id: string;
      reference_number: string;
      first_name: string;
      last_name: string;
      status: string;
      bank_name: string | null;
      bank_account_name: string | null;
      bank_account_number: string | null;
    }>(
      `SELECT id, reference_number, first_name, last_name, status, bank_name, bank_account_name, bank_account_number
         FROM hr_employees
        WHERE entity_id = $1
          AND status = ANY($2::text[])
          AND NOT EXISTS (
            SELECT 1 FROM hr_employment_changes c
             WHERE c.employee_id = hr_employees.id
               AND c.status = 'APPROVED'
               AND c.kind IN ('TERMINATION', 'RESIGNATION')
               AND c.effective_on <= $3::date
          )`,
      [run.entity_id, statuses, period.ends_on],
    );
    const bands = await this.payeBandsAsOf(tx, period.ends_on);
    const pension = await this.pensionAsOf(tx, period.ends_on);
    const other = await this.otherAsOf(tx, period.ends_on);
    await tx.client.query(`SELECT app.replace_payroll_run_lines($1)`, [run.id]);
    const runExceptions: PayrollExceptionView[] = [];
    let employeeCount = 0;
    let grossTotal = 0;
    let netTotal = 0;
    let payeTotal = 0;
    let pensionEeTotal = 0;
    let pensionErTotal = 0;
    for (const employee of employees.rows) {
      const name = `${employee.first_name} ${employee.last_name}`.trim();
      const exceptions: PayrollExceptionView[] = [];
      const structure = await this.structureAsOf(tx, employee.id, run.entity_id, period.ends_on);
      if (!structure) {
        exceptions.push({ code: 'MISSING_STRUCTURE', message: 'No confirmed salary structure as of period end.', employeeId: employee.id });
      }
      const absent = await tx.client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM hr_attendance_records
          WHERE employee_id = $1 AND work_date BETWEEN $2::date AND $3::date AND kind = 'ABSENT'`,
        [employee.id, period.starts_on, period.ends_on],
      );
      if (Number(absent.rows[0]?.n ?? 0) > 0) {
        exceptions.push({
          code: 'ATTENDANCE_ABSENT',
          message: 'Attendance anomalies in the period do not change pay.',
          employeeId: employee.id,
        });
      }
      const basic = structure?.basicKobo ?? 0;
      const allowances = (structure?.allowances ?? []).reduce((sum, item) => sum + item.amountKobo, 0);
      const monthly = basic + allowances;
      const otHours = await tx.client.query<{ hours: string }>(
        `SELECT coalesce(sum(hours), 0)::text AS hours FROM hr_overtime_requests
          WHERE employee_id = $1 AND status = 'APPROVED' AND work_date BETWEEN $2::date AND $3::date`,
        [employee.id, period.starts_on, period.ends_on],
      );
      const hours = Number(otHours.rows[0]?.hours ?? 0);
      const hourly = monthly / (settings.unpaidLeaveDailyDivisor * 8);
      const overtime = Math.round(hours * hourly * (settings.overtimeMultiplierBps / 10_000));
      const unpaidDays = await tx.client.query<{ days: string }>(
        `SELECT coalesce(sum(
            (least(l.ends_on, $3::date) - greatest(l.starts_on, $2::date) + 1)
          ), 0)::text AS days
           FROM hr_leave_requests l
           JOIN hr_leave_types t ON t.id = l.type_id
          WHERE l.employee_id = $1 AND l.status = 'APPROVED' AND t.paid = false
            AND l.starts_on <= $3::date AND l.ends_on >= $2::date`,
        [employee.id, period.starts_on, period.ends_on],
      );
      const unpaidLeave = Math.round(
        Number(unpaidDays.rows[0]?.days ?? 0) * (monthly / settings.unpaidLeaveDailyDivisor),
      );
      const loan = await tx.client.query<{ id: string; remaining_kobo: string; installment_kobo: string }>(
        `SELECT id, remaining_kobo::text, installment_kobo::text FROM payroll_loans
          WHERE employee_id = $1 AND status = 'ACTIVE' AND remaining_kobo > 0 AND starts_on <= $2::date
          ORDER BY starts_on LIMIT 1`,
        [employee.id, period.ends_on],
      );
      const loanRow = loan.rows[0];
      const loanKobo = loanRow
        ? Math.min(Number(loanRow.installment_kobo), Number(loanRow.remaining_kobo))
        : 0;
      const pensionable = monthly;
      const pensionEe = Math.round((pensionable * pension.employeeBps) / 10_000);
      const pensionEr = Math.round((pensionable * pension.employerBps) / 10_000);
      const gross = Math.max(0, monthly + overtime - unpaidLeave);
      const otherKobo = other.reduce((sum, item) => {
        if (item.amountKobo != null) return sum + item.amountKobo;
        return sum + Math.round((gross * (item.rateBps ?? 0)) / 10_000);
      }, 0);
      const payeKobo = this.monthlyPaye(gross, bands);
      const net = Math.max(0, gross - payeKobo - pensionEe - otherKobo - loanKobo);
      await tx.client.query(
        `INSERT INTO payroll_run_lines (
           run_id, entity_id, employee_id, employee_name, employee_number, bank_name, bank_account_name,
           bank_account_number, structure_id, basic_kobo, allowances_kobo, overtime_kobo, unpaid_leave_kobo,
           loan_kobo, paye_kobo, pension_employee_kobo, pension_employer_kobo, other_statutory_kobo,
           gross_kobo, net_kobo, exceptions, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$22)`,
        [
          run.id,
          run.entity_id,
          employee.id,
          name,
          employee.reference_number,
          employee.bank_name,
          employee.bank_account_name,
          employee.bank_account_number,
          structure?.id ?? null,
          basic,
          allowances,
          overtime,
          unpaidLeave,
          loanKobo,
          payeKobo,
          pensionEe,
          pensionEr,
          otherKobo,
          gross,
          net,
          JSON.stringify(exceptions),
          actor.ref,
        ],
      );
      employeeCount += 1;
      grossTotal += gross;
      netTotal += net;
      payeTotal += payeKobo;
      pensionEeTotal += pensionEe;
      pensionErTotal += pensionEr;
      runExceptions.push(...exceptions);
    }
    await tx.client.query(
      `UPDATE payroll_runs
          SET status = 'CALCULATED', employee_count = $1, gross_kobo = $2, net_kobo = $3, paye_kobo = $4,
              pension_employee_kobo = $5, pension_employer_kobo = $6, exceptions = $7::jsonb, updated_by = $8
        WHERE id = $9`,
      [
        employeeCount,
        grossTotal,
        netTotal,
        payeTotal,
        pensionEeTotal,
        pensionErTotal,
        JSON.stringify(runExceptions),
        actor.ref,
        run.id,
      ],
    );
  }

  private monthlyPaye(monthlyGross: number, bands: PayrollPayeBandView[]): number {
    const annual = monthlyGross * 12;
    let tax = 0;
    for (const band of [...bands].sort((a, b) => a.fromKobo - b.fromKobo)) {
      const top = band.toKobo ?? Number.MAX_SAFE_INTEGER;
      const slice = Math.min(annual, top) - band.fromKobo;
      if (slice > 0) tax += (slice * band.rateBps) / 10_000;
    }
    return Math.round(tax / 12);
  }

  private async payeBandsAsOf(tx: TxScope, asOf: string): Promise<PayrollPayeBandView[]> {
    const latest = await tx.client.query<{ effective_on: string }>(
      `SELECT effective_on::text FROM payroll_paye_bands WHERE effective_on <= $1::date
       ORDER BY effective_on DESC LIMIT 1`,
      [asOf],
    );
    const effectiveOn = latest.rows[0]?.effective_on;
    if (!effectiveOn) return [];
    const result = await tx.client.query<{
      id: string;
      from_kobo: string;
      to_kobo: string | null;
      rate_bps: number;
    }>(
      `SELECT id, from_kobo::text, to_kobo::text, rate_bps FROM payroll_paye_bands
        WHERE effective_on = $1::date ORDER BY from_kobo`,
      [effectiveOn],
    );
    return result.rows.map((row) => ({
      id: row.id,
      effectiveOn,
      fromKobo: Number(row.from_kobo),
      toKobo: row.to_kobo == null ? null : Number(row.to_kobo),
      rateBps: row.rate_bps,
    }));
  }

  private async pensionAsOf(tx: TxScope, asOf: string): Promise<{ employeeBps: number; employerBps: number }> {
    const result = await tx.client.query<{ employee_bps: number; employer_bps: number }>(
      `SELECT employee_bps, employer_bps FROM payroll_pension_rates
        WHERE effective_on <= $1::date ORDER BY effective_on DESC LIMIT 1`,
      [asOf],
    );
    return {
      employeeBps: result.rows[0]?.employee_bps ?? 0,
      employerBps: result.rows[0]?.employer_bps ?? 0,
    };
  }

  private async otherAsOf(tx: TxScope, asOf: string): Promise<PayrollStatutoryView[]> {
    const result = await tx.client.query<{
      id: string;
      key: string;
      name: string;
      effective_on: string;
      rate_bps: number | null;
      amount_kobo: string | null;
    }>(
      `SELECT DISTINCT ON (key) id, key, name, effective_on::text, rate_bps, amount_kobo::text
         FROM payroll_other_statutory
        WHERE effective_on <= $1::date
        ORDER BY key, effective_on DESC`,
      [asOf],
    );
    return result.rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      effectiveOn: row.effective_on,
      rateBps: row.rate_bps,
      amountKobo: row.amount_kobo == null ? null : Number(row.amount_kobo),
    }));
  }

  private async structureAsOf(
    tx: TxScope,
    employeeId: string,
    entityId: string,
    asOf: string,
  ): Promise<{ id: string; basicKobo: number; allowances: PayrollComponent[] } | null> {
    const result = await tx.client.query<{
      id: string;
      basic_kobo: string;
      allowances: PayrollComponent[];
    }>(
      `SELECT id, basic_kobo::text, allowances FROM payroll_salary_structures
        WHERE status = 'CONFIRMED' AND entity_id = $2 AND effective_on <= $3::date
          AND (employee_id = $1 OR (employee_id IS NULL AND grade_key IS NOT NULL))
        ORDER BY CASE WHEN employee_id = $1 THEN 0 ELSE 1 END, effective_on DESC
        LIMIT 1`,
      [employeeId, entityId, asOf],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, basicKobo: Number(row.basic_kobo), allowances: row.allowances ?? [] };
  }

  private async issuePayslipsInTx(tx: TxScope, actor: ActorContext, runId: string): Promise<void> {
    const run = await this.lockRun(tx, runId);
    const period = await this.loadPeriod(tx, run.fiscal_period_id, run.entity_id);
    const entity = await tx.client.query<{ name: string }>(`SELECT name FROM entities WHERE id = $1`, [
      run.entity_id,
    ]);
    const lines = await this.loadLineRows(tx, runId);
    for (const line of lines) {
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM payroll_payslips WHERE run_id = $1 AND employee_id = $2`,
        [runId, line.employee_id],
      );
      if (existing.rows[0]) continue;
      const buffer = await renderPayslipPdf({
        runReference: run.reference_number,
        periodName: period.name,
        employeeName: line.employee_name ?? 'Employee',
        employeeNumber: line.employee_number ?? '',
        entityName: entity.rows[0]?.name ?? '',
        basicKobo: Number(line.basic_kobo),
        allowancesKobo: Number(line.allowances_kobo),
        overtimeKobo: Number(line.overtime_kobo),
        unpaidLeaveKobo: Number(line.unpaid_leave_kobo),
        loanKobo: Number(line.loan_kobo),
        payeKobo: Number(line.paye_kobo),
        pensionEmployeeKobo: Number(line.pension_employee_kobo),
        otherStatutoryKobo: Number(line.other_statutory_kobo),
        grossKobo: Number(line.gross_kobo),
        netKobo: Number(line.net_kobo),
      });
      const stored = await this.documents.storeGeneratedPdfInTx(tx, actor, {
        title: `Payslip ${run.reference_number} ${line.employee_number ?? ''}`.trim(),
        entityId: run.entity_id,
        ownerType: 'payroll_payslip',
        ownerId: line.employee_id,
        buffer,
        filename: `${run.reference_number}-${line.employee_number ?? line.employee_id}.pdf`,
        category: 'payslip',
        confidentiality: 'CONFIDENTIAL',
      });
      const employeeFolder = await tx.client.query<{ edms_folder_id: string | null }>(
        `SELECT edms_folder_id FROM hr_employees WHERE id = $1`,
        [line.employee_id],
      );
      let folderId = employeeFolder.rows[0]?.edms_folder_id ?? null;
      if (!folderId) {
        folderId = await this.hr.ensureEmployeeFolder(
          tx,
          actor,
          run.entity_id,
          `${line.employee_name ?? 'Employee'} ${line.employee_number ?? ''}`.trim(),
        );
        if (folderId) {
          await tx.client.query(`UPDATE hr_employees SET edms_folder_id = $1, updated_by = $2 WHERE id = $3`, [
            folderId,
            actor.ref,
            line.employee_id,
          ]);
        }
      }
      if (folderId) {
        await tx.client.query(
          `INSERT INTO edms_folder_items (folder_id, document_id, entity_id, listed, created_by, updated_by)
           VALUES ($1, $2, $3, true, $4, $4)
           ON CONFLICT DO NOTHING`,
          [folderId, stored.documentId, run.entity_id, actor.ref],
        );
      }
      await tx.client.query(
        `INSERT INTO payroll_payslips (run_id, employee_id, entity_id, document_id, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [runId, line.employee_id, run.entity_id, stored.documentId, actor.ref],
      );
    }
  }

  private async loadRunView(tx: TxScope, actor: ActorContext, id: string): Promise<PayrollRunView> {
    const result = await tx.client.query<RunRow>(`${this.runSelectSql()} WHERE r.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That payroll run does not exist.');
    const showMoney = can(actor, 'payroll.view', row.entity_id);
    const lines = await this.loadLineRows(tx, id);
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      fiscalPeriodId: row.fiscal_period_id,
      periodName: row.period_name,
      periodEndsOn: row.period_ends_on,
      status: row.status as PayrollRunView['status'],
      workflowInstanceId: row.workflow_instance_id,
      employeeCount: row.employee_count,
      grossKobo: showMoney ? Number(row.gross_kobo) : 0,
      netKobo: showMoney ? Number(row.net_kobo) : 0,
      payeKobo: showMoney ? Number(row.paye_kobo) : 0,
      pensionEmployeeKobo: showMoney ? Number(row.pension_employee_kobo) : 0,
      pensionEmployerKobo: showMoney ? Number(row.pension_employer_kobo) : 0,
      exceptions: row.exceptions ?? [],
      lines: lines.map((line) => this.toLineView(line, showMoney)),
      rowVersion: row.row_version,
    };
  }

  private runSelectSql(): string {
    return `SELECT r.id, r.reference_number, r.entity_id, e.code AS entity_code, r.fiscal_period_id,
                   p.name AS period_name, p.ends_on::text AS period_ends_on, r.status, r.workflow_instance_id,
                   r.employee_count, r.gross_kobo::text, r.net_kobo::text, r.paye_kobo::text,
                   r.pension_employee_kobo::text, r.pension_employer_kobo::text, r.exceptions, r.journal_id,
                   r.row_version, r.created_by
              FROM payroll_runs r
              JOIN entities e ON e.id = r.entity_id
              JOIN fiscal_periods p ON p.id = r.fiscal_period_id`;
  }

  private async lockRun(tx: TxScope, id: string): Promise<RunRow> {
    await tx.client.query(`SELECT id FROM payroll_runs WHERE id = $1 FOR UPDATE`, [id]);
    const result = await tx.client.query<RunRow>(`${this.runSelectSql()} WHERE r.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That payroll run does not exist.');
    return row;
  }

  private async loadLineRows(tx: TxScope, runId: string): Promise<LineRow[]> {
    const result = await tx.client.query<LineRow>(
      `SELECT id, employee_id, employee_name, employee_number, bank_name, bank_account_name, bank_account_number,
              basic_kobo::text, allowances_kobo::text, overtime_kobo::text, unpaid_leave_kobo::text, loan_kobo::text,
              paye_kobo::text, pension_employee_kobo::text, pension_employer_kobo::text, other_statutory_kobo::text,
              gross_kobo::text, net_kobo::text, exceptions
         FROM payroll_run_lines WHERE run_id = $1 ORDER BY employee_name`,
      [runId],
    );
    return result.rows;
  }

  private toLineView(row: LineRow, showMoney: boolean): PayrollRunLineView {
    const money = (value: string) => (showMoney ? Number(value) : null);
    return {
      id: row.id,
      employeeId: row.employee_id,
      employeeName: showMoney ? row.employee_name : row.employee_name,
      employeeNumber: row.employee_number,
      basicKobo: money(row.basic_kobo),
      allowancesKobo: money(row.allowances_kobo),
      overtimeKobo: money(row.overtime_kobo),
      unpaidLeaveKobo: money(row.unpaid_leave_kobo),
      loanKobo: money(row.loan_kobo),
      payeKobo: money(row.paye_kobo),
      pensionEmployeeKobo: money(row.pension_employee_kobo),
      pensionEmployerKobo: money(row.pension_employer_kobo),
      otherStatutoryKobo: money(row.other_statutory_kobo),
      grossKobo: money(row.gross_kobo),
      netKobo: money(row.net_kobo),
      exceptions: row.exceptions ?? [],
    };
  }

  private async loadPeriod(tx: TxScope, id: string, entityId: string): Promise<PeriodRow> {
    const result = await tx.client.query<PeriodRow>(
      `SELECT id, name, starts_on::text, ends_on::text, status, entity_id
         FROM fiscal_periods WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row || row.entity_id !== entityId) throw new ValidationFailedError('That fiscal period is not on this subsidiary.');
    if (row.status !== 'OPEN') throw new ConflictError('Payroll can only be prepared in an open fiscal period.');
    return row;
  }

  private async listPayeInTx(tx: TxScope): Promise<PayrollPayeBandView[]> {
    const result = await tx.client.query<{
      id: string;
      effective_on: string;
      from_kobo: string;
      to_kobo: string | null;
      rate_bps: number;
    }>(
      `SELECT id, effective_on::text, from_kobo::text, to_kobo::text, rate_bps
         FROM payroll_paye_bands ORDER BY effective_on DESC, from_kobo`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      effectiveOn: row.effective_on,
      fromKobo: Number(row.from_kobo),
      toKobo: row.to_kobo == null ? null : Number(row.to_kobo),
      rateBps: row.rate_bps,
    }));
  }

  private async listPensionInTx(tx: TxScope): Promise<PayrollPensionRateView[]> {
    const result = await tx.client.query<{
      id: string;
      effective_on: string;
      employee_bps: number;
      employer_bps: number;
    }>(
      `SELECT id, effective_on::text, employee_bps, employer_bps
         FROM payroll_pension_rates ORDER BY effective_on DESC`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      effectiveOn: row.effective_on,
      employeeBps: row.employee_bps,
      employerBps: row.employer_bps,
    }));
  }

  private async listStatutoryInTx(tx: TxScope): Promise<PayrollStatutoryView[]> {
    const result = await tx.client.query<{
      id: string;
      key: string;
      name: string;
      effective_on: string;
      rate_bps: number | null;
      amount_kobo: string | null;
    }>(
      `SELECT id, key, name, effective_on::text, rate_bps, amount_kobo::text
         FROM payroll_other_statutory ORDER BY effective_on DESC, key`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      effectiveOn: row.effective_on,
      rateBps: row.rate_bps,
      amountKobo: row.amount_kobo == null ? null : Number(row.amount_kobo),
    }));
  }

  private async listStructuresInTx(tx: TxScope, employeeId?: string): Promise<PayrollStructureView[]> {
    const result = await tx.client.query<{
      id: string;
      employee_id: string | null;
      employee_name: string | null;
      grade_key: string | null;
      entity_id: string;
      entity_code: string | null;
      basic_kobo: string;
      allowances: PayrollComponent[];
      overtime_rule: string | null;
      effective_on: string;
      supersedes_id: string | null;
      status: PayrollStructureView['status'];
      row_version: number;
    }>(
      `SELECT s.id, s.employee_id, trim(both from coalesce(e.first_name,'') || ' ' || coalesce(e.last_name,'')) AS employee_name,
              s.grade_key, s.entity_id, ent.code AS entity_code, s.basic_kobo::text, s.allowances, s.overtime_rule,
              s.effective_on::text, s.supersedes_id, s.status, s.row_version
         FROM payroll_salary_structures s
         JOIN entities ent ON ent.id = s.entity_id
         LEFT JOIN hr_employees e ON e.id = s.employee_id
        WHERE ($1::uuid IS NULL OR s.employee_id = $1)
        ORDER BY s.effective_on DESC, s.created_at DESC`,
      [employeeId ?? null],
    );
    return result.rows.map((row) => ({
      id: row.id,
      employeeId: row.employee_id,
      employeeName: row.employee_name?.trim() || null,
      gradeKey: row.grade_key,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      basicKobo: Number(row.basic_kobo),
      allowances: row.allowances ?? [],
      overtimeRule: row.overtime_rule,
      effectiveOn: row.effective_on,
      supersedesId: row.supersedes_id,
      status: row.status,
      rowVersion: row.row_version,
    }));
  }

  private async listLoansInTx(tx: TxScope, employeeId?: string): Promise<PayrollLoanView[]> {
    const result = await tx.client.query<{
      id: string;
      employee_id: string;
      employee_name: string | null;
      entity_id: string;
      principal_kobo: string;
      remaining_kobo: string;
      installment_kobo: string;
      starts_on: string;
      status: string;
    }>(
      `SELECT l.id, l.employee_id,
              trim(both from coalesce(e.first_name,'') || ' ' || coalesce(e.last_name,'')) AS employee_name,
              l.entity_id, l.principal_kobo::text, l.remaining_kobo::text, l.installment_kobo::text,
              l.starts_on::text, l.status
         FROM payroll_loans l
         LEFT JOIN hr_employees e ON e.id = l.employee_id
        WHERE ($1::uuid IS NULL OR l.employee_id = $1)
        ORDER BY l.starts_on DESC`,
      [employeeId ?? null],
    );
    return result.rows.map((row) => ({
      id: row.id,
      employeeId: row.employee_id,
      employeeName: row.employee_name?.trim() || null,
      entityId: row.entity_id,
      principalKobo: Number(row.principal_kobo),
      remainingKobo: Number(row.remaining_kobo),
      installmentKobo: Number(row.installment_kobo),
      startsOn: row.starts_on,
      status: row.status,
    }));
  }

  private async loadSettings(tx: TxScope): Promise<PayrollSettingsView> {
    const result = await tx.client.query<{
      id: string;
      ed_finance_threshold_kobo: string;
      overtime_multiplier_bps: number;
      include_suspended: boolean;
      unpaid_leave_daily_divisor: number;
      row_version: number;
    }>(
      `SELECT id, ed_finance_threshold_kobo::text, overtime_multiplier_bps, include_suspended,
              unpaid_leave_daily_divisor, row_version
         FROM payroll_settings ORDER BY created_at LIMIT 1`,
    );
    const row = result.rows[0];
    if (!row) throw new ConflictError('Payroll settings are not seeded.');
    return {
      id: row.id,
      edFinanceThresholdKobo: Number(row.ed_finance_threshold_kobo),
      overtimeMultiplierBps: row.overtime_multiplier_bps,
      includeSuspended: row.include_suspended,
      unpaidLeaveDailyDivisor: row.unpaid_leave_daily_divisor,
      rowVersion: row.row_version,
    };
  }

  private async listRemittances(tx: TxScope, runId: string): Promise<PayrollRemittanceView[]> {
    const result = await tx.client.query<{
      id: string;
      run_id: string;
      kind: PayrollRemittanceView['kind'];
      amount_kobo: string;
      status: PayrollRemittanceView['status'];
      evidence_document_id: string | null;
    }>(
      `SELECT id, run_id, kind, amount_kobo::text, status, evidence_document_id
         FROM payroll_remittances WHERE run_id = $1 ORDER BY kind`,
      [runId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      kind: row.kind,
      amountKobo: Number(row.amount_kobo),
      status: row.status,
      evidenceDocumentId: row.evidence_document_id,
    }));
  }

  private async reversalLines(
    tx: TxScope,
    journalId: string,
  ): Promise<Array<{ accountId: string; debitKobo: number; creditKobo: number; narration?: string }>> {
    const result = await tx.client.query<{
      account_id: string;
      debit_kobo: string;
      credit_kobo: string;
      narration: string | null;
    }>(
      `SELECT account_id, debit_kobo::text, credit_kobo::text, narration
         FROM journal_lines WHERE journal_id = $1 ORDER BY line_number`,
      [journalId],
    );
    return result.rows.map((row) => ({
      accountId: row.account_id,
      debitKobo: Number(row.credit_kobo),
      creditKobo: Number(row.debit_kobo),
      narration: row.narration ?? undefined,
    }));
  }

  private async indexRun(
    tx: TxScope,
    id: string,
    reference: string,
    entityId: string,
    periodName: string,
  ): Promise<void> {
    await tx.indexSearch({
      recordType: 'PAYROLL_RUN',
      recordId: id,
      referenceNumber: reference,
      title: `Payroll ${reference}`,
      searchableText: `${reference} ${periodName}`,
      entityId,
      permissionKey: 'payroll.view',
    });
  }

  private async buildHrSnapshot(tx: TxScope, entityId?: string): Promise<PayrollHrReportView> {
    const head = await tx.client.query<{ entity_code: string; count: string }>(
      `SELECT e.code AS entity_code, count(*)::text AS count
         FROM hr_employees emp JOIN entities e ON e.id = emp.entity_id
        WHERE emp.status NOT IN ('TERMINATED', 'RESIGNED', 'INACTIVE')
          AND ($1::uuid IS NULL OR emp.entity_id = $1)
        GROUP BY e.code ORDER BY e.code`,
      [entityId ?? null],
    );
    const vacancies = await tx.client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM hr_vacancies
        WHERE status IN ('OPEN', 'SHORTLISTING', 'INTERVIEWING', 'OFFER')
          AND ($1::uuid IS NULL OR entity_id = $1)`,
      [entityId ?? null],
    );
    const leave = await tx.client.query<{ days: string }>(
      `SELECT coalesce(sum(days), 0)::text AS days FROM hr_leave_requests
        WHERE status = 'APPROVED' AND ($1::uuid IS NULL OR entity_id = $1)`,
      [entityId ?? null],
    );
    return {
      periodLabel: new Date().toISOString().slice(0, 7),
      headcountByEntity: head.rows.map((row) => ({ entityCode: row.entity_code, count: Number(row.count) })),
      openVacancies: Number(vacancies.rows[0]?.n ?? 0),
      leaveDaysInPeriod: Number(leave.rows[0]?.days ?? 0),
      snapshotAt: new Date().toISOString(),
    };
  }

  private async buildOrgSnapshot(
    tx: TxScope,
    templateKey: string,
    entityId?: string,
  ): Promise<PayrollOrgSnapshot> {
    const hr = await this.buildHrSnapshot(tx, entityId);
    if (templateKey === 'hr_staff') {
      return {
        kind: 'hr_staff',
        stampedAt: hr.snapshotAt,
        periodLabel: hr.periodLabel,
        headcountByEntity: hr.headcountByEntity,
        openVacancies: hr.openVacancies,
        leaveDaysInPeriod: hr.leaveDaysInPeriod,
      };
    }
    const run = await tx.client.query<{
      reference_number: string;
      gross_kobo: string;
      net_kobo: string;
      paye_kobo: string;
      pension_employee_kobo: string;
      pension_employer_kobo: string;
      entity_id: string;
      fiscal_period_id: string;
    }>(
      `SELECT reference_number, gross_kobo::text, net_kobo::text, paye_kobo::text,
              pension_employee_kobo::text, pension_employer_kobo::text, entity_id, fiscal_period_id
         FROM payroll_runs
        WHERE status IN ('LOCKED', 'PAID')
          AND ($1::uuid IS NULL OR entity_id = $1)
        ORDER BY created_at DESC LIMIT 1`,
      [entityId ?? null],
    );
    const current = run.rows[0];
    let variance: number | null = null;
    if (current) {
      const prior = await tx.client.query<{ net_kobo: string }>(
        `SELECT net_kobo::text FROM payroll_runs
          WHERE entity_id = $1 AND fiscal_period_id <> $2 AND status IN ('LOCKED', 'PAID')
          ORDER BY created_at DESC LIMIT 1`,
        [current.entity_id, current.fiscal_period_id],
      );
      if (prior.rows[0]) variance = Number(current.net_kobo) - Number(prior.rows[0].net_kobo);
    }
    return {
      kind: 'payroll',
      stampedAt: new Date().toISOString(),
      periodLabel: hr.periodLabel,
      grossKobo: current ? Number(current.gross_kobo) : 0,
      netKobo: current ? Number(current.net_kobo) : 0,
      payeKobo: current ? Number(current.paye_kobo) : 0,
      pensionKobo: current ? Number(current.pension_employee_kobo) + Number(current.pension_employer_kobo) : 0,
      varianceVsPriorNetKobo: variance,
      runReference: current?.reference_number ?? null,
    };
  }
}

interface LineRow {
  id: string;
  employee_id: string;
  employee_name: string | null;
  employee_number: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  basic_kobo: string;
  allowances_kobo: string;
  overtime_kobo: string;
  unpaid_leave_kobo: string;
  loan_kobo: string;
  paye_kobo: string;
  pension_employee_kobo: string;
  pension_employer_kobo: string;
  other_statutory_kobo: string;
  gross_kobo: string;
  net_kobo: string;
  exceptions: PayrollExceptionView[];
}
