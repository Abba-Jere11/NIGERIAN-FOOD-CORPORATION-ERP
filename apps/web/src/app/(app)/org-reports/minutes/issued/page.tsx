import type { MeView, OrgMinuteListItemView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { MinuteTable } from '../../ReportTable';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Official minutes issued — NFC' };

export default async function IssuedMinutesPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('org_report.minute.issue')) redirect('/forbidden');
  const rows = await apiFetch<OrgMinuteListItemView[]>('/api/org-reports/minutes/issued');
  return (
    <>
      <PageHeader
        eyebrow="Managing Director"
        title="Official minutes"
        description="Instructions you have issued. Forwarding a report never appears here."
      />
      <Surface padded={false}>
        <SurfaceHeader title="Issued" />
        <MinuteTable
          rows={rows}
          emptyTitle="No minutes issued"
          emptyDescription="Issue an official minute from a report when an officer must act."
        />
      </Surface>
    </>
  );
}
