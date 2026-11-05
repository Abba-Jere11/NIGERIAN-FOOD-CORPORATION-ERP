import type { MeView, OrgReportListItemView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { ReportTable } from '../ReportTable';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Forwarded reports — NFC' };

export default async function ForwardedReportsPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('org_report.forward')) redirect('/forbidden');
  const rows = await apiFetch<OrgReportListItemView[]>('/api/org-reports/inbox', { query: { box: 'forwarded' } });
  return (
    <>
      <PageHeader
        eyebrow="Managing Director"
        title="Forwarded reports"
        description="Forwarding shares the original correspondence. It does not assign work."
      />
      <Surface padded={false}>
        <SurfaceHeader title="Forwarding history" />
        <ReportTable
          rows={rows}
          emptyTitle="No forwarded reports"
          emptyDescription="Forward a submitted report from its detail page when additional officers need to see it."
        />
      </Surface>
    </>
  );
}
