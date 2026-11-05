import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import { VENDOR_SELECTABLE_STATUSES, type VendorValidateView } from '@nfc/shared';
import { can } from '../auth/can';
import { ForbiddenError, NotFoundError, ValidationFailedError } from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';

/**
 * Shared gate for M6/M8 vendor selection. Writes an append-only block row when
 * the vendor cannot be used, so the History tab can show the attempt.
 */
@Injectable()
export class VendorValidationService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async assertSelectable(
    actor: ActorContext,
    vendorId: string,
    context = 'validate',
  ): Promise<VendorValidateView> {
    if (
      !can(actor, 'procurement.create') &&
      !can(actor, 'vendor.view') &&
      !can(actor, 'finance.view') &&
      !can(actor, 'procurement.review.finance')
    ) {
      throw new ForbiddenError('You cannot validate a vendor for selection.');
    }

    return this.unitOfWork.write(actor, (tx) => this.assertSelectableInTx(tx, actor, vendorId, context));
  }

  async assertSelectableInTx(
    tx: TxScope,
    actor: ActorContext,
    vendorId: string,
    context = 'validate',
  ): Promise<VendorValidateView> {
    if (
      !can(actor, 'procurement.create') &&
      !can(actor, 'vendor.view') &&
      !can(actor, 'finance.view') &&
      !can(actor, 'procurement.review.finance')
    ) {
      throw new ForbiddenError('You cannot validate a vendor for selection.');
    }

    const result = await tx.client.query<{
      id: string;
      entity_id: string;
      status: string;
      expired: boolean;
    }>(
      `SELECT v.id, v.entity_id, v.status,
              EXISTS (
                SELECT 1 FROM vendor_compliance_documents c
               WHERE c.vendor_id = v.id AND c.required
                 AND c.expires_at IS NOT NULL AND c.expires_at < CURRENT_DATE
              ) AS expired
         FROM vendors v
        WHERE v.id = $1`,
      [vendorId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That vendor was not found.');

    let reason: string | null = null;
    if (!(VENDOR_SELECTABLE_STATUSES as readonly string[]).includes(row.status)) {
      reason = `Vendor status ${row.status} cannot be selected for procurement.`;
    } else if (row.expired) {
      reason = 'A required compliance document has expired.';
    }

    if (reason) {
      await tx.client.query(
        `INSERT INTO vendor_selection_blocks (vendor_id, entity_id, actor_ref, reason, context, created_by)
         VALUES ($1, $2, $3, $4, $5, $3)`,
        [row.id, row.entity_id, actor.ref, reason, context],
      );
      throw new ValidationFailedError(reason, { vendorId: row.id, status: row.status });
    }

    return {
      vendorId: row.id,
      selectable: true,
      status: row.status,
      reason: null,
    };
  }
}
