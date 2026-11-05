'use client';

import type { ProcurementInvoiceVarianceView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import { ActionDialog } from '@/components/ui/Dialog';
import { decideInvoiceVarianceAction } from './actions';

/** The MD approves or rejects an invoice amount that differs from the approved total. */
export function InvoiceVarianceDecision({
  requestId,
  variance,
}: {
  requestId: string;
  variance: ProcurementInvoiceVarianceView;
}) {
  const difference = variance.differenceKobo;
  const summary = (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
      <dt className="text-ink-600">Approved amount</dt>
      <dd className="tabular text-right">{formatKobo(BigInt(variance.approvedAmountKobo))}</dd>
      <dt className="text-ink-600">Invoice {variance.invoiceNumber}</dt>
      <dd className="tabular text-right">{formatKobo(BigInt(variance.invoiceAmountKobo))}</dd>
      <dt className="text-ink-600">Difference</dt>
      <dd className="tabular text-right font-medium">
        {difference > 0 ? '+' : '−'}
        {formatKobo(BigInt(Math.abs(difference)))}
      </dd>
    </dl>
  );
  return (
    <div className="space-y-3" data-testid="invoice-variance-decision">
      {summary}
      <div className="flex flex-wrap gap-2">
        <ActionDialog
          triggerLabel="Approve invoiced amount"
          title="Approve the invoiced amount"
          description="ED Finance will be able to continue with the invoiced amount. The budget commitment moves to match it."
          submitLabel="Approve amount"
          successMessage="Invoiced amount approved. ED Finance has been notified."
          action={decideInvoiceVarianceAction}
          hiddenFields={{ requestId, decision: 'APPROVE' }}
        >
          {summary}
        </ActionDialog>
        <ActionDialog
          triggerLabel="Reject"
          triggerVariant="danger"
          title="Reject the invoiced amount"
          description="The Procurement Manager will be asked to upload a corrected invoice."
          submitLabel="Reject amount"
          submitVariant="danger"
          successMessage="Invoiced amount rejected. The Procurement Manager has been notified."
          action={decideInvoiceVarianceAction}
          requireReason
          hiddenFields={{ requestId, decision: 'REJECT' }}
        >
          {summary}
        </ActionDialog>
      </div>
    </div>
  );
}
