import type { AuditEntryView, AuditFiltersView, EntityView, MeView, Page } from '@nfc/shared';
import { Pagination } from '@/components/ui/Pagination';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { ErrorState, Notice } from '@/components/ui/States';
import { apiFetch, ApiError } from '@/lib/api';
import { AuditFilters, type AuditFilterValues } from './AuditFilters';
import { AuditTable } from './AuditTable';

/**
 * The audit viewer (M1 item 7).
 *
 * Read-only, and scope-limited twice over: only the MD and ED Finance hold
 * `audit.view` at all, and Row-Level Security then restricts the rows returned
 * to the entities the caller may see. There is no edit control anywhere on this
 * page because the table itself refuses UPDATE and DELETE (rule R2).
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Audit log — NFC' };

const FILTER_KEYS = ['from', 'to', 'actor', 'action', 'subjectType', 'entityId', 'q'] as const;

function readFilters(params: Record<string, string | string[] | undefined>): AuditFilterValues {
  const read = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
  };
  return {
    from: read('from'),
    to: read('to'),
    actor: read('actor'),
    action: read('action'),
    subjectType: read('subjectType'),
    entityId: read('entityId'),
    q: read('q'),
  };
}

function toQuery(filters: AuditFilterValues): Record<string, string> {
  return Object.fromEntries(
    FILTER_KEYS.filter((key) => filters[key] !== '').map((key) => [key, filters[key]]),
  );
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = readFilters(params);
  const pageParam = Array.isArray(params.page) ? params.page[0] : params.page;
  const page = Math.max(1, Number.parseInt(pageParam ?? '1', 10) || 1);
  const pageSize = 25;

  const me = await apiFetch<MeView>('/api/me');

  if (!me.permissions.includes('audit.view')) {
    return (
      <>
        <PageHeader eyebrow="Audit" title="Audit log" />
        <Surface>
          <ErrorState
            title="You cannot view the audit log"
            message="The audit log is visible only to the Managing Director and the Executive Director, Finance. Your role does not include it."
          />
        </Surface>
      </>
    );
  }

  const query = toQuery(filters);
  const searchString = new URLSearchParams(query).toString();

  const [result, options, entities] = await Promise.all([
    apiFetch<Page<AuditEntryView>>('/api/audit', { query: { ...query, page, pageSize } })
      .then((value) => ({ value, error: null as string | null }))
      .catch((error: unknown) => ({
        value: null,
        error: error instanceof ApiError ? error.message : 'The audit log could not be read.',
      })),
    apiFetch<AuditFiltersView>('/api/audit/filters').catch(
      () => ({ actions: [], subjectTypes: [] }) as AuditFiltersView,
    ),
    apiFetch<EntityView[]>('/api/entities').catch(() => [] as EntityView[]),
  ]);

  const canExport = me.permissions.includes('audit.export');
  const exportHref = searchString === '' ? '/audit/export' : `/audit/export?${searchString}`;
  const buildHref = (target: number): string => {
    const next = new URLSearchParams(query);
    if (target > 1) next.set('page', String(target));
    const text = next.toString();
    return text === '' ? '/audit' : `/audit?${text}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Audit"
        title="Audit log"
        description="Every recorded action, with who took it, when, against what, and why. Entries cannot be edited or removed by anyone, including the Managing Director."
      />

      <div className="mb-4">
        <Notice tone="info">
          {me.isCorporate
            ? 'You see the whole group. Exporting is itself recorded as an action in this log.'
            : `You see only ${me.entities.map((entity) => entity.code).join(', ')}.`}
        </Notice>
      </div>

      <Surface padded={false}>
        <SurfaceHeader
          title="Filters"
          description="The filtered view has its own address, so it can be bookmarked or sent to an auditor."
        />
        <AuditFilters
          values={filters}
          options={options}
          entities={entities}
          exportHref={exportHref}
          canExport={canExport}
        />
      </Surface>

      <div className="mt-4">
        <Surface padded={false}>
          {result.error !== null || result.value === null ? (
            <div className="p-4">
              <ErrorState message={result.error ?? 'The audit log could not be read.'} />
            </div>
          ) : (
            <>
              <AuditTable entries={result.value.rows} />
              <Pagination
                page={result.value.page}
                totalPages={result.value.totalPages}
                total={result.value.total}
                pageSize={result.value.pageSize}
                buildHref={buildHref}
              />
            </>
          )}
        </Surface>
      </div>
    </>
  );
}
