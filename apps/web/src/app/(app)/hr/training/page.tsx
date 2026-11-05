import type { HrEmployeeListItemView, HrTrainingView, MeView } from '@nfc/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { TrainingForm } from '../HrForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Training — HR — NFC' };

export default async function TrainingPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('hr.training.view')) redirect('/forbidden');
  const [rows, employees] = await Promise.all([
    apiFetch<HrTrainingView[]>('/api/hr/training'),
    apiFetch<HrEmployeeListItemView[]>('/api/hr/employees').catch(() => [] as HrEmployeeListItemView[]),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Development"
        title="Training"
        description="One session, many participants. Costed sessions use existing expense-v1."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Surface padded={false}>
            <SurfaceHeader title="Sessions" />
            {rows.length === 0 ? (
              <EmptyState title="No sessions" description="Create a session and add participants." />
            ) : (
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase text-ink-500">
                  <tr>
                    <th className="px-4 py-2">Reference</th>
                    <th className="px-4 py-2">Title</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-ink-100">
                      <td className="px-4 py-2 font-mono">
                        <Link href={`/hr/training/${row.id}`} className="underline">
                          {row.referenceNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-2">{row.title}</td>
                      <td className="px-4 py-2">
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Surface>
        </div>
        {me.permissions.includes('hr.training.manage') ? (
          <Surface>
            <SurfaceHeader title="New session" />
            <div className="px-4 py-3">
              <TrainingForm
                entities={me.entities.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` }))}
                employees={employees.map((row) => ({
                  value: row.id,
                  label: `${row.referenceNumber} ${row.name}`,
                }))}
              />
            </div>
          </Surface>
        ) : null}
      </div>
    </>
  );
}
