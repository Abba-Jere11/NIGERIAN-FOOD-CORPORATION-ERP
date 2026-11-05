import type {
  EntityView,
  HrEmployeeListItemView,
  MeView,
  PayrollDashboardView,
  PayrollRemittanceView,
  PayrollRunListItemView,
  PayrollSettingsView,
  PayrollStructureView,
} from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { ConfirmStructureForm, CreateRunForm, SettingsForm, StructureForm } from './PayrollForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payroll — HR — NFC' };

export default async function PayrollPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('payroll.view')) redirect('/forbidden');
  const [dash, runs, structures, settings, remittances, employees, entities, periods] = await Promise.all([
    apiFetch<PayrollDashboardView>('/api/payroll/dashboard'),
    apiFetch<PayrollRunListItemView[]>('/api/payroll/runs'),
    apiFetch<PayrollStructureView[]>('/api/payroll/structures'),
    apiFetch<PayrollSettingsView>('/api/payroll/settings'),
    apiFetch<PayrollRemittanceView[]>('/api/payroll/reports/remittance').catch(() => [] as PayrollRemittanceView[]),
    apiFetch<HrEmployeeListItemView[]>('/api/hr/employees').catch(() => [] as HrEmployeeListItemView[]),
    apiFetch<EntityView[]>('/api/entities').catch(() => [] as EntityView[]),
    apiFetch<Array<{ id: string; name: string; entityCode: string | null }>>('/api/payroll/periods').catch(
      () => [] as Array<{ id: string; name: string; entityCode: string | null }>,
    ),
  ]);
  const entityOpts = entities.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` }));
  const employeeOpts = employees.map((row) => ({
    value: row.id,
    label: `${row.referenceNumber} ${row.name}`,
  }));
  const periodOpts = periods.map((row) => ({
    value: row.id,
    label: `${row.entityCode ?? ''} ${row.name}`.trim(),
  }));

  return (
    <>
      <PageHeader
        eyebrow="Payroll"
        title="Payroll runs"
        description="HR prepares. Finance Head approves and pays. ED Finance approves above the net threshold."
      />
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Surface>
          <p className="text-[11px] uppercase text-ink-500">Calculated</p>
          <p className="tabular text-lg">{dash.calculated}</p>
        </Surface>
        <Surface>
          <p className="text-[11px] uppercase text-ink-500">Submitted</p>
          <p className="tabular text-lg">{dash.submitted}</p>
        </Surface>
        <Surface>
          <p className="text-[11px] uppercase text-ink-500">Locked unpaid</p>
          <p className="tabular text-lg">{dash.lockedUnpaid}</p>
        </Surface>
        <Surface>
          <p className="text-[11px] uppercase text-ink-500">Unremitted</p>
          <p className="tabular text-lg">{dash.unremitted}</p>
        </Surface>
      </div>
      {me.permissions.includes('payroll.run.prepare') ? (
        <Surface className="mb-4">
          <SurfaceHeader title="New run" description="One open run per subsidiary period." />
          <div className="px-4 py-3">
            <CreateRunForm entities={entityOpts} periods={periodOpts} />
          </div>
        </Surface>
      ) : null}
      <Surface className="mb-4" padded={false}>
        <SurfaceHeader title="Runs" />
        {runs.length === 0 ? (
          <EmptyState title="No payroll runs" description="Create a draft for an open fiscal period." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Reference</th>
                <th className="px-4 py-2 font-semibold">Subsidiary</th>
                <th className="px-4 py-2 font-semibold">Period</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Net</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2 font-mono">
                    <Link href={`/hr/payroll/${row.id}`} className="text-accent-800 underline">
                      {row.referenceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.entityCode}</td>
                  <td className="px-4 py-2">{row.periodName}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-2 tabular">
                    {row.netKobo == null ? '—' : formatKobo(BigInt(row.netKobo))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
      {me.permissions.includes('payroll.structure.manage') ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Salary structure" description="Effective-dated. Confirming updates the employee snapshot." />
          <div className="px-4 py-3">
            <StructureForm entities={entityOpts} employees={employeeOpts} />
          </div>
        </Surface>
      ) : null}
      <Surface className="mb-4" padded={false}>
        <SurfaceHeader title="Structures" />
        {structures.length === 0 ? (
          <EmptyState title="No structures" description="Draft a structure against an employee, then confirm it." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Employee</th>
                <th className="px-4 py-2 font-semibold">Basic</th>
                <th className="px-4 py-2 font-semibold">Effective</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {structures.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">{row.employeeName ?? row.gradeKey ?? '—'}</td>
                  <td className="px-4 py-2 tabular">{formatKobo(BigInt(row.basicKobo))}</td>
                  <td className="px-4 py-2">{row.effectiveOn}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-2">
                    {row.status === 'DRAFT' && me.permissions.includes('payroll.structure.manage') ? (
                      <ConfirmStructureForm id={row.id} rowVersion={row.rowVersion} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
      {me.permissions.includes('payroll.config') ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Settings" description="PAYE and pension rates are separate dated rows. Changing them writes a payroll_change audit." />
          <div className="px-4 py-3">
            <SettingsForm
              threshold={settings.edFinanceThresholdKobo}
              overtime={settings.overtimeMultiplierBps}
              includeSuspended={settings.includeSuspended}
              divisor={settings.unpaidLeaveDailyDivisor}
              rowVersion={settings.rowVersion}
            />
          </div>
        </Surface>
      ) : null}
      <Surface padded={false}>
        <SurfaceHeader title="Statutory remittance" />
        {remittances.length === 0 ? (
          <EmptyState title="No remittance rows" description="They are created when a locked run is paid." />
        ) : (
          <ul className="divide-y divide-ink-100 text-[13px]">
            {remittances.map((row) => (
              <li key={row.id} className="flex justify-between px-4 py-2">
                <span>
                  {row.kind} · {row.status}
                </span>
                <span className="tabular">{formatKobo(BigInt(row.amountKobo))}</span>
              </li>
            ))}
          </ul>
        )}
      </Surface>
    </>
  );
}
