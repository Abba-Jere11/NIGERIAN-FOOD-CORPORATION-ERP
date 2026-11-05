import type { ReportCatalogItem } from '@nfc/shared';
import Link from 'next/link';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { resolveFinanceScope, withScope } from '../scope';
import type { FinanceContextView } from '@nfc/shared';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports — NFC' };

export default async function ReportsCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<FinanceContextView>('/api/finance/context');
  const resolved = resolveFinanceScope(context, query.scope);
  const catalog = await apiFetch<ReportCatalogItem[]>('/api/finance/reports');
  const scope = resolved.consolidated ? 'consolidated' : resolved.entityCode;

  return (
    <>
      <PageHeader eyebrow="Finance" title="Reports" description={`${resolved.label}. Every figure drills to the ledger.`} />
      <Surface padded={false}>
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Report</th>
              <th className="px-4 py-2 font-semibold">Description</th>
            </tr>
          </thead>
          <tbody>
            {catalog.map((item) => (
              <tr key={item.kind} className="border-b border-ink-100">
                <td className="px-4 py-2">
                  <Link href={withScope(`/finance/reports/${item.kind}`, scope)} className="underline">
                    {item.title}
                  </Link>
                </td>
                <td className="px-4 py-2 text-ink-700">{item.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Surface>
    </>
  );
}
