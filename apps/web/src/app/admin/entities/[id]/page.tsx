import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { AuditEntryView, DepartmentView, EntityView, MeView, Page } from '@nfc/shared';
import { AUDIT_ACTION_LABELS, formatLagosDateTime } from '@nfc/shared';
import { DefinitionList, PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Timeline } from '@/components/ui/Timeline';
import { apiFetch, ApiError } from '@/lib/api';
import { CreateDepartmentDialog, DepartmentsPanel } from './DepartmentsPanel';
import { EntityActions } from './EntityActions';

export const dynamic = 'force-dynamic';

export default async function EntityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await apiFetch<MeView>('/api/me');

  let entity: EntityView;
  try {
    entity = await apiFetch<EntityView>(`/api/entities/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  const [departments, history] = await Promise.all([
    apiFetch<DepartmentView[]>(`/api/entities/${id}/departments`).catch(
      () => [] as DepartmentView[],
    ),
    me.permissions.includes('audit.view')
      ? apiFetch<Page<AuditEntryView>>('/api/audit', {
          query: { entityId: id, page: 1, pageSize: 15 },
        }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const canManageEntity = me.permissions.includes('organization.entity.manage');
  const canManageDepartments = me.permissions.includes('organization.department.manage');

  return (
    <>
      <div className="no-print mb-3">
        <Link href="/admin/entities" className="text-[13px] text-accent-700 underline">
          ← All entities
        </Link>
      </div>

      <PageHeader
        eyebrow={entity.type === 'HOLDING' ? 'Holding company' : 'Subsidiary'}
        title={`${entity.code} — ${entity.name}`}
        description={entity.legalName}
        actions={canManageEntity ? <EntityActions entity={entity} /> : null}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Surface padded={false}>
            <SurfaceHeader
              title="Departments"
              description="Deactivating a department never removes it, and never touches the records that reference it."
              actions={canManageDepartments ? <CreateDepartmentDialog entityId={entity.id} /> : null}
            />
            <DepartmentsPanel
              entityId={entity.id}
              entityCode={entity.code}
              departments={departments}
              canManage={canManageDepartments}
            />
          </Surface>

          {history ? (
            <Surface padded={false}>
              <SurfaceHeader
                title="History"
                description="Everything recorded against this entity, newest first."
              />
              <div className="px-4 py-3">
                <Timeline
                  entries={history.rows.map((entry) => ({
                    id: entry.id,
                    occurredAt: entry.occurredAt,
                    actor: entry.actorName ?? entry.actorRef ?? 'System',
                    text: `${AUDIT_ACTION_LABELS[entry.action]} — ${
                      entry.subjectLabel ?? entry.subjectType
                    }`,
                    detail: entry.reason ? (
                      <span className="italic">“{entry.reason}”</span>
                    ) : null,
                  }))}
                />
              </div>
              {history.total > history.rows.length ? (
                <div className="border-t border-ink-200 px-4 py-2.5">
                  <Link
                    href={`/audit?entityId=${entity.id}`}
                    className="text-[13px] text-accent-700 underline"
                  >
                    View all {history.total} entries for this entity
                  </Link>
                </div>
              ) : null}
            </Surface>
          ) : null}
        </div>

        <Surface>
          <h2 className="mb-3 text-[15px] font-semibold text-ink-900">Record</h2>
          <DefinitionList
            columns={1}
            items={[
              { label: 'Status', value: <StatusBadge status={entity.status} /> },
              { label: 'Code', value: <span className="font-mono text-[12px]">{entity.code}</span> },
              {
                label: 'Type',
                value: entity.type === 'HOLDING' ? 'Holding company' : 'Subsidiary',
              },
              {
                label: 'Departments',
                value: `${entity.activeDepartmentCount} active of ${entity.departmentCount}`,
              },
              { label: 'Created', value: <span className="tabular">{formatLagosDateTime(entity.createdAt)}</span> },
              { label: 'Last changed', value: <span className="tabular">{formatLagosDateTime(entity.updatedAt)}</span> },
              { label: 'Record version', value: <span className="tabular">{entity.rowVersion}</span> },
            ]}
          />
        </Surface>
      </div>
    </>
  );
}
