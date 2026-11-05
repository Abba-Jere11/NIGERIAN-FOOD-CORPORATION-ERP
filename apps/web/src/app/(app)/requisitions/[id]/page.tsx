import type {
  DepartmentView,
  MeView,
  ProcurementCategoryView,
  RequisitionView,
  TimelineEventView,
  UnitOfMeasureView,
  WorkflowInstanceView,
} from '@nfc/shared';
import { formatLagosDate, formatLagosDateTime, hasRequisitionNavPermission } from '@nfc/shared';
import { notFound, redirect } from 'next/navigation';
import { DraftVersionProvider } from '@/components/forms/DraftVersion';
import { ApprovalTracker } from '@/components/ui/ApprovalTracker';
import { DefinitionList, PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Timeline } from '@/components/ui/Timeline';
import { apiFetch, ApiError } from '@/lib/api';
import { ApprovalActions } from '../../procurement/ApprovalActions';
import { RequisitionActions } from '../RequisitionActions';
import { RequisitionForm } from '../RequisitionForm';

export const dynamic = 'force-dynamic';

export default async function RequisitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await apiFetch<MeView>('/api/me');
  if (!hasRequisitionNavPermission(me.permissions)) redirect('/forbidden');

  let requisition: RequisitionView;
  try {
    requisition = await apiFetch<RequisitionView>(`/api/requisitions/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  const isDraft = requisition.status === 'DRAFT' && me.ref === requisition.originatorUserId;
  const [departments, categories, units, timeline, workflow, memo] = await Promise.all([
    apiFetch<DepartmentView[]>(`/api/entities/${requisition.entityId}/departments`).catch(() => []),
    apiFetch<ProcurementCategoryView[]>('/api/procurement/categories'),
    apiFetch<UnitOfMeasureView[]>('/api/procurement/units'),
    requisition.procurementRequestId
      ? apiFetch<TimelineEventView[]>('/api/timeline', {
          query: { subjectType: 'PROCUREMENT', subjectId: requisition.procurementRequestId },
        }).catch(() => [])
      : Promise.resolve([] as TimelineEventView[]),
    requisition.workflowInstanceId
      ? apiFetch<WorkflowInstanceView>(`/api/workflows/${requisition.workflowInstanceId}`).catch(() => null)
      : Promise.resolve(null),
    apiFetch<{ html: string }>(`/api/requisitions/${id}/memo`).catch(() => null),
  ]);

  return (
    <DraftVersionProvider rowVersion={requisition.rowVersion}>
      <PageHeader
        eyebrow={requisition.referenceNumber}
        title={requisition.title || 'Untitled requisition'}
        description={`${requisition.entityName ?? requisition.entityCode ?? ''} · originated by ${requisition.originatorName ?? 'the GM'}`}
        actions={<StatusBadge status={requisition.status} />}
      />
      {requisition.lastReturnReason ? (
        <p role="status" className="mb-4 border-l-2 border-warning-600 bg-warning-100 px-3 py-2 text-[13px]">
          Returned for correction. Reason: {requisition.lastReturnReason}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Surface>
            <SurfaceHeader title={isDraft ? 'Need request' : 'Requisition details'} />
            <div className="px-4 py-3">
              {isDraft ? (
                <RequisitionForm
                  requisition={requisition}
                  departments={departments}
                  categories={categories}
                  units={units}
                />
              ) : (
                <>
                  <div className="mb-4 overflow-x-auto">
                    <table className="w-full text-left text-[13px]">
                      <thead>
                        <tr className="border-b border-ink-200 text-[12px] text-ink-600">
                          <th className="py-1 pr-2">Item</th>
                          <th className="py-1 pr-2">Description</th>
                          <th className="py-1 pr-2">Qty</th>
                          <th className="py-1">Unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {requisition.lines.map((line) => (
                          <tr key={line.id} className="border-b border-ink-100">
                            <td className="py-1 pr-2">{line.lineNumber}</td>
                            <td className="py-1 pr-2">{line.description}</td>
                            <td className="py-1 pr-2">{line.quantity}</td>
                            <td className="py-1">{line.unitCode ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <DefinitionList
                    items={[
                      { label: 'Department', value: requisition.departmentName ?? '—' },
                      { label: 'Category', value: requisition.categoryName ?? '—' },
                      {
                        label: 'Required date',
                        value: requisition.requiredDate ? formatLagosDate(requisition.requiredDate) : '—',
                      },
                      { label: 'Delivery', value: requisition.deliveryLocation ?? '—' },
                      { label: 'Urgency', value: requisition.urgency },
                      { label: 'Background', value: requisition.background ?? '—' },
                      { label: 'Justification', value: requisition.justification ?? '—' },
                      { label: 'Prayer', value: requisition.prayer ?? '—' },
                    ]}
                  />
                </>
              )}
            </div>
          </Surface>

          <Surface>
            <SurfaceHeader title="Need memorandum" description="No amounts or vendors appear on this memo." />
            <div className="px-4 py-3">
              {memo ? (
                <iframe title="Requisition memo" className="h-[480px] w-full border border-ink-200" srcDoc={memo.html} />
              ) : (
                <EmptyState title="Memo not ready" description="Save the draft to preview the generated memorandum." />
              )}
              <p className="mt-2 text-[12px]">
                <a className="underline" href={`/requisitions/${id}/memo.pdf`}>
                  Download PDF
                </a>
                {requisition.procurementRequestId ? (
                  <>
                    {' '}
                    ·{' '}
                    <a className="underline" href={`/procurement/${requisition.procurementRequestId}`}>
                      Open proposal {requisition.procurementReference}
                    </a>
                  </>
                ) : null}
              </p>
            </div>
          </Surface>
        </div>

        <div className="space-y-4">
          <Surface>
            <SurfaceHeader title="Actions" />
            <div className="space-y-3 px-4 py-3">
              {workflow && requisition.procurementRequestId && workflow.currentStageKey === 'need-approval' ? (
                <ApprovalActions
                  requestId={requisition.procurementRequestId}
                  workflow={workflow}
                  proposedPaymentTiming={null}
                />
              ) : null}
              <RequisitionActions requisition={requisition} />
            </div>
          </Surface>
          {workflow ? (
            <Surface>
              <SurfaceHeader title="Approval track" />
              <div className="px-4 py-3">
                <ApprovalTracker stages={workflow.tracker} />
              </div>
            </Surface>
          ) : null}
          {timeline.length > 0 ? (
            <Surface>
              <SurfaceHeader title="Timeline" />
              <div className="px-4 py-3">
                <Timeline
                entries={timeline.map((event) => ({
                  id: event.id,
                  occurredAt: event.occurredAt,
                  actor: event.actor,
                  text: event.text,
                  href: event.href,
                }))}
              />
              </div>
            </Surface>
          ) : null}
          <p className="px-1 text-[12px] text-ink-500">Created {formatLagosDateTime(requisition.createdAt)}.</p>
        </div>
      </div>
    </DraftVersionProvider>
  );
}
