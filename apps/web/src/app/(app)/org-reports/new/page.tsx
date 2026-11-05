import type { MeView, OrgReportPersonView, OrgReportTemplateView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { CreateReportForm } from '../OrgReportForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create official report — NFC' };

export default async function NewOrgReportPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('org_report.create')) redirect('/forbidden');
  const [templates, people] = await Promise.all([
    apiFetch<OrgReportTemplateView[]>('/api/org-reports/templates'),
    apiFetch<OrgReportPersonView[]>('/api/org-reports/directory'),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Official reports"
        title="Create report"
        description="The Managing Director is the recipient. CC is optional and does not assign work."
      />
      <Surface>
        <SurfaceHeader title="Report" description="Save a draft, preview, or submit as an official record." />
        <div className="px-4 py-3">
          <CreateReportForm entities={me.entities} templates={templates} people={people} />
        </div>
      </Surface>
    </>
  );
}
