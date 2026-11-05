import type { MeView, OrgMinuteListItemView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { MinuteTable } from '../ReportTable';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Assigned minutes — NFC' };

export default async function AssignedMinutesPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('org_report.minute.respond') && !me.permissions.includes('org_report.view')) {
    redirect('/forbidden');
  }
  const rows = await apiFetch<OrgMinuteListItemView[]>('/api/org-reports/minutes/assigned');
  const active = rows.filter((row) => !['COMPLETED', 'DRAFT'].includes(row.status));
  const done = rows.filter((row) => row.status === 'COMPLETED');
  return (
    <>
      <PageHeader
        eyebrow="Official minutes"
        title="Assigned minutes"
        description="Instructions issued to you. Acknowledgement is not completion."
      />
      <Surface padded={false} className="mb-4">
        <SurfaceHeader title="Active assignments" />
        <MinuteTable
          rows={active}
          emptyTitle="No active minutes"
          emptyDescription="When the Managing Director issues a minute addressed to you, it appears here."
        />
      </Surface>
      <Surface padded={false}>
        <SurfaceHeader title="Completed" />
        <MinuteTable rows={done} emptyTitle="No completed minutes" emptyDescription="Completed instructions remain for the record." />
      </Surface>
    </>
  );
}
