'use client';

import type { WorkflowInstanceView } from '@nfc/shared';
import { ActionDialog } from '@/components/ui/Dialog';
import { closeShortWorkflowAction } from './actions';

const LABELS: Record<string, string> = {
  APPROVE: 'Approve close-short',
  REJECT: 'Reject close-short',
};

export function CloseShortActions({
  requestId,
  workflow,
}: {
  requestId: string;
  workflow: WorkflowInstanceView;
}) {
  const actions = workflow.allowedActions.filter((action) => action === 'APPROVE' || action === 'REJECT');
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <ActionDialog
          key={action}
          triggerLabel={LABELS[action] ?? action}
          triggerVariant={action === 'REJECT' ? 'danger' : 'primary'}
          title={LABELS[action] ?? action}
          submitLabel={LABELS[action] ?? action}
          successMessage="Recorded."
          action={closeShortWorkflowAction}
          requireReason={action === 'REJECT'}
          hiddenFields={{
            requestId,
            instanceId: workflow.id,
            action,
            rowVersion: String(workflow.rowVersion),
          }}
        />
      ))}
    </div>
  );
}
