'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { FixedAssetView } from '@nfc/shared';
import { AssetThumb, ASSET_STATUS_LABEL } from '../assets/AssetPhoto';
import { AssetLabel, PrintLabelsButton } from './AssetLabel';

/** Assets list with optional multi-select printable AST labels. */
export function AssetListWithLabels({ assets }: { assets: FixedAssetView[] }) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const chosen = useMemo(() => assets.filter((row) => selected[row.id]), [assets, selected]);
  const allSelected = assets.length > 0 && chosen.length === assets.length;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-2 print:hidden">
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(event) => {
              if (event.target.checked) {
                const next: Record<string, boolean> = {};
                for (const row of assets) next[row.id] = true;
                setSelected(next);
              } else {
                setSelected({});
              }
            }}
          />
          Select for labels
        </label>
        {chosen.length > 0 ? <PrintLabelsButton count={chosen.length} /> : null}
      </div>
      <table className="w-full text-left text-[13px] print:hidden">
        <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
          <tr>
            <th className="px-4 py-2" />
            <th className="px-4 py-2" />
            <th className="px-4 py-2">Reference</th>
            <th className="px-4 py-2">Item</th>
            <th className="px-4 py-2">Serial</th>
            <th className="px-4 py-2">Where</th>
            <th className="px-4 py-2">Custodian</th>
            <th className="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((row) => (
            <tr key={row.id} className="border-b border-ink-100">
              <td className="px-4 py-2">
                <input
                  type="checkbox"
                  checked={Boolean(selected[row.id])}
                  onChange={(event) =>
                    setSelected((prev) => ({ ...prev, [row.id]: event.target.checked }))
                  }
                  aria-label={`Select ${row.referenceNumber}`}
                />
              </td>
              <td className="px-4 py-2">
                <AssetThumb asset={row} size={40} />
              </td>
              <td className="px-4 py-2">
                <Link href={`/inventory/assets/${row.id}`} className="underline">
                  {row.referenceNumber}
                </Link>
              </td>
              <td className="px-4 py-2">
                {row.itemCode} — {row.itemName}
              </td>
              <td className="px-4 py-2">{row.serialCode ?? '—'}</td>
              <td className="px-4 py-2">
                {[row.departmentLabel, row.locationLabel ?? row.warehouseName].filter(Boolean).join(' · ') || '—'}
              </td>
              <td className="px-4 py-2">{row.custodianName ?? '—'}</td>
              <td className="px-4 py-2">{ASSET_STATUS_LABEL[row.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {chosen.length > 0 ? (
        <div className="hidden flex-wrap gap-3 p-4 print:flex">
          {chosen.map((asset) => (
            <AssetLabel key={asset.id} asset={asset} />
          ))}
        </div>
      ) : null}
    </>
  );
}
