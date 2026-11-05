import type { SearchResultsView } from '@nfc/shared';
import Link from 'next/link';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Search — NFC' };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const query = q.trim();
  const results = query
    ? await apiFetch<SearchResultsView>('/api/search', { query: { q: query } })
    : { query: '', groups: [] };

  return (
    <>
      <PageHeader
        eyebrow="Search"
        title="Global search"
        description="Results are limited to records your role and subsidiary may see."
      />
      <form action="/search" method="get" className="mb-4 md:hidden">
        <label className="block text-[12px] text-ink-600" htmlFor="search-q">
          Query
        </label>
        <input
          id="search-q"
          name="q"
          defaultValue={query}
          className="mt-1 h-9 w-full border border-ink-300 px-2 text-[13px]"
        />
      </form>
      {query === '' ? (
        <Surface>
          <EmptyState title="Enter a search" description="Reference numbers, names and amounts are all accepted." />
        </Surface>
      ) : results.groups.length === 0 ? (
        <Surface>
          <EmptyState title="No matching records" description={`Nothing visible to you matches “${query}”.`} />
        </Surface>
      ) : (
        <div className="space-y-4">
          {results.groups.map((group) => (
            <Surface key={group.type} padded={false}>
              <h2 className="border-b border-ink-200 px-4 py-2 text-[13px] font-semibold uppercase tracking-wide text-ink-600">
                {group.type}
              </h2>
              <ul>
                {group.hits.map((hit) => (
                  <li key={`${hit.recordType}-${hit.recordId}`} className="border-b border-ink-100 px-4 py-2 last:border-b-0">
                    {hit.href ? (
                      <Link href={hit.href} className="text-[13px] text-accent-800 underline">
                        {hit.referenceNumber ?? hit.title}
                      </Link>
                    ) : (
                      <span className="text-[13px] text-ink-900">{hit.referenceNumber ?? hit.title}</span>
                    )}
                    <p className="text-[12px] text-ink-600">{hit.title}</p>
                  </li>
                ))}
              </ul>
            </Surface>
          ))}
        </div>
      )}
    </>
  );
}
