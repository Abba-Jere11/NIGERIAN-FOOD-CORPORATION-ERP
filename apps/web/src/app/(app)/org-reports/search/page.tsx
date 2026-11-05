import Link from 'next/link';
import type { MeView, OrgReportSearchHitView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Search official records — NFC' };

export default async function OrgReportSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('org_report.view') && !me.permissions.includes('org_report.create')) {
    redirect('/forbidden');
  }
  const { q } = await searchParams;
  const hits = q
    ? await apiFetch<OrgReportSearchHitView[]>('/api/org-reports/search', { query: { q } })
    : [];
  return (
    <>
      <PageHeader
        eyebrow="Official reports"
        title="Search / records"
        description="Results only include documents you are allowed to see."
      />
      <Surface className="mb-4">
        <form action="/org-reports/search" method="get" className="px-4 py-3">
          <label className="block text-[12px] font-semibold text-ink-700" htmlFor="org-search">
            Search
          </label>
          <input
            id="org-search"
            name="q"
            defaultValue={q ?? ''}
            className="mt-1 w-full border border-ink-300 px-2 py-1.5 text-sm"
            placeholder="Reference, title, sender or unit"
          />
        </form>
      </Surface>
      <Surface padded={false}>
        <SurfaceHeader title="Results" />
        {hits.length === 0 ? (
          <EmptyState
            title={q ? 'No matching records' : 'Enter a search'}
            description="Access restrictions apply to every result."
          />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Reference</th>
                <th className="px-4 py-2 font-semibold">Title</th>
                <th className="px-4 py-2 font-semibold">Type</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((hit) => (
                <tr key={`${hit.recordType}-${hit.id}`} className="border-b border-ink-100">
                  <td className="px-4 py-2 font-mono">
                    <Link href={hit.href} className="underline">
                      {hit.referenceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{hit.title}</td>
                  <td className="px-4 py-2">{hit.recordType.replace('_', ' ')}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={hit.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
