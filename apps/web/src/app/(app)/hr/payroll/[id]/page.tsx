import type { MeView, PayrollRunView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import { notFound, redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch, ApiError } from '@/lib/api';
import { AdjustRunForm, PayRunForm, RemitForm, RunActionForm } from '../PayrollForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payroll run — NFC' };

export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('payroll.view')) redirect('/forbidden');
  let run: PayrollRunView;
  try {
    run = await apiFetch<PayrollRunView>(`/api/payroll/runs/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        eyebrow={run.entityCode ?? 'Payroll'}
        title={run.referenceNumber}
        description={`${run.periodName ?? 'Period'} · ${run.employeeCount} employees`}
        actions={<StatusBadge status={run.status} />}
      />
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Surface>
          <p className="text-[11px] uppercase text-ink-500">Gross</p>
          <p className="tabular">{formatKobo(BigInt(run.grossKobo))}</p>
        </Surface>
        <Surface>
          <p className="text-[11px] uppercase text-ink-500">Net</p>
          <p className="tabular">{formatKobo(BigInt(run.netKobo))}</p>
        </Surface>
        <Surface>
          <p className="text-[11px] uppercase text-ink-500">PAYE</p>
          <p className="tabular">{formatKobo(BigInt(run.payeKobo))}</p>
        </Surface>
        <Surface>
          <p className="text-[11px] uppercase text-ink-500">Pension (er)</p>
          <p className="tabular">{formatKobo(BigInt(run.pensionEmployerKobo))}</p>
        </Surface>
      </div>
      {run.exceptions.length > 0 ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Exceptions" description="Resolve these before submitting. Attendance flags do not change pay." />
          <ul className="px-4 py-3 text-[13px]">
            {run.exceptions.map((item, index) => (
              <li key={`${item.code}-${index}`}>
                {item.code}: {item.message}
              </li>
            ))}
          </ul>
        </Surface>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-3">
        {me.permissions.includes('payroll.run.prepare') && (run.status === 'DRAFT' || run.status === 'CALCULATED') ? (
          <RunActionForm id={run.id} rowVersion={run.rowVersion} action="calculate" label="Calculate" />
        ) : null}
        {me.permissions.includes('payroll.run.prepare') && run.status === 'CALCULATED' ? (
          <RunActionForm id={run.id} rowVersion={run.rowVersion} action="submit" label="Submit for approval" />
        ) : null}
      </div>
      {me.permissions.includes('payroll.pay') && run.status === 'LOCKED' ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Pay" description="Upload payment evidence first, then paste its document id." />
          <div className="px-4 py-3">
            <PayRunForm id={run.id} rowVersion={run.rowVersion} />
          </div>
        </Surface>
      ) : null}
      {me.permissions.includes('payroll.pay') && run.status === 'PAID' ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Remit statutory" description="PAYE and pension stay unremitted until evidence is filed." />
          <div className="px-4 py-3">
            <RemitForm id={run.id} rowVersion={run.rowVersion} />
          </div>
        </Surface>
      ) : null}
      {me.permissions.includes('payroll.run.prepare') && (run.status === 'LOCKED' || run.status === 'PAID') ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Correction" description="Locked lines are never edited. This reverses the journals and opens a new PRL-." />
          <div className="px-4 py-3">
            <AdjustRunForm id={run.id} rowVersion={run.rowVersion} />
          </div>
        </Surface>
      ) : null}
      <Surface padded={false}>
        <SurfaceHeader title="Lines" />
        {run.lines.length === 0 ? (
          <EmptyState title="Not calculated yet" description="Calculate to pull approved HR, overtime and unpaid leave." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Employee</th>
                <th className="px-4 py-2 font-semibold">Gross</th>
                <th className="px-4 py-2 font-semibold">PAYE</th>
                <th className="px-4 py-2 font-semibold">Net</th>
                <th className="px-4 py-2 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {run.lines.map((line) => (
                <tr key={line.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">
                    {line.employeeName}{' '}
                    <span className="font-mono text-ink-500">{line.employeeNumber}</span>
                  </td>
                  <td className="px-4 py-2 tabular">
                    {line.grossKobo == null ? '—' : formatKobo(BigInt(line.grossKobo))}
                  </td>
                  <td className="px-4 py-2 tabular">
                    {line.payeKobo == null ? '—' : formatKobo(BigInt(line.payeKobo))}
                  </td>
                  <td className="px-4 py-2 tabular">
                    {line.netKobo == null ? '—' : formatKobo(BigInt(line.netKobo))}
                  </td>
                  <td className="px-4 py-2">
                    {run.status === 'LOCKED' || run.status === 'PAID' ? (
                      <a
                        href={`/hr/payroll/${run.id}/payslips/${line.employeeId}`}
                        className="text-accent-800 underline"
                      >
                        Payslip
                      </a>
                    ) : null}
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
