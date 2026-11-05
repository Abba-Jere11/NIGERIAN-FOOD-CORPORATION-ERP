import { redirect } from 'next/navigation';
import type { MeView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My payslips — NFC' };

export default async function MePayslipsPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('self.payslip.view')) redirect('/forbidden');
  const rows = await apiFetch<Array<{ runId: string; periodName: string; referenceNumber: string }>>(
    '/api/me/payslips',
  );

  return (
    <>
      <PageHeader eyebrow="My workspace" title="Payslips" description="Payslips issued for your employee record." />
      <Surface padded={false}>
        <SurfaceHeader title="Issued payslips" />
        <ul className="divide-y divide-ink-100 text-[13px]">
          {rows.length === 0 ? <li className="px-4 py-3 text-ink-500">No payslip has been issued yet.</li> : null}
          {rows.map((row) => (
            <li key={row.runId} className="flex justify-between px-4 py-2">
              <span>{row.periodName}</span>
              <span>{row.referenceNumber}</span>
            </li>
          ))}
        </ul>
      </Surface>
    </>
  );
}
