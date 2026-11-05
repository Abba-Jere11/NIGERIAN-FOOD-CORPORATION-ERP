import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { formatLagosIsoDate, type FundingTransferView, type ProcurementPaymentView, type ProcurementView } from '@nfc/shared';
import { assertCan } from '../auth/can';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ReasonRequiredError,
  ValidationFailedError,
} from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import { IntercompanyService } from '../finance/intercompany.service';
import { LedgerPostingService } from '../finance/ledger-posting.service';
import { PayablesService } from '../finance/payables.service';
import { VendorValidationService } from '../vendors/vendor-validation.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { DeliveryService } from './delivery.service';
import { deliveryVerificationRecipients } from './notify-targets';
import {
  loadPaymentEligibility,
  nextStatusAfterPayment,
  PAYABLE_STATUSES,
} from './payment-eligibility';
import { ProcurementService } from './procurement.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly workflows: WorkflowsService,
    private readonly vendors: VendorValidationService,
    private readonly procurement: ProcurementService,
    @Optional() private readonly ledger?: LedgerPostingService,
    @Optional() private readonly intercompany?: IntercompanyService,
    @Optional() private readonly payables?: PayablesService,
    @Optional() @Inject(forwardRef(() => DeliveryService)) private readonly delivery?: DeliveryService,
  ) {}

  async recordTransfer(
    actor: ActorContext,
    input: {
      requestId: string;
      sourceAccountId: string;
      destinationAccountId: string;
      amountKobo: number;
      purpose: string;
      transferDate: string;
      transferMethod: string;
      bankReference: string;
      proofDocumentId: string;
    },
  ): Promise<ProcurementView> {
    assertCan(actor, 'finance.funding.transfer.record');
    return this.unitOfWork.write(actor, async (tx) => {
      const request = await tx.client.query<{
        id: string;
        reference_number: string;
        entity_id: string;
        status: string;
        funding_route: string | null;
        authorized_amount_kobo: string | null;
        destination_account_id: string | null;
        title: string;
        originator_user_id: string;
        timing_change_pending_ack: boolean;
        final_payment_timing: string | null;
      }>(
        `SELECT id, reference_number, entity_id, status, funding_route, authorized_amount_kobo::text,
                destination_account_id, originator_user_id, timing_change_pending_ack,
                final_payment_timing,
                (SELECT title FROM procurement_versions
                  WHERE request_id = procurement_requests.id
                    AND version_number = procurement_requests.current_version) AS title
           FROM procurement_requests WHERE id = $1 FOR UPDATE`,
        [input.requestId],
      );
      const row = request.rows[0];
      if (!row) throw new NotFoundError('That procurement request was not found.');
      if (row.timing_change_pending_ack) {
        throw new ConflictError(
          'Payment timing has changed. ED Finance must acknowledge the decision before money can move.',
        );
      }
      if (row.status !== 'FUNDING_PENDING' || row.funding_route !== 'corporate_allocation') {
        throw new ConflictError('A funding transfer can only be recorded for route C while funding is pending.');
      }
      const authorized = Number(row.authorized_amount_kobo ?? 0);
      if (input.amountKobo !== authorized) {
        throw new ValidationFailedError('The transfer amount must equal the authorized amount.');
      }
      const accounts = await this.loadAccounts(tx, [input.sourceAccountId, input.destinationAccountId]);
      const source = accounts.get(input.sourceAccountId);
      const dest = accounts.get(input.destinationAccountId);
      if (!source || !dest) throw new ValidationFailedError('Both bank accounts are required.');
      if (source.entity_code !== 'NFC') {
        throw new ValidationFailedError('Route C transfers must leave an NFC Holding account.');
      }
      if (dest.entity_id !== row.entity_id) {
        throw new ValidationFailedError('The destination account must belong to the requesting subsidiary.');
      }
      if (row.destination_account_id && row.destination_account_id !== dest.id) {
        throw new ValidationFailedError('The destination account does not match the funding decision.');
      }

      const allocated = await tx.client.query<{ ref: string }>('SELECT app.next_reference($1, NULL) AS ref', [
        'TRF',
      ]);
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The transfer reference was not allocated.');

      let transferId: string | null = null;
      try {
        const inserted = await tx.client.query<{ id: string }>(
          `INSERT INTO funding_transfer_records (
             reference_number, request_id, entity_id, source_entity_id, source_account_id,
             destination_entity_id, destination_account_id, amount_kobo, purpose, transfer_date,
             transfer_method, bank_reference, proof_document_id, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING id`,
          [
            reference,
            row.id,
            row.entity_id,
            source.entity_id,
            source.id,
            dest.entity_id,
            dest.id,
            input.amountKobo,
            input.purpose.trim(),
            input.transferDate,
            input.transferMethod.trim(),
            input.bankReference.trim(),
            input.proofDocumentId,
            actor.ref,
          ],
        );
        transferId = inserted.rows[0]?.id ?? null;
      } catch (error) {
        const pg = error as { code?: string };
        if (pg.code === '23505') {
          throw new ConflictError('That bank reference has already been recorded on this account.');
        }
        throw error;
      }

      const nextStatus = row.final_payment_timing === 'after_delivery' ? 'AWAITING_DELIVERY' : 'AWAITING_PAYMENT';
      await tx.client.query(
        `UPDATE procurement_requests SET status = $1, updated_by = $2 WHERE id = $3`,
        [nextStatus, actor.ref, row.id],
      );
      if (this.intercompany && transferId) {
        await this.intercompany.createInTx(tx, actor, {
          type: 'funding_allocation',
          sourceEntityId: source.entity_id,
          destinationEntityId: dest.entity_id,
          sourceBankAccountId: source.id,
          destBankAccountId: dest.id,
          amountKobo: input.amountKobo,
          occurredOn: input.transferDate,
          narration: input.purpose.trim(),
          idempotencyKey: `trf:${transferId}`,
          fundingTransferId: transferId,
          existingReference: reference,
        });
      }
      await this.workflows.moveToFinanceHeadInTx(tx, actor, row.id);
      await tx.publish({
        eventType: 'procurement.funds_allocated',
        subjectType: 'PROCUREMENT',
        subjectId: row.id,
        entityId: row.entity_id,
        payload: {
          type: 'procurement.funds_allocated',
          reference: row.reference_number,
          title: row.title,
          recipientUserId: row.originator_user_id,
          href: `/procurement/${row.id}`,
        },
      });
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: row.id,
        text: `Finance recorded funding transfer ${reference}.`,
        href: `/procurement/${row.id}`,
        entityId: row.entity_id,
      });
      await tx.audit({
        action: 'transfer',
        subjectType: 'funding_transfer',
        subjectId: row.id,
        subjectLabel: row.title,
        subjectReferenceNumber: reference,
        entityId: row.entity_id,
        newValue: { amountKobo: input.amountKobo, bankReference: input.bankReference },
      });
      return this.procurement.getInTx(tx, actor, row.id);
    });
  }

  async completePayment(
    actor: ActorContext,
    requestId: string,
    input: {
      payingAccountId?: string;
      amountKobo?: number;
      method?: string;
      bankReference?: string;
      paymentDate?: string;
      proofDocumentId?: string | null;
      idempotencyKey: string;
    },
  ): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM procurement_payments WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) {
        return this.procurement.getInTx(tx, actor, requestId);
      }

      const request = await tx.client.query<{
        id: string;
        reference_number: string;
        entity_id: string;
        status: string;
        funding_route: string | null;
        authorized_amount_kobo: string | null;
        paying_account_id: string | null;
        vendor_id: string | null;
        current_version: number;
        version_id: string;
        title: string;
        originator_user_id: string;
        prepared_by_user_id: string | null;
        memo_json: unknown;
        timing_change_pending_ack: boolean;
      }>(
        `SELECT r.id, r.reference_number, r.entity_id, r.status, r.funding_route,
                r.authorized_amount_kobo::text, r.paying_account_id, r.vendor_id, r.current_version,
                r.originator_user_id, r.prepared_by_user_id, r.timing_change_pending_ack,
                v.id AS version_id, v.title, snap.canonical_json AS memo_json
           FROM procurement_requests r
           JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
           LEFT JOIN procurement_memo_snapshots snap ON snap.version_id = v.id
          WHERE r.id = $1
          FOR UPDATE OF r`,
        [requestId],
      );
      const row = request.rows[0];
      if (!row) throw new NotFoundError('That procurement request was not found.');
      if (row.timing_change_pending_ack) {
        throw new ConflictError(
          'Payment timing has changed. ED Finance must acknowledge the decision before money can move.',
        );
      }
      if (!PAYABLE_STATUSES.includes(row.status as (typeof PAYABLE_STATUSES)[number])) {
        throw new ConflictError('This request is not awaiting payment.');
      }
      if (!row.vendor_id) throw new ValidationFailedError('A vendor is required to record payment.');
      const authorized = Number(row.authorized_amount_kobo ?? 0);
      if (authorized <= 0) throw new ValidationFailedError('There is no authorized amount to pay.');
      const beforePay = await loadPaymentEligibility(tx, row.id);
      if (beforePay.payableKobo <= 0) {
        throw new ConflictError(
          beforePay.timing === 'after_delivery' && beforePay.acceptedValueKobo <= 0
            ? 'Record accepted delivery before paying the vendor.'
            : 'There is no remaining amount payable on this request.',
        );
      }
      const amountKobo = input.amountKobo ?? beforePay.payableKobo;
      if (amountKobo <= 0 || amountKobo > beforePay.payableKobo) {
        throw new ValidationFailedError(
          `The payment amount must be between 1 and ${beforePay.payableKobo} kobo.`,
        );
      }

      const route = row.funding_route;
      if (route === 'nfc_holding') {
        assertCan(actor, 'finance.payment.execute.corporate');
      } else {
        assertCan(actor, 'finance.payment.execute', row.entity_id);
        if (actor.isCorporate || !actor.entityIds.includes(row.entity_id)) {
          throw new ForbiddenError('You can only pay a procurement for your own subsidiary.');
        }
      }

      await this.vendors.assertSelectableInTx(tx, actor, row.vendor_id, 'payment');

      const payingAccountId = await this.resolvePayingAccountId(tx, {
        requestedId: input.payingAccountId,
        fundingPayingAccountId: row.paying_account_id,
        route,
        entityId: row.entity_id,
      });
      const account = await tx.client.query<{
        id: string;
        entity_id: string;
        entity_code: string;
        name: string;
      }>(
        `SELECT a.id, a.entity_id, e.code AS entity_code, a.name
           FROM entity_bank_accounts a
           JOIN entities e ON e.id = a.entity_id
          WHERE a.id = $1 AND a.status = 'ACTIVE'`,
        [payingAccountId],
      );
      const paying = account.rows[0];
      if (!paying) throw new ValidationFailedError('The paying account was not found or is inactive.');
      if (route === 'nfc_holding' && paying.entity_code !== 'NFC') {
        throw new ValidationFailedError('Route B must be paid from an NFC Holding account.');
      }
      if (route !== 'nfc_holding' && paying.entity_id !== row.entity_id) {
        throw new ValidationFailedError('The paying account must belong to the requesting subsidiary.');
      }
      if (row.paying_account_id && row.paying_account_id !== paying.id && route !== 'corporate_allocation') {
        throw new ValidationFailedError('The paying account does not match the funding decision.');
      }

      const allocated = await tx.client.query<{ ref: string }>('SELECT app.next_reference($1, NULL) AS ref', [
        'PAY',
      ]);
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The payment reference was not allocated.');
      const method = input.method?.trim() || 'bank_transfer';
      const bankReference = input.bankReference?.trim() || reference;
      const paymentDate = input.paymentDate || formatLagosIsoDate(new Date());
      const proofDocumentId = input.proofDocumentId ?? null;

      let paymentId: string | null = null;
      try {
        const inserted = await tx.client.query<{ id: string }>(
          `INSERT INTO procurement_payments (
             reference_number, request_id, version_id, entity_id, vendor_id, paying_account_id,
             amount_kobo, method, bank_reference, payment_date, proof_document_id, status,
             idempotency_key, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'COMPLETED', $12, $13, $13)
           RETURNING id`,
          [
            reference,
            row.id,
            row.version_id,
            row.entity_id,
            row.vendor_id,
            paying.id,
            amountKobo,
            method,
            bankReference,
            paymentDate,
            proofDocumentId,
            input.idempotencyKey,
            actor.ref,
          ],
        );
        paymentId = inserted.rows[0]?.id ?? null;
      } catch (error) {
        const pg = error as { code?: string };
        if (pg.code === '23505') {
          throw new ConflictError('That bank reference has already been recorded on this account.');
        }
        throw error;
      }

      const afterPay = await loadPaymentEligibility(tx, row.id);
      const nextStatus = nextStatusAfterPayment(afterPay, row.status);
      if (this.ledger && paymentId) {
        const version = await tx.client.query<{ budget_line_id: string | null }>(
          `SELECT budget_line_id FROM procurement_versions WHERE id = $1`,
          [row.version_id],
        );
        await this.ledger.postProcurementPayment(tx, actor, {
          paymentId,
          requestId: row.id,
          entityId: paying.entity_id,
          vendorId: row.vendor_id,
          payingAccountId: paying.id,
          amountKobo,
          occurredOn: paymentDate,
          narration: `Vendor payment ${reference}`,
          budgetLineId: version.rows[0]?.budget_line_id ?? null,
        });
        await this.payables?.markPaidFromProcurementInTx(tx, actor, {
          entityId: row.entity_id,
          vendorId: row.vendor_id,
          requestId: row.id,
          amountKobo,
          invoiceDate: paymentDate,
          dueDate: paymentDate,
          narration: `Procurement ${row.reference_number}`,
        });
      }
      const requestCompleted = nextStatus === 'COMPLETED';
      await this.workflows.completePaymentInTx(tx, actor, {
        requestId: row.id,
        paymentRef: reference,
        snapshot: row.memo_json ?? { reference: row.reference_number, amountKobo },
        paymentSettled: afterPay.paymentComplete,
        requestCompleted,
      });
      const outstandingKobo = Math.max(afterPay.obligationKobo - afterPay.paidKobo, 0);
      // Pay-before-delivery: ask the Procurement Manager to verify each item; the GM gets a copy.
      if (nextStatus === 'AWAITING_DELIVERY' || nextStatus === 'PARTIALLY_RECEIVED') {
        const managers = await deliveryVerificationRecipients(tx.client, {
          entityId: row.entity_id,
          preparedByUserId: row.prepared_by_user_id,
        });
        const recipients = new Set(managers);
        if (row.originator_user_id) recipients.add(row.originator_user_id);
        for (const recipientUserId of recipients) {
          await tx.publish({
            eventType: 'procurement.paid',
            subjectType: 'PROCUREMENT',
            subjectId: row.id,
            entityId: row.entity_id,
            payload: {
              type: 'procurement.paid',
              reference: row.reference_number,
              title: row.title,
              recipientUserId,
              href: `/procurement/${row.id}?payment=${reference}`,
              summary: `Paid ${afterPay.paidKobo} of ${afterPay.authorizedKobo}; outstanding ${outstandingKobo}.`,
              authorizedKobo: afterPay.authorizedKobo,
              paidKobo: afterPay.paidKobo,
              outstandingKobo,
            },
          });
        }
      }
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: row.id,
        text: `Finance Head paid vendor ${reference}.`,
        href: `/procurement/${row.id}`,
        entityId: row.entity_id,
      });
      if (proofDocumentId) {
        await tx.appendTimeline({
          subjectType: 'PROCUREMENT',
          subjectId: row.id,
          text: 'Payment proof uploaded.',
          href: `/procurement/${row.id}`,
          entityId: row.entity_id,
        });
      }
      await tx.audit({
        action: 'payment',
        subjectType: 'procurement_payment',
        subjectId: row.id,
        subjectLabel: row.title,
        subjectReferenceNumber: reference,
        entityId: row.entity_id,
        newValue: { amountKobo, bankReference },
      });
      if (paymentId) {
        await tx.indexSearch({
          recordType: 'PAYMENT',
          recordId: paymentId,
          referenceNumber: reference,
          title: row.title,
          searchableText: `${reference} ${row.reference_number} ${row.title} ${amountKobo} ${bankReference}`,
          entityId: row.entity_id,
          permissionKey: 'procurement.view',
        });
      }
      if (nextStatus === 'COMPLETED' && this.delivery) {
        await this.delivery.completeInTx(tx, actor, row.id, { skipPermission: true });
      } else if (nextStatus !== row.status) {
        await tx.client.query(`UPDATE procurement_requests SET status = $1, updated_by = $2 WHERE id = $3`, [
          nextStatus,
          actor.ref,
          row.id,
        ]);
      }
      return this.procurement.getInTx(tx, actor, row.id);
    });
  }

  async requestReversal(actor: ActorContext, paymentId: string, reason: string): Promise<ProcurementView> {
    if (!reason.trim()) throw new ReasonRequiredError('payment correction');
    return this.unitOfWork.write(actor, async (tx) => {
      const payment = await this.lockPayment(tx, paymentId);
      assertCan(actor, 'finance.payment.reverse.request', payment.entity_id);
      if (payment.reversed_at) throw new ConflictError('This payment has already been reversed.');
      const pending = await tx.client.query<{ id: string }>(
        `SELECT id FROM procurement_payment_reversals WHERE payment_id = $1 AND status = 'PENDING'`,
        [paymentId],
      );
      if (pending.rows[0]) throw new ConflictError('A correction is already awaiting approval.');
      await tx.client.query(
        `INSERT INTO procurement_payment_reversals (
           payment_id, request_id, entity_id, reason, requested_by, created_by
         ) VALUES ($1, $2, $3, $4, $5, $5)`,
        [paymentId, payment.request_id, payment.entity_id, reason.trim(), actor.ref],
      );
      await tx.audit({
        action: 'payment',
        subjectType: 'procurement_payment',
        subjectId: payment.request_id,
        subjectLabel: payment.reference_number,
        subjectReferenceNumber: payment.reference_number,
        entityId: payment.entity_id,
        reason: reason.trim(),
        newValue: { reversal: 'requested' },
      });
      return this.procurement.getInTx(tx, actor, payment.request_id);
    });
  }

  async approveReversal(actor: ActorContext, paymentId: string, reason?: string): Promise<ProcurementView> {
    assertCan(actor, 'finance.payment.reverse.approve');
    return this.unitOfWork.write(actor, async (tx) => {
      const payment = await this.lockPayment(tx, paymentId);
      const pending = await tx.client.query<{ id: string; reason: string }>(
        `SELECT id, reason FROM procurement_payment_reversals
          WHERE payment_id = $1 AND status = 'PENDING'
          ORDER BY created_at DESC LIMIT 1`,
        [paymentId],
      );
      const reversal = pending.rows[0];
      if (!reversal) throw new ConflictError('There is no pending correction to approve.');
      await tx.client.query(
        `UPDATE procurement_payments
            SET reversed_at = now(), updated_by = $1
          WHERE id = $2`,
        [actor.ref, paymentId],
      );
      await tx.client.query(
        `UPDATE procurement_requests SET status = 'AWAITING_PAYMENT', updated_by = $1 WHERE id = $2`,
        [actor.ref, payment.request_id],
      );
      if (this.ledger) {
        const extras = await tx.client.query<{
          paying_account_id: string;
          amount_kobo: string;
          payment_date: Date;
          budget_line_id: string | null;
        }>(
          `SELECT p.paying_account_id, p.amount_kobo::text, p.payment_date, v.budget_line_id
             FROM procurement_payments p
             JOIN procurement_versions v ON v.id = p.version_id
            WHERE p.id = $1`,
          [paymentId],
        );
        const extra = extras.rows[0];
        if (extra) {
          await this.ledger.reverseProcurementPayment(tx, actor, {
            paymentId,
            requestId: payment.request_id,
            entityId: payment.entity_id,
            payingAccountId: extra.paying_account_id,
            amountKobo: Number(extra.amount_kobo),
            occurredOn: extra.payment_date.toISOString().slice(0, 10),
            reason: (reason ?? reversal.reason).trim(),
            budgetLineId: extra.budget_line_id,
          });
        }
      }
      await tx.client.query(
        `INSERT INTO procurement_payment_reversals (
           payment_id, request_id, entity_id, reason, requested_by, approved_by, approved_at,
           status, created_by
         ) VALUES ($1, $2, $3, $4, $5, $5, now(), 'APPROVED', $5)`,
        [
          paymentId,
          payment.request_id,
          payment.entity_id,
          (reason ?? reversal.reason).trim(),
          actor.ref,
        ],
      );
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: payment.request_id,
        text: `Payment ${payment.reference_number} reversed. A replacement payment may now be recorded.`,
        href: `/procurement/${payment.request_id}`,
        entityId: payment.entity_id,
      });
      await tx.audit({
        action: 'payment',
        subjectType: 'procurement_payment',
        subjectId: payment.request_id,
        subjectLabel: payment.reference_number,
        subjectReferenceNumber: payment.reference_number,
        entityId: payment.entity_id,
        reason: (reason ?? reversal.reason).trim(),
        oldValue: { status: 'COMPLETED' },
        newValue: { status: 'REVERSED' },
      });
      return this.procurement.getInTx(tx, actor, payment.request_id);
    });
  }

  private async resolvePayingAccountId(
    tx: TxScope,
    input: {
      requestedId?: string;
      fundingPayingAccountId: string | null;
      route: string | null;
      entityId: string;
    },
  ): Promise<string> {
    if (input.requestedId) return input.requestedId;
    if (input.fundingPayingAccountId) return input.fundingPayingAccountId;
    const eligible = await tx.client.query<{ id: string }>(
      `SELECT a.id
         FROM entity_bank_accounts a
         JOIN entities e ON e.id = a.entity_id
        WHERE a.status = 'ACTIVE'
          AND CASE
                WHEN $1 = 'nfc_holding' THEN e.code = 'NFC'
                ELSE a.entity_id = $2
              END
        ORDER BY a.created_at`,
      [input.route, input.entityId],
    );
    if (eligible.rows.length === 1) return eligible.rows[0]!.id;
    if (eligible.rows.length === 0) {
      throw new ValidationFailedError('No eligible paying account is available.');
    }
    throw new ValidationFailedError('Choose a paying account.');
  }

  private async lockPayment(
    tx: TxScope,
    paymentId: string,
  ): Promise<{
    id: string;
    request_id: string;
    entity_id: string;
    reference_number: string;
    reversed_at: Date | null;
  }> {
    const result = await tx.client.query<{
      id: string;
      request_id: string;
      entity_id: string;
      reference_number: string;
      reversed_at: Date | null;
    }>(
      `SELECT id, request_id, entity_id, reference_number, reversed_at
         FROM procurement_payments WHERE id = $1 FOR UPDATE`,
      [paymentId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That payment was not found.');
    return row;
  }

  private async loadAccounts(
    tx: TxScope,
    ids: string[],
  ): Promise<Map<string, { id: string; entity_id: string; entity_code: string }>> {
    const result = await tx.client.query<{ id: string; entity_id: string; entity_code: string }>(
      `SELECT a.id, a.entity_id, e.code AS entity_code
         FROM entity_bank_accounts a
         JOIN entities e ON e.id = a.entity_id
        WHERE a.id = ANY($1::uuid[]) AND a.status = 'ACTIVE'`,
      [ids],
    );
    return new Map(result.rows.map((row) => [row.id, row]));
  }
}

export type { FundingTransferView, ProcurementPaymentView };
