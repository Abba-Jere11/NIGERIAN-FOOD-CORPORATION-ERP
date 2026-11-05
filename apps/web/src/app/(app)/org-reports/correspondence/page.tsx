import type { MeView, OrgExternalView } from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'External correspondence — NFC' };

export default async function CorrespondencePage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('org_report.email')) redirect('/forbidden');
  const rows = await apiFetch<OrgExternalView[]>('/api/org-reports/correspondence');
  return (
    <>
      <PageHeader
        eyebrow="Managing Director"
        title="External correspondence"
        description="Queued means accepted by this system. Submitted means handed to the mail provider. It does not mean the recipient read it."
      />
      <Surface padded={false}>
        <SurfaceHeader title="Sends" />
        {rows.length === 0 ? (
          <EmptyState title="No external correspondence" description="Send a permitted document from its report page." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Recipient</th>
                <th className="px-4 py-2 font-semibold">Subject</th>
                <th className="px-4 py-2 font-semibold">Sender identity</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">{row.recipientEmail}</td>
                  <td className="px-4 py-2">{row.subject}</td>
                  <td className="px-4 py-2">{row.senderIdentity}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={row.providerStatus.toUpperCase()} />
                    {row.lastError ? <p className="text-[12px] text-danger-700">{row.lastError}</p> : null}
                  </td>
                  <td className="px-4 py-2">{formatLagosDateTime(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
