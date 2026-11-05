import type { EdmsGatewayView, EdmsSearchHitView } from '@nfc/shared';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function EdmsExplorerPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ q?: string; all?: string }>;
}) {
  const { code } = await params;
  const query = await searchParams;
  const gateway = await apiFetch<EdmsGatewayView>('/api/edms/gateway');
  const entity = gateway.entities.find((item) => item.code === code);

  const hits =
    query.q && query.q.trim() !== '' && entity
      ? await apiFetch<EdmsSearchHitView[]>('/api/edms/search', {
          query: {
            q: query.q,
            entityId: query.all === '1' ? undefined : entity.id,
            all: query.all === '1' ? '1' : undefined,
          },
        }).catch(() => [] as EdmsSearchHitView[])
      : null;

  if (hits) {
    return (
      <div className="p-4">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink-900">Search results</h2>
          <p className="text-[12px] text-ink-500">
            {hits.length === 0
              ? 'No matches'
              : hits.length === 1
                ? '1 match'
                : `${hits.length} matches`}
            {query.all === '1' ? ' across your subsidiaries' : ` in ${code}`}
          </p>
        </div>
        {hits.length === 0 ? (
          <EmptyState
            title="No documents matched"
            description="Try another title or reference number. Search stays within entities you may view."
          />
        ) : (
          <ul className="divide-y divide-ink-100 border border-ink-200">
            {hits.map((hit) => (
              <li key={hit.id}>
                <Link
                  href={hit.href}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2.5 hover:bg-accent-50"
                >
                  <span className="font-medium text-ink-900">{hit.title}</span>
                  {hit.referenceNumber ? (
                    <span className="font-mono text-[12px] text-ink-500">{hit.referenceNumber}</span>
                  ) : null}
                  {hit.entityCode ? (
                    <span className="ml-auto text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                      {hit.entityCode}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <EmptyState
      className="py-16"
      title="Select a folder"
      description="Expand the tree on the left and open a module folder to list its documents. Use Active or Archived above to switch space."
    />
  );
}
