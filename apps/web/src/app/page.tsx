import Link from 'next/link';
import type { AuditEntryView, EntityView, MeView } from '@nfc/shared';
import { AUDIT_ACTION_LABELS, type Page } from '@nfc/shared';
import { DefinitionList, PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState, ErrorState, Notice } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Timeline, type TimelineEntry } from '@/components/ui/Timeline';
import { apiFetch } from '@/lib/api';

/**
 * Home.
 *
 * A10 gives each role a dashboard whose first panel is "what is waiting for
 * you". M1 has nothing to approve yet - approvals begin at M6 - so the panel
 * says so plainly rather than showing an invented number. What it does show is
 * real: the entities this role can reach, and the activity recorded so far.
 */
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const me = await apiFetch<MeView>('/api/me');

  const [entities, recent] = await Promise.all([
    apiFetch<EntityView[]>('/api/entities').catch(() => [] as EntityView[]),
    me.permissions.includes('audit.view')
      ? apiFetch<Page<AuditEntryView>>('/api/audit', { query: { page: 1, pageSize: 10 } }).catch(
          () => null,
        )
      : Promise.resolve(null),
  ]);

  const subsidiaries = entities.filter((entity) => entity.type === 'SUBSIDIARY');
  const holding = entities.find((entity) => entity.type === 'HOLDING');

  return (
    <>
      <PageHeader
        eyebrow={me.isCorporate ? 'Corporate' : (me.entities[0]?.name ?? 'Subsidiary')}
        title={`Good day, ${me.name.split(' ')[0] ?? me.name}`}
        description={
          me.isCorporate
            ? 'You have group-wide visibility across the holding company and all four subsidiaries.'
            : 'You see only your own subsidiary. Records belonging to other subsidiaries are not returned to you at all.'
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Surface padded={false}>
            <SurfaceHeader
              title="Waiting for you"
              description="Requests, approvals and payments that need your decision."
            />
            <EmptyState
              title="Nothing is waiting for you"
              description="Approval queues fill up once requisitions exist. Procurement begins at milestone M6; until then this panel is correctly empty."
            />
          </Surface>

          <Surface padded={false}>
            <SurfaceHeader
              title={me.isCorporate ? 'Subsidiaries' : 'Your subsidiary'}
              description="Operating companies and their departments."
            />
            {subsidiaries.length === 0 && !holding ? (
              <EmptyState
                title="No entities are visible to you"
                description="Run pnpm db:seed to create the holding company and its four subsidiaries."
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {[...(holding ? [holding] : []), ...subsidiaries].map((entity) => (
                  <li key={entity.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link
                        href={`/admin/entities/${entity.id}`}
                        className="text-[14px] font-medium text-accent-700 underline decoration-accent-100 hover:decoration-accent-700"
                      >
                        {entity.code} — {entity.name}
                      </Link>
                      <div className="flex items-center gap-2">
                        {entity.type === 'HOLDING' ? (
                          <StatusBadge status="HOLDING" tone="info" />
                        ) : null}
                        <StatusBadge status={entity.status} />
                      </div>
                    </div>
                    <p className="tabular mt-0.5 text-[12px] text-ink-500">
                      {entity.activeDepartmentCount} active{' '}
                      {entity.activeDepartmentCount === 1 ? 'department' : 'departments'}
                      {entity.departmentCount !== entity.activeDepartmentCount
                        ? ` of ${entity.departmentCount}`
                        : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Surface>
        </div>

        <div className="space-y-4">
          <Surface>
            <h2 className="mb-3 text-[15px] font-semibold text-ink-900">Your access</h2>
            <DefinitionList
              columns={1}
              items={[
                { label: 'Role', value: me.roleName ?? 'Unknown' },
                {
                  label: 'Scope',
                  value: me.isCorporate
                    ? 'Group-wide (holding and all subsidiaries)'
                    : me.entities.map((entity) => entity.code).join(', ') || 'None',
                },
                {
                  label: 'Permissions',
                  value:
                    me.permissions.length === 0 ? (
                      'None'
                    ) : (
                      <ul className="space-y-0.5">
                        {me.permissions.map((permission) => (
                          <li key={permission} className="font-mono text-[11px] text-ink-700">
                            {permission}
                          </li>
                        ))}
                      </ul>
                    ),
                },
              ]}
            />
            <div className="mt-3">
              <Notice tone="warning">
                This build has no sign-in yet. The identity in the top bar is a development actor,
                added so that role and scope rules can be exercised before authentication is built
                in M2. The server enforces them for real.
              </Notice>
            </div>
          </Surface>

          {me.permissions.includes('audit.view') ? (
            <Surface padded={false}>
              <SurfaceHeader title="Recent activity" description="The last ten recorded actions." />
              <div className="px-4 py-3">
                {recent === null ? (
                  <ErrorState message="The audit log could not be read." />
                ) : (
                  <Timeline entries={recent.rows.map(toTimelineEntry)} />
                )}
              </div>
              {recent && recent.total > recent.rows.length ? (
                <div className="border-t border-ink-200 px-4 py-2.5">
                  <Link href="/audit" className="text-[13px] text-accent-700 underline">
                    View the full audit log
                  </Link>
                </div>
              ) : null}
            </Surface>
          ) : null}
        </div>
      </div>
    </>
  );
}

function toTimelineEntry(entry: AuditEntryView): TimelineEntry {
  const subject = entry.subjectLabel ?? entry.subjectReferenceNumber ?? entry.subjectType;
  return {
    id: entry.id,
    occurredAt: entry.occurredAt,
    actor: [entry.actorName, entry.entityCode].filter(Boolean).join(' · ') || 'System',
    text: `${AUDIT_ACTION_LABELS[entry.action]} — ${subject}`,
    detail: entry.reason ? <span className="italic">“{entry.reason}”</span> : null,
  };
}
