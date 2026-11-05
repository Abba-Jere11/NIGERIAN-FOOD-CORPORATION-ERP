import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { BudgetCommitmentAction, JournalSource, JournalView } from '@nfc/shared';
import { ConflictError, ValidationFailedError } from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { JournalsService } from './journals.service';

@Injectable()
export class LedgerPostingService {
  constructor(private readonly journals: JournalsService) {}

  async accountIdByCode(tx: TxScope, entityId: string, code: string): Promise<string> {
    const result = await tx.client.query<{ id: string }>(
      `SELECT id FROM accounts WHERE entity_id = $1 AND code = $2 AND active = true`,
      [entityId, code],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new ValidationFailedError(`Account ${code} is not on this entity chart.`);
    return id;
  }

  async openPeriodId(tx: TxScope, entityId: string, occurredOn: string): Promise<string> {
    const result = await tx.client.query<{ id: string }>(
      `SELECT id FROM fiscal_periods
        WHERE entity_id = $1 AND status = 'OPEN' AND $2::date BETWEEN starts_on AND ends_on`,
      [entityId, occurredOn],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new ConflictError('There is no open fiscal period for that date.');
    return id;
  }

  async applyBankDelta(
    tx: TxScope,
    actor: ActorContext,
    accountId: string,
    deltaKobo: number,
    asOf: string,
  ): Promise<void> {
    await tx.client.query(
      `UPDATE entity_bank_accounts
          SET recorded_balance_kobo = recorded_balance_kobo + $1,
              balance_as_of = $2,
              balance_recorded_by = $3,
              updated_by = $3
        WHERE id = $4`,
      [deltaKobo, asOf, actor.ref, accountId],
    );
    const current = await tx.client.query<{ recorded_balance_kobo: string; entity_id: string }>(
      `SELECT recorded_balance_kobo::text, entity_id FROM entity_bank_accounts WHERE id = $1`,
      [accountId],
    );
    const row = current.rows[0];
    if (!row) return;
    await tx.client.query(
      `INSERT INTO entity_bank_balance_events (account_id, entity_id, balance_kobo, as_of, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [accountId, row.entity_id, Number(row.recorded_balance_kobo), asOf, actor.ref],
    );
  }

  async insertBankTransaction(
    tx: TxScope,
    actor: ActorContext,
    input: {
      accountId: string;
      entityId: string;
      kind: string;
      amountKobo: number;
      occurredOn: string;
      narration: string;
      journalId?: string | null;
      transferId?: string | null;
    },
  ): Promise<void> {
    await tx.client.query(
      `INSERT INTO bank_transactions (
         account_id, entity_id, kind, amount_kobo, occurred_on, narration, journal_id, transfer_id, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.accountId,
        input.entityId,
        input.kind,
        input.amountKobo,
        input.occurredOn,
        input.narration,
        input.journalId ?? null,
        input.transferId ?? null,
        actor.ref,
      ],
    );
  }

  async writeBudgetEvent(
    tx: TxScope,
    actor: ActorContext,
    input: {
      requestId?: string | null;
      entityId: string;
      budgetLineId?: string | null;
      action: BudgetCommitmentAction;
      amountKobo: number;
    },
  ): Promise<void> {
    await tx.client.query(
      `INSERT INTO budget_commitment_events (
         request_id, entity_id, budget_line_id, action, amount_kobo, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.requestId ?? null,
        input.entityId,
        input.budgetLineId ?? null,
        input.action,
        input.amountKobo,
        actor.ref,
      ],
    );
  }

  async postTwoSided(
    tx: TxScope,
    actor: ActorContext,
    input: {
      entityId: string;
      occurredOn: string;
      narration: string;
      idempotencyKey: string;
      source: JournalSource;
      debitAccountId: string;
      creditAccountId: string;
      amountKobo: number;
      procurementRequestId?: string | null;
      vendorId?: string | null;
      customerId?: string | null;
      intercompanyTransactionId?: string | null;
      payableInvoiceId?: string | null;
      receivableInvoiceId?: string | null;
      inventoryMovementId?: string | null;
    },
  ): Promise<JournalView> {
    const periodId = await this.openPeriodId(tx, input.entityId, input.occurredOn);
    const amountKobo = Number(input.amountKobo);
    const dims = {
      procurementRequestId: input.procurementRequestId ?? null,
      vendorId: input.vendorId ?? null,
      customerId: input.customerId ?? null,
      intercompanyTransactionId: input.intercompanyTransactionId ?? null,
      payableInvoiceId: input.payableInvoiceId ?? null,
      receivableInvoiceId: input.receivableInvoiceId ?? null,
      inventoryMovementId: input.inventoryMovementId ?? null,
    };
    return this.journals.postSystemInTx(tx, actor, {
      entityId: input.entityId,
      fiscalPeriodId: periodId,
      narration: input.narration,
      idempotencyKey: input.idempotencyKey,
      source: input.source,
      lines: [
        { accountId: input.debitAccountId, debitKobo: amountKobo, creditKobo: 0, ...dims },
        { accountId: input.creditAccountId, debitKobo: 0, creditKobo: amountKobo, ...dims },
      ],
    });
  }

  async postProcurementPayment(
    tx: TxScope,
    actor: ActorContext,
    input: {
      paymentId: string;
      requestId: string;
      entityId: string;
      vendorId: string | null;
      payingAccountId: string;
      amountKobo: number;
      occurredOn: string;
      narration: string;
      budgetLineId?: string | null;
    },
  ): Promise<JournalView> {
    const prepay = await this.accountIdByCode(tx, input.entityId, '1300');
    const bank = await tx.client.query<{ gl_account_id: string | null; entity_id: string }>(
      `SELECT gl_account_id, entity_id FROM entity_bank_accounts WHERE id = $1`,
      [input.payingAccountId],
    );
    if (!bank.rows[0]?.gl_account_id) {
      throw new ValidationFailedError('The paying account is not mapped to the ledger.');
    }
    const journal = await this.postTwoSided(tx, actor, {
      entityId: input.entityId,
      occurredOn: input.occurredOn,
      narration: input.narration,
      idempotencyKey: `pay:${input.paymentId}`,
      source: 'PROCUREMENT_PAYMENT',
      debitAccountId: prepay,
      creditAccountId: bank.rows[0].gl_account_id,
      amountKobo: input.amountKobo,
      procurementRequestId: input.requestId,
      vendorId: input.vendorId,
    });
    await this.insertBankTransaction(tx, actor, {
      accountId: input.payingAccountId,
      entityId: input.entityId,
      kind: 'PAYMENT',
      amountKobo: -input.amountKobo,
      occurredOn: input.occurredOn,
      narration: input.narration,
      journalId: journal.id,
    });
    await this.applyBankDelta(tx, actor, input.payingAccountId, -input.amountKobo, input.occurredOn);
    await this.writeBudgetEvent(tx, actor, {
      requestId: input.requestId,
      entityId: input.entityId,
      budgetLineId: input.budgetLineId ?? null,
      action: 'PAY',
      amountKobo: input.amountKobo,
    });
    return journal;
  }

  async postProcurementRecovery(
    tx: TxScope,
    actor: ActorContext,
    input: {
      recoveryId: string;
      requestId: string;
      entityId: string;
      vendorId: string;
      amountKobo: number;
      occurredOn: string;
      narration: string;
      receivableInvoiceId: string;
    },
  ): Promise<JournalView> {
    const existing = await tx.client.query<{ id: string }>(
      `SELECT id FROM journals WHERE idempotency_key = $1`,
      [`recovery:${input.recoveryId}`],
    );
    if (existing.rows[0]) return this.journals.getInTx(tx, existing.rows[0].id);
    const ar = await this.accountIdByCode(tx, input.entityId, '1220');
    const prepay = await this.accountIdByCode(tx, input.entityId, '1300');
    return this.postTwoSided(tx, actor, {
      entityId: input.entityId,
      occurredOn: input.occurredOn,
      narration: input.narration,
      idempotencyKey: `recovery:${input.recoveryId}`,
      source: 'PROCUREMENT_RECOVERY',
      debitAccountId: ar,
      creditAccountId: prepay,
      amountKobo: input.amountKobo,
      procurementRequestId: input.requestId,
      vendorId: input.vendorId,
      receivableInvoiceId: input.receivableInvoiceId,
    });
  }

  async postProcurementReclass(
    tx: TxScope,
    actor: ActorContext,
    input: {
      requestId: string;
      entityId: string;
      vendorId: string | null;
      categoryKey: string;
      amountKobo: number;
      occurredOn: string;
      narration: string;
      budgetLineId?: string | null;
    },
  ): Promise<JournalView | null> {
    const existing = await tx.client.query<{ id: string }>(
      `SELECT id FROM journals WHERE idempotency_key = $1`,
      [`reclass:${input.requestId}`],
    );
    if (existing.rows[0]) return this.journals.getInTx(tx, existing.rows[0].id);
    const rule = await tx.client.query<{ prepayment_account_code: string; completion_account_code: string }>(
      `SELECT prepayment_account_code, completion_account_code
         FROM category_posting_rules WHERE procurement_category_key = $1`,
      [input.categoryKey],
    );
    const prepayCode = rule.rows[0]?.prepayment_account_code ?? '1300';
    const completeCode = rule.rows[0]?.completion_account_code ?? '5220';
    let amountKobo = input.amountKobo;
    if (input.categoryKey === 'goods' || input.categoryKey === 'equipment') {
      const posted = await tx.client.query<{ n: string }>(
        `SELECT coalesce(sum(l.debit_kobo), 0)::text AS n
           FROM journal_lines l
           JOIN journals j ON j.id = l.journal_id
          WHERE j.status = 'POSTED'
            AND j.source = 'INVENTORY_RECEIPT'
            AND l.procurement_request_id = $1
            AND l.debit_kobo > 0`,
        [input.requestId],
      );
      amountKobo = Math.max(input.amountKobo - Number(posted.rows[0]?.n ?? 0), 0);
      if (amountKobo <= 0) return null;
    }
    const debit = await this.accountIdByCode(tx, input.entityId, completeCode);
    const credit = await this.accountIdByCode(tx, input.entityId, prepayCode);
    const journal = await this.postTwoSided(tx, actor, {
      entityId: input.entityId,
      occurredOn: input.occurredOn,
      narration: input.narration,
      idempotencyKey: `reclass:${input.requestId}`,
      source: 'PROCUREMENT_RECLASS',
      debitAccountId: debit,
      creditAccountId: credit,
      amountKobo,
      procurementRequestId: input.requestId,
      vendorId: input.vendorId,
    });
    await this.writeBudgetEvent(tx, actor, {
      requestId: input.requestId,
      entityId: input.entityId,
      budgetLineId: input.budgetLineId ?? null,
      action: 'ACTUAL',
      amountKobo,
    });
    return journal;
  }

  async reverseProcurementPayment(
    tx: TxScope,
    actor: ActorContext,
    input: {
      paymentId: string;
      requestId: string;
      entityId: string;
      payingAccountId: string;
      amountKobo: number;
      occurredOn: string;
      reason: string;
      budgetLineId?: string | null;
    },
  ): Promise<void> {
    const original = await tx.client.query<{ id: string; fiscal_period_id: string }>(
      `SELECT id, fiscal_period_id FROM journals WHERE idempotency_key = $1 AND status = 'POSTED'`,
      [`pay:${input.paymentId}`],
    );
    const journal = original.rows[0];
    if (!journal) return;
    const lines = await tx.client.query<{
      account_id: string;
      debit_kobo: string;
      credit_kobo: string;
      narration: string | null;
      procurement_request_id: string | null;
      vendor_id: string | null;
    }>(
      `SELECT account_id, debit_kobo::text, credit_kobo::text, narration, procurement_request_id, vendor_id
         FROM journal_lines WHERE journal_id = $1 ORDER BY line_number`,
      [journal.id],
    );
    await this.journals.postSystemInTx(tx, actor, {
      entityId: input.entityId,
      fiscalPeriodId: journal.fiscal_period_id,
      narration: `Reversal of payment. ${input.reason}`,
      idempotencyKey: `pay-rev:${input.paymentId}`,
      source: 'REVERSAL',
      reversesJournalId: journal.id,
      lines: lines.rows.map((line) => ({
        accountId: line.account_id,
        debitKobo: Number(line.credit_kobo),
        creditKobo: Number(line.debit_kobo),
        narration: line.narration ?? undefined,
        procurementRequestId: line.procurement_request_id,
        vendorId: line.vendor_id,
      })),
    });
    await tx.client.query(
      `UPDATE journals SET status = 'REVERSED', updated_by = $1 WHERE id = $2 AND status = 'POSTED'`,
      [actor.ref, journal.id],
    );
    await this.applyBankDelta(tx, actor, input.payingAccountId, input.amountKobo, input.occurredOn);
    await this.writeBudgetEvent(tx, actor, {
      requestId: input.requestId,
      entityId: input.entityId,
      budgetLineId: input.budgetLineId ?? null,
      action: 'REVERSE_PAY',
      amountKobo: input.amountKobo,
    });
  }
}
