'use client';

import type { ProcurementView } from '@nfc/shared';
import { useToastAction } from '@/lib/use-toast-action';
import { DraftVersionInput } from '@/components/forms/DraftVersion';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/States';
import { cloneProcurementAction, discardProcurementAction, submitProcurementAction } from './actions';

export function ProcurementActions({ request }: { request: ProcurementView }) {
  const [state, formAction, submitting] = useToastAction(submitProcurementAction, { errorTitle: 'Submit failed' });
  const [discardState, discardAction, discarding] = useToastAction(discardProcurementAction, {
    errorTitle: 'The draft was not discarded',
  });
  const [cloneState, cloneAction, cloning] = useToastAction(cloneProcurementAction, {
    errorTitle: 'The request was not cloned',
  });
  if (request.status === 'REJECTED') {
    return (
      <form action={cloneAction} className="space-y-2">
        {cloneState.status === 'error' ? (
          <ErrorState title="The request was not cloned" message={cloneState.message} requestId={cloneState.requestId} />
        ) : null}
        <input type="hidden" name="id" value={request.id} />
        <Button type="submit" variant="primary" disabled={cloning}>
          Clone as new request
        </Button>
      </form>
    );
  }
  const openProposal = request.status === 'DRAFT' || request.status === 'AWAITING_PREPARATION';
  if (!openProposal) return null;
  const canDiscard = request.currentVersion === 1 && !request.workflowInstanceId;
  return (
    <div className="space-y-3">
      {state.status === 'error' ? (
        <ErrorState title="Submit failed" message={state.message} requestId={state.requestId} />
      ) : null}
      {discardState.status === 'error' ? (
        <ErrorState title="The draft was not discarded" message={discardState.message} requestId={discardState.requestId} />
      ) : null}
      <form
        action={formAction}
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          if (
            !window.confirm(
              request.requisitionId
                ? 'Submit this proposal? The priced memo will freeze, your seal will be applied, and budget will be committed.'
                : 'Submit this request? The memo and totals will freeze, the GM seal will be applied, and Operations will receive it.',
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={request.id} />
        <DraftVersionInput fallback={request.rowVersion} />
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting
            ? 'Submitting…'
            : request.requisitionId
              ? request.currentVersion > 1
                ? 'Resubmit proposal'
                : 'Submit proposal'
              : request.currentVersion > 1
                ? 'Resubmit request'
                : 'Submit request'}
        </Button>
      </form>
      {canDiscard ? (
        <form action={discardAction}>
          <input type="hidden" name="id" value={request.id} />
          <DraftVersionInput fallback={request.rowVersion} />
          <Button type="submit" variant="subtle" disabled={discarding}>
            Discard draft
          </Button>
        </form>
      ) : null}
    </div>
  );
}
