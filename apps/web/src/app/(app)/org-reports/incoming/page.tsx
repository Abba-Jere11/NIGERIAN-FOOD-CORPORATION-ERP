import type { MeView, OrgReportListItemView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { ReportTable } from '../ReportTable';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Incoming reports — NFC' };

export default async function IncomingReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('org_report.forward')) redirect('/forbidden');
  const query = await searchParams;
  const rows = await apiFetch<OrgReportListItemView[]>('/api/org-reports/inbox', {
    query: { box: 'incoming', status: query.status },
  });
  return (
    <>
      <PageHeader
        eyebrow="Managing Director"
        title="Incoming reports"
        description="Submitted reports addressed to you. Opening a submitted report marks it under review."
      />
      <Surface padded={false}>
        <SurfaceHeader title="Inbox" />
        <ReportTable
          rows={rows}
          emptyTitle="No incoming reports"
          emptyDescription="When an authorised officer submits a report to the MD, it appears here."
        />
      </Surface>
    </>
  );
}
