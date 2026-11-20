import Link from 'next/link';
import type { ScanLookupView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { apiFetch, ApiError } from '@/lib/api';
import { AssetThumb, ASSET_STATUS_LABEL } from '../assets/AssetPhoto';
import { ScanInput } from './ScanInput';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Scan lookup — Inventory — NFC' };

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code = '' } = await searchParams;
  const trimmed = code.trim();
  let result: ScanLookupView | null = null;
  let error: string | null = null;
  if (trimmed) {
    try {
      result = await apiFetch<ScanLookupView>('/api/inventory/scan', { query: { code: trimmed } });
    } catch (caught) {
      error = caught instanceof ApiError ? caught.message : 'The lookup failed.';
    }
  }
  const asset = result?.asset ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Scan lookup"
        description="Scan or type an asset tag (AST-), serial number, item code or batch to see what it is and where it is."
      />
      <Surface className="mb-4">
        <ScanInput initial={trimmed} />
      </Surface>
      {error ? <ErrorState title="Lookup failed" message={error} requestId={null} /> : null}
      {result && !asset && result.items.length === 0 ? (
        <EmptyState title="Nothing found" description={`No asset or item matches “${result.query}”.`} />
      ) : null}
      {asset ? (
        <Surface id="scan-asset" padded={false}>
          <SurfaceHeader title={`${asset.referenceNumber} · ${asset.itemName}`} />
          <div className="flex flex-wrap gap-4 p-4">
            <AssetThumb asset={asset} size={200} />
            <dl className="grid flex-1 grid-cols-2 gap-2 text-[13px]">
              <dt className="text-ink-500">Item</dt>
              <dd>{asset.itemCode}</dd>
              <dt className="text-ink-500">Serial</dt>
              <dd>{asset.serialCode ?? '—'}</dd>
              <dt className="text-ink-500">Status</dt>
              <dd>{ASSET_STATUS_LABEL[asset.status]}</dd>
              <dt className="text-ink-500">Where</dt>
              <dd>
                {[asset.departmentLabel, asset.locationLabel ?? asset.warehouseName].filter(Boolean).join(' · ') || '—'}
              </dd>
              <dt className="text-ink-500">Custodian</dt>
              <dd>{asset.custodianName ?? '—'}</dd>
              <dt className="text-ink-500">Condition</dt>
              <dd>{asset.condition}</dd>
            </dl>
          </div>
          <p className="px-4 pb-3 text-[13px]">
            <Link href={`/inventory/assets/${asset.id}`} className="underline">
              Open asset record
            </Link>
          </p>
        </Surface>
      ) : null}
      {result && result.items.length > 0 ? (
        <Surface padded={false} className="mt-4">
          <SurfaceHeader title="Stock items" />
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Batch</th>
                <th className="px-4 py-2">Available</th>
                <th className="px-4 py-2">Quarantined</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <tr key={`${item.id}-${item.batchCode ?? ''}`} className="border-b border-ink-100">
                  <td className="px-4 py-2">
                    <Link href={`/inventory/items/${item.id}`} className="underline">
                      {item.code}
                    </Link>{' '}
                    — {item.name}
                    {item.entityCode ? ` · ${item.entityCode}` : ''}
                  </td>
                  <td className="px-4 py-2">{item.batchCode ?? '—'}</td>
                  <td className="tabular px-4 py-2">
                    {item.availableQty} {item.uomCode}
                  </td>
                  <td className="tabular px-4 py-2">{item.quarantinedQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      ) : null}
    </>
  );
}
