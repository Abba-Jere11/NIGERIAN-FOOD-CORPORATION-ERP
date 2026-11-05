import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { MeView, OrgReportPersonView, OrgReportView } from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  AmendForm,
  AttachmentForm,
  CloseForm,
  DecisionForm,
  DraftActions,
  ExternalForm,
  ForwardForm,
  MinuteForm,
} from '../OrgReportForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Official report — NFC' };

export default async function OrgReportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ submitted?: string }>;
}) {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('org_report.view') && !me.permissions.includes('org_report.create')) {
    redirect('/forbidden');
  }
  const { id } = await params;
  const query = await searchParams;
  let report: OrgReportView;
  try {
    report = await apiFetch<OrgReportView>(`/api/org-reports/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const people = me.permissions.includes('org_report.forward') || me.permissions.includes('org_report.minute.issue')
    ? await apiFetch<OrgReportPersonView[]>('/api/org-reports/directory').catch(() => [] as OrgReportPersonView[])
    : [];
  const readOnly = report.myKind === 'CC' || report.myKind === 'FORWARD';
  const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

  return (
    <>
      <PageHeader
        eyebrow="Official report"
        title={report.title}
        description={`${report.referenceNumber} · ${report.templateTitle} · ${report.entityCode ?? ''}`}
        actions={
          <ButtonLink href={`${api}/api/org-reports/${report.id}/pdf`} variant="secondary">
            Print / PDF
          </ButtonLink>
        }
      />
      {query.submitted === '1' ? (
        <Surface className="mb-4">
          <SurfaceHeader
            title="Report submitted"
            description={`Reference ${report.referenceNumber} was submitted to ${report.toName ?? 'the Managing Director'} at ${report.submittedAt ? formatLagosDateTime(report.submittedAt) : 'the recorded time'}. CC: ${report.originalCc.length > 0 ? report.originalCc.map((item) => item.name).join(', ') : 'None'}.`}
          />
        </Surface>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Surface>
            <SurfaceHeader title="Original correspondence" description="Later forwarding does not change these fields." />
            <dl className="grid gap-2 px-4 py-3 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-ink-500">From</dt>
                <dd>{report.senderName}</dd>
              </div>
              <div>
                <dt className="text-ink-500">To</dt>
                <dd>{report.originalTo?.name ?? report.toName ?? 'Managing Director'}</dd>
              </div>
              <div>
                <dt className="text-ink-500">CC</dt>
                <dd>{report.originalCc.length > 0 ? report.originalCc.map((item) => item.name).join(', ') : 'None'}</dd>
              </div>
              <div>
                <dt className="text-ink-500">Status</dt>
                <dd>
                  <StatusBadge status={report.status} />
                </dd>
              </div>
              {report.reportingPeriod ? (
                <div>
                  <dt className="text-ink-500">Period</dt>
                  <dd>{report.reportingPeriod}</dd>
                </div>
              ) : null}
            </dl>
            <div className="border-t border-ink-100 px-4 py-3 text-[13px] whitespace-pre-wrap">{report.body}</div>
            {report.observations ? (
              <div className="border-t border-ink-100 px-4 py-3 text-[13px]">
                <p className="font-semibold">Observations</p>
                <p className="mt-1 whitespace-pre-wrap">{report.observations}</p>
              </div>
            ) : null}
          </Surface>
          {report.forwards.length > 0 ? (
            <Surface>
              <SurfaceHeader title="Forwarding record" description="Separate from the original To and CC." />
              <ul className="px-4 py-3 text-[13px] space-y-2">
                {report.forwards.map((item) => (
                  <li key={item.id}>
                    Forwarded by {item.forwardedByName} on {formatLagosDateTime(item.createdAt)} to{' '}
                    {item.recipients.map((person) => person.name).join(', ')}
                    {item.note ? `. Note: ${item.note}` : ''}
                  </li>
                ))}
              </ul>
            </Surface>
          ) : null}
          <Surface>
            <SurfaceHeader title="Linked official minutes" />
            {report.minutes.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-500">No official minutes. Forwarding is not an instruction.</p>
            ) : (
              <ul className="px-4 py-3 text-[13px] space-y-1">
                {report.minutes.map((item) => (
                  <li key={item.id}>
                    <Link href={`/org-reports/minutes/${item.id}`} className="underline">
                      {item.referenceNumber}
                    </Link>{' '}
                    {item.subject} · <StatusBadge status={item.status} />
                  </li>
                ))}
              </ul>
            )}
          </Surface>
          <Surface>
            <SurfaceHeader title="Management decisions" />
            {report.decisions.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-500">No management decision has been recorded.</p>
            ) : (
              <ul className="px-4 py-3 text-[13px] space-y-2">
                {report.decisions.map((item) => (
                  <li key={item.id}>
                    <span className="font-mono">{item.referenceNumber}</span> — {item.subject}
                    <p className="mt-1 whitespace-pre-wrap">{item.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Surface>
          <Surface>
            <SurfaceHeader title="History" />
            <ol className="px-4 py-3 text-[13px] space-y-2">
              {report.history.map((item, index) => (
                <li key={`${item.at}-${index}`}>
                  {formatLagosDateTime(item.at)} · {item.actorName ?? item.actor} · {item.detail}
                </li>
              ))}
            </ol>
          </Surface>
        </div>
        <div className="space-y-4">
          <Surface>
            <SurfaceHeader title="Attachments" />
            <ul className="px-4 py-2 text-[13px]">
              {report.attachments.length === 0 ? <li className="text-ink-500">None</li> : null}
              {report.attachments.map((item) => (
                <li key={item.id}>
                  <Link href={`/documents/${item.id}`} className="underline">
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
            {report.status === 'DRAFT' && report.senderUserId === me.ref ? (
              <div className="px-4 pb-3">
                <AttachmentForm ownerId={report.id} ownerType="org_report" entityId={report.entityId} />
              </div>
            ) : null}
          </Surface>
          {report.status === 'DRAFT' && report.senderUserId === me.ref ? (
            <Surface>
              <SurfaceHeader title="Draft" />
              <div className="px-4 py-3">
                <DraftActions report={report} />
              </div>
            </Surface>
          ) : null}
          {readOnly ? (
            <Surface>
              <SurfaceHeader title="Your access" description="This is a read-only copy. It does not grant authority to edit, forward, issue minutes or send externally." />
            </Surface>
          ) : null}
          {!readOnly && me.permissions.includes('org_report.forward') && report.status !== 'DRAFT' ? (
            <Surface>
              <SurfaceHeader title="Forward report" description="Shares a copy. Does not assign work." />
              <div className="px-4 py-3">
                <ForwardForm report={report} people={people} />
              </div>
            </Surface>
          ) : null}
          {!readOnly && me.permissions.includes('org_report.minute.issue') && report.status !== 'DRAFT' ? (
            <Surface>
              <SurfaceHeader title="Issue official minute" description="This is how work is assigned." />
              <div className="px-4 py-3">
                <MinuteForm report={report} people={people} />
              </div>
            </Surface>
          ) : null}
          {!readOnly && me.permissions.includes('org_report.decide') && report.status !== 'DRAFT' ? (
            <Surface>
              <SurfaceHeader title="Management decision" />
              <div className="px-4 py-3">
                <DecisionForm report={report} />
              </div>
            </Surface>
          ) : null}
          {!readOnly && me.permissions.includes('org_report.email') && report.status !== 'DRAFT' ? (
            <Surface>
              <SurfaceHeader title="External correspondence" />
              <div className="px-4 py-3">
                <ExternalForm report={report} />
              </div>
            </Surface>
          ) : null}
          {!readOnly && me.permissions.includes('org_report.close') && report.status !== 'DRAFT' ? (
            <Surface>
              <SurfaceHeader title="Close or archive" />
              <div className="px-4 py-3 space-y-4">
                <CloseForm report={report} />
                <AmendForm report={report} />
              </div>
            </Surface>
          ) : null}
        </div>
      </div>
    </>
  );
}
