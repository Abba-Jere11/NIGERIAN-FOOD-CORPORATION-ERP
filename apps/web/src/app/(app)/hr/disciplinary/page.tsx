import type { HrDisciplinaryView, HrEmployeeListItemView, MeView } from '@nfc/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { DisciplinaryForm } from '../HrForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Disciplinary — HR — NFC' };

export default async function DisciplinaryPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('hr.disciplinary.view') && !me.permissions.includes('hr.disciplinary.approve')) {
    redirect('/forbidden');
  }
  const [rows, employees] = await Promise.all([
    apiFetch<HrDisciplinaryView[]>('/api/hr/disciplinary'),
    me.permissions.includes('hr.employee.view')
      ? apiFetch<HrEmployeeListItemView[]>('/api/hr/employees')
      : Promise.resolve([] as HrEmployeeListItemView[]),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Confidential"
        title="Disciplinary"
        description="Own ACL, not merged with Cases. Suspension and above wait for the MD."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Surface padded={false}>
            <SurfaceHeader title="Cases" />
            {rows.length === 0 ? (
              <EmptyState title="No visible cases" description="Only handlers and decision makers can open a case." />
            ) : (
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase text-ink-500">
                  <tr>
                    <th className="px-4 py-2">Reference</th>
                    <th className="px-4 py-2">Employee</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-ink-100">
                      <td className="px-4 py-2 font-mono">
                        <Link href={`/hr/disciplinary/${row.id}`} className="underline">
                          {row.referenceNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-2">{row.employeeName}</td>
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
        {me.permissions.includes('hr.disciplinary.manage') ? (
          <Surface>
            <SurfaceHeader title="Open a case" />
            <div className="px-4 py-3">
              <DisciplinaryForm
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
