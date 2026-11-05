'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';

export function SearchForm({
  entityCode,
  canSearchAll,
}: {
  entityCode: string;
  canSearchAll: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const q = String(data.get('q') ?? '').trim();
        const all = data.get('all') === '1';
        const next = new URLSearchParams();
        if (q) next.set('q', q);
        if (all) next.set('all', '1');
        router.push(`/edms/${entityCode}?${next.toString()}`);
      }}
    >
      <label className="text-[12px] font-semibold text-ink-700">
        Search
        <input
          name="q"
          type="search"
          defaultValue={params.get('q') ?? ''}
          placeholder="Title or reference"
          className="mt-1 block min-w-[14rem] border border-ink-300 bg-surface px-2 py-1.5 text-sm"
        />
      </label>
      {canSearchAll ? (
        <label className="flex items-center gap-1.5 pb-1.5 text-[12px] text-ink-700">
          <input type="checkbox" name="all" value="1" defaultChecked={params.get('all') === '1'} />
          All my subsidiaries
        </label>
      ) : null}
      <Button type="submit" size="sm" variant="secondary">
        Search
      </Button>
    </form>
  );
}
