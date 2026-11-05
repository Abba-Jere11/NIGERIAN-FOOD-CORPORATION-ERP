import type { DepartmentView, MeView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { RequisitionForm } from '../RequisitionForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New requisition — NFC' };

export default async function NewRequisitionPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('requisition.create')) redirect('/forbidden');
  const entityId = me.entities[0]?.id;
  const departments = entityId
    ? await apiFetch<DepartmentView[]>(`/api/entities/${entityId}/departments`).catch(() => [])
    : [];

  return (
    <>
      <PageHeader
        eyebrow="Requisition"
        title="New requisition"
        description="Describe the need. Do not include prices, a vendor or an invoice."
      />
      <Surface>
        <SurfaceHeader title="Draft" />
        <div className="px-4 py-3">
          <RequisitionForm departments={departments} categories={[]} units={[]} />
        </div>
      </Surface>
    </>
  );
}
