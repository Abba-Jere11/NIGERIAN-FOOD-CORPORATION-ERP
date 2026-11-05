import { redirect } from 'next/navigation';
import type { MeView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Def = {
  key: string;
  name: string;
  version: number;
  stages: Array<{ key: string; label: string; requiredPermission: string | null }>;
};

export default async function AdminWorkflowsPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('admin.health.view')) redirect('/forbidden');
  const defs = await apiFetch<Def[]>('/api/admin/workflows/definitions');

  return (
    <>
      <PageHeader eyebrow="Administration" title="Workflow definitions" description="Read-only stage map." />
      <div className="space-y-4">
        {defs.map((def) => (
          <Surface key={def.key} padded={false}>
            <SurfaceHeader title={def.name} description={`${def.key} · version ${def.version}`} />
            <ol className="list-decimal px-8 py-3 text-[13px] text-ink-800">
              {def.stages.map((stage) => (
                <li key={stage.key} className="py-1">
                  {stage.label}
                  {stage.requiredPermission ? (
                    <span className="text-ink-500"> — {stage.requiredPermission}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </Surface>
        ))}
      </div>
    </>
  );
}
