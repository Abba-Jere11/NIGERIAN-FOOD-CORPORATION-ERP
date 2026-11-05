import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type {
  AgingBucket,
  CustomerStatementView,
  ReceiptView,
  ReceivableAgingView,
  ReceivableInvoiceView,
} from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import { CustomersService } from './customers.service';
import type { CreateReceiptInput } from './finance.dto';
import { LedgerPostingService } from './ledger-posting.service';

export function agingBucketFor(dueDate: string, now = new Date()): AgingBucket {
  const due = new Date(`${dueDate}T00:00:00Z`);
  const days = Math.floor((now.getTime() - due.getTime()) / 86_400_000);
  if (days <= 0) return 'current';
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return '90_plus';
}

@Injectable()
export class ReceivablesService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly ledger: LedgerPostingService,
    private readonly customers: CustomersService,
  ) {}

  async listInvoices(actor: ActorContext, entityId?: string): Promise<ReceivableInvoiceView[]> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.receivables.manage')) {
      throw new ForbiddenError('You cannot view receivables.');
    }
    return this.unitOfWork.read(actor, async (tx) => this.listInTx(tx, entityId));
  }

  async aging(actor: ActorContext, entityId?: string): Promise<ReceivableAgingView> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.receivables.manage')) {
      throw new ForbiddenError('You cannot view receivables.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const invoices = await this.listInTx(tx, entityId);
      const buckets: Record<AgingBucket, number> = {
        current: 0,
        '1_30': 0,
        '31_60': 0,
        '61_90': 0,
        '90_plus': 0,
      };
      for (const invoice of invoices) {
        if (invoice.outstandingKobo > 0) buckets[invoice.agingBucket] += invoice.outstandingKobo;
      }
      return { entityId: entityId ?? null, buckets, invoices };
    });
  }

  async statement(actor: ActorContext, customerId: string): Promise<CustomerStatementView> {
    if (!can(actor, 'finance.view') && !can(actor, 'finance.receivables.manage')) {
      throw new ForbiddenError('You cannot view receivables.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const customer = await this.customers.getInTx(tx, customerId);
      const invoices = (await this.listInTx(tx, customer.entityId)).filter((row) => row.customerId === customerId);
      const receipts = await this.listReceiptsInTx(tx, customer.entityId, customerId);
      return {
        customer,
        invoices,
        receipts,
        balanceKobo: invoices.reduce((sum, row) => sum + row.outstandingKobo, 0),
      };
    });
  }

  async recordReceipt(actor: ActorContext, input: CreateReceiptInput): Promise<ReceiptView> {
    assertCan(actor, 'finance.receivables.manage', input.entityId);
    const allocated = input.allocations.reduce((sum, row) => sum + row.amountKobo, 0);
    if (allocated !== input.amountKobo) {
      throw new ValidationFailedError('Allocations must equal the receipt amount.');
    }
    return this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM receipts WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) return this.getReceiptInTx(tx, existing.rows[0].id);
      const bank = await tx.client.query<{ gl_account_id: string | null; entity_id: string }>(
        `SELECT gl_account_id, entity_id FROM entity_bank_accounts WHERE id = $1 AND status = 'ACTIVE'`,
        [input.bankAccountId],
      );
      if (!bank.rows[0]?.gl_account_id) {
        throw new ValidationFailedError('The receiving account is not mapped to the ledger.');
      }
      if (bank.rows[0].entity_id !== input.entityId) {
        throw new ValidationFailedError('The bank account must belong to this entity.');
      }
      const arAccount = await this.ledger.accountIdByCode(tx, input.entityId, '1220');
      const ref = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('RCT') AS ref`);
      const firstInvoice = await tx.client.query<{
        customer_id: string | null;
        vendor_id: string | null;
        recovery_id: string | null;
      }>(
        `SELECT customer_id, vendor_id, recovery_id FROM receivable_invoices WHERE id = $1`,
        [input.allocations[0]?.invoiceId],
      );
      const party = firstInvoice.rows[0];
      const customerId = input.customerId ?? party?.customer_id ?? null;
      const vendorId = input.vendorId ?? party?.vendor_id ?? null;
      const recoveryId = party?.recovery_id ?? null;
      if (!customerId && !recoveryId) {
        throw new ValidationFailedError('A customer or vendor recovery invoice is required.');
      }
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO receipts (
           reference_number, entity_id, customer_id, vendor_id, recovery_id, bank_account_id, received_on,
           amount_kobo, idempotency_key, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING id`,
        [
          ref.rows[0]?.ref,
          input.entityId,
          customerId,
          vendorId,
          recoveryId,
          input.bankAccountId,
          input.receivedOn,
          input.amountKobo,
          input.idempotencyKey,
          actor.ref,
        ],
      );
      const receiptId = inserted.rows[0]?.id;
      if (!receiptId) throw new Error('The receipt was not created.');
      for (const allocation of input.allocations) {
        const invoice = await tx.client.query<{
          amount_kobo: string;
          allocated_kobo: string;
          entity_id: string;
          customer_id: string | null;
          vendor_id: string | null;
          recovery_id: string | null;
          status: string;
        }>(
          `SELECT amount_kobo::text, allocated_kobo::text, entity_id, customer_id, vendor_id, recovery_id, status
             FROM receivable_invoices WHERE id = $1 FOR UPDATE`,
          [allocation.invoiceId],
        );
        const row = invoice.rows[0];
        const partyMatch = customerId
          ? row?.customer_id === customerId
          : Boolean(row?.recovery_id) && row?.recovery_id === recoveryId && row?.vendor_id === vendorId;
        if (!row || row.entity_id !== input.entityId || !partyMatch) {
          throw new ValidationFailedError('Every allocation must be an invoice for this customer or vendor recovery.');
        }
        const outstanding = Number(row.amount_kobo) - Number(row.allocated_kobo);
        if (allocation.amountKobo > outstanding) {
          throw new ConflictError('A receipt cannot allocate more than the invoice outstanding.');
        }
        const nextAllocated = Number(row.allocated_kobo) + allocation.amountKobo;
        const status =
          nextAllocated === Number(row.amount_kobo) ? 'PAID' : nextAllocated > 0 ? 'PART_PAID' : row.status;
        await tx.client.query(
          `INSERT INTO receipt_allocations (receipt_id, invoice_id, entity_id, amount_kobo, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [receiptId, allocation.invoiceId, input.entityId, allocation.amountKobo, actor.ref],
        );
        await tx.client.query(
          `UPDATE receivable_invoices SET allocated_kobo = $1, status = $2, updated_by = $3 WHERE id = $4`,
          [nextAllocated, status, actor.ref, allocation.invoiceId],
        );
        if (status === 'PAID' && row.recovery_id) {
          await tx.client.query(
            `UPDATE procurement_recoveries SET status = 'SETTLED', updated_by = $1 WHERE id = $2`,
            [actor.ref, row.recovery_id],
          );
        }
      }
      const journal = await this.ledger.postTwoSided(tx, actor, {
        entityId: input.entityId,
        occurredOn: input.receivedOn,
        narration: `Customer receipt ${ref.rows[0]?.ref}`,
        idempotencyKey: `rct:${receiptId}`,
        source: 'RECEIPT',
        debitAccountId: bank.rows[0].gl_account_id,
        creditAccountId: arAccount,
        amountKobo: input.amountKobo,
        customerId: customerId,
        vendorId: vendorId,
      });
      await tx.client.query(`UPDATE receipts SET journal_id = $1, updated_by = $2 WHERE id = $3`, [
        journal.id,
        actor.ref,
        receiptId,
      ]);
      await this.ledger.insertBankTransaction(tx, actor, {
        accountId: input.bankAccountId,
        entityId: input.entityId,
        kind: 'RECEIPT',
        amountKobo: input.amountKobo,
        occurredOn: input.receivedOn,
        narration: `Customer receipt ${ref.rows[0]?.ref}`,
        journalId: journal.id,
      });
      await this.ledger.applyBankDelta(tx, actor, input.bankAccountId, input.amountKobo, input.receivedOn);
      await tx.indexSearch({
        recordType: 'RECEIPT',
        recordId: receiptId,
        referenceNumber: ref.rows[0]?.ref,
        title: `Receipt ${ref.rows[0]?.ref}`,
        searchableText: `Receipt ${ref.rows[0]?.ref}`,
        entityId: input.entityId,
        permissionKey: 'finance.view',
      });
      await tx.audit({
        action: 'create',
        subjectType: 'receipt',
        subjectId: receiptId,
        subjectReferenceNumber: ref.rows[0]?.ref,
        entityId: input.entityId,
        newValue: { amountKobo: input.amountKobo },
      });
      await tx.publish({
        eventType: 'receipt.recorded',
        subjectType: 'RECEIPT',
        subjectId: receiptId,
        entityId: input.entityId,
        payload: { type: 'receipt.recorded', reference: ref.rows[0]?.ref, title: 'Customer receipt', href: `/finance/receivables` },
      });
      return this.getReceiptInTx(tx, receiptId);
    });
  }

  private async listInTx(tx: TxScope, entityId?: string): Promise<ReceivableInvoiceView[]> {
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      entity_code: string | null;
      customer_id: string | null;
      customer_name: string | null;
      vendor_id: string | null;
      recovery_id: string | null;
      income_entry_id: string | null;
      invoice_date: Date;
      due_date: Date;
      amount_kobo: string;
      allocated_kobo: string;
      status: ReceivableInvoiceView['status'];
      journal_id: string | null;
      row_version: number;
    }>(
      `SELECT i.id, i.reference_number, i.entity_id, e.code AS entity_code, i.customer_id,
              coalesce(c.name, ven.legal_name) AS customer_name,
              i.vendor_id, i.recovery_id, i.income_entry_id, i.invoice_date, i.due_date,
              i.amount_kobo::text, i.allocated_kobo::text, i.status, i.journal_id, i.row_version
         FROM receivable_invoices i
         JOIN entities e ON e.id = i.entity_id
         LEFT JOIN customers c ON c.id = i.customer_id
         LEFT JOIN vendors ven ON ven.id = i.vendor_id
        WHERE ($1::uuid IS NULL OR i.entity_id = $1)
        ORDER BY i.due_date`,
      [entityId ?? null],
    );
    return result.rows.map((row) => {
      const amount = Number(row.amount_kobo);
      const allocated = Number(row.allocated_kobo);
      const outstanding = amount - allocated;
      const dueDate = row.due_date.toISOString().slice(0, 10);
      return {
        id: row.id,
        referenceNumber: row.reference_number,
        entityId: row.entity_id,
        entityCode: row.entity_code,
        customerId: row.customer_id,
        customerName: row.customer_name,
        vendorId: row.vendor_id,
        recoveryId: row.recovery_id,
        incomeEntryId: row.income_entry_id,
        invoiceDate: row.invoice_date.toISOString().slice(0, 10),
        dueDate,
        amountKobo: amount,
        allocatedKobo: allocated,
        outstandingKobo: outstanding,
        status: row.status,
        overdue: outstanding > 0 && new Date(`${dueDate}T00:00:00Z`) < new Date(),
        agingBucket: agingBucketFor(dueDate),
        journalId: row.journal_id,
        rowVersion: row.row_version,
      };
    });
  }

  private async listReceiptsInTx(tx: TxScope, entityId: string, customerId: string): Promise<ReceiptView[]> {
    const ids = await tx.client.query<{ id: string }>(
      `SELECT id FROM receipts WHERE entity_id = $1 AND customer_id = $2 ORDER BY received_on DESC`,
      [entityId, customerId],
    );
    return Promise.all(ids.rows.map((row) => this.getReceiptInTx(tx, row.id)));
  }

  private async getReceiptInTx(tx: TxScope, id: string): Promise<ReceiptView> {
    const header = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      customer_id: string | null;
      customer_name: string | null;
      received_on: Date;
      amount_kobo: string;
      journal_id: string | null;
    }>(
      `SELECT r.id, r.reference_number, r.entity_id, r.customer_id,
              coalesce(c.name, ven.legal_name) AS customer_name,
              r.received_on, r.amount_kobo::text, r.journal_id
         FROM receipts r
         LEFT JOIN customers c ON c.id = r.customer_id
         LEFT JOIN vendors ven ON ven.id = r.vendor_id
        WHERE r.id = $1`,
      [id],
    );
    const row = header.rows[0];
    if (!row) throw new NotFoundError('That receipt does not exist.');
    const allocations = await tx.client.query<{
      invoice_id: string;
      invoice_reference: string;
      amount_kobo: string;
    }>(
      `SELECT a.invoice_id, i.reference_number AS invoice_reference, a.amount_kobo::text
         FROM receipt_allocations a
         JOIN receivable_invoices i ON i.id = a.invoice_id
        WHERE a.receipt_id = $1`,
      [id],
    );
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      entityId: row.entity_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      receivedOn: row.received_on.toISOString().slice(0, 10),
      amountKobo: Number(row.amount_kobo),
      journalId: row.journal_id,
      allocations: allocations.rows.map((item) => ({
        invoiceId: item.invoice_id,
        invoiceReference: item.invoice_reference,
        amountKobo: Number(item.amount_kobo),
      })),
    };
  }
}
