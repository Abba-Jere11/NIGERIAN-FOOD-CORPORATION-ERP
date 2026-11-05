import { createHash } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { ProcurementDocumentAccessView, ProcurementReportsView, ProcurementView } from '@nfc/shared';
import { formatLagosIsoDate } from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import { DocumentsService } from '../documents/documents.service';
import { LedgerPostingService } from '../finance/ledger-posting.service';
import { InventoryService } from '../inventory/inventory.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { deliveryVerificationRecipients } from './notify-targets';
import { loadPaymentEligibility, nextStatusAfterPayment } from './payment-eligibility';
import { renderProcurementRecordPdf } from './record-pdf';
import { ProcurementService } from './procurement.service';
import { zipStore } from './zip-store';

const DELIVERY_STATUSES = ['AWAITING_DELIVERY', 'PARTIALLY_RECEIVED'] as const;

export interface RecordReceiptInput {
  receivedDate: string;
  location: string;
  lineId?: string;
  quantityReceived: number;
  quantityAccepted: number;
  quantityRejected?: number;
  rejectReason?: string;
  conditionNotes?: string;
  secondBatchDueOn?: string;
  idempotencyKey: string;
  documents: Array<{ documentId: string; kind: string }>;
  warehouseId?: string;
  batchCode?: string;
  serialCodes?: string[];
}

export interface DeliveryItemInput {
  lineId: string;
  quantityReceived: number;
  quantityAccepted: number;
  quantityRejected: number;
  rejectReason?: string;
  conditionNotes?: string;
  secondBatchDueOn?: string;
  batchCode?: string;
  serialCodes?: string[];
}

export interface RecordDeliveryInput {
  receivedDate: string;
  location: string;
  documentKind: string;
  notes?: string;
  warehouseId?: string;
  idempotencyKey: string;
  documents: Array<{ documentId: string; kind: string }>;
  items: DeliveryItemInput[];
}

interface LockedLine {
  id: string;
  line_number: number;
  quantity: number;
  unit_price_kobo: number;
}

interface LockedRequest {
  id: string;
  reference_number: string;
  entity_id: string;
  status: string;
  originator_user_id: string;
  version_id: string;
  current_version: number;
  title: string;
  quantity: number;
  unit_price_kobo: number;
  close_short_id: string | null;
  memo_json: unknown;
  required_docs: string[];
  category_key: string | null;
  lines: LockedLine[];
}

