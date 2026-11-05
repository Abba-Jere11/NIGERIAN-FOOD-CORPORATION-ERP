import type { FiscalYearView, JournalView, MeView, WorkflowInstanceView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import { notFound } from 'next/navigation';
import { ActionDialog } from '@/components/ui/Dialog';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import Link from 'next/link';
import { SealBadge } from '@/components/seals/SealBadge';
import { apiFetch, ApiError } from '@/lib/api';
import { workflowAction } from '../../../workflows/actions';
import { reverseJournalAction, submitJournalAction } from '../../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Journal — NFC' };

export default async function JournalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await apiFetch<MeView>('/api/me');
  let journal: JournalView;
  try {
    journal = await apiFetch<JournalView>(`/api/finance/journals/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const workflow = journal.workflowInstanceId
    ? await apiFetch<WorkflowInstanceView>(`/api/workflows/${journal.workflowInstanceId}`).catch(() => null)
    : null;
  const years = await apiFetch<FiscalYearView[]>('/api/finance/years', {
    query: { entityId: journal.entityId },
  });
  const openPeriod = years.flatMap((year) => year.periods).find((period) => period.status === 'OPEN');

  return (
    <>
      <PageHeader
        eyebrow={journal.entityCode ?? 'Journal'}
        title={journal.referenceNumber}
        description={journal.narration}
        actions={<StatusBadge status={journal.status} />}
      />
      {journal.sourceHref ? (
        <p className="mb-4 text-[13px]">
          Source document:{' '}
          <Link href={journal.sourceHref} className="underline">
            {journal.sourceLabel ?? 'Open'}
          </Link>
        </p>
      ) : null}
      <Surface className="mb-4" padded={false}>
        <SurfaceHeader title="Lines" description={`${journal.periodName} · ${journal.source}`} />
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Account</th>
              <th className="px-4 py-2 font-semibold">Debit</th>
              <th className="px-4 py-2 font-semibold">Credit</th>
            </tr>
          </thead>
          <tbody>
            {journal.lines.map((line) => (
              <tr key={line.id} className="border-b border-ink-100">
                <td className="px-4 py-2">
                  {line.accountCode} {line.accountName}
                </td>
                <td className="tabular px-4 py-2">
                  {line.debitKobo ? formatKobo(BigInt(line.debitKobo)) : '—'}
                </td>
                <td className="tabular px-4 py-2">
                  {line.creditKobo ? formatKobo(BigInt(line.creditKobo)) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Surface>
      {journal.status === 'DRAFT' && me.permissions.includes('finance.journal.prepare') ? (
        <Surface className="mb-4">
          <ActionDialog
            triggerLabel="Submit for approval"
            triggerVariant="primary"
            title="Submit journal"
            submitLabel="Submit"
            successMessage="Journal submitted."
            action={submitJournalAction}
            hiddenFields={{ id: journal.id, rowVersion: String(journal.rowVersion) }}
          />
        </Surface>
      ) : null}
      {workflow && workflow.allowedActions.length > 0 ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Approval" />
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {workflow.allowedActions.map((action) => (
              <ActionDialog
                key={action}
                triggerLabel={action === 'APPROVE' ? 'Approve and post' : action}
                triggerVariant={action === 'REJECT' ? 'danger' : 'primary'}
                title={action}
                submitLabel={action}
                successMessage="Recorded."
                action={workflowAction}
                requireReason={action === 'REJECT'}
                hiddenFields={{
                  instanceId: workflow.id,
                  action,
                  rowVersion: String(workflow.rowVersion),
                }}
              />
            ))}
          </div>
        </Surface>
      ) : null}
      {journal.status === 'POSTED' && me.permissions.includes('finance.journal.prepare') && openPeriod ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Correction" description="Creates a reversing journal. Both remain visible." />
          <div className="px-4 py-3">
            <ActionDialog
              triggerLabel="Reverse"
              title="Reverse this journal"
              submitLabel="Reverse"
              successMessage="Reversal submitted."
              action={reverseJournalAction}
              requireReason
              hiddenFields={{ id: journal.id, fiscalPeriodId: openPeriod.id }}
            />
          </div>
        </Surface>
      ) : null}
      {workflow?.seals?.length ? (
        <Surface>
          <SurfaceHeader title="Seals" />
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
            {workflow.seals.map((seal) => (
              <SealBadge key={seal.id} seal={seal} />
            ))}
          </div>
        </Surface>
      ) : null}
    </>
  );
}
