import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { MeView, OrgMinuteView } from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { MinuteButton, ResponseForm, ReviewForm } from '../../OrgReportForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Official minute — NFC' };

export default async function MinuteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('org_report.view') && !me.permissions.includes('org_report.minute.respond')) {
    redirect('/forbidden');
  }
  const { id } = await params;
  let minute: OrgMinuteView;
  try {
    minute = await apiFetch<OrgMinuteView>(`/api/org-reports/minutes/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
  const assignee = minute.toUserId === me.ref;
  const issuer = minute.myKind === 'ISSUER' || me.permissions.includes('org_report.minute.review');

  return (
    <>
      <PageHeader
        eyebrow="Official minute"
        title={minute.subject}
        description={`${minute.referenceNumber} · related ${minute.sourceReportReference}`}
        actions={
          <ButtonLink href={`${api}/api/org-reports/minutes/${minute.id}/pdf`} variant="secondary">
            Print / PDF
          </ButtonLink>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Surface>
            <SurfaceHeader title="Instruction" />
            <dl className="grid gap-2 px-4 py-3 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-ink-500">From</dt>
                <dd>{minute.issuerName}</dd>
              </div>
              <div>
                <dt className="text-ink-500">To</dt>
                <dd>{minute.toName}</dd>
              </div>
              <div>
                <dt className="text-ink-500">CC</dt>
                <dd>
                  {minute.recipients.filter((item) => item.kind === 'CC').map((item) => item.userName).join(', ') || 'None'}
                </dd>
              </div>
              <div>
                <dt className="text-ink-500">Status</dt>
                <dd>
                  <StatusBadge status={minute.status} />
                </dd>
              </div>
              <div>
                <dt className="text-ink-500">Related report</dt>
                <dd>
                  <Link href={`/org-reports/${minute.sourceReportId}`} className="underline">
                    {minute.sourceReportReference}
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="text-ink-500">Deadline</dt>
                <dd>{minute.dueAt ? formatLagosDateTime(minute.dueAt) : '—'}</dd>
              </div>
            </dl>
            <div className="border-t border-ink-100 px-4 py-3 text-[13px] whitespace-pre-wrap">{minute.instruction}</div>
          </Surface>
          <Surface>
            <SurfaceHeader title="Responses" description="Further action keeps earlier responses." />
            {minute.responses.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-500">No response submitted yet.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {minute.responses.map((item) => (
                  <li key={item.id} className="px-4 py-3 text-[13px]">
                    <p className="font-mono">{item.referenceNumber}</p>
                    <p className="font-medium">{item.subject}</p>
                    <p className="mt-1 whitespace-pre-wrap">{item.body}</p>
                    {item.outcome ? <p className="mt-1">Outcome: {item.outcome}</p> : null}
                    <StatusBadge status={item.status} />
                  </li>
                ))}
              </ul>
            )}
          </Surface>
        </div>
        <div className="space-y-4">
          {assignee && minute.status !== 'COMPLETED' && minute.status !== 'DRAFT' ? (
            <Surface>
              <SurfaceHeader title="Assignee actions" />
              <div className="space-y-3 px-4 py-3">
                {minute.acknowledgementRequired && minute.status === 'ISSUED' ? (
                  <MinuteButton minuteId={minute.id} rowVersion={minute.rowVersion} path="acknowledge" label="Acknowledge receipt" />
                ) : null}
                {['ISSUED', 'ACKNOWLEDGED', 'FURTHER_ACTION_REQUIRED', 'REOPENED'].includes(minute.status) ? (
                  <MinuteButton minuteId={minute.id} rowVersion={minute.rowVersion} path="progress" label="Mark in progress" />
                ) : null}
                <ResponseForm minute={minute} />
              </div>
            </Surface>
          ) : null}
          {issuer && minute.status !== 'DRAFT' ? (
            <Surface>
              <SurfaceHeader title="MD review" />
              <div className="px-4 py-3">
                <ReviewForm minute={minute} />
              </div>
            </Surface>
          ) : null}
        </div>
      </div>
    </>
  );
}
