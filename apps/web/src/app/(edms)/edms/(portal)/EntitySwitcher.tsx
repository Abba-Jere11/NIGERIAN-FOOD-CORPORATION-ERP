'use client';

import { useRouter } from 'next/navigation';
import type { EdmsGatewayEntityView } from '@nfc/shared';

export function EntitySwitcher({
  entities,
  current,
  suffix = '',
}: {
  entities: EdmsGatewayEntityView[];
  current: string;
  suffix?: string;
}) {
  const router = useRouter();
  return (
    <label className="text-[12px] font-semibold text-ink-700">
      Entity
      <select
        value={current}
        onChange={(event) => router.push(`/edms/${event.target.value}${suffix}`)}
        className="mt-1 block min-w-[14rem] border border-ink-300 bg-surface px-2 py-1.5 text-sm"
      >
        {entities.map((entity) => (
          <option key={entity.id} value={entity.code}>
            {entity.code} — {entity.name}
          </option>
        ))}
      </select>
    </label>
  );
}
