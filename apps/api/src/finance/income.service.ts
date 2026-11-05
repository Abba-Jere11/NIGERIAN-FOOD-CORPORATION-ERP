import { forwardRef, Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { IncomeEntryView } from '@nfc/shared';
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
import type { CreateIncomeInput } from './finance.dto';
import { LedgerPostingService } from './ledger-posting.service';

@Injectable()
export class IncomeService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    @Inject(forwardRef(() => WorkflowsService))
    private readonly workflows: WorkflowsService,
    private readonly ledger: LedgerPostingService,
  ) {}

  async list(actor: ActorContext, entityId?: string): Promise<IncomeEntryView[]> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.income.manage')) {
      throw new ForbiddenError('You cannot view income.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT id FROM income_entries WHERE ($1::uuid IS NULL OR entity_id = $1) ORDER BY created_at DESC`,
        [entityId ?? null],
      );
      return Promise.all(ids.rows.map((row) => this.getInTx(tx, row.id)));
    });
  }

  async get(actor: ActorContext, id: string): Promise<IncomeEntryView> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.income.manage')) {
      throw new ForbiddenError('You cannot view income.');
    }
    return this.unitOfWork.read(actor, async (tx) => this.getInTx(tx, id));
  }

  async create(actor: ActorContext, input: CreateIncomeInput): Promise<IncomeEntryView> {
    assertCan(actor, 'finance.income.manage', input.entityId);
    if (input.settlement === 'INVOICE' && !input.customerId) {
      throw new ValidationFailedError('An invoiced income entry needs a customer.');
    }
    if (input.settlement === 'CASH' && !input.bankAccountId) {
      throw new ValidationFailedError('Cash income needs a bank account.');
    }
    return this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM income_entries WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) return this.getInTx(tx, existing.rows[0].id);
      const ref = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('INC') AS ref`);
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO income_entries (
           reference_number, entity_id, category_key, settlement, customer_id, bank_account_id,
           amount_kobo, occurred_on, due_date, narration, document_id, idempotency_key, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
         RETURNING id`,
        [
          ref.rows[0]?.ref,
          input.entityId,
          input.categoryKey,
          input.settlement,
          input.customerId ?? null,
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
      if (!id) throw new Error('The income entry was not created.');
      await this.index(tx, id);
      await tx.audit({
        action: 'create',
        subjectType: 'income',
        subjectId: id,
        subjectLabel: input.narration,
        subjectReferenceNumber: ref.rows[0]?.ref,
        entityId: input.entityId,
        newValue: { status: 'DRAFT' },
      });
      return this.getInTx(tx, id);
    });
  }

  async submit(actor: ActorContext, id: string, rowVersion: number): Promise<IncomeEntryView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lock(tx, id);
      assertCan(actor, 'finance.income.manage', current.entity_id);
      if (current.created_by !== actor.ref) throw new ForbiddenError('Only the preparer can submit this income.');
      if (current.status !== 'DRAFT') throw new ConflictError('This income has already been submitted.');
      if (current.row_version !== rowVersion) {
        throw new StaleRecordError('This income entry has changed. Refresh and try again.');
      }
      await tx.client.query(
        `UPDATE income_entries SET status = 'PENDING_APPROVAL', updated_by = $1 WHERE id = $2`,
        [actor.ref, id],
      );
      const view = await this.getInTx(tx, id);
      const instance = await this.workflows.startIncomeInTx(tx, actor, {
        incomeId: id,
        snapshot: { reference: view.referenceNumber, amountKobo: view.amountKobo },
      });
      await tx.client.query(
        `UPDATE income_entries SET workflow_instance_id = $1, updated_by = $2 WHERE id = $3`,
        [instance.id, actor.ref, id],
      );
      await tx.publish({
        eventType: 'income.submitted',
        subjectType: 'INCOME',
        subjectId: id,
        entityId: current.entity_id,
        payload: {
          type: 'income.submitted',
          reference: view.referenceNumber,
          title: view.narration,
          href: `/finance/income/${id}`,
        },
      });
      await this.index(tx, id);
      return this.getInTx(tx, id);
    });
  }

  async postApprovedInTx(tx: TxScope, actor: ActorContext, id: string): Promise<void> {
    const current = await this.lock(tx, id);
    const category = await tx.client.query<{ account_code: string }>(
      `SELECT account_code FROM income_categories WHERE key = $1`,
      [current.category_key],
    );
    const incomeAccount = await this.ledger.accountIdByCode(
      tx,
      current.entity_id,
      category.rows[0]?.account_code ?? '4100',
    );
    let debitAccount = incomeAccount;
    let receivableId: string | null = null;
    if (current.settlement === 'INVOICE') {
      if (!current.customer_id) throw new ValidationFailedError('Invoiced income needs a customer.');
      debitAccount = await this.ledger.accountIdByCode(tx, current.entity_id, '1220');
      const due = current.due_date ?? current.occurred_on;
      const arRef = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('ARI') AS ref`);
      const invoice = await tx.client.query<{ id: string }>(
        `INSERT INTO receivable_invoices (
           reference_number, entity_id, customer_id, income_entry_id, invoice_date, due_date,
           amount_kobo, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         RETURNING id`,
        [
          arRef.rows[0]?.ref,
          current.entity_id,
          current.customer_id,
          id,
          current.occurred_on,
          due,
          current.amount_kobo,
          actor.ref,
        ],
      );
      receivableId = invoice.rows[0]?.id ?? null;
    } else if (current.bank_account_id) {
      const bank = await tx.client.query<{ gl_account_id: string | null; entity_id: string }>(
        `SELECT gl_account_id, entity_id FROM entity_bank_accounts WHERE id = $1`,
        [current.bank_account_id],
      );
      const gl = bank.rows[0]?.gl_account_id;
      if (!gl) throw new ValidationFailedError('The bank account is not mapped to the ledger.');
      debitAccount = gl;
    }
    const journal = await this.ledger.postTwoSided(tx, actor, {
      entityId: current.entity_id,
      occurredOn: current.occurred_on,
      narration: current.narration,
      idempotencyKey: `inc:${id}`,
      source: current.settlement === 'INVOICE' ? 'RECEIVABLE' : 'INCOME',
      debitAccountId: debitAccount,
      creditAccountId: incomeAccount,
      amountKobo: current.amount_kobo,
      customerId: current.customer_id,
      receivableInvoiceId: receivableId,
    });
    if (current.settlement === 'CASH' && current.bank_account_id) {
      await this.ledger.insertBankTransaction(tx, actor, {
        accountId: current.bank_account_id,
        entityId: current.entity_id,
        kind: 'RECEIPT',
        amountKobo: current.amount_kobo,
        occurredOn: current.occurred_on,
        narration: current.narration,
        journalId: journal.id,
      });
      await this.ledger.applyBankDelta(tx, actor, current.bank_account_id, current.amount_kobo, current.occurred_on);
    }
    if (receivableId) {
      await tx.client.query(`UPDATE receivable_invoices SET journal_id = $1, updated_by = $2 WHERE id = $3`, [
        journal.id,
        actor.ref,
        receivableId,
      ]);
      await tx.indexSearch({
        recordType: 'AR_INVOICE',
        recordId: receivableId,
        referenceNumber: (await tx.client.query<{ reference_number: string }>(
          `SELECT reference_number FROM receivable_invoices WHERE id = $1`,
          [receivableId],
        )).rows[0]?.reference_number,
        title: current.narration,
        searchableText: current.narration,
        entityId: current.entity_id,
        permissionKey: 'finance.view',
      });
    }
    await tx.client.query(
      `UPDATE income_entries
          SET status = 'POSTED', journal_id = $1, receivable_invoice_id = $2, updated_by = $3
        WHERE id = $4`,
      [journal.id, receivableId, actor.ref, id],
    );
    await this.index(tx, id);
  }

  async rejectInTx(tx: TxScope, actor: ActorContext, id: string): Promise<void> {
    await tx.client.query(
      `UPDATE income_entries SET status = 'REJECTED', updated_by = $1 WHERE id = $2`,
      [actor.ref, id],
    );
  }

  async getInTx(tx: TxScope, id: string): Promise<IncomeEntryView> {
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      entity_code: string | null;
      category_key: string;
      category_name: string;
      settlement: IncomeEntryView['settlement'];
      customer_id: string | null;
      customer_name: string | null;
      amount_kobo: string;
      occurred_on: Date;
      narration: string;
      status: IncomeEntryView['status'];
      document_id: string | null;
      journal_id: string | null;
      receivable_invoice_id: string | null;
      workflow_instance_id: string | null;
      prepared_by_name: string | null;
      row_version: number;
    }>(
      `SELECT i.id, i.reference_number, i.entity_id, e.code AS entity_code, i.category_key,
              c.name AS category_name, i.settlement, i.customer_id, cu.name AS customer_name,
              i.amount_kobo::text, i.occurred_on, i.narration, i.status, i.document_id, i.journal_id,
              i.receivable_invoice_id, i.workflow_instance_id, i.row_version,
              app.user_public_name(
                CASE WHEN i.created_by ~ '^[0-9a-f-]{36}$' THEN i.created_by::uuid ELSE NULL END
              ) AS prepared_by_name
         FROM income_entries i
         JOIN entities e ON e.id = i.entity_id
         JOIN income_categories c ON c.key = i.category_key
         LEFT JOIN customers cu ON cu.id = i.customer_id
        WHERE i.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That income entry does not exist.');
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      categoryKey: row.category_key,
      categoryName: row.category_name,
      settlement: row.settlement,
      customerId: row.customer_id,
      customerName: row.customer_name,
      amountKobo: Number(row.amount_kobo),
      occurredOn: row.occurred_on.toISOString().slice(0, 10),
      narration: row.narration,
      status: row.status,
      documentId: row.document_id,
      journalId: row.journal_id,
      receivableInvoiceId: row.receivable_invoice_id,
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
      customer_id: string | null;
      bank_account_id: string | null;
      amount_kobo: number;
      occurred_on: string;
      due_date: string | null;
      narration: string;
    }>(
      `SELECT id, entity_id, status, created_by, row_version, category_key, settlement, customer_id,
              bank_account_id, amount_kobo, occurred_on::text, due_date::text, narration
         FROM income_entries WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That income entry does not exist.');
    return { ...row, amount_kobo: Number(row.amount_kobo) };
  }

  private async index(tx: TxScope, id: string): Promise<void> {
    const view = await this.getInTx(tx, id);
    await tx.indexSearch({
      recordType: 'INCOME',
      recordId: id,
      referenceNumber: view.referenceNumber,
      title: view.narration,
      searchableText: `${view.referenceNumber} ${view.narration} ${view.categoryName}`,
      entityId: view.entityId,
      permissionKey: 'finance.view',
    });
  }
}
