import { redirect } from 'next/navigation';
import type { MeView, SealView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function AdminSealsPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('admin.health.view')) redirect('/forbidden');
  const query = await searchParams;
  const reference = query.reference?.trim() ?? '';
  const result =
    reference === ''
      ? null
      : await apiFetch<{ reference: string; subjectId: string; seals: SealView[] }>(
          '/api/admin/seals/verify',
          { query: { reference } },
        ).catch(() => null);

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Seal verification"
        description="Resolve a procurement reference and recompute seal integrity."
      />
      <Surface>
        <form action="/admin/seals" method="get" className="flex flex-wrap items-end gap-2">
          <label className="block text-[13px]">
            <span className="text-ink-600">Reference</span>
            <input
              name="reference"
              defaultValue={reference}
              placeholder="PR-2026-000184"
              className="mt-1 block w-64 border border-ink-200 px-2 py-1 text-[13px]"
            />
          </label>
          <button type="submit" className="border border-ink-300 px-3 py-1 text-[13px]">
            Verify
          </button>
        </form>
      </Surface>
      {result ? (
        <Surface padded={false} className="mt-4">
          <SurfaceHeader title={result.reference} description={`Subject ${result.subjectId}`} />
          <ul className="divide-y divide-ink-100 px-4 py-2 text-[13px]">
            {result.seals.map((seal) => (
              <li key={seal.id} className="py-2">
                <span className="font-medium">{seal.badgeLabel}</span> — {seal.verification}
                <span className="text-ink-500"> · {seal.approverName}</span>
              </li>
            ))}
          </ul>
        </Surface>
      ) : reference ? (
        <p className="mt-4 text-[13px] text-ink-600">No match or verification failed.</p>
      ) : null}
    </>
  );
}
