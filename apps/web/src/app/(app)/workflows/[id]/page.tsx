import type { WorkflowInstanceView } from '@nfc/shared';
import { notFound } from 'next/navigation';
import { ApprovalTracker } from '@/components/ui/ApprovalTracker';
import { ActionDialog } from '@/components/ui/Dialog';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SealBadge } from '@/components/seals/SealBadge';
import { Timeline } from '@/components/ui/Timeline';
import { apiFetch, ApiError } from '@/lib/api';
import { workflowAction } from '../actions';

export const dynamic = 'force-dynamic';

const ACTION_LABELS: Record<string, string> = {
  APPROVE: 'Approve',
  REJECT: 'Reject',
  RETURN_FOR_CORRECTION: 'Return for correction',
  ARCHIVE: 'Archive',
  RESTORE: 'Restore',
  RESUBMIT: 'Resubmit',
};

export default async function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let instance: WorkflowInstanceView;
  try {
    instance = await apiFetch<WorkflowInstanceView>(`/api/workflows/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        eyebrow="Workflow"
        title={instance.referenceNumber}
        description={`${instance.title} · ${instance.originatorName}`}
        actions={<StatusBadge status={instance.status} />}
      />
      <Surface className="mb-4">
        <SurfaceHeader title="Who has it now" description="Done, current and pending. Returned and rejected keep their own marks." />
        <div className="px-4 py-3">
          <ApprovalTracker stages={instance.tracker} />
        </div>
      </Surface>
      {instance.allowedActions.length > 0 ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Actions" description="Reject, return and archive require a reason that is stored permanently." />
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {instance.allowedActions.map((action) => (
              <ActionDialog
                key={action}
                triggerLabel={ACTION_LABELS[action] ?? action}
                triggerVariant={action === 'REJECT' || action === 'ARCHIVE' ? 'danger' : 'primary'}
                title={ACTION_LABELS[action] ?? action}
                submitLabel={ACTION_LABELS[action] ?? action}
                successMessage="Recorded."
                action={workflowAction}
                requireReason={['REJECT', 'RETURN_FOR_CORRECTION', 'ARCHIVE', 'RESTORE'].includes(action)}
                hiddenFields={{
                  instanceId: instance.id,
                  action,
                  rowVersion: String(instance.rowVersion),
                }}
              />
            ))}
          </div>
        </Surface>
      ) : null}
      <Surface className="mb-4" padded={false}>
        <SurfaceHeader title="Seals" description="Server-signed. There is no upload path." />
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
          {instance.seals.length === 0 ? (
            <p className="text-[13px] text-ink-500">No seals on this version yet.</p>
          ) : (
            instance.seals.map((seal) => <SealBadge key={seal.id} seal={seal} />)
          )}
        </div>
      </Surface>
      <Surface padded={false}>
        <SurfaceHeader title="History" />
        <div className="px-4 py-3">
          <Timeline
            entries={instance.history.map((entry) => ({
              id: entry.id,
              occurredAt: entry.occurredAt,
              actor: entry.actorName,
              text: `${entry.action} · ${entry.stageKey}${entry.reason ? ` — ${entry.reason}` : ''}`,
            }))}
          />
        </div>
      </Surface>
    </>
  );
}
