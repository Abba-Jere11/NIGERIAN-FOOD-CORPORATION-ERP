import type { MeView, OrgMinuteListItemView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { MinuteTable } from '../../ReportTable';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My responses — NFC' };

export default async function MyResponsesPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('org_report.minute.respond') && !me.permissions.includes('org_report.view')) {
    redirect('/forbidden');
  }
  const rows = await apiFetch<OrgMinuteListItemView[]>('/api/org-reports/minutes/my-responses');
  return (
    <>
      <PageHeader
        eyebrow="Official reports"
        title="My responses"
        description="Responses you have submitted remain on the record even if further action is requested."
      />
      <Surface padded={false}>
        <SurfaceHeader title="Submitted" />
        <MinuteTable
          rows={rows}
          emptyTitle="No responses yet"
          emptyDescription="When you respond to an official minute, it is listed here."
        />
      </Surface>
    </>
  );
}
