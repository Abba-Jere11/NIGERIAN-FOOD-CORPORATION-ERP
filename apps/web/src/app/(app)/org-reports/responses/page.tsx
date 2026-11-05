import type { MeView, OrgMinuteListItemView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { MinuteTable } from '../ReportTable';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Responses awaiting review — NFC' };

export default async function ResponsesAwaitingPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('org_report.minute.review')) redirect('/forbidden');
  const rows = await apiFetch<OrgMinuteListItemView[]>('/api/org-reports/responses/awaiting');
  return (
    <>
      <PageHeader
        eyebrow="Managing Director"
        title="Responses awaiting review"
        description="Accept a response to complete the minute, or return it for further action without erasing the original."
      />
      <Surface padded={false}>
        <SurfaceHeader title="Queue" />
        <MinuteTable
          rows={rows}
          emptyTitle="No responses waiting"
          emptyDescription="Submitted responses to your minutes appear here."
        />
      </Surface>
    </>
  );
}
