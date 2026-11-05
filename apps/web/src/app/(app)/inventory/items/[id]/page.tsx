import type { InventoryItemDetailView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function InventoryItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await apiFetch<InventoryItemDetailView>(`/api/inventory/items/${id}`);
  const defaultWarehouse = item.onHandByWarehouse.find((row) => row.warehouseId === item.defaultWarehouseId);
  return (
    <>
      <PageHeader
        eyebrow={item.entityCode ?? 'Inventory'}
        title={`${item.code} — ${item.name}`}
        description={`${item.categoryName} · ${item.uomCode} · weighted average · ${item.trackingMode}`}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Surface>
          <SurfaceHeader title="Identity" />
          <dl className="grid grid-cols-2 gap-2 px-4 py-3 text-[13px]">
            <dt className="text-ink-500">Category</dt>
            <dd>{item.categoryName}</dd>
            <dt className="text-ink-500">UOM</dt>
            <dd>{item.uomCode}</dd>
            <dt className="text-ink-500">Default warehouse</dt>
            <dd>{defaultWarehouse?.warehouseName ?? '—'}</dd>
            <dt className="text-ink-500">Tracking</dt>
            <dd>{item.trackingMode}</dd>
            <dt className="text-ink-500">Cost method</dt>
            <dd>weighted average</dd>
            <dt className="text-ink-500">Reorder</dt>
            <dd>{item.reorderLevel}</dd>
            <dt className="text-ink-500">On hand</dt>
            <dd>
              {item.onHandQty} {item.uomCode}
            </dd>
            <dt className="text-ink-500">Reserved</dt>
            <dd>
              {item.reservedQty} {item.uomCode}
            </dd>
            <dt className="text-ink-500">Available</dt>
            <dd>
              {item.availableQty} {item.uomCode}
            </dd>
            <dt className="text-ink-500">Value</dt>
            <dd>{formatKobo(BigInt(item.onHandValueKobo))}</dd>
            <dt className="text-ink-500">Status</dt>
            <dd>{item.status}</dd>
          </dl>
        </Surface>
        <Surface>
          <SurfaceHeader title="Suppliers" />
          <ul className="px-4 py-3 text-[13px]">
            {item.suppliers.length === 0 ? <li>No linked vendors.</li> : null}
            {item.suppliers.map((row) => (
              <li key={row.vendorId}>{row.vendorName}</li>
            ))}
          </ul>
        </Surface>
        <Surface padded={false}>
          <SurfaceHeader title="On hand by warehouse" />
          <table className="w-full text-left text-[13px]">
            <tbody>
              {item.onHandByWarehouse.map((row) => (
                <tr key={row.warehouseId} className="border-b border-ink-100">
                  <td className="px-4 py-2">{row.warehouseName}</td>
                  <td className="tabular px-4 py-2">{row.qty}</td>
                  <td className="tabular px-4 py-2">{formatKobo(BigInt(row.valueKobo))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
        {item.batches.length > 0 ? (
          <Surface padded={false}>
            <SurfaceHeader title="On hand by batch" />
            <table className="w-full text-left text-[13px]">
              <tbody>
                {item.batches.map((row) => (
                  <tr key={row.id} className="border-b border-ink-100">
                    <td className="px-4 py-2">{row.batchCode}</td>
                    <td className="px-4 py-2">{row.warehouseName}</td>
                    <td className="tabular px-4 py-2">{row.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Surface>
        ) : null}
        {item.serials.length > 0 ? (
          <Surface padded={false}>
            <SurfaceHeader title="Serials" />
            <table className="w-full text-left text-[13px]">
              <tbody>
                {item.serials.map((row) => (
                  <tr key={row.id} className="border-b border-ink-100">
                    <td className="px-4 py-2">{row.serialCode}</td>
                    <td className="px-4 py-2">{row.warehouseName}</td>
                    <td className="px-4 py-2">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Surface>
        ) : null}
        {item.producedFrom.length > 0 || item.consumedIn.length > 0 || item.soldOn.length > 0 ? (
          <Surface>
            <SurfaceHeader title="Produced / sold" />
            <ul className="px-4 py-3 text-[13px]">
              {item.producedFrom.map((row) => (
                <li key={`pf-${row.orderId}-${row.rawBatchCode}`}>
                  Produced from {row.rawBatchCode} on{' '}
                  <Link href={`/inventory/production/${row.orderId}`} className="underline">
                    {row.orderReference}
                  </Link>
                </li>
              ))}
              {item.consumedIn.map((row) => (
                <li key={`ci-${row.orderId}-${row.finishedBatchCode}`}>
                  Consumed in {row.finishedBatchCode} on{' '}
                  <Link href={`/inventory/production/${row.orderId}`} className="underline">
                    {row.orderReference}
                  </Link>
                </li>
              ))}
              {item.soldOn.map((row) => (
                <li key={`so-${row.orderId}`}>
                  Sold on{' '}
                  <Link href={`/inventory/sales/${row.orderId}`} className="underline">
                    {row.orderReference}
                  </Link>{' '}
                  · {row.quantity} · {row.status.replaceAll('_', ' ')}
                </li>
              ))}
            </ul>
          </Surface>
        ) : null}
        <Surface padded={false}>
          <SurfaceHeader title="Purchase history" description="Stock came from these PRs via GRNs." />
          <ul className="px-4 py-3 text-[13px]">
            {item.purchaseHistory.length === 0 ? <li>No receipts yet.</li> : null}
            {item.purchaseHistory.map((row) => (
              <li key={`${row.procurementId}-${row.grnReference ?? 'pr'}`} className="mb-1">
                <Link href={`/procurement/${row.procurementId}`} className="underline">
                  {row.procurementReference}
                </Link>
                {row.grnReference ? ` via ${row.grnReference}` : ''}
                {row.vendorName ? ` · ${row.vendorName}` : ''} · {row.quantity} on {row.occurredOn}
              </li>
            ))}
          </ul>
        </Surface>
      </div>
      <Surface padded={false} className="mt-4">
        <SurfaceHeader title="Movements" />
        {item.movements.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-ink-500">No movements.</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2">In</th>
                <th className="px-4 py-2">Out</th>
                <th className="px-4 py-2">Warehouse</th>
                <th className="px-4 py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {item.movements.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">{row.referenceNumber}</td>
                  <td className="px-4 py-2">
                    {row.source}
                    {row.grnReference ? ` · ${row.grnReference}` : ''}
                    {row.procurementReference ? ` · ${row.procurementReference}` : ''}
                  </td>
                  <td className="tabular px-4 py-2">{row.quantityIn || ''}</td>
                  <td className="tabular px-4 py-2">{row.quantityOut || ''}</td>
                  <td className="px-4 py-2">{row.warehouseName}</td>
                  <td className="px-4 py-2">{row.occurredOn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
