import type { MeView, OrgReportTemplateView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { TemplateForm } from '../../OrgReportForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Official report templates — NFC' };

export default async function TemplatesAdminPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('org_report.template.manage')) redirect('/forbidden');
  const rows = await apiFetch<OrgReportTemplateView[]>('/api/org-reports/templates', { query: { all: '1' } });
  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Report templates"
        description="Technical configuration only. This screen does not grant authority to issue minutes or read confidential reports."
      />
      <Surface>
        <SurfaceHeader title="Categories" />
        <div className="space-y-4 px-4 py-3">
          {rows.map((row) => (
            <div key={row.id} className="border-b border-ink-100 pb-3">
              <p className="text-[12px] text-ink-500">
                {row.key} · {row.kind} · requires {row.requiredPermission}
              </p>
              <TemplateForm id={row.id} title={row.title} available={row.available} rowVersion={row.rowVersion} />
            </div>
          ))}
        </div>
      </Surface>
    </>
  );
}
