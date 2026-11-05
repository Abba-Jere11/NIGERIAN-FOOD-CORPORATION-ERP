import Link from 'next/link';
import type { MeView, OrgReportDashboardView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Official reports — NFC' };

const MD_CARDS: Array<{ key: keyof OrgReportDashboardView; label: string; href: string }> = [
  { key: 'incoming', label: 'Incoming reports', href: '/org-reports/incoming' },
  { key: 'underReview', label: 'Reports under review', href: '/org-reports/incoming?status=UNDER_REVIEW' },
  { key: 'recentlyForwarded', label: 'Recently forwarded', href: '/org-reports/forwarded' },
  { key: 'minutesIssued', label: 'Official minutes issued', href: '/org-reports/minutes/issued' },
  { key: 'minutesAwaitingResponse', label: 'Minutes awaiting responses', href: '/org-reports/minutes/issued' },
  { key: 'responsesAwaitingReview', label: 'Responses awaiting review', href: '/org-reports/responses' },
  { key: 'outstandingActions', label: 'Outstanding actions', href: '/org-reports/minutes/issued' },
  { key: 'recentDecisions', label: 'Recent management decisions', href: '/org-reports/decisions' },
];

const USER_CARDS: Array<{ key: keyof OrgReportDashboardView; label: string; href: string }> = [
  { key: 'myReports', label: 'My reports', href: '/org-reports/mine' },
  { key: 'receivedForInformation', label: 'Received for information', href: '/org-reports/information' },
  { key: 'assignedMinutes', label: 'Official minutes assigned to me', href: '/org-reports/minutes' },
  { key: 'responsesAwaitingSubmission', label: 'Responses awaiting submission', href: '/org-reports/minutes' },
];

export default async function OrgReportsDashboardPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (me.permissions.includes('org_report.template.manage') && !me.permissions.includes('org_report.view')) {
    redirect('/org-reports/admin/templates');
  }
  if (!me.permissions.includes('org_report.view') && !me.permissions.includes('org_report.create')) {
    redirect('/forbidden');
  }
  const dash = await apiFetch<OrgReportDashboardView>('/api/org-reports/dashboard');
  const isMd = me.permissions.includes('org_report.forward');
  const cards = isMd ? [...MD_CARDS, ...USER_CARDS] : USER_CARDS;

  return (
    <>
      <PageHeader
        eyebrow="Official correspondence"
        title="Official reports"
        description="Submit information to the Managing Director. Forwarding is not an instruction. Official minutes assign work."
        actions={
          me.permissions.includes('org_report.create') ? (
            <ButtonLink href="/org-reports/new" variant="primary">
              Create report
            </ButtonLink>
          ) : null
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.key}
            href={card.href}
            className="border border-ink-200 bg-surface px-4 py-3 hover:border-accent-400"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{card.label}</p>
            <p className="mt-1 text-2xl tabular text-ink-900">{dash[card.key]}</p>
          </Link>
        ))}
      </div>
      {cards.every((card) => dash[card.key] === 0) ? (
        <Surface className="mt-4">
          <EmptyState
            title="No official correspondence yet"
            description="Create a report, or wait until one is sent to you for information or action."
          />
        </Surface>
      ) : null}
      <Surface className="mt-4">
        <SurfaceHeader
          title="How this module works"
          description="A report informs the MD. A CC copy is read-only. A forward shares the original. An official minute assigns work."
        />
      </Surface>
    </>
  );
}
