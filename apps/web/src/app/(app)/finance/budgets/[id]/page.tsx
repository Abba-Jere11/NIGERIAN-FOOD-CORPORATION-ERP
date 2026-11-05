import type { BudgetView, MeView, WorkflowInstanceView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import { notFound } from 'next/navigation';
import { ActionDialog } from '@/components/ui/Dialog';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SealBadge } from '@/components/seals/SealBadge';
import { apiFetch, ApiError } from '@/lib/api';
import { BudgetProgressStrip } from '../../_components/BudgetProgressStrip';
import { workflowAction } from '../../../workflows/actions';
import { submitBudgetAction } from '../../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Budget — NFC' };

export default async function BudgetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const me = await apiFetch<MeView>('/api/me');
  let budget: BudgetView;
  try {
    budget = await apiFetch<BudgetView>(`/api/finance/budgets/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const workflow = budget.workflowInstanceId
    ? await apiFetch<WorkflowInstanceView>(`/api/workflows/${budget.workflowInstanceId}`).catch(() => null)
    : null;
  const scope = query.scope ?? budget.entityCode ?? undefined;

  return (
    <>
      <PageHeader
        eyebrow={budget.entityCode ?? 'Budget'}
        title={budget.referenceNumber}
        description={`Version ${budget.versionNumber} · ${budget.year}`}
        actions={<StatusBadge status={budget.status} />}
      />
      <Surface className="mb-4" padded={false}>
        <SurfaceHeader
          title="Approved to available"
          description="Available stays approved minus commitments. Paid follows procurement settlements. Open a figure for underlying rows."
        />
        <BudgetProgressStrip lines={budget.lines} scope={scope} budgetId={budget.id} />
      </Surface>
      <Surface className="mb-4" padded={false}>
        <SurfaceHeader
          title="Utilization and variance"
          description="Line-level approved, committed, available, paid and variance."
        />
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Line</th>
              <th className="px-4 py-2 font-semibold">Approved</th>
              <th className="px-4 py-2 font-semibold">Committed</th>
              <th className="px-4 py-2 font-semibold">Available</th>
              <th className="px-4 py-2 font-semibold">Paid</th>
              <th className="px-4 py-2 font-semibold">Variance</th>
            </tr>
          </thead>
          <tbody>
            {budget.lines.map((line) => (
              <tr key={line.id} className="border-b border-ink-100">
                <td className="px-4 py-2">
                  {line.code} {line.name}
                </td>
                <td className="tabular px-4 py-2">{formatKobo(BigInt(line.approvedKobo))}</td>
                <td className="tabular px-4 py-2">{formatKobo(BigInt(line.committedKobo))}</td>
                <td className="tabular px-4 py-2">{formatKobo(BigInt(line.availableKobo))}</td>
                <td className="tabular px-4 py-2">{formatKobo(BigInt(line.paidKobo))}</td>
                <td className="tabular px-4 py-2">{formatKobo(BigInt(line.varianceKobo))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Surface>
      {budget.status === 'DRAFT' && me.permissions.includes('finance.budget.prepare') ? (
        <Surface className="mb-4">
          <ActionDialog
            triggerLabel="Submit for approval"
            triggerVariant="primary"
            title="Submit budget"
            submitLabel="Submit"
            successMessage="Budget submitted."
            action={submitBudgetAction}
            hiddenFields={{ id: budget.id, rowVersion: String(budget.rowVersion) }}
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
                triggerLabel={action === 'APPROVE' ? 'Approve' : action}
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
