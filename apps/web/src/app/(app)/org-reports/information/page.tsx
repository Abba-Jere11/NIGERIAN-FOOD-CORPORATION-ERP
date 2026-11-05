import type { MeView, OrgReportListItemView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { ReportTable } from '../ReportTable';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports received for information — NFC' };

export default async function InformationReportsPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('org_report.view') && !me.permissions.includes('org_report.create')) {
    redirect('/forbidden');
  }
  const rows = await apiFetch<OrgReportListItemView[]>('/api/org-reports/inbox', { query: { box: 'information' } });
  return (
    <>
      <PageHeader
        eyebrow="Official reports"
        title="Received for information"
        description="Read-only copies. Being CC'd or forwarded a report does not assign work or grant MD authority."
      />
      <Surface padded={false}>
        <SurfaceHeader title="Copies" />
        <ReportTable
          rows={rows}
          emptyTitle="No copies for information"
          emptyDescription="When you are CC'd or a report is forwarded to you, it appears here."
        />
      </Surface>
    </>
  );
}
