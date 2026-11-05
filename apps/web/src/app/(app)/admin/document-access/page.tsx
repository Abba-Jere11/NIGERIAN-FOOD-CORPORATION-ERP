import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { MeView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function AdminDocumentAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('admin.health.view')) redirect('/forbidden');
  const query = await searchParams;
  const q = query.q?.trim() ?? '';
  const page = await apiFetch<{
    total: number;
    items: Array<{
      id: string;
      documentId: string;
      documentTitle: string | null;
      action: string;
      actorRef: string;
      occurredAt: string;
      entityCode: string | null;
    }>;
  }>('/api/admin/document-access', { query: { q, limit: 50 } });

  return (
    <>
      <PageHeader eyebrow="Administration" title="Document access log" description="Views and downloads." />
      <Surface className="mb-4">
        <form action="/admin/document-access" method="get" className="flex gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Title, actor or action"
            className="flex-1 border border-ink-200 px-2 py-1 text-[13px]"
          />
          <button type="submit" className="border border-ink-300 px-3 py-1 text-[13px]">
            Search
          </button>
        </form>
      </Surface>
      <Surface padded={false}>
        <SurfaceHeader title="Recent access" description={`${page.total} matching rows`} />
        <ul className="divide-y divide-ink-100 text-[13px]">
          {page.items.map((row) => (
            <li key={row.id} className="px-4 py-2">
              <Link href={`/documents/${row.documentId}`} className="font-medium underline">
                {row.documentTitle ?? row.documentId}
              </Link>
              <span className="text-ink-600">
                {' '}
                · {row.action} · {row.entityCode ?? '—'} · {row.actorRef} ·{' '}
                {new Date(row.occurredAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </Surface>
    </>
  );
}
