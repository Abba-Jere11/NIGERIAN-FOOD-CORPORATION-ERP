import type { CasePersonView, CaseView, MeView } from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import { notFound, redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch, ApiError } from '@/lib/api';
import { CaseAccessForm, CaseCommentForm, CaseStatusForm } from '../CaseForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Case — NFC' };

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await apiFetch<MeView>('/api/me');
  let view: CaseView;
  try {
    view = await apiFetch<CaseView>(`/api/cases/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.isForbidden)) redirect('/forbidden');
    throw error;
  }
  if (!view) notFound();

  const isCc = view.myKind === 'CC';
  const canAssign = !isCc && me.permissions.includes('cases.assign');
  const canGrant = !isCc && me.permissions.includes('cases.grant');
  const canClose = !isCc && me.permissions.includes('cases.close');
  const people =
    canAssign || canGrant
      ? await apiFetch<CasePersonView[]>('/api/cases/directory').catch(() => [])
      : [];
  const choices = people.filter((row) => row.id !== me.ref);

  return (
    <>
      <PageHeader
        eyebrow={view.referenceNumber}
        title={view.title}
        description={`${view.createdByName ?? 'Opened'} · ${formatLagosDateTime(view.createdAt)}`}
        actions={<StatusBadge status={view.status} />}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Surface className="lg:col-span-2">
          <SurfaceHeader title="Details" />
          <div className="space-y-4 px-4 py-3 text-[13px] text-ink-800">
            <p className="whitespace-pre-wrap">{view.body}</p>
            <p className="text-ink-500">
              Assigned: {view.assignedUserName ?? '—'}
              {view.myKind ? ` · Your access: ${view.myKind}` : null}
            </p>
          </div>
        </Surface>
        <div className="space-y-4">
          {canAssign || canGrant ? (
            <Surface>
              <SurfaceHeader
                title="Access"
                description="Assign sets the handler. Grant and CC do not."
              />
              <div className="space-y-4 px-4 py-3">
                {canAssign ? (
                  <CaseAccessForm caseId={view.id} kind="ASSIGNEE" label="Assign handler" people={choices} />
                ) : null}
                {canGrant ? (
                  <>
                    <CaseAccessForm caseId={view.id} kind="GRANT" label="Grant access" people={choices} />
                    <CaseAccessForm caseId={view.id} kind="CC" label="CC" people={choices} />
                  </>
                ) : null}
              </div>
            </Surface>
          ) : null}
          {!isCc ? (
            <Surface>
              <SurfaceHeader title="Status" />
              <div className="px-4 py-3">
                <CaseStatusForm caseId={view.id} status={view.status} canClose={canClose} />
              </div>
            </Surface>
          ) : (
            <Surface>
              <SurfaceHeader title="Status" description="CC recipients can read and comment only." />
              <div className="px-4 py-3">
                <StatusBadge status={view.status} />
              </div>
            </Surface>
          )}
          <Surface>
            <SurfaceHeader title="People on this case" />
            <ul className="divide-y divide-ink-100 px-4 py-2 text-[13px]">
              {view.access.length === 0 ? (
                <li className="py-2 text-ink-500">No extra access yet.</li>
              ) : (
                view.access.map((row) => (
                  <li key={`${row.userId}-${row.kind}`} className="flex justify-between gap-2 py-2">
                    <span>{row.userName ?? row.userId}</span>
                    <span className="text-ink-500">{row.kind}</span>
                  </li>
                ))
              )}
            </ul>
          </Surface>
        </div>
      </div>
      <Surface className="mt-4">
        <SurfaceHeader title="Comments" description="Everyone on the case, including CC, may comment." />
        <div className="space-y-3 px-4 py-3">
          {view.comments.length === 0 ? (
            <p className="text-[13px] text-ink-500">No comments yet.</p>
          ) : (
            <ul className="space-y-3">
              {view.comments.map((row) => (
                <li key={row.id} className="border-b border-ink-100 pb-3 text-[13px]">
                  <p className="font-medium text-ink-900">
                    {row.createdByName ?? 'Someone'}{' '}
                    <span className="font-normal text-ink-500">{formatLagosDateTime(row.createdAt)}</span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-ink-800">{row.body}</p>
                </li>
              ))}
            </ul>
          )}
          <CaseCommentForm caseId={view.id} />
        </div>
      </Surface>
    </>
  );
}
