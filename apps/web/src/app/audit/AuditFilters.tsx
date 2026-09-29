'use client';

import type { AuditFiltersView, EntityView } from '@nfc/shared';
import { Button, ButtonLink } from '@/components/ui/Button';
import { CONTROL_CLASS } from '@/components/ui/Field';

export interface AuditFilterValues {
  from: string;
  to: string;
  actor: string;
  action: string;
  subjectType: string;
  entityId: string;
  q: string;
}

/**
 * The audit filters (M1 item 7).
 *
 * A plain GET form, so every filtered view has a URL that can be bookmarked,
 * shared with an auditor, or handed to the export button unchanged.
 */
export function AuditFilters({
  values,
  options,
  entities,
  exportHref,
  canExport,
}: {
  values: AuditFilterValues;
  options: AuditFiltersView;
  entities: EntityView[];
  exportHref: string;
  canExport: boolean;
}) {
  const hasFilters = Object.values(values).some((value) => value !== '');

  return (
    <form method="get" action="/audit" className="no-print px-4 py-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Labelled label="From">
          <input type="date" name="from" defaultValue={values.from} className={CONTROL_CLASS} />
        </Labelled>
        <Labelled label="To" hint="A date covers the whole day in Lagos time.">
          <input type="date" name="to" defaultValue={values.to} className={CONTROL_CLASS} />
        </Labelled>
        <Labelled label="Action">
          <select name="action" defaultValue={values.action} className={CONTROL_CLASS}>
            <option value="">Any action</option>
            {options.actions.map((action) => (
              <option key={action.value} value={action.value}>
                {action.label}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Record type">
          <select name="subjectType" defaultValue={values.subjectType} className={CONTROL_CLASS}>
            <option value="">Any record type</option>
            {options.subjectTypes.map((subjectType) => (
              <option key={subjectType} value={subjectType}>
                {subjectType}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Entity">
          <select name="entityId" defaultValue={values.entityId} className={CONTROL_CLASS}>
            <option value="">Any entity</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.code} — {entity.name}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Actor" hint="Name, or a system actor such as system:seed.">
          <input
            type="search"
            name="actor"
            defaultValue={values.actor}
            placeholder="Adebayo, or system:seed"
            className={CONTROL_CLASS}
          />
        </Labelled>
        <div className="sm:col-span-2">
          <Labelled label="Contains" hint="Searches the record label, reference number and reason.">
            <input
              type="search"
              name="q"
              defaultValue={values.q}
              placeholder="Text in the label, reference or reason"
              className={CONTROL_CLASS}
            />
          </Labelled>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary">
          Apply filters
        </Button>
        {hasFilters ? <ButtonLink href="/audit">Clear</ButtonLink> : null}
        {canExport ? (
          <div className="ml-auto">
            <ButtonLink href={exportHref}>Export CSV</ButtonLink>
          </div>
        ) : null}
      </div>
    </form>
  );
}

function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[12px] font-semibold text-ink-700">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-ink-500">{hint}</span> : null}
    </label>
  );
}
