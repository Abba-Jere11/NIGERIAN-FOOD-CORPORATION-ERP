import Link from 'next/link';
import { formatKobo } from '@nfc/shared';
import { Surface, SurfaceHeader } from '@/components/ui/Surface';

export function InventorySnapshot({
  onHandValueKobo,
  expectedLines,
  lowStockCount,
  openProductionOrders,
  reservedSalesLines,
  href = '/inventory',
}: {
  onHandValueKobo: number;
  expectedLines: number;
  lowStockCount: number;
  openProductionOrders?: number;
  reservedSalesLines?: number;
  href?: string;
}) {
  return (
    <Surface padded={false}>
      <SurfaceHeader title="Inventory" description="Live stock across subsidiaries in your scope." />
      <dl className="grid grid-cols-1 gap-1 px-4 py-3 text-[13px]">
        <div className="flex justify-between">
          <dt className="text-ink-500">On-hand value</dt>
          <dd className="tabular font-medium">{formatKobo(BigInt(onHandValueKobo))}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-500">Expected lines</dt>
          <dd className="tabular font-medium">{expectedLines}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-500">Low-stock alerts</dt>
          <dd className="tabular font-medium">{lowStockCount}</dd>
        </div>
        {typeof openProductionOrders === 'number' ? (
          <div className="flex justify-between">
            <dt className="text-ink-500">Open production</dt>
            <dd className="tabular font-medium">{openProductionOrders}</dd>
          </div>
        ) : null}
        {typeof reservedSalesLines === 'number' ? (
          <div className="flex justify-between">
            <dt className="text-ink-500">Reserved sales lines</dt>
            <dd className="tabular font-medium">{reservedSalesLines}</dd>
          </div>
        ) : null}
      </dl>
      <p className="border-t border-ink-100 px-4 py-2 text-[12px] text-ink-500">
        <Link href={href} className="underline">
          Open inventory
        </Link>
      </p>
    </Surface>
  );
}