@Injectable()
export class DeliveryService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly procurement: ProcurementService,
    private readonly workflows: WorkflowsService,
    private readonly documents: DocumentsService,
    @Optional() private readonly ledger?: LedgerPostingService,
    @Optional() private readonly inventory?: InventoryService,
  ) {}

  async recordDeliveryNote(actor: ActorContext, requestId: string, note: string): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const row = await this.lockRequest(tx, actor, requestId, 'procurement.verify.delivery');
      if (row.status !== 'AWAITING_DELIVERY') {
        throw new ConflictError('A “not received” note can only be recorded while awaiting delivery.');
      }
      const trimmed = note.trim();
      if (!trimmed) throw new ValidationFailedError('A note is required when delivery has not been received.');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO procurement_delivery_notes (
           request_id, version_id, entity_id, note, next_reminder_at, created_by
         ) VALUES ($1, $2, $3, $4, now() + interval '2 days', $5)
         RETURNING id`,
        [row.id, row.version_id, row.entity_id, trimmed, actor.ref],
      );
      await tx.audit({
        action: 'create',
        subjectType: 'PROCUREMENT',
        subjectId: row.id,
        subjectLabel: row.title,
        subjectReferenceNumber: row.reference_number,
        entityId: row.entity_id,
        reason: trimmed,
        newValue: { kind: 'delivery_note', id: inserted.rows[0]?.id },
      });
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: row.id,
        text: `Delivery has not been received. ${trimmed}`,
        href: `/procurement/${row.id}`,
        entityId: row.entity_id,
      });
      return this.procurement.getInTx(tx, actor, requestId);
    });
  }

  /**
   * Records one delivery: the shared details once and a verification for each
   * item on it. Items with nothing received are skipped.
   */
  async recordDelivery(actor: ActorContext, requestId: string, input: RecordDeliveryInput): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const replayed = await this.replayedRequest(tx, input.idempotencyKey);
      if (replayed) return this.procurement.getInTx(tx, actor, replayed);
      const row = await this.lockRequest(tx, actor, requestId, 'procurement.grn.record');
      return this.recordDeliveryInTx(tx, actor, row, input, { strictSplit: true });
    });
  }

  /** Single-line receipt, kept for API callers that record one item at a time. */
  async recordReceipt(
    actor: ActorContext,
    requestId: string,
    input: RecordReceiptInput,
  ): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const replayed = await this.replayedRequest(tx, input.idempotencyKey);
      if (replayed) return this.procurement.getInTx(tx, actor, replayed);
      const row = await this.lockRequest(tx, actor, requestId, 'procurement.grn.record');
      const line = this.resolveReceiptLine(row.lines, input.lineId);
      return this.recordDeliveryInTx(
        tx,
        actor,
        row,
        {
          receivedDate: input.receivedDate,
          location: input.location,
          documentKind: input.documents[0]?.kind ?? 'goods_received_note',
          warehouseId: input.warehouseId,
          idempotencyKey: input.idempotencyKey,
          documents: input.documents,
          items: [
            {
              lineId: line.id,
              quantityReceived: input.quantityReceived,
              quantityAccepted: input.quantityAccepted,
              quantityRejected: input.quantityRejected ?? 0,
              rejectReason: input.rejectReason,
              conditionNotes: input.conditionNotes,
              secondBatchDueOn: input.secondBatchDueOn,
              batchCode: input.batchCode,
              serialCodes: input.serialCodes,
            },
          ],
        },
        { strictSplit: false },
      );
    });
  }

  private async replayedRequest(tx: TxScope, idempotencyKey: string): Promise<string | null> {
    const existing = await tx.client.query<{ request_id: string }>(
      `SELECT request_id FROM procurement_deliveries WHERE idempotency_key = $1
       UNION ALL
       SELECT request_id FROM procurement_goods_receipts WHERE idempotency_key = $1
       LIMIT 1`,
      [idempotencyKey],
    );
    return existing.rows[0]?.request_id ?? null;
  }

  private async recordDeliveryInTx(
    tx: TxScope,
    actor: ActorContext,
    row: LockedRequest,
    input: RecordDeliveryInput,
    opts: { strictSplit: boolean },
  ): Promise<ProcurementView> {
    if (!DELIVERY_STATUSES.includes(row.status as (typeof DELIVERY_STATUSES)[number])) {
      throw new ConflictError('A receipt can only be recorded while awaiting delivery.');
    }
    const eligibility = await loadPaymentEligibility(tx, row.id);
    if (eligibility.timing !== 'after_delivery' && !eligibility.paymentComplete) {
      throw new ConflictError('A receipt can only be recorded after payment, before completion.');
    }
    await this.assertVendorReadable(tx, row.id);

    const seen = new Set<string>();
    const items: Array<{ input: DeliveryItemInput; line: LockedLine; acceptedBefore: number }> = [];
    for (const item of input.items) {
      const line = row.lines.find((candidate) => candidate.id === item.lineId);
      if (!line?.id) throw new ValidationFailedError('An item on this delivery does not belong to this request.');
      if (seen.has(line.id)) throw new ValidationFailedError(`Item ${line.line_number} appears twice on this delivery.`);
      seen.add(line.id);
      const label = `Item ${line.line_number}`;
      if (item.quantityAccepted < 0 || item.quantityReceived < 0 || item.quantityRejected < 0) {
        throw new ValidationFailedError(`${label}: quantities cannot be negative.`);
      }
      if (item.quantityReceived === 0 && item.quantityAccepted === 0 && item.quantityRejected === 0) continue;
      if (opts.strictSplit && item.quantityAccepted + item.quantityRejected !== item.quantityReceived) {
        throw new ValidationFailedError(`${label}: accepted plus rejected must equal the quantity received.`);
      }
      if (item.quantityAccepted + item.quantityRejected > item.quantityReceived) {
        throw new ValidationFailedError(
          input.items.length === 1
            ? 'Accepted plus rejected cannot exceed received.'
            : `${label}: accepted plus rejected cannot exceed received.`,
        );
      }
      if (item.quantityRejected > 0 && !item.rejectReason?.trim()) {
        throw new ValidationFailedError(
          input.items.length === 1
            ? 'A reason is required when any quantity is rejected.'
            : `${label}: a reason is required when any quantity is rejected.`,
        );
      }
      const acceptedBefore = await this.acceptedOnLine(tx, row.id, line.id);
      if (item.quantityAccepted + acceptedBefore > line.quantity) {
        throw new ValidationFailedError(
          input.items.length === 1
            ? 'Accepted quantity exceeds outstanding on this line.'
            : `${label}: accepted quantity exceeds the ${Math.max(line.quantity - acceptedBefore, 0)} still outstanding.`,
        );
      }
      items.push({ input: item, line, acceptedBefore });
    }
    if (items.length === 0) {
      throw new ValidationFailedError('Enter the quantity received for at least one item.');
    }

    const deliveryRef = await this.nextReference(tx, 'DEL');
    const delivery = await tx.client.query<{ id: string }>(
      `INSERT INTO procurement_deliveries (
         reference_number, request_id, version_id, entity_id, received_date, location,
         document_kind, notes, warehouse_id, idempotency_key, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        deliveryRef,
        row.id,
        row.version_id,
        row.entity_id,
        input.receivedDate,
        input.location.trim(),
        input.documentKind.trim(),
        input.notes?.trim() || null,
        input.warehouseId ?? null,
        input.idempotencyKey,
        actor.ref,
      ],
    );
    const deliveryId = delivery.rows[0]?.id;
    if (!deliveryId) throw new Error('The delivery was not recorded.');
    for (const doc of input.documents) {
      await tx.client.query(
        `INSERT INTO procurement_receipt_documents (
           entity_id, request_id, delivery_id, document_id, kind, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.entity_id, row.id, deliveryId, doc.documentId, doc.kind, actor.ref],
      );
    }

    const summaries: string[] = [];
    for (const { input: item, line, acceptedBefore } of items) {
      if (item.quantityAccepted + acceptedBefore < line.quantity) {
        await this.ensureShortageDeadline(tx, actor, {
          requestId: row.id,
          lineId: line.id,
          entityId: row.entity_id,
          dueOn: item.secondBatchDueOn,
          label: input.items.length > 1 ? `Item ${line.line_number}` : null,
        });
      }
      const reference = await this.nextReference(tx, 'GRN');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO procurement_goods_receipts (
           reference_number, request_id, version_id, entity_id, line_id, delivery_id, received_date, location,
           quantity_ordered, quantity_received, quantity_accepted, quantity_rejected,
           reject_reason, condition_notes, idempotency_key, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id`,
        [
          reference,
          row.id,
          row.version_id,
          row.entity_id,
          line.id,
          deliveryId,
          input.receivedDate,
          input.location.trim(),
          line.quantity,
          item.quantityReceived,
          item.quantityAccepted,
          item.quantityRejected,
          item.rejectReason?.trim() || null,
          item.conditionNotes?.trim() || null,
          `${input.idempotencyKey}:${line.line_number}`,
          actor.ref,
        ],
      );
      const grnId = inserted.rows[0]?.id;
      if (!grnId) throw new Error('The GRN was not recorded.');
      await this.inventory?.applyReceiptInTx(tx, actor, {
        grnId,
        warehouseId: input.warehouseId ?? null,
        batchCode: item.batchCode ?? null,
        serialCodes: item.serialCodes,
      });
      await tx.indexSearch({
        recordType: 'GRN',
        recordId: grnId,
        referenceNumber: reference,
        title: row.title,
        searchableText: `${reference} ${deliveryRef} ${row.reference_number} ${row.title}`,
        entityId: row.entity_id,
        permissionKey: 'procurement.view',
      });
      await tx.publish({
        eventType: 'goods.received',
        subjectType: 'PROCUREMENT',
        subjectId: row.id,
        entityId: row.entity_id,
        payload: {
          type: 'goods.received',
          reference: row.reference_number,
          grn: reference,
          grnId,
          deliveryId,
          lineId: line.id,
          quantityAccepted: String(item.quantityAccepted),
          quantityRejected: String(item.quantityRejected),
          warehouseId: input.warehouseId ?? null,
          batchCode: item.batchCode ?? null,
          serialCodes: item.serialCodes ?? [],
          title: row.title,
          recipientUserId: row.originator_user_id,
          href: `/procurement/${row.id}#delivery`,
        },
      });
      summaries.push(
        `item ${line.line_number} accepted ${item.quantityAccepted} of ${line.quantity}` +
          (item.quantityRejected > 0 ? ` (${item.quantityRejected} rejected)` : ''),
      );
    }

    const accepted = await this.acceptedTotal(tx, row.id);
    const progress = await this.lineProgress(tx, row.id, row.lines);
    await tx.client.query(
      `UPDATE procurement_requests SET accepted_quantity_total = $1, updated_by = $2 WHERE id = $3`,
      [accepted, actor.ref, row.id],
    );
    if (progress.anyAccepted && progress.anyOutstanding) {
      await tx.client.query(`UPDATE procurement_requests SET status = 'PARTIALLY_RECEIVED', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        row.id,
      ]);
    }
    await tx.appendTimeline({
      subjectType: 'PROCUREMENT',
      subjectId: row.id,
      text: `Delivery ${deliveryRef} verified: ${summaries.join('; ')}.`,
      href: `/procurement/${row.id}#delivery`,
      entityId: row.entity_id,
    });
    await tx.audit({
      action: 'create',
      subjectType: 'PROCUREMENT',
      subjectId: row.id,
      subjectLabel: row.title,
      subjectReferenceNumber: deliveryRef,
      entityId: row.entity_id,
      newValue: {
        delivery: deliveryRef,
        items: items.map(({ input: item, line }) => ({
          line: line.line_number,
          received: item.quantityReceived,
          accepted: item.quantityAccepted,
          rejected: item.quantityRejected,
        })),
      },
    });
    if (!progress.anyOutstanding) {
      const missing = await this.missingRequiredDocs(tx, row);
      if (missing.length > 0) {
        throw new ValidationFailedError(`Attach one of: ${missing.join(', ')}.`);
      }
      const afterReceipt = await loadPaymentEligibility(tx, row.id);
      if (afterReceipt.paymentComplete) {
        return this.completeInTx(tx, actor, row.id, { skipPermission: true });
      }
      const nextStatus = nextStatusAfterPayment(afterReceipt, row.status);
      await tx.client.query(`UPDATE procurement_requests SET status = $1, updated_by = $2 WHERE id = $3`, [
        nextStatus,
        actor.ref,
        row.id,
      ]);
      await this.workflows.activatePaymentStageInTx(tx, actor, row.id);
    }
    return this.procurement.getInTx(tx, actor, row.id);
  }

  private async nextReference(tx: TxScope, kind: 'GRN' | 'DEL'): Promise<string> {
    const allocated = await tx.client.query<{ ref: string }>('SELECT app.next_reference($1, NULL) AS ref', [kind]);
    const reference = allocated.rows[0]?.ref;
    if (!reference) throw new Error(`The ${kind} reference was not allocated.`);
    return reference;
  }

  async supersedeReceipt(
    actor: ActorContext,
    requestId: string,
    grnId: string,
    input: RecordReceiptInput & { reason: string },
  ): Promise<ProcurementView> {
    if (!input.reason.trim()) throw new ValidationFailedError('A reason is required to correct a GRN.');
    return this.unitOfWork.write(actor, async (tx) => {
      const row = await this.lockRequest(tx, actor, requestId, 'procurement.grn.record');
      const original = await tx.client.query<{ id: string; line_id: string | null }>(
        `SELECT id, line_id FROM procurement_goods_receipts WHERE id = $1 AND request_id = $2`,
        [grnId, row.id],
      );
      if (!original.rows[0]) throw new NotFoundError('That goods received note was not found.');
      const line = this.resolveReceiptLine(row.lines, input.lineId ?? original.rows[0].line_id ?? undefined);
      const allocated = await tx.client.query<{ ref: string }>('SELECT app.next_reference($1, NULL) AS ref', [
        'GRN',
      ]);
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The GRN reference was not allocated.');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO procurement_goods_receipts (
           reference_number, request_id, version_id, entity_id, line_id, received_date, location,
           quantity_ordered, quantity_received, quantity_accepted, quantity_rejected,
           reject_reason, condition_notes, idempotency_key, supersedes_id, supersede_reason, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING id`,
        [
          reference,
          row.id,
          row.version_id,
          row.entity_id,
          line.id,
          input.receivedDate,
          input.location.trim(),
          line.quantity,
          input.quantityReceived,
          input.quantityAccepted,
          input.quantityRejected ?? 0,
          input.rejectReason?.trim() ?? null,
          input.conditionNotes?.trim() ?? null,
          input.idempotencyKey,
          grnId,
          input.reason.trim(),
          actor.ref,
        ],
      );
      const nextId = inserted.rows[0]?.id;
      if (!nextId) throw new Error('The correcting GRN was not recorded.');
      await this.inventory?.reverseReceiptInTx(tx, actor, grnId);
      await this.inventory?.applyReceiptInTx(tx, actor, {
        grnId: nextId,
        warehouseId: input.warehouseId ?? null,
        batchCode: input.batchCode ?? null,
        serialCodes: input.serialCodes,
      });
      for (const doc of input.documents) {
        await tx.client.query(
          `INSERT INTO procurement_receipt_documents (
             entity_id, request_id, grn_id, document_id, kind, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [row.entity_id, row.id, nextId, doc.documentId, doc.kind, actor.ref],
        );
      }
      const accepted = await this.acceptedTotal(tx, row.id);
      const progress = await this.lineProgress(tx, row.id, row.lines);
      const acceptedOnLine = await this.acceptedOnLine(tx, row.id, line.id);
      if (acceptedOnLine < line.quantity) {
        await this.ensureShortageDeadline(tx, actor, {
          requestId: row.id,
          lineId: line.id,
          entityId: row.entity_id,
          dueOn: input.secondBatchDueOn,
        });
      }
      await tx.client.query(
        `UPDATE procurement_requests SET accepted_quantity_total = $1, status = $2, updated_by = $3 WHERE id = $4`,
        [accepted, progress.anyOutstanding ? 'PARTIALLY_RECEIVED' : row.status, actor.ref, row.id],
      );
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: row.id,
        text: `GRN corrected with ${reference}. ${input.reason.trim()}`,
        href: `/procurement/${row.id}`,
        entityId: row.entity_id,
      });
      return this.procurement.getInTx(tx, actor, requestId);
    });
  }

  async requestCloseShort(actor: ActorContext, requestId: string, reason: string): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      return this.requestCloseShortInTx(tx, actor, requestId, reason);
    });
  }

  async overrideShortageDeadline(
    actor: ActorContext,
    requestId: string,
    input: { lineId: string; dueOn: string; reason: string },
  ): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const row = await this.lockRequest(tx, actor, requestId, 'procurement.shortage.override');
      const line = this.resolveReceiptLine(row.lines, input.lineId);
      const existing = await tx.client.query<{ due_on: Date }>(
        `SELECT due_on FROM procurement_shortage_deadlines WHERE line_id = $1`,
        [line.id],
      );
      if (!existing.rows[0]) {
        throw new ConflictError('There is no locked second-batch date on this line to correct.');
      }
      const reason = input.reason.trim();
      if (!reason) throw new ValidationFailedError('A reason is required to correct the second-batch date.');
      const previous = formatLagosIsoDate(existing.rows[0].due_on);
      const today = formatLagosIsoDate(new Date());
      if (input.dueOn < today) {
        throw new ValidationFailedError('The second-batch date cannot be in the past.');
      }
      await tx.client.query(
        `UPDATE procurement_shortage_deadlines
            SET due_on = $1, updated_by = $2
          WHERE line_id = $3`,
        [input.dueOn, actor.ref, line.id],
      );
      await tx.audit({
        action: 'edit',
        subjectType: 'PROCUREMENT',
        subjectId: row.id,
        subjectLabel: row.title,
        subjectReferenceNumber: row.reference_number,
        entityId: row.entity_id,
        reason,
        oldValue: { lineId: line.id, secondBatchDueOn: previous },
        newValue: { lineId: line.id, secondBatchDueOn: input.dueOn },
      });
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: row.id,
        text: `Second-batch date on line ${line.line_number} corrected from ${previous} to ${input.dueOn}. ${reason}`,
        href: `/procurement/${row.id}`,
        entityId: row.entity_id,
      });
      return this.procurement.getInTx(tx, actor, requestId);
    });
  }

  async startCloseShortForMissedDeadlines(actor: ActorContext, now: Date): Promise<number> {
    const today = formatLagosIsoDate(now);
    const due = await this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{ id: string }>(
        `SELECT r.id
           FROM procurement_requests r
          WHERE r.status = 'PARTIALLY_RECEIVED'
            AND NOT EXISTS (
              SELECT 1 FROM procurement_close_short_requests c
               WHERE c.request_id = r.id AND c.status = 'PENDING'
            )
            AND EXISTS (
              SELECT 1 FROM procurement_version_lines l
               JOIN procurement_versions v ON v.id = l.version_id
              WHERE v.request_id = r.id AND v.version_number = r.current_version
                AND COALESCE(l.quantity, 0) > COALESCE((
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
                ), 0)
            )
            AND NOT EXISTS (
              SELECT 1 FROM procurement_version_lines l
               JOIN procurement_versions v ON v.id = l.version_id
              WHERE v.request_id = r.id AND v.version_number = r.current_version
                AND COALESCE(l.quantity, 0) > COALESCE((
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
                ), 0)
                AND NOT EXISTS (
                  SELECT 1 FROM procurement_shortage_deadlines d
                   WHERE d.line_id = l.id AND d.due_on < $1::date
                )
            )`,
        [today],
      );
      return result.rows.map((row) => row.id);
    });
    let started = 0;
    for (const requestId of due) {
      try {
        await this.unitOfWork.write(actor, async (tx) => {
          await this.requestCloseShortInTx(tx, actor, requestId, 'Second-batch deadline missed.', {
            skipPermission: true,
          });
        });
        started += 1;
      } catch (error) {
        if (error instanceof ConflictError) continue;
        throw error;
      }
    }
    return started;
  }

  private async requestCloseShortInTx(
    tx: TxScope,
    actor: ActorContext,
    requestId: string,
    reason: string,
    opts?: { skipPermission?: boolean },
  ): Promise<ProcurementView> {
      const row = await this.lockRequest(tx, actor, requestId, 'procurement.close_short.request', opts);
      if (row.status !== 'PARTIALLY_RECEIVED') {
        throw new ConflictError('Close-short is only available while a remainder is outstanding.');
      }
      const progress = await this.lineProgress(tx, row.id, row.lines);
      const outstanding = progress.outstandingQuantity;
      if (outstanding <= 0) throw new ConflictError('There is no outstanding quantity to close.');
      const pending = await tx.client.query<{ id: string }>(
        `SELECT id FROM procurement_close_short_requests WHERE request_id = $1 AND status = 'PENDING'`,
        [row.id],
      );
      if (pending.rows[0]) throw new ConflictError('A close-short request is already awaiting approval.');
      const amount = progress.outstandingAmountKobo;
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO procurement_close_short_requests (
           request_id, entity_id, outstanding_quantity, outstanding_amount_kobo, reason, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING id`,
        [row.id, row.entity_id, outstanding, amount, reason.trim(), actor.ref],
      );
      const closeId = inserted.rows[0]?.id;
      if (!closeId) throw new Error('The close-short request was not created.');
      await tx.client.query(`UPDATE procurement_requests SET close_short_id = $1, updated_by = $2 WHERE id = $3`, [
        closeId,
        actor.ref,
        row.id,
      ]);
      const instance = await this.workflows.startCloseShortInTx(tx, actor, {
        closeShortId: closeId,
        requestId: row.id,
        snapshot: row.memo_json ?? { reference: row.reference_number },
      });
      await tx.client.query(
        `UPDATE procurement_close_short_requests SET workflow_instance_id = $1, updated_by = $2 WHERE id = $3`,
        [instance.id, actor.ref, closeId],
      );
      await tx.publish({
        eventType: 'procurement.close_short.requested',
        subjectType: 'PROCUREMENT',
        subjectId: row.id,
        entityId: row.entity_id,
        payload: {
          type: 'procurement.close_short.requested',
          reference: row.reference_number,
          title: row.title,
          href: `/procurement/${row.id}`,
        },
      });
      await tx.appendTimeline({
        subjectType: 'PROCUREMENT',
        subjectId: row.id,
        text: `Close-short requested for ${outstanding} outstanding units. ${reason.trim()}`,
        href: `/procurement/${row.id}`,
        entityId: row.entity_id,
      });
    return this.procurement.getInTx(tx, actor, requestId, { skipPermission: opts?.skipPermission });
  }

  async complete(actor: ActorContext, requestId: string): Promise<ProcurementView> {
    return this.unitOfWork.write(actor, async (tx) => this.completeInTx(tx, actor, requestId));
  }

  async completeInTx(
    tx: TxScope,
    actor: ActorContext,
    requestId: string,
    opts?: { skipPermission?: boolean },
  ): Promise<ProcurementView> {
    const row = await this.lockRequest(tx, actor, requestId, 'procurement.verify.delivery', opts);
    if (row.status === 'COMPLETED') return this.procurement.getInTx(tx, actor, requestId);
    const completable = ['AWAITING_DELIVERY', 'PARTIALLY_RECEIVED', 'AWAITING_PAYMENT'].includes(row.status);
    if (!completable) {
      throw new ConflictError('This request is not awaiting completion.');
    }
    const accepted = await this.acceptedTotal(tx, row.id);
    const eligibility = await loadPaymentEligibility(tx, row.id);
    if (!eligibility.deliveryComplete) {
      throw new ConflictError('Delivery is still outstanding. Record the remainder or close short.');
    }
    if (!eligibility.paymentComplete) {
      throw new ConflictError('Record the remaining payment before completing this request.');
    }
    const missing = await this.missingRequiredDocs(tx, row);
    if (missing.length > 0) {
      throw new ValidationFailedError(`Attach one of: ${missing.join(', ')}.`);
    }
    await tx.client.query(
      `UPDATE procurement_requests SET status = 'COMPLETED', accepted_quantity_total = $1, updated_by = $2 WHERE id = $3`,
      [accepted, actor.ref, row.id],
    );
    if (this.ledger) {
      const paid = await tx.client.query<{
        amount_kobo: string;
        vendor_id: string | null;
        budget_line_id: string | null;
      }>(
        `SELECT coalesce(sum(p.amount_kobo), 0)::text AS amount_kobo,
                (array_agg(p.vendor_id) FILTER (WHERE p.vendor_id IS NOT NULL))[1] AS vendor_id,
                (array_agg(v.budget_line_id) FILTER (WHERE v.budget_line_id IS NOT NULL))[1] AS budget_line_id
           FROM procurement_payments p
           JOIN procurement_versions v ON v.id = p.version_id
          WHERE p.request_id = $1 AND p.reversed_at IS NULL`,
        [row.id],
      );
      const payment = paid.rows[0];
      if (payment && Number(payment.amount_kobo) > 0) {
        let acceptedValueKobo = 0;
        for (const line of row.lines) {
          const acceptedQty = await this.acceptedOnLine(tx, row.id, line.id);
          acceptedValueKobo += acceptedQty * line.unit_price_kobo;
        }
        const reclassKobo = acceptedValueKobo > 0 ? acceptedValueKobo : Number(payment.amount_kobo);
        if (reclassKobo > 0) {
          await this.ledger.postProcurementReclass(tx, actor, {
            requestId: row.id,
            entityId: row.entity_id,
            vendorId: payment.vendor_id,
            categoryKey: row.category_key ?? 'services',
            amountKobo: reclassKobo,
            occurredOn: new Date().toISOString().slice(0, 10),
            narration: `Reclass ${row.reference_number} on completion`,
            budgetLineId: payment.budget_line_id,
          });
        }
      }
    }
    await this.workflows.completeVerificationInTx(tx, actor, {
      requestId: row.id,
      snapshot: row.memo_json ?? { reference: row.reference_number },
      subjectVersion: row.current_version,
    });
    await this.workflows.completeProcurementInstanceInTx(tx, actor, row.id);
    await tx.publish({
      eventType: 'procurement.completed',
      subjectType: 'PROCUREMENT',
      subjectId: row.id,
      entityId: row.entity_id,
      payload: {
        type: 'procurement.completed',
        reference: row.reference_number,
        title: row.title,
        recipientUserId: row.originator_user_id,
        href: `/procurement/${row.id}`,
      },
    });
    await tx.appendTimeline({
      subjectType: 'PROCUREMENT',
      subjectId: row.id,
      text: 'Procurement completed. Delivery verified.',
      href: `/procurement/${row.id}`,
      entityId: row.entity_id,
    });
    await tx.audit({
      action: 'approve',
      subjectType: 'PROCUREMENT',
      subjectId: row.id,
      subjectLabel: row.title,
      subjectReferenceNumber: row.reference_number,
      entityId: row.entity_id,
      newValue: { status: 'COMPLETED' },
    });
    return this.procurement.getInTx(tx, actor, requestId);
  }

  async reports(actor: ActorContext): Promise<ProcurementReportsView> {
    if (!can(actor, 'procurement.report.view')) {
      throw new ForbiddenError('Your role does not permit this action.', {
        permission: 'procurement.report.view',
      });
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const scoped = actor.isCorporate
        ? ''
        : `AND r.entity_id = ANY($1::uuid[])`;
      const params = actor.isCorporate ? [] : [actor.entityIds];
      const byStatus = await tx.client.query<{ key: string; count: string; amount: string }>(
        `SELECT r.status AS key, count(*)::text AS count,
                coalesce(sum(v.total_amount_kobo), 0)::text AS amount
           FROM procurement_requests r
           JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
          WHERE r.status <> 'DISCARDED' ${scoped}
          GROUP BY r.status`,
        params,
      );
      const bySubsidiary = await tx.client.query<{ key: string; count: string; amount: string }>(
        `SELECT e.code AS key, count(*)::text AS count,
                coalesce(sum(v.total_amount_kobo), 0)::text AS amount
           FROM procurement_requests r
           JOIN entities e ON e.id = r.entity_id
           JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
          WHERE r.status <> 'DISCARDED' ${scoped}
          GROUP BY e.code`,
        params,
      );
      const byVendor = await tx.client.query<{ key: string; count: string; amount: string }>(
        `SELECT coalesce(ven.legal_name, 'Unassigned') AS key, count(*)::text AS count,
                coalesce(sum(v.total_amount_kobo), 0)::text AS amount
           FROM procurement_requests r
           JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
           LEFT JOIN vendors ven ON ven.id = r.vendor_id
          WHERE r.status <> 'DISCARDED' ${scoped}
          GROUP BY ven.legal_name
          ORDER BY count(*) DESC
          LIMIT 20`,
        params,
      );
      const byCategory = await tx.client.query<{ key: string; count: string; amount: string }>(
        `SELECT coalesce(c.name, 'Unassigned') AS key, count(*)::text AS count,
                coalesce(sum(v.total_amount_kobo), 0)::text AS amount
           FROM procurement_requests r
           JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
           LEFT JOIN procurement_categories c ON c.id = v.category_id
          WHERE r.status <> 'DISCARDED' ${scoped}
          GROUP BY c.name`,
        params,
      );
      const ageing = await tx.client.query<{ key: string; count: string; amount: string }>(
        `SELECT CASE
                  WHEN age <= 2 THEN '0–2 days'
                  WHEN age <= 5 THEN '2–5 days'
                  WHEN age <= 7 THEN '5–7 days'
                  ELSE '7+ days'
                END AS key,
                count(*)::text AS count,
                coalesce(sum(amount), 0)::text AS amount
           FROM (
             SELECT extract(day FROM now() - r.updated_at) AS age, v.total_amount_kobo AS amount
               FROM procurement_requests r
               JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
              WHERE r.status IN (
                'AWAITING_OPERATIONS', 'AWAITING_MD', 'AWAITING_ED_FINANCE',
                'FUNDING_PENDING', 'AWAITING_PAYMENT', 'AWAITING_DELIVERY', 'PARTIALLY_RECEIVED'
              ) ${scoped}
           ) pending
          GROUP BY 1
          ORDER BY 1`,
        params,
      );
      const toRows = (rows: Array<{ key: string; count: string; amount: string }>) =>
        rows.map((row) => ({
          key: row.key,
          label: row.key,
          count: Number(row.count),
          amountKobo: Number(row.amount),
        }));
      return {
        byStatus: toRows(byStatus.rows),
        bySubsidiary: toRows(bySubsidiary.rows),
        byVendor: toRows(byVendor.rows),
        byCategory: toRows(byCategory.rows),
        ageing: toRows(ageing.rows),
      };
    });
  }

  async listDocuments(actor: ActorContext, requestId: string): Promise<ProcurementDocumentAccessView[]> {
    const view = await this.procurement.get(actor, requestId);
    if (!can(actor, 'document.view', view.entityId)) {
      throw new ForbiddenError('Your role does not permit this action.', { permission: 'document.view' });
    }
    return view.documents;
  }

  async recordPdf(actor: ActorContext, requestId: string): Promise<{ buffer: Buffer; filename: string }> {
    const view = await this.procurement.get(actor, requestId);
    assertCan(actor, 'procurement.package.download', view.entityId);
    const buffer = await renderProcurementRecordPdf(view);
    return { buffer, filename: `${view.referenceNumber}-record.pdf` };
  }

  async packageZip(actor: ActorContext, requestId: string): Promise<{ buffer: Buffer; filename: string }> {
    const view = await this.procurement.get(actor, requestId);
    assertCan(actor, 'procurement.package.download', view.entityId);
    const record = await renderProcurementRecordPdf(view);
    const files: Array<{ name: string; data: Buffer; sha256: string }> = [
      {
        name: '00-procurement-record.pdf',
        data: record,
        sha256: createHash('sha256').update(record).digest('hex'),
      },
    ];
    const workflow = view.workflowInstanceId
      ? await this.workflows.get(actor, view.workflowInstanceId).catch(() => null)
      : null;
    const closeShortWorkflow = view.closeShort?.workflowInstanceId
      ? await this.workflows.get(actor, view.closeShort.workflowInstanceId).catch(() => null)
      : null;
    const seals = [...(workflow?.seals ?? []), ...(closeShortWorkflow?.seals ?? [])];
    for (const doc of view.documents) {
      try {
        const streamed = await this.documents.streamForActor(actor, doc.documentId);
        files.push({
          name: `documents/${doc.referenceNumber}-${doc.title.replaceAll(/[^\w.-]+/g, '_')}`,
          data: streamed.buffer,
          sha256: createHash('sha256').update(streamed.buffer).digest('hex'),
        });
      } catch {
        files.push({
          name: `documents/${doc.referenceNumber}-UNAVAILABLE.txt`,
          data: Buffer.from('The file could not be decrypted for this package.'),
          sha256: '',
        });
      }
    }
    if (view.closeShort?.vendorOpenClaim) {
      const claimPayload = {
        requestReference: view.referenceNumber,
        closeShortReference: view.closeShort.referenceNumber,
        quantity: view.closeShort.vendorOpenClaim.quantity,
        amountKobo: view.closeShort.vendorOpenClaim.amountKobo,
        reason: view.closeShort.vendorOpenClaim.reason,
      };
      const claimBuf = Buffer.from(JSON.stringify(claimPayload, null, 2));
      files.push({
        name: 'vendor-open-claim.json',
        data: claimBuf,
        sha256: createHash('sha256').update(claimBuf).digest('hex'),
      });
    }
    const manifest = {
      reference: view.referenceNumber,
      generatedAt: new Date().toISOString(),
      seals: seals.map((seal) => ({
        action: seal.action,
        verification: seal.verification,
        referenceNumber: seal.referenceNumber,
      })),
      closeShort: view.closeShort
        ? {
            referenceNumber: view.closeShort.referenceNumber,
            status: view.closeShort.status,
            outstandingQuantity: view.closeShort.outstandingQuantity,
            outstandingAmountKobo: view.closeShort.outstandingAmountKobo,
            requestReason: view.closeShort.reason,
            decisions: view.closeShort.approvals.map((item) => ({
              stageLabel: item.stageLabel,
              action: item.action,
              actorName: item.actorName,
              occurredAt: item.occurredAt,
              reason: item.reason,
            })),
            vendorOpenClaim: view.closeShort.vendorOpenClaim,
          }
        : null,
      files: files.map((file) => ({ name: file.name, sha256: file.sha256 })),
    };
    const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2));
    files.push({
      name: 'manifest.json',
      data: manifestBuf,
      sha256: createHash('sha256').update(manifestBuf).digest('hex'),
    });
    return {
      buffer: zipStore(files.map((file) => ({ name: file.name, data: file.data }))),
      filename: `${view.referenceNumber}-package.zip`,
    };
  }

  async dispatchDeliveryReminders(now = new Date()): Promise<number> {
    const actor = {
      ref: 'system:escalation',
      name: 'Delivery reminder',
      role: 'administrator' as const,
      scopeType: 'CORPORATE' as const,
      entityIds: [] as string[],
      isCorporate: true,
      isAdmin: false,
      permissions: [],
      homePath: '/',
    };
    return this.unitOfWork.write(actor, async (tx) => {
      const due = await tx.client.query<{
        id: string;
        request_id: string;
        entity_id: string;
        reference_number: string;
        title: string;
        prepared_by_user_id: string | null;
      }>(
        `SELECT n.id, n.request_id, n.entity_id, r.reference_number, v.title, r.prepared_by_user_id
           FROM procurement_delivery_notes n
           JOIN procurement_requests r ON r.id = n.request_id
           JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
          WHERE n.next_reminder_at IS NOT NULL AND n.next_reminder_at <= $1
            AND r.status IN ('AWAITING_DELIVERY', 'PARTIALLY_RECEIVED')`,
        [now],
      );
      for (const row of due.rows) {
        const recipients = await deliveryVerificationRecipients(tx.client, {
          entityId: row.entity_id,
          preparedByUserId: row.prepared_by_user_id,
        });
        for (const recipientUserId of recipients) {
          await tx.publish({
            eventType: 'procurement.delivery_reminder',
            subjectType: 'PROCUREMENT',
            subjectId: row.request_id,
            entityId: row.entity_id,
            payload: {
              type: 'procurement.delivery_reminder',
              reference: row.reference_number,
              title: row.title,
              recipientUserId,
              href: `/procurement/${row.request_id}#delivery`,
            },
          });
        }
        await tx.client.query(
          `UPDATE procurement_delivery_notes SET next_reminder_at = $1 + interval '3 days' WHERE id = $2`,
          [now, row.id],
        );
      }
      return due.rows.length;
    });
  }

  private async ensureShortageDeadline(
    tx: TxScope,
    actor: ActorContext,
    input: { requestId: string; lineId: string; entityId: string; dueOn?: string; label?: string | null },
  ): Promise<void> {
    const existing = await tx.client.query<{ due_on: Date }>(
      `SELECT due_on FROM procurement_shortage_deadlines WHERE line_id = $1`,
      [input.lineId],
    );
    if (existing.rows[0]) return;
    const dueOn = input.dueOn?.trim();
    if (!dueOn) {
      throw new ValidationFailedError(
        input.label
          ? `${input.label}: a second-batch date is required while part of it is outstanding.`
          : 'A second-batch date is required when a remainder is outstanding on this line.',
      );
    }
    const today = formatLagosIsoDate(new Date());
    if (dueOn < today) {
      throw new ValidationFailedError(
        input.label
          ? `${input.label}: the second-batch date cannot be in the past.`
          : 'The second-batch date cannot be in the past.',
      );
    }
    await tx.client.query(
      `INSERT INTO procurement_shortage_deadlines (
         request_id, line_id, entity_id, due_on, set_by, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $5, $5)`,
      [input.requestId, input.lineId, input.entityId, dueOn, actor.ref],
    );
    await tx.appendTimeline({
      subjectType: 'PROCUREMENT',
      subjectId: input.requestId,
      text: `Second-batch delivery date set: ${dueOn}.`,
      href: `/procurement/${input.requestId}`,
      entityId: input.entityId,
    });
  }

  private async lockRequest(
    tx: TxScope,
    actor: ActorContext,
    requestId: string,
    permission:
      | 'procurement.verify.delivery'
      | 'procurement.grn.record'
      | 'procurement.close_short.request'
      | 'procurement.shortage.override',
    opts?: { skipPermission?: boolean },
  ): Promise<LockedRequest> {
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      status: string;
      originator_user_id: string;
      version_id: string;
      current_version: number;
      title: string;
      quantity: number;
      unit_price_kobo: string | null;
      close_short_id: string | null;
      memo_json: unknown;
      required_docs: string[] | null;
      category_key: string | null;
    }>(
      `SELECT r.id, r.reference_number, r.entity_id, r.status, r.originator_user_id,
              v.id AS version_id, r.current_version, v.title, coalesce(v.quantity, 0) AS quantity,
              v.unit_price_kobo::text, r.close_short_id, snap.canonical_json AS memo_json,
              c.required_delivery_document_set AS required_docs, c.key AS category_key
         FROM procurement_requests r
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
         LEFT JOIN procurement_memo_snapshots snap ON snap.version_id = v.id
         LEFT JOIN procurement_categories c ON c.id = v.category_id
        WHERE r.id = $1
        FOR UPDATE OF r`,
      [requestId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That procurement request was not found.');
    if (!opts?.skipPermission) assertCan(actor, permission, row.entity_id);
    const lineRows = await tx.client.query<{
      id: string;
      line_number: number;
      quantity: number | null;
      unit_price_kobo: string | null;
      required_docs: string[] | null;
    }>(
      `SELECT l.id, l.line_number, l.quantity, l.unit_price_kobo::text,
              c.required_delivery_document_set AS required_docs
         FROM procurement_version_lines l
         LEFT JOIN procurement_categories c ON c.id = l.category_id
        WHERE l.version_id = $1
        ORDER BY l.line_number`,
      [row.version_id],
    );
    const lines: LockedLine[] =
      lineRows.rows.length > 0
        ? lineRows.rows.map((line) => ({
            id: line.id,
            line_number: line.line_number,
            quantity: line.quantity ?? 0,
            unit_price_kobo: Number(line.unit_price_kobo ?? 0),
          }))
        : [
            {
              id: '',
              line_number: 1,
              quantity: row.quantity,
              unit_price_kobo: Number(row.unit_price_kobo ?? 0),
            },
          ];
    const requiredDocs = [
      ...new Set(lineRows.rows.flatMap((line) => line.required_docs ?? row.required_docs ?? [])),
    ];
    return {
      ...row,
      unit_price_kobo: Number(row.unit_price_kobo ?? 0),
      required_docs: requiredDocs.length > 0 ? requiredDocs : (row.required_docs ?? []),
      lines,
    };
  }

  private resolveReceiptLine(lines: LockedLine[], lineId?: string): LockedLine {
    if (lineId) {
      const match = lines.find((line) => line.id === lineId);
      if (!match) throw new ValidationFailedError('That line does not belong to this request.');
      return match;
    }
    if (lines.length > 1) {
      throw new ValidationFailedError('Choose which line this receipt applies to.');
    }
    const only = lines[0];
    if (!only?.id) throw new ValidationFailedError('This request has no commercial lines to receive against.');
    return only;
  }

  private async acceptedOnLine(tx: TxScope, requestId: string, lineId: string): Promise<number> {
    const result = await tx.client.query<{ total: string }>(
      `SELECT coalesce(sum(g.quantity_accepted), 0)::text AS total
         FROM procurement_goods_receipts g
        WHERE g.request_id = $1
          AND coalesce(g.line_id, $2) = $2
          AND NOT EXISTS (
            SELECT 1 FROM procurement_goods_receipts later WHERE later.supersedes_id = g.id
          )`,
      [requestId, lineId],
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  private async lineProgress(
    tx: TxScope,
    requestId: string,
    lines: LockedLine[],
  ): Promise<{
    anyAccepted: boolean;
    anyOutstanding: boolean;
    outstandingQuantity: number;
    outstandingAmountKobo: number;
  }> {
    let anyAccepted = false;
    let anyOutstanding = false;
    let outstandingQuantity = 0;
    let outstandingAmountKobo = 0;
    for (const line of lines) {
      const accepted = line.id ? await this.acceptedOnLine(tx, requestId, line.id) : 0;
      const outstanding = Math.max(line.quantity - accepted, 0);
      if (accepted > 0) anyAccepted = true;
      if (outstanding > 0) {
        anyOutstanding = true;
        outstandingQuantity += outstanding;
        outstandingAmountKobo += outstanding * line.unit_price_kobo;
      }
    }
    return { anyAccepted, anyOutstanding, outstandingQuantity, outstandingAmountKobo };
  }

  private async acceptedTotal(tx: TxScope, requestId: string): Promise<number> {
    const result = await tx.client.query<{ total: string }>(
      `SELECT coalesce(sum(g.quantity_accepted), 0)::text AS total
         FROM procurement_goods_receipts g
        WHERE g.request_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM procurement_goods_receipts later WHERE later.supersedes_id = g.id
          )`,
      [requestId],
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  private async missingRequiredDocs(
    tx: TxScope,
    row: { id: string; required_docs: string[] },
  ): Promise<string[]> {
    if (row.required_docs.length === 0) return [];
    const present = await tx.client.query<{ kind: string }>(
      `SELECT DISTINCT kind FROM procurement_receipt_documents WHERE request_id = $1`,
      [row.id],
    );
    const kinds = new Set(present.rows.map((item) => item.kind));
    if (row.required_docs.some((kind) => kinds.has(kind))) return [];
    return row.required_docs;
  }

  private async assertVendorReadable(tx: TxScope, requestId: string): Promise<void> {
    const result = await tx.client.query<{ status: string | null }>(
      `SELECT ven.status
         FROM procurement_requests r
         LEFT JOIN vendors ven ON ven.id = r.vendor_id
        WHERE r.id = $1`,
      [requestId],
    );
    const status = result.rows[0]?.status;
    if (!status) throw new ValidationFailedError('This request has no readable vendor.');
    if (status !== 'ACTIVE') {
      throw new ConflictError(`Delivery cannot be recorded while the vendor is ${status.toLowerCase().replaceAll('_', ' ')}.`);
    }
  }
}
