import Link from 'next/link';
import type { MeView, OrgDecisionView } from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Management decisions — NFC' };

export default async function DecisionsPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('org_report.decide')) redirect('/forbidden');
  const rows = await apiFetch<OrgDecisionView[]>('/api/org-reports/decisions');
  return (
    <>
      <PageHeader
        eyebrow="Managing Director"
        title="Management decisions"
        description="A decision is not a report, a forwarding event, a minute or a response."
      />
      <Surface padded={false}>
        <SurfaceHeader title="Register" />
        {rows.length === 0 ? (
          <EmptyState title="No decisions recorded" description="Record a decision from a report detail page." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Reference</th>
                <th className="px-4 py-2 font-semibold">Subject</th>
                <th className="px-4 py-2 font-semibold">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2 font-mono">{row.referenceNumber}</td>
                  <td className="px-4 py-2">
                    <Link href={`/org-reports/${row.reportId}`} className="underline">
                      {row.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{formatLagosDateTime(row.decidedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
