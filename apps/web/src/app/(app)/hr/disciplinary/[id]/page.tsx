import type { HrDisciplinaryView, MeView } from '@nfc/shared';
import { notFound, redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch, ApiError } from '@/lib/api';
import { RecommendForm } from '../../HrForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Disciplinary case — HR — NFC' };

export default async function DisciplinaryCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('hr.disciplinary.view') && !me.permissions.includes('hr.disciplinary.approve')) {
    redirect('/forbidden');
  }
  let disc: HrDisciplinaryView;
  try {
    disc = await apiFetch<HrDisciplinaryView>(`/api/hr/disciplinary/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        eyebrow={disc.referenceNumber}
        title={disc.employeeName}
        description={`${disc.entityCode} · ${disc.category} · incident ${disc.incidentOn}`}
      />
      <p className="mb-3 text-[13px]">
        <StatusBadge status={disc.status} /> {disc.outcome ?? ''}
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Surface>
            <SurfaceHeader title="Description" />
            <p className="px-4 py-3 whitespace-pre-wrap text-[13px]">{disc.description}</p>
          </Surface>
          <Surface padded={false} className="mt-4">
            <SurfaceHeader title="Events" description="Reopen inserts a new event. Prior decisions stay." />
            <ul className="divide-y divide-ink-100 text-[13px]">
              {disc.events.map((event) => (
                <li key={event.id} className="px-4 py-2">
                  <p className="font-medium">
                    {event.kind}
                    {event.outcome ? ` · ${event.outcome}` : ''}
                  </p>
                  <p>{event.body}</p>
                  <p className="text-[12px] text-ink-500">
                    {event.actorName} · {event.occurredAt}
                  </p>
                </li>
              ))}
            </ul>
          </Surface>
        </div>
        {me.permissions.includes('hr.disciplinary.manage') ? (
          <Surface>
            <SurfaceHeader title="Recommend outcome" />
            <div className="px-4 py-3">
              <RecommendForm id={disc.id} rowVersion={disc.rowVersion} />
            </div>
          </Surface>
        ) : (
          <Surface>
            <SurfaceHeader title="MD decision" description="Approve or reject from Workflows pending." />
            <p className="px-4 py-3 text-[13px]">
              {disc.workflowInstanceId
                ? 'This case is waiting on /workflows/pending.'
                : 'Written warning and below complete with HR only.'}
            </p>
          </Surface>
        )}
      </div>
    </>
  );
}
