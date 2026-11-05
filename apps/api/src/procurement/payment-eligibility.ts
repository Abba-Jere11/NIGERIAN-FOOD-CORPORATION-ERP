import type { PaymentTiming } from '@nfc/shared';
import type { TxScope } from '../database/unit-of-work';

export const PAYABLE_STATUSES = ['AWAITING_PAYMENT', 'AWAITING_DELIVERY', 'PARTIALLY_RECEIVED'] as const;

export interface PaymentEligibility {
  authorizedKobo: number;
  paidKobo: number;
  acceptedValueKobo: number;
  payableKobo: number;
  obligationKobo: number;
  paymentComplete: boolean;
  deliveryComplete: boolean;
  timing: PaymentTiming | null;
  fundingRoute: string | null;
  funded: boolean;
  closeShortApproved: boolean;
}

export function eligibilityFromParts(input: {
  authorizedKobo: number;
  paidKobo: number;
  acceptedValueKobo: number;
  anyOutstanding: boolean;
  timing: PaymentTiming | null;
  fundingRoute: string | null;
  funded: boolean;
  closeShortApproved: boolean;
}): PaymentEligibility {
  const authorizedKobo = Math.max(0, input.authorizedKobo);
  const paidKobo = Math.max(0, input.paidKobo);
  const acceptedValueKobo = Math.max(0, input.acceptedValueKobo);
  const obligationKobo = input.closeShortApproved ? acceptedValueKobo : authorizedKobo;
  const paymentComplete = paidKobo >= obligationKobo && (obligationKobo > 0 || input.closeShortApproved);
  const deliveryComplete = !input.anyOutstanding || input.closeShortApproved;
  let cap: number;
  if (input.closeShortApproved) {
    cap = obligationKobo - paidKobo;
  } else if (input.timing === 'after_delivery') {
    cap = Math.min(authorizedKobo, acceptedValueKobo) - paidKobo;
  } else {
    cap = authorizedKobo - paidKobo;
  }
  return {
    authorizedKobo,
    paidKobo,
    acceptedValueKobo,
    payableKobo: Math.max(cap, 0),
    obligationKobo,
    paymentComplete,
    deliveryComplete,
    timing: input.timing,
    fundingRoute: input.fundingRoute,
    funded: input.funded,
    closeShortApproved: input.closeShortApproved,
  };
}

export function nextStatusAfterPayment(elig: PaymentEligibility, currentStatus: string): string {
  if (elig.deliveryComplete && elig.paymentComplete) return 'COMPLETED';
  if (elig.deliveryComplete) {
    if (elig.fundingRoute === 'corporate_allocation' && !elig.funded) return 'FUNDING_PENDING';
    return 'AWAITING_PAYMENT';
  }
  if (elig.timing === 'after_delivery') {
    return currentStatus === 'PARTIALLY_RECEIVED' ? 'PARTIALLY_RECEIVED' : 'AWAITING_DELIVERY';
  }
  return elig.paymentComplete ? 'AWAITING_DELIVERY' : 'AWAITING_PAYMENT';
}

export async function loadPaymentEligibility(tx: TxScope, requestId: string): Promise<PaymentEligibility> {
  const header = await tx.client.query<{
    authorized_amount_kobo: string | null;
    final_payment_timing: string | null;
    funding_route: string | null;
    close_status: string | null;
    version_id: string | null;
  }>(
    `SELECT r.authorized_amount_kobo::text, r.final_payment_timing, r.funding_route,
            s.status AS close_status, v.id AS version_id
       FROM procurement_requests r
       JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
       LEFT JOIN procurement_close_short_requests s ON s.id = r.close_short_id
      WHERE r.id = $1`,
    [requestId],
  );
  const row = header.rows[0];
  const paid = await tx.client.query<{ total: string }>(
    `SELECT coalesce(sum(amount_kobo), 0)::text AS total
       FROM procurement_payments
      WHERE request_id = $1 AND reversed_at IS NULL AND status = 'COMPLETED'`,
    [requestId],
  );
  const funded = await tx.client.query<{ yes: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM funding_transfer_records
        WHERE request_id = $1 AND reversed_transfer_id IS NULL
     ) AS yes`,
    [requestId],
  );
  const lines = row?.version_id
    ? await tx.client.query<{ id: string; quantity: number | null; unit_price_kobo: string | null }>(
        `SELECT id, quantity, unit_price_kobo::text
           FROM procurement_version_lines
          WHERE version_id = $1
          ORDER BY line_number`,
        [row.version_id],
      )
    : { rows: [] as Array<{ id: string; quantity: number | null; unit_price_kobo: string | null }> };

  let acceptedValueKobo = 0;
  let anyOutstanding = false;
  for (const line of lines.rows) {
    const accepted = await acceptedOnLine(tx, requestId, line.id);
    const quantity = line.quantity ?? 0;
    const price = Number(line.unit_price_kobo ?? 0);
    acceptedValueKobo += accepted * price;
    if (quantity - accepted > 0) anyOutstanding = true;
  }

  const timing = row?.final_payment_timing === 'after_delivery' || row?.final_payment_timing === 'before_delivery'
    ? row.final_payment_timing
    : null;

  return eligibilityFromParts({
    authorizedKobo: Number(row?.authorized_amount_kobo ?? 0),
    paidKobo: Number(paid.rows[0]?.total ?? 0),
    acceptedValueKobo,
    anyOutstanding,
    timing,
    fundingRoute: row?.funding_route ?? null,
    funded: Boolean(funded.rows[0]?.yes),
    closeShortApproved: row?.close_status === 'APPROVED',
  });
}

async function acceptedOnLine(tx: TxScope, requestId: string, lineId: string): Promise<number> {
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
