'use client';

import type { PaymentTiming, WorkflowInstanceView } from '@nfc/shared';
import { PAYMENT_TIMINGS, PAYMENT_TIMING_LABELS } from '@nfc/shared';
import { ActionDialog } from '@/components/ui/Dialog';
import { procurementWorkflowAction } from './actions';

const ACTION_LABELS: Record<string, string> = {
  APPROVE: 'Approve',
  REJECT: 'Reject',
  RETURN_FOR_CORRECTION: 'Return for correction',
  ARCHIVE: 'Archive',
  RESTORE: 'Restore',
};

export function ApprovalActions({
  requestId,
  workflow,
  proposedPaymentTiming,
}: {
  requestId: string;
  workflow: WorkflowInstanceView;
  proposedPaymentTiming: PaymentTiming | null;
}) {
  const actions = workflow.allowedActions.filter((action) => {
    if (action === 'RESUBMIT') return false;
    if (action === 'APPROVE' && workflow.currentStageKey === 'ed-finance') return false;
    return true;
  });
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <ActionDialog
          key={action}
          triggerLabel={ACTION_LABELS[action] ?? action}
          triggerVariant={action === 'REJECT' || action === 'ARCHIVE' ? 'danger' : 'primary'}
          title={ACTION_LABELS[action] ?? action}
          submitLabel={ACTION_LABELS[action] ?? action}
          successMessage="Recorded."
          action={procurementWorkflowAction}
          requireReason={['REJECT', 'RETURN_FOR_CORRECTION', 'ARCHIVE', 'RESTORE'].includes(action)}
          hiddenFields={{
            requestId,
            action,
            rowVersion: String(workflow.rowVersion),
          }}
        >
          {action === 'APPROVE' && workflow.currentStageKey === 'md' ? (
            <fieldset className="space-y-2">
              <legend className="text-[12px] font-semibold text-ink-700">Payment timing</legend>
              <p className="text-[13px] text-ink-800">
                GM proposed:{' '}
                {proposedPaymentTiming ? PAYMENT_TIMING_LABELS[proposedPaymentTiming] : 'not set'}
              </p>
              {PAYMENT_TIMINGS.map((timing) => (
                <label key={timing} className="flex items-start gap-2 text-[13px] text-ink-800">
                  <input
                    type="radio"
                    name="finalPaymentTiming"
                    value={timing}
                    required
                    defaultChecked={timing === (proposedPaymentTiming ?? 'before_delivery')}
                    className="mt-1"
                  />
                  <span>
                    {timing === proposedPaymentTiming ? 'Retain — ' : 'Change to '}
                    {PAYMENT_TIMING_LABELS[timing]}
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
        </ActionDialog>
      ))}
    </div>
  );
}
