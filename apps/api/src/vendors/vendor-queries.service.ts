import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import {
  findPotentialDuplicateProcurement,
  hasVendorBeenUsedBefore,
  isInvoiceNumberUsedElsewhere,
  isVendorValidAndActive,
  listProcurementHistory,
  previousPayments,
  subsidiariesUsed,
  totalSpendKobo,
} from '@nfc/db';
import type { VendorHistoryView } from '@nfc/shared';
import { canReadVendorRegister } from '@nfc/shared';
import { can } from '../auth/can';
import { ForbiddenError, NotFoundError } from '../common/errors/domain-error';
import { UnitOfWork } from '../database/unit-of-work';

@Injectable()
export class VendorQueriesService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async history(actor: ActorContext, vendorId: string): Promise<VendorHistoryView> {
    if (!canReadVendorRegister(actor.permissions) && !can(actor, 'finance.view')) {
      throw new ForbiddenError('You cannot view vendor history.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const exists = await tx.client.query<{ id: string; entity_id: string }>(
        `SELECT id, entity_id FROM vendors WHERE id = $1`,
        [vendorId],
      );
      if (!exists.rows[0]) throw new NotFoundError('That vendor was not found.');

      const [procurement, payments, subsidiaries, used, blocks, invoiceDup] = await Promise.all([
        listProcurementHistory(tx.client, vendorId),
        previousPayments(tx.client, vendorId),
        subsidiariesUsed(tx.client, vendorId),
        hasVendorBeenUsedBefore(tx.client, vendorId),
        tx.client.query<{
          id: string;
          reason: string;
          context: string;
          created_at: Date;
          actor_ref: string;
        }>(
          `SELECT id, reason, context, created_at, actor_ref
             FROM vendor_selection_blocks
            WHERE vendor_id = $1
            ORDER BY created_at DESC`,
          [vendorId],
        ),
        findPotentialDuplicateProcurement(tx.client, vendorId),
      ]);
      void invoiceDup;
      void used;

      const spendAll = await totalSpendKobo(tx.client, vendorId);
      const dates = [
        ...procurement.map((row) => row.occurredAt),
        ...payments.map((row) => row.paidAt),
      ].sort();

      return {
        procurement: procurement.map((row) => ({
          referenceNumber: row.referenceNumber,
          title: row.title,
          status: row.status,
          entityCode: row.entityCode,
          occurredAt: row.occurredAt,
        })),
        payments: payments.map((row) => ({
          referenceNumber: row.referenceNumber,
          amountKobo: row.amountKobo,
          entityCode: row.entityCode,
          paidAt: row.paidAt,
        })),
        subsidiaries,
        firstUsedAt: dates[0] ?? null,
        lastUsedAt: dates[dates.length - 1] ?? null,
        totalSpendKobo: spendAll,
        blockedAttempts: blocks.rows.map((row) => ({
          id: row.id,
          reason: row.reason,
          context: row.context,
          occurredAt: row.created_at.toISOString(),
          actorRef: row.actor_ref,
        })),
        openClaims: (
          await tx.client.query<{
            procurement_ref: string | null;
            quantity: number;
            amount_kobo: string;
            reason: string;
            created_at: Date;
          }>(
            `SELECT r.reference_number AS procurement_ref, c.quantity, c.amount_kobo::text, c.reason, c.created_at
               FROM vendor_open_claims c
               JOIN procurement_requests r ON r.id = c.request_id
              WHERE c.vendor_id = $1
              ORDER BY c.created_at DESC`,
            [vendorId],
          )
        ).rows.map((row) => ({
          procurementReference: row.procurement_ref,
          quantity: row.quantity,
          amountKobo: Number(row.amount_kobo),
          reason: row.reason,
          createdAt: row.created_at.toISOString(),
        })),
      };
    });
  }

  async isValidAndActive(actor: ActorContext, vendorId: string): Promise<boolean> {
    return this.unitOfWork.read(actor, (tx) => isVendorValidAndActive(tx.client, vendorId));
  }

  async hasBeenUsed(actor: ActorContext, vendorId: string): Promise<boolean> {
    return this.unitOfWork.read(actor, (tx) => hasVendorBeenUsedBefore(tx.client, vendorId));
  }

  async invoiceUsedElsewhere(
    actor: ActorContext,
    vendorId: string,
    invoiceNumber: string,
    excludeProcurementRef?: string | null,
  ): Promise<boolean> {
    return this.unitOfWork.read(actor, (tx) =>
      isInvoiceNumberUsedElsewhere(tx.client, vendorId, invoiceNumber, excludeProcurementRef),
    );
  }
}
