import Link from 'next/link';
import { cx } from '@/lib/cx';

export function HomeStatusTiles({
  tiles,
  active,
  basePath,
}: {
  tiles: Array<{ key: string; label: string; count: number }>;
  active?: string;
  basePath: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-4 lg:grid-cols-5">
      {tiles.map((tile) => {
        const href = `${basePath}${basePath.includes('?') ? '&' : '?'}status=${encodeURIComponent(tile.key)}`;
        const selected = active === tile.key;
        return (
          <Link
            key={tile.key}
            href={href}
            className={cx(
              'border px-3 py-2',
              selected ? 'border-accent-600 bg-accent-50' : 'border-ink-200 bg-surface hover:bg-ink-50',
            )}
          >
            <p className="text-[11px] uppercase tracking-wider text-ink-500">{tile.label}</p>
            <p className="tabular text-[18px] font-semibold text-ink-900">{tile.count}</p>
          </Link>
        );
      })}
    </div>
  );
}
