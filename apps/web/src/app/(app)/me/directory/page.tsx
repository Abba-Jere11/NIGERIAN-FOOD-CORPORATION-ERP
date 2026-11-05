import { redirect } from 'next/navigation';
import type { DirectoryEntryView, MeView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Directory — NFC' };

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; department?: string }>;
}) {
  const { q, department } = await searchParams;
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('directory.view')) redirect('/forbidden');
  const rows = await apiFetch<DirectoryEntryView[]>('/api/directory', { query: { q } });
  const departments = [...new Set(rows.map((row) => row.departmentName).filter(Boolean))] as string[];
  const visible = department ? rows.filter((row) => row.departmentName === department) : rows;

  return (
    <>
      <PageHeader
        eyebrow="My workspace"
        title="Directory"
        description="Work details only. You see colleagues in the subsidiaries your role can reach."
      />
      <Surface padded={false}>
        <SurfaceHeader title="People" />
        <form className="flex flex-wrap gap-2 px-4 py-3" action="/me/directory">
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Name"
            aria-label="Search directory"
            className="h-9 border border-ink-300 px-2 text-sm"
          />
          <select
            name="department"
            defaultValue={department ?? ''}
            aria-label="Department"
            className="h-9 border border-ink-300 px-2 text-sm"
          >
            <option value="">All departments</option>
            {departments.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button type="submit" className="h-9 border border-ink-300 px-3 text-sm">
            Search
          </button>
        </form>
        <ul className="divide-y divide-ink-100 text-[13px]">
          {visible.map((row) => (
            <li key={row.employeeId} className="px-4 py-2">
              <p className="font-medium">{row.name}</p>
              <p className="text-ink-500">
                {row.entityCode} · {row.departmentName ?? '—'} · {row.positionTitle ?? '—'}
              </p>
              <p>
                {row.workEmail ?? 'No work email'} · {row.workPhone ?? 'No work phone'}
              </p>
            </li>
          ))}
        </ul>
      </Surface>
    </>
  );
}
