'use client';

import type { RequisitionView } from '@nfc/shared';
import { useToastAction } from '@/lib/use-toast-action';
import { DraftVersionInput } from '@/components/forms/DraftVersion';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/States';
import { discardRequisitionAction, submitRequisitionAction } from './actions';

export function RequisitionActions({ requisition }: { requisition: RequisitionView }) {
  const [state, formAction, pending] = useToastAction(submitRequisitionAction, { errorTitle: 'Submit failed' });
  const [discardState, discardAction, discarding] = useToastAction(discardRequisitionAction, {
    errorTitle: 'The draft was not discarded',
  });
  if (requisition.status !== 'DRAFT') return null;
  const canDiscard = requisition.currentVersion === 1 && !requisition.workflowInstanceId;
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
              'Submit this requisition? The need memo will freeze and the Managing Director will review it. No prices are included.',
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={requisition.id} />
        <DraftVersionInput fallback={requisition.rowVersion} />
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Submitting…' : requisition.currentVersion > 1 ? 'Resubmit requisition' : 'Submit requisition'}
        </Button>
      </form>
      {canDiscard ? (
        <form action={discardAction}>
          <input type="hidden" name="id" value={requisition.id} />
          <DraftVersionInput fallback={requisition.rowVersion} />
          <Button type="submit" variant="subtle" disabled={discarding}>
            Discard draft
          </Button>
        </form>
      ) : null}
    </div>
  );
}
