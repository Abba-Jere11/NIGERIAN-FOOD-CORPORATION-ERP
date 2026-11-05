import type { MeView, OrgReportListItemView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { ReportTable } from '../ReportTable';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My reports — NFC' };

export default async function MyReportsPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('org_report.create') && !me.permissions.includes('org_report.view')) {
    redirect('/forbidden');
  }
  const rows = await apiFetch<OrgReportListItemView[]>('/api/org-reports/inbox', { query: { box: 'mine' } });
  return (
    <>
      <PageHeader
        eyebrow="Official reports"
        title="My reports"
        description="Reports you created, including drafts and submitted records."
        actions={
          me.permissions.includes('org_report.create') ? (
            <ButtonLink href="/org-reports/new" variant="primary">
              Create report
            </ButtonLink>
          ) : null
        }
      />
      <Surface padded={false}>
        <SurfaceHeader title="Register" />
        <ReportTable
          rows={rows}
          emptyTitle="You have not created a report"
          emptyDescription="Create a general report within your subsidiary or corporate scope."
        />
      </Surface>
    </>
  );
}
