'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { FinanceContextView } from '@nfc/shared';
import { resolveFinanceScope, withScope } from '../scope';

export function EntityContextBar({ context }: { context: FinanceContextView }) {
  const pathname = usePathname() ?? '/finance';
  const search = useSearchParams();
  const router = useRouter();
  const scope = search.get('scope') ?? undefined;
  const resolved = resolveFinanceScope(context, scope);
  const current = resolved.consolidated ? 'consolidated' : (resolved.entityCode ?? '');
  const options = [
    ...(context.canConsolidate ? [{ value: 'consolidated', label: 'Consolidated' }] : []),
    ...context.entities.map((entity) => ({ value: entity.code, label: `${entity.code} — ${entity.name}` })),
  ];
  const viewing = resolved.consolidated
    ? `Viewing Consolidated (NFC + subsidiaries)`
    : `Viewing ${resolved.label}`;

  return (
    <div className="flex flex-wrap items-end gap-4 border-b border-ink-200 pb-3">
      <label className="text-[12px] font-semibold text-ink-700">
        Entity
        <select
          value={current}
          onChange={(event) => router.push(withScope(pathname, event.target.value))}
          className="mt-1 block min-w-[14rem] border border-ink-300 bg-surface px-2 py-1.5 text-sm"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="pb-1.5 text-[13px] font-medium text-ink-900">{viewing}</p>
    </div>
  );
}
