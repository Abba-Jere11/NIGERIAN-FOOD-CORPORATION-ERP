import { forwardRef, Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { PayableInvoiceView } from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StaleRecordError,
} from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import { WorkflowsService } from '../workflows/workflows.service';
import type { CreateBillInput } from './finance.dto';
import { LedgerPostingService } from './ledger-posting.service';

@Injectable()
export class PayablesService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    @Inject(forwardRef(() => WorkflowsService))
    private readonly workflows: WorkflowsService,
    private readonly ledger: LedgerPostingService,
  ) {}

  async list(actor: ActorContext, entityId?: string): Promise<PayableInvoiceView[]> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.payables.manage')) {
      throw new ForbiddenError('You cannot view payables.');
    }
    return this.unitOfWork.read(actor, async (tx) => this.listInTx(tx, entityId));
  }

  async get(actor: ActorContext, id: string): Promise<PayableInvoiceView> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.payables.manage')) {
      throw new ForbiddenError('You cannot view payables.');
    }
    return this.unitOfWork.read(actor, async (tx) => this.getInTx(tx, id));
  }

  async createBill(actor: ActorContext, input: CreateBillInput): Promise<PayableInvoiceView> {
    assertCan(actor, 'finance.payables.manage', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM payable_invoices WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) return this.getInTx(tx, existing.rows[0].id);
      const ref = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('BILL') AS ref`);
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO payable_invoices (
           reference_number, entity_id, vendor_id, source, invoice_date, due_date, amount_kobo,
           narration, document_id, idempotency_key, created_by, updated_by
         ) VALUES ($1, $2, $3, 'BILL', $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING id`,
        [
          ref.rows[0]?.ref,
          input.entityId,
          input.vendorId,
          input.invoiceDate,
          input.dueDate,
          input.amountKobo,
          input.narration.trim(),
          input.documentId ?? null,
          input.idempotencyKey,
          actor.ref,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The bill was not created.');
      await this.index(tx, id);
      await tx.audit({
        action: 'create',
        subjectType: 'payable',
        subjectId: id,
        subjectReferenceNumber: ref.rows[0]?.ref,
        entityId: input.entityId,
        newValue: { status: 'DRAFT' },
      });
      return this.getInTx(tx, id);
    });
  }

  async submit(actor: ActorContext, id: string, rowVersion: number): Promise<PayableInvoiceView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lock(tx, id);
      assertCan(actor, 'finance.payables.manage', current.entity_id);
      if (current.created_by !== actor.ref) throw new ForbiddenError('Only the preparer can submit this bill.');
      if (current.status !== 'DRAFT') throw new ConflictError('This bill has already been submitted.');
      if (current.row_version !== rowVersion) {
        throw new StaleRecordError('This bill has changed. Refresh and try again.');
      }
      await tx.client.query(
        `UPDATE payable_invoices SET status = 'PENDING_APPROVAL', updated_by = $1 WHERE id = $2`,
        [actor.ref, id],
      );
      const view = await this.getInTx(tx, id);
      const instance = await this.workflows.startBillInTx(tx, actor, {
        billId: id,
        snapshot: { reference: view.referenceNumber, amountKobo: view.amountKobo },
      });
      await tx.client.query(
        `UPDATE payable_invoices SET workflow_instance_id = $1, updated_by = $2 WHERE id = $3`,
        [instance.id, actor.ref, id],
      );
      await tx.publish({
        eventType: 'bill.submitted',
        subjectType: 'BILL',
        subjectId: id,
        entityId: current.entity_id,
        payload: {
          type: 'bill.submitted',
          reference: view.referenceNumber,
          title: view.vendorName ?? view.referenceNumber,
          href: `/finance/payables/${id}`,
        },
      });
      await this.index(tx, id);
      return this.getInTx(tx, id);
    });
  }

  async postApprovedInTx(tx: TxScope, actor: ActorContext, id: string): Promise<void> {
    const current = await this.lock(tx, id);
    const expenseAccount = await this.ledger.accountIdByCode(tx, current.entity_id, '5220');
    const payableAccount = await this.ledger.accountIdByCode(tx, current.entity_id, '2110');
    const journal = await this.ledger.postTwoSided(tx, actor, {
      entityId: current.entity_id,
      occurredOn: current.invoice_date,
      narration: current.narration || `Vendor bill ${current.reference_number}`,
      idempotencyKey: `bill:${id}`,
      source: 'PAYABLE',
      debitAccountId: expenseAccount,
      creditAccountId: payableAccount,
      amountKobo: current.amount_kobo,
      vendorId: current.vendor_id,
      payableInvoiceId: id,
    });
    await tx.client.query(
      `UPDATE payable_invoices SET status = 'UNPAID', journal_id = $1, updated_by = $2 WHERE id = $3`,
      [journal.id, actor.ref, id],
    );
    await this.index(tx, id);
  }

  async rejectInTx(tx: TxScope, actor: ActorContext, id: string): Promise<void> {
    await tx.client.query(
      `UPDATE payable_invoices SET status = 'REJECTED', updated_by = $1 WHERE id = $2`,
      [actor.ref, id],
    );
  }

  async markPaidFromProcurementInTx(
    tx: TxScope,
    actor: ActorContext,
    input: {
      entityId: string;
      vendorId: string | null;
      requestId: string;
      amountKobo: number;
      invoiceDate: string;
      dueDate: string;
      narration: string;
    },
  ): Promise<void> {
    const existing = await tx.client.query<{ id: string }>(
      `SELECT id FROM payable_invoices WHERE procurement_request_id = $1`,
      [input.requestId],
    );
    if (existing.rows[0]) {
      await tx.client.query(
        `UPDATE payable_invoices
            SET paid_kobo = amount_kobo, status = 'PAID', updated_by = $1
          WHERE id = $2`,
        [actor.ref, existing.rows[0].id],
      );
      return;
    }
    const ref = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('BILL') AS ref`);
    await tx.client.query(
      `INSERT INTO payable_invoices (
         reference_number, entity_id, vendor_id, source, procurement_request_id, invoice_date, due_date,
         amount_kobo, paid_kobo, status, narration, created_by, updated_by
       ) VALUES ($1, $2, $3, 'PROCUREMENT', $4, $5, $6, $7, $7, 'PAID', $8, $9, $9)`,
      [
        ref.rows[0]?.ref,
        input.entityId,
        input.vendorId,
        input.requestId,
        input.invoiceDate,
        input.dueDate,
        input.amountKobo,
        input.narration,
        actor.ref,
      ],
    );
  }

  async getInTx(tx: TxScope, id: string): Promise<PayableInvoiceView> {
    const rows = await this.listInTx(tx);
    const view = rows.find((row) => row.id === id);
    if (!view) throw new NotFoundError('That payable invoice does not exist.');
    return view;
  }

  private async listInTx(tx: TxScope, entityId?: string): Promise<PayableInvoiceView[]> {
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      entity_code: string | null;
      vendor_id: string | null;
      vendor_name: string | null;
      source: PayableInvoiceView['source'];
      procurement_request_id: string | null;
      expense_entry_id: string | null;
      invoice_date: Date;
      due_date: Date;
      amount_kobo: string;
      paid_kobo: string;
      status: PayableInvoiceView['status'];
      journal_id: string | null;
      row_version: number;
    }>(
      `SELECT p.id, p.reference_number, p.entity_id, e.code AS entity_code, p.vendor_id,
              v.legal_name AS vendor_name, p.source, p.procurement_request_id, p.expense_entry_id,
              p.invoice_date, p.due_date, p.amount_kobo::text, p.paid_kobo::text, p.status,
              p.journal_id, p.row_version
         FROM payable_invoices p
         JOIN entities e ON e.id = p.entity_id
         LEFT JOIN vendors v ON v.id = p.vendor_id
        WHERE ($1::uuid IS NULL OR p.entity_id = $1)
        ORDER BY p.due_date`,
      [entityId ?? null],
    );
    return result.rows.map((row) => {
      const amount = Number(row.amount_kobo);
      const paid = Number(row.paid_kobo);
      const outstanding = amount - paid;
      const dueDate = row.due_date.toISOString().slice(0, 10);
      const computed =
        row.status === 'DRAFT' || row.status === 'PENDING_APPROVAL' || row.status === 'REJECTED'
          ? row.status
          : outstanding <= 0
            ? 'PAID'
            : paid > 0
              ? 'PART_PAID'
              : 'UNPAID';
      return {
        id: row.id,
        referenceNumber: row.reference_number,
        entityId: row.entity_id,
        entityCode: row.entity_code,
        vendorId: row.vendor_id,
        vendorName: row.vendor_name,
        source: row.source,
        procurementRequestId: row.procurement_request_id,
        expenseEntryId: row.expense_entry_id,
        invoiceDate: row.invoice_date.toISOString().slice(0, 10),
        dueDate,
        amountKobo: amount,
        paidKobo: paid,
        outstandingKobo: outstanding,
        status: computed,
        overdue: outstanding > 0 && computed === 'UNPAID' && new Date(`${dueDate}T00:00:00Z`) < new Date(),
        journalId: row.journal_id,
        rowVersion: row.row_version,
      };
    });
  }

  private async lock(tx: TxScope, id: string) {
    const result = await tx.client.query<{
      id: string;
      entity_id: string;
      status: string;
      created_by: string;
      row_version: number;
      invoice_date: string;
      amount_kobo: number;
      narration: string;
      reference_number: string;
      vendor_id: string | null;
    }>(
      `SELECT id, entity_id, status, created_by, row_version, invoice_date::text, amount_kobo,
              narration, reference_number, vendor_id
         FROM payable_invoices WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That payable invoice does not exist.');
    return { ...row, amount_kobo: Number(row.amount_kobo) };
  }

  private async index(tx: TxScope, id: string): Promise<void> {
    const view = await this.getInTx(tx, id);
    await tx.indexSearch({
      recordType: 'BILL',
      recordId: id,
      referenceNumber: view.referenceNumber,
      title: view.vendorName ?? view.referenceNumber,
      searchableText: `${view.referenceNumber} ${view.vendorName ?? ''}`.trim(),
      entityId: view.entityId,
      permissionKey: 'finance.view',
    });
  }
}
