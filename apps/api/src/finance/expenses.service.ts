import { forwardRef, Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { ExpenseEntryView } from '@nfc/shared';
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
import { WorkflowsService } from '../workflows/workflows.service';
import type { CreateExpenseInput } from './finance.dto';
import { LedgerPostingService } from './ledger-posting.service';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    @Inject(forwardRef(() => WorkflowsService))
    private readonly workflows: WorkflowsService,
    private readonly ledger: LedgerPostingService,
  ) {}

  async list(actor: ActorContext, entityId?: string): Promise<ExpenseEntryView[]> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.expense.manage')) {
      throw new ForbiddenError('You cannot view expenses.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT id FROM expense_entries WHERE ($1::uuid IS NULL OR entity_id = $1) ORDER BY created_at DESC`,
        [entityId ?? null],
      );
      return Promise.all(ids.rows.map((row) => this.getInTx(tx, row.id)));
    });
  }

  async get(actor: ActorContext, id: string): Promise<ExpenseEntryView> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.expense.manage')) {
      throw new ForbiddenError('You cannot view expenses.');
    }
    return this.unitOfWork.read(actor, async (tx) => this.getInTx(tx, id));
  }

  async create(actor: ActorContext, input: CreateExpenseInput): Promise<ExpenseEntryView> {
    assertCan(actor, 'finance.expense.manage', input.entityId);
    if (input.settlement === 'CASH' && !input.bankAccountId) {
      throw new ValidationFailedError('A cash expense needs a bank account.');
    }
    return this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM expense_entries WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) return this.getInTx(tx, existing.rows[0].id);
      const ref = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('EXP') AS ref`);
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO expense_entries (
           reference_number, entity_id, category_key, settlement, vendor_id, bank_account_id,
           amount_kobo, occurred_on, due_date, narration, document_id, idempotency_key, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
         RETURNING id`,
        [
          ref.rows[0]?.ref,
          input.entityId,
          input.categoryKey,
          input.settlement,
          input.vendorId ?? null,
          input.bankAccountId ?? null,
          input.amountKobo,
          input.occurredOn,
          input.dueDate ?? null,
          input.narration.trim(),
          input.documentId ?? null,
          input.idempotencyKey,
          actor.ref,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The expense entry was not created.');
      await this.index(tx, id);
      await tx.audit({
        action: 'create',
        subjectType: 'expense',
        subjectId: id,
        subjectLabel: input.narration,
        subjectReferenceNumber: ref.rows[0]?.ref,
        entityId: input.entityId,
        newValue: { status: 'DRAFT' },
      });
      return this.getInTx(tx, id);
    });
  }

  async submit(actor: ActorContext, id: string, rowVersion: number): Promise<ExpenseEntryView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lock(tx, id);
      assertCan(actor, 'finance.expense.manage', current.entity_id);
      if (current.created_by !== actor.ref) throw new ForbiddenError('Only the preparer can submit this expense.');
      if (current.status !== 'DRAFT') throw new ConflictError('This expense has already been submitted.');
      if (current.row_version !== rowVersion) {
        throw new StaleRecordError('This expense has changed. Refresh and try again.');
      }
      await tx.client.query(
        `UPDATE expense_entries SET status = 'PENDING_APPROVAL', updated_by = $1 WHERE id = $2`,
        [actor.ref, id],
      );
      const view = await this.getInTx(tx, id);
      const instance = await this.workflows.startExpenseInTx(tx, actor, {
        expenseId: id,
        snapshot: { reference: view.referenceNumber, amountKobo: view.amountKobo },
      });
      await tx.client.query(
        `UPDATE expense_entries SET workflow_instance_id = $1, updated_by = $2 WHERE id = $3`,
        [instance.id, actor.ref, id],
      );
      await tx.publish({
        eventType: 'expense.submitted',
        subjectType: 'EXPENSE',
        subjectId: id,
        entityId: current.entity_id,
        payload: {
          type: 'expense.submitted',
          reference: view.referenceNumber,
          title: view.narration,
          href: `/finance/expenses/${id}`,
        },
      });
      await this.index(tx, id);
      return this.getInTx(tx, id);
    });
  }

  async postApprovedInTx(tx: TxScope, actor: ActorContext, id: string): Promise<void> {
    const current = await this.lock(tx, id);
    const category = await tx.client.query<{ account_code: string }>(
      `SELECT account_code FROM expense_categories WHERE key = $1`,
      [current.category_key],
    );
    const expenseAccount = await this.ledger.accountIdByCode(
      tx,
      current.entity_id,
      category.rows[0]?.account_code ?? '5200',
    );
    let creditAccount = await this.ledger.accountIdByCode(tx, current.entity_id, '2110');
    let payableId: string | null = null;
    if (current.settlement === 'CASH' && current.bank_account_id) {
      const bank = await tx.client.query<{ gl_account_id: string | null }>(
        `SELECT gl_account_id FROM entity_bank_accounts WHERE id = $1`,
        [current.bank_account_id],
      );
      if (!bank.rows[0]?.gl_account_id) {
        throw new ValidationFailedError('The bank account is not mapped to the ledger.');
      }
      creditAccount = bank.rows[0].gl_account_id;
    } else {
      const due = current.due_date ?? current.occurred_on;
      const billRef = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('BILL') AS ref`);
      const bill = await tx.client.query<{ id: string }>(
        `INSERT INTO payable_invoices (
           reference_number, entity_id, vendor_id, source, expense_entry_id, invoice_date, due_date,
           amount_kobo, status, narration, created_by, updated_by
         ) VALUES ($1, $2, $3, 'EXPENSE', $4, $5, $6, $7, 'UNPAID', $8, $9, $9)
         RETURNING id`,
        [
          billRef.rows[0]?.ref,
          current.entity_id,
          current.vendor_id,
          id,
          current.occurred_on,
          due,
          current.amount_kobo,
          current.narration,
          actor.ref,
        ],
      );
      payableId = bill.rows[0]?.id ?? null;
    }
    const journal = await this.ledger.postTwoSided(tx, actor, {
      entityId: current.entity_id,
      occurredOn: current.occurred_on,
      narration: current.narration,
      idempotencyKey: `exp:${id}`,
      source: current.settlement === 'CASH' ? 'EXPENSE' : 'PAYABLE',
      debitAccountId: expenseAccount,
      creditAccountId: creditAccount,
      amountKobo: current.amount_kobo,
      vendorId: current.vendor_id,
      payableInvoiceId: payableId,
    });
    if (current.settlement === 'CASH' && current.bank_account_id) {
      await this.ledger.insertBankTransaction(tx, actor, {
        accountId: current.bank_account_id,
        entityId: current.entity_id,
        kind: 'PAYMENT',
        amountKobo: -current.amount_kobo,
        occurredOn: current.occurred_on,
        narration: current.narration,
        journalId: journal.id,
      });
      await this.ledger.applyBankDelta(tx, actor, current.bank_account_id, -current.amount_kobo, current.occurred_on);
    }
    if (payableId) {
      await tx.client.query(`UPDATE payable_invoices SET journal_id = $1, updated_by = $2 WHERE id = $3`, [
        journal.id,
        actor.ref,
        payableId,
      ]);
    }
    await tx.client.query(
      `UPDATE expense_entries
          SET status = 'POSTED', journal_id = $1, payable_invoice_id = $2, updated_by = $3
        WHERE id = $4`,
      [journal.id, payableId, actor.ref, id],
    );
    await this.index(tx, id);
  }

  async rejectInTx(tx: TxScope, actor: ActorContext, id: string): Promise<void> {
    await tx.client.query(
      `UPDATE expense_entries SET status = 'REJECTED', updated_by = $1 WHERE id = $2`,
      [actor.ref, id],
    );
  }

  async getInTx(tx: TxScope, id: string): Promise<ExpenseEntryView> {
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      entity_code: string | null;
      category_key: string;
      category_name: string;
      settlement: ExpenseEntryView['settlement'];
      vendor_id: string | null;
      vendor_name: string | null;
      amount_kobo: string;
      occurred_on: Date;
      due_date: Date | null;
      narration: string;
      status: ExpenseEntryView['status'];
      document_id: string | null;
      journal_id: string | null;
      payable_invoice_id: string | null;
      workflow_instance_id: string | null;
      prepared_by_name: string | null;
      row_version: number;
    }>(
      `SELECT x.id, x.reference_number, x.entity_id, e.code AS entity_code, x.category_key,
              c.name AS category_name, x.settlement, x.vendor_id, v.legal_name AS vendor_name,
              x.amount_kobo::text, x.occurred_on, x.due_date, x.narration, x.status, x.document_id,
              x.journal_id, x.payable_invoice_id, x.workflow_instance_id, x.row_version,
              app.user_public_name(
                CASE WHEN x.created_by ~ '^[0-9a-f-]{36}$' THEN x.created_by::uuid ELSE NULL END
              ) AS prepared_by_name
         FROM expense_entries x
         JOIN entities e ON e.id = x.entity_id
         JOIN expense_categories c ON c.key = x.category_key
         LEFT JOIN vendors v ON v.id = x.vendor_id
        WHERE x.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That expense entry does not exist.');
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      categoryKey: row.category_key,
      categoryName: row.category_name,
      settlement: row.settlement,
      vendorId: row.vendor_id,
      vendorName: row.vendor_name,
      amountKobo: Number(row.amount_kobo),
      occurredOn: row.occurred_on.toISOString().slice(0, 10),
      dueDate: row.due_date ? row.due_date.toISOString().slice(0, 10) : null,
      narration: row.narration,
      status: row.status,
      documentId: row.document_id,
      journalId: row.journal_id,
      payableInvoiceId: row.payable_invoice_id,
      workflowInstanceId: row.workflow_instance_id,
      preparedByName: row.prepared_by_name,
      rowVersion: row.row_version,
    };
  }

  private async lock(tx: TxScope, id: string) {
    const result = await tx.client.query<{
      id: string;
      entity_id: string;
      status: string;
      created_by: string;
      row_version: number;
      category_key: string;
      settlement: string;
      vendor_id: string | null;
      bank_account_id: string | null;
      amount_kobo: number;
      occurred_on: string;
      due_date: string | null;
      narration: string;
    }>(
      `SELECT id, entity_id, status, created_by, row_version, category_key, settlement, vendor_id,
              bank_account_id, amount_kobo, occurred_on::text, due_date::text, narration
         FROM expense_entries WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That expense entry does not exist.');
    return { ...row, amount_kobo: Number(row.amount_kobo) };
  }

  private async index(tx: TxScope, id: string): Promise<void> {
    const view = await this.getInTx(tx, id);
    await tx.indexSearch({
      recordType: 'EXPENSE',
      recordId: id,
      referenceNumber: view.referenceNumber,
      title: view.narration,
      searchableText: `${view.referenceNumber} ${view.narration} ${view.categoryName}`,
      entityId: view.entityId,
      permissionKey: 'finance.view',
    });
  }
}
