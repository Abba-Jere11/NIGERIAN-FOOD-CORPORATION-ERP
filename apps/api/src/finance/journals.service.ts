import { forwardRef, Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { JournalLineView, JournalView, LedgerEntryView, TrialBalanceView } from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import {
  applyEliminations,
  fetchCodeBalances,
  postedPairTotal,
} from './consolidation.service';
import { resolveReportWindow } from './report-window';
import { sourceHref } from './source-href';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StaleRecordError,
  ValidationFailedError,
} from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import { WorkflowsService } from '../workflows/workflows.service';
import type { CreateJournalInput, ReverseJournalInput, UpdateJournalInput } from './finance.dto';

@Injectable()
export class JournalsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    @Inject(forwardRef(() => WorkflowsService))
    private readonly workflows: WorkflowsService,
  ) {}

  async list(actor: ActorContext, entityId?: string): Promise<JournalView[]> {
    if (!can(actor, 'finance.view')) throw new ForbiddenError('You cannot view journals.');
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT id FROM journals WHERE ($1::uuid IS NULL OR entity_id = $1) ORDER BY created_at DESC`,
        [entityId ?? null],
      );
      const views: JournalView[] = [];
      for (const row of ids.rows) views.push(await this.getInTx(tx, row.id));
      return views;
    });
  }

  async get(actor: ActorContext, id: string): Promise<JournalView> {
    if (!can(actor, 'finance.view')) throw new ForbiddenError('You cannot view journals.');
    return this.unitOfWork.read(actor, async (tx) => this.getInTx(tx, id));
  }

  async getInTx(tx: TxScope, id: string): Promise<JournalView> {
    const header = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      entity_code: string | null;
      fiscal_period_id: string;
      period_name: string;
      status: JournalView['status'];
      source: JournalView['source'];
      narration: string;
      reverses_journal_id: string | null;
      workflow_instance_id: string | null;
      prepared_by_name: string | null;
      posted_at: Date | null;
      row_version: number;
    }>(
      `SELECT j.id, j.reference_number, j.entity_id, e.code AS entity_code, j.fiscal_period_id,
              p.name AS period_name, j.status, j.source, j.narration, j.reverses_journal_id,
              j.workflow_instance_id,
              app.user_public_name(
                CASE WHEN j.created_by ~ '^[0-9a-f-]{36}$' THEN j.created_by::uuid ELSE NULL END
              ) AS prepared_by_name,
              j.posted_at, j.row_version
         FROM journals j
         JOIN entities e ON e.id = j.entity_id
         JOIN fiscal_periods p ON p.id = j.fiscal_period_id
        WHERE j.id = $1`,
      [id],
    );
    const row = header.rows[0];
    if (!row) throw new NotFoundError('That journal does not exist.');
    const lines = await tx.client.query<{
      id: string;
      account_id: string;
      account_code: string;
      account_name: string;
      debit_kobo: string;
      credit_kobo: string;
      narration: string | null;
      department_id: string | null;
      project_id: string | null;
      procurement_request_id: string | null;
      vendor_id: string | null;
      customer_id: string | null;
      intercompany_transaction_id: string | null;
      payable_invoice_id: string | null;
      receivable_invoice_id: string | null;
    }>(
      `SELECT l.id, l.account_id, a.code AS account_code, a.name AS account_name,
              l.debit_kobo::text, l.credit_kobo::text, l.narration, l.department_id,
              l.project_id, l.procurement_request_id, l.vendor_id, l.customer_id,
              l.intercompany_transaction_id, l.payable_invoice_id, l.receivable_invoice_id
         FROM journal_lines l
         JOIN accounts a ON a.id = l.account_id
        WHERE l.journal_id = $1
        ORDER BY l.line_number`,
      [id],
    );
    const lineViews: JournalLineView[] = lines.rows.map((line) => ({
      id: line.id,
      accountId: line.account_id,
      accountCode: line.account_code,
      accountName: line.account_name,
      debitKobo: Number(line.debit_kobo),
      creditKobo: Number(line.credit_kobo),
      narration: line.narration,
      departmentId: line.department_id,
      projectId: line.project_id,
      procurementRequestId: line.procurement_request_id,
      vendorId: line.vendor_id,
      customerId: line.customer_id,
      intercompanyTransactionId: line.intercompany_transaction_id,
      payableInvoiceId: line.payable_invoice_id,
      receivableInvoiceId: line.receivable_invoice_id,
    }));
    const debitTotal = lineViews.reduce((sum, line) => sum + line.debitKobo, 0);
    const reversed = await tx.client.query<{ id: string }>(
      `SELECT id FROM journals WHERE reverses_journal_id = $1 LIMIT 1`,
      [id],
    );
    const first = lineViews[0];
    const source = sourceHref({
      procurementRequestId: first?.procurementRequestId,
      intercompanyTransactionId: first?.intercompanyTransactionId,
      payableInvoiceId: first?.payableInvoiceId,
      receivableInvoiceId: first?.receivableInvoiceId,
      customerId: first?.customerId,
      journalSource: row.source,
    });
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      fiscalPeriodId: row.fiscal_period_id,
      periodName: row.period_name,
      status: row.status,
      source: row.source,
      narration: row.narration,
      reversesJournalId: row.reverses_journal_id,
      reversedByJournalId: reversed.rows[0]?.id ?? null,
      workflowInstanceId: row.workflow_instance_id,
      preparedByName: row.prepared_by_name,
      postedAt: row.posted_at?.toISOString() ?? null,
      rowVersion: row.row_version,
      debitTotalKobo: debitTotal,
      creditTotalKobo: lineViews.reduce((sum, line) => sum + line.creditKobo, 0),
      lines: lineViews,
      sourceHref: source.href,
      sourceLabel: source.label,
    };
  }

  async create(actor: ActorContext, input: CreateJournalInput): Promise<JournalView> {
    assertCan(actor, 'finance.journal.prepare', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => this.createInTx(tx, actor, input));
  }

  async createInTx(tx: TxScope, actor: ActorContext, input: CreateJournalInput): Promise<JournalView> {
    this.assertLines(input.lines);
    await this.assertPeriodOpen(tx, input.fiscalPeriodId, input.entityId);
    const existing = await tx.client.query<{ id: string }>(
      `SELECT id FROM journals WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    if (existing.rows[0]) return this.getInTx(tx, existing.rows[0].id);
    const ref = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('JNL') AS ref`);
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO journals (
         reference_number, entity_id, fiscal_period_id, narration, idempotency_key, source,
         reverses_journal_id, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING id`,
      [
        ref.rows[0]?.ref,
        input.entityId,
        input.fiscalPeriodId,
        input.narration.trim(),
        input.idempotencyKey,
        input.source ?? 'MANUAL',
        input.reversesJournalId ?? null,
        actor.ref,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('The journal was not created.');
    await this.replaceLines(tx, actor, id, input.entityId, input.lines);
    await tx.audit({
      action: 'create',
      subjectType: 'journal',
      subjectId: id,
      subjectLabel: input.narration,
      subjectReferenceNumber: ref.rows[0]?.ref,
      entityId: input.entityId,
      newValue: { status: 'DRAFT' },
    });
    await this.indexJournal(tx, id);
    return this.getInTx(tx, id);
  }

  async postSystemInTx(tx: TxScope, actor: ActorContext, input: CreateJournalInput): Promise<JournalView> {
    this.assertLines(input.lines);
    await this.assertPeriodOpen(tx, input.fiscalPeriodId, input.entityId);
    const existing = await tx.client.query<{ id: string }>(
      `SELECT id FROM journals WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    if (existing.rows[0]) return this.getInTx(tx, existing.rows[0].id);
    const draft = await this.createInTx(tx, actor, input);
    await tx.client.query(
      `UPDATE journals
          SET status = 'POSTED', posted_at = now(), posted_by = $1, updated_by = $1
        WHERE id = $2 AND status = 'DRAFT'`,
      [actor.ref, draft.id],
    );
    await this.indexJournal(tx, draft.id);
    return this.getInTx(tx, draft.id);
  }

  async update(actor: ActorContext, id: string, input: UpdateJournalInput): Promise<JournalView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lock(tx, id);
      assertCan(actor, 'finance.journal.prepare', current.entity_id);
      if (current.created_by !== actor.ref) {
        throw new ForbiddenError('Only the preparer can edit this draft.');
      }
      if (current.status !== 'DRAFT') throw new ConflictError('Only a draft journal can be edited.');
      if (current.row_version !== input.rowVersion) {
        throw new StaleRecordError('This journal has changed. Refresh and try again.');
      }
      if (input.fiscalPeriodId) {
        await this.assertPeriodOpen(tx, input.fiscalPeriodId, current.entity_id);
      }
      await tx.client.query(
        `UPDATE journals SET narration = coalesce($2, narration), fiscal_period_id = coalesce($3, fiscal_period_id),
                updated_by = $4
          WHERE id = $1`,
        [id, input.narration?.trim() ?? null, input.fiscalPeriodId ?? null, actor.ref],
      );
      if (input.lines) {
        this.assertLines(input.lines);
        await tx.client.query(`DELETE FROM journal_lines WHERE journal_id = $1`, [id]);
        await this.replaceLines(tx, actor, id, current.entity_id, input.lines);
      }
      await this.indexJournal(tx, id);
      return this.getInTx(tx, id);
    });
  }

  async submit(actor: ActorContext, id: string, rowVersion: number): Promise<JournalView> {
    return this.unitOfWork.write(actor, async (tx) => this.submitInTx(tx, actor, id, rowVersion));
  }

  async submitInTx(tx: TxScope, actor: ActorContext, id: string, rowVersion: number): Promise<JournalView> {
    const current = await this.lock(tx, id);
    assertCan(actor, 'finance.journal.prepare', current.entity_id);
    if (current.created_by !== actor.ref) {
      throw new ForbiddenError('Only the preparer can submit this journal.');
    }
    if (current.status !== 'DRAFT') throw new ConflictError('This journal has already been submitted.');
    if (current.row_version !== rowVersion) {
      throw new StaleRecordError('This journal has changed. Refresh and try again.');
    }
    await this.assertPeriodOpen(tx, current.fiscal_period_id, current.entity_id);
    await tx.client.query(
      `UPDATE journals SET status = 'PENDING_APPROVAL', updated_by = $1 WHERE id = $2`,
      [actor.ref, id],
    );
    const view = await this.getInTx(tx, id);
    const instance = await this.workflows.startJournalInTx(tx, actor, {
      journalId: id,
      snapshot: { reference: view.referenceNumber, narration: view.narration, lines: view.lines },
    });
    await tx.client.query(`UPDATE journals SET workflow_instance_id = $1, updated_by = $2 WHERE id = $3`, [
      instance.id,
      actor.ref,
      id,
    ]);
    await tx.publish({
      eventType: 'journal.submitted',
      subjectType: 'JOURNAL',
      subjectId: id,
      entityId: current.entity_id,
      payload: {
        type: 'journal.submitted',
        reference: view.referenceNumber,
        title: view.narration,
        href: `/finance/journals/${id}`,
      },
    });
    await tx.appendTimeline({
      subjectType: 'JOURNAL',
      subjectId: id,
      text: 'Journal submitted for approval.',
      href: `/finance/journals/${id}`,
      entityId: current.entity_id,
    });
    await this.indexJournal(tx, id);
    return this.getInTx(tx, id);
  }

  async reverse(actor: ActorContext, id: string, input: ReverseJournalInput): Promise<JournalView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const original = await this.lock(tx, id);
      assertCan(actor, 'finance.journal.prepare', original.entity_id);
      if (original.status !== 'POSTED') throw new ConflictError('Only a posted journal can be reversed.');
      await this.assertPeriodOpen(tx, input.fiscalPeriodId, original.entity_id);
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM journals WHERE reverses_journal_id = $1`,
        [id],
      );
      if (existing.rows[0]) return this.getInTx(tx, existing.rows[0].id);
      const lines = await tx.client.query<{
        account_id: string;
        debit_kobo: string;
        credit_kobo: string;
        narration: string | null;
        department_id: string | null;
        project_id: string | null;
        procurement_request_id: string | null;
        vendor_id: string | null;
      }>(
        `SELECT account_id, debit_kobo::text, credit_kobo::text, narration, department_id,
                project_id, procurement_request_id, vendor_id
           FROM journal_lines WHERE journal_id = $1 ORDER BY line_number`,
        [id],
      );
      const draft = await this.createInTx(tx, actor, {
        entityId: original.entity_id,
        fiscalPeriodId: input.fiscalPeriodId,
        narration: `Reversal of ${original.reference_number}. ${input.reason.trim()}`,
        idempotencyKey: input.idempotencyKey,
        source: 'REVERSAL',
        reversesJournalId: id,
        lines: lines.rows.map((line) => ({
          accountId: line.account_id,
          debitKobo: Number(line.credit_kobo),
          creditKobo: Number(line.debit_kobo),
          narration: line.narration ?? undefined,
          departmentId: line.department_id,
          projectId: line.project_id,
          procurementRequestId: line.procurement_request_id,
          vendorId: line.vendor_id,
        })),
      });
      await tx.audit({
        action: 'edit',
        subjectType: 'journal',
        subjectId: draft.id,
        subjectLabel: draft.narration,
        subjectReferenceNumber: draft.referenceNumber,
        entityId: original.entity_id,
        reason: input.reason.trim(),
        oldValue: { reverses: null },
        newValue: { reverses: original.reference_number },
      });
      return this.submitInTx(tx, actor, draft.id, draft.rowVersion);
    });
  }

  async trialBalance(
    actor: ActorContext,
    opts: { entityId?: string; consolidated?: boolean; periodId?: string },
  ): Promise<TrialBalanceView> {
    if (!can(actor, 'finance.view')) throw new ForbiddenError('You cannot view the trial balance.');
    if (opts.consolidated) assertCan(actor, 'finance.view.consolidated');
    return this.unitOfWork.read(actor, async (tx) => {
      if (opts.consolidated) {
        const window = await resolveReportWindow(tx, { periodId: opts.periodId, consolidated: true });
        const raw = await fetchCodeBalances(tx, {
          window,
          mode: opts.periodId ? 'activity' : 'as_of',
        });
        const eliminated = await postedPairTotal(tx, window);
        const rolled = applyEliminations(raw, eliminated);
        const rows = rolled.map((row) => {
          const net = row.debitKobo - row.creditKobo;
          return {
            accountId: row.consolidationCode,
            accountCode: row.consolidationCode,
            accountName: row.accountName,
            accountType: row.accountType,
            entityId: '',
            entityCode: null,
            debitKobo: net > 0 ? net : 0,
            creditKobo: net < 0 ? -net : 0,
          };
        }).filter((row) => row.debitKobo !== 0 || row.creditKobo !== 0);
        return {
          scope: 'consolidated' as const,
          periodId: opts.periodId ?? null,
          rows,
          debitTotalKobo: rows.reduce((sum, row) => sum + row.debitKobo, 0),
          creditTotalKobo: rows.reduce((sum, row) => sum + row.creditKobo, 0),
          eliminationTotalKobo: eliminated,
        };
      }
      const result = await tx.client.query<{
        account_id: string;
        account_code: string;
        account_name: string;
        account_type: TrialBalanceView['rows'][number]['accountType'];
        entity_id: string;
        entity_code: string | null;
        debit: string;
        credit: string;
      }>(
        `SELECT a.id AS account_id, a.code AS account_code, a.name AS account_name, a.type AS account_type,
                a.entity_id, e.code AS entity_code,
                sum(l.debit_kobo)::text AS debit, sum(l.credit_kobo)::text AS credit
           FROM journal_lines l
           JOIN journals j ON j.id = l.journal_id
           JOIN accounts a ON a.id = l.account_id
           JOIN entities e ON e.id = a.entity_id
          WHERE j.status = 'POSTED'
            AND ($1::uuid IS NULL OR j.entity_id = $1)
            AND ($2::uuid IS NULL OR j.fiscal_period_id = $2)
          GROUP BY a.id, a.code, a.name, a.type, a.entity_id, e.code
          ORDER BY e.code, a.code`,
        [opts.consolidated ? null : (opts.entityId ?? null), opts.periodId ?? null],
      );
      const rows = result.rows.map((row) => ({
        accountId: row.account_id,
        accountCode: row.account_code,
        accountName: row.account_name,
        accountType: row.account_type,
        entityId: row.entity_id,
        entityCode: row.entity_code,
        debitKobo: Number(row.debit),
        creditKobo: Number(row.credit),
      }));
      return {
        scope: opts.consolidated ? 'consolidated' : 'entity',
        periodId: opts.periodId ?? null,
        rows,
        debitTotalKobo: rows.reduce((sum, row) => sum + row.debitKobo, 0),
        creditTotalKobo: rows.reduce((sum, row) => sum + row.creditKobo, 0),
      };
    });
  }

  async ledger(
    actor: ActorContext,
    accountId: string,
    periodId?: string,
  ): Promise<LedgerEntryView[]> {
    if (!can(actor, 'finance.view')) throw new ForbiddenError('You cannot view the ledger.');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        journal_id: string;
        journal_line_id: string;
        journal_reference: string;
        occurred_on: Date;
        narration: string;
        debit_kobo: string;
        credit_kobo: string;
      }>(
        `SELECT j.id AS journal_id, l.id AS journal_line_id, j.reference_number AS journal_reference,
                p.starts_on AS occurred_on, coalesce(l.narration, j.narration) AS narration,
                l.debit_kobo::text, l.credit_kobo::text
           FROM journal_lines l
           JOIN journals j ON j.id = l.journal_id
           JOIN fiscal_periods p ON p.id = j.fiscal_period_id
          WHERE l.account_id = $1
            AND j.status = 'POSTED'
            AND ($2::uuid IS NULL OR j.fiscal_period_id = $2)
          ORDER BY p.starts_on, j.reference_number`,
        [accountId, periodId ?? null],
      );
      return result.rows.map((row) => ({
        journalId: row.journal_id,
        journalLineId: row.journal_line_id,
        journalReference: row.journal_reference,
        occurredOn: row.occurred_on.toISOString().slice(0, 10),
        narration: row.narration,
        debitKobo: Number(row.debit_kobo),
        creditKobo: Number(row.credit_kobo),
      }));
    });
  }

  private async lock(tx: TxScope, id: string): Promise<{
    id: string;
    entity_id: string;
    fiscal_period_id: string;
    status: string;
    created_by: string;
    reference_number: string;
    row_version: number;
  }> {
    const result = await tx.client.query<{
      id: string;
      entity_id: string;
      fiscal_period_id: string;
      status: string;
      created_by: string;
      reference_number: string;
      row_version: number;
    }>(
      `SELECT id, entity_id, fiscal_period_id, status, created_by, reference_number, row_version
         FROM journals WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That journal does not exist.');
    return row;
  }

  private async assertPeriodOpen(tx: TxScope, periodId: string, entityId: string): Promise<void> {
    const period = await tx.client.query<{ status: string; entity_id: string }>(
      `SELECT status, entity_id FROM fiscal_periods WHERE id = $1`,
      [periodId],
    );
    const row = period.rows[0];
    if (!row) throw new ValidationFailedError('The fiscal period was not found.');
    if (row.entity_id !== entityId) throw new ValidationFailedError('The period does not belong to this entity.');
    if (row.status !== 'OPEN') throw new ConflictError('Posting to a closed period is not allowed.');
  }

  private assertLines(lines: CreateJournalInput['lines']): void {
    const debit = lines.reduce((sum, line) => sum + line.debitKobo, 0);
    const credit = lines.reduce((sum, line) => sum + line.creditKobo, 0);
    if (debit === 0 || debit !== credit) {
      throw new ValidationFailedError('An unbalanced journal cannot be saved.');
    }
    for (const line of lines) {
      if ((line.debitKobo > 0 && line.creditKobo > 0) || (line.debitKobo === 0 && line.creditKobo === 0)) {
        throw new ValidationFailedError('Each line must be a debit or a credit, not both.');
      }
    }
  }

  private async replaceLines(
    tx: TxScope,
    actor: ActorContext,
    journalId: string,
    entityId: string,
    lines: CreateJournalInput['lines'],
  ): Promise<void> {
    let number = 1;
    for (const line of lines) {
      const account = await tx.client.query<{ entity_id: string; active: boolean }>(
        `SELECT entity_id, active FROM accounts WHERE id = $1`,
        [line.accountId],
      );
      const row = account.rows[0];
      if (!row || row.entity_id !== entityId || !row.active) {
        throw new ValidationFailedError('Every line must use an active account on this entity.');
      }
      await tx.client.query(
        `INSERT INTO journal_lines (
           journal_id, entity_id, account_id, line_number, debit_kobo, credit_kobo, narration,
           department_id, project_id, procurement_request_id, vendor_id, customer_id,
           intercompany_transaction_id, payable_invoice_id, receivable_invoice_id, inventory_movement_id,
           created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)`,
        [
          journalId,
          entityId,
          line.accountId,
          number,
          line.debitKobo,
          line.creditKobo,
          line.narration?.trim() ?? null,
          line.departmentId ?? null,
          line.projectId ?? null,
          line.procurementRequestId ?? null,
          line.vendorId ?? null,
          line.customerId ?? null,
          line.intercompanyTransactionId ?? null,
          line.payableInvoiceId ?? null,
          line.receivableInvoiceId ?? null,
          line.inventoryMovementId ?? null,
          actor.ref,
        ],
      );
      number += 1;
    }
  }

  private async indexJournal(tx: TxScope, id: string): Promise<void> {
    const view = await this.getInTx(tx, id);
    await tx.indexSearch({
      recordType: 'JOURNAL',
      recordId: id,
      referenceNumber: view.referenceNumber,
      title: view.narration,
      searchableText: `${view.referenceNumber} ${view.narration} ${view.lines.map((line) => line.accountCode).join(' ')}`,
      entityId: view.entityId,
      permissionKey: 'finance.view',
    });
  }
}
