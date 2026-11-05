import Link from 'next/link';
import type { FinanceDashboardTilesView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import { withScope } from '../scope';

const COLUMNS: Array<{ key: keyof FinanceDashboardTilesView; label: string }> = [
  { key: 'cashPositionKobo', label: 'Cash' },
  { key: 'outstandingReceivablesKobo', label: 'Receivables' },
  { key: 'outstandingPayablesKobo', label: 'Payables' },
  { key: 'totalRevenueKobo', label: 'Revenue' },
  { key: 'totalExpenditureKobo', label: 'Expenditure' },
  { key: 'profitLossKobo', label: 'P&L' },
];

export function EntityComparisonTable({ entities }: { entities: FinanceDashboardTilesView[] }) {
  if (entities.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
          <tr>
            <th className="px-4 py-2 font-semibold">Entity</th>
            {COLUMNS.map((column) => (
              <th key={column.key} className="px-4 py-2 font-semibold">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entities.map((entity) => {
            const code = entity.entityCode ?? 'Entity';
            return (
              <tr key={entity.entityId ?? code} className="border-b border-ink-100">
                <td className="px-4 py-2 font-medium">
                  <Link href={withScope('/finance', code)} className="underline">
                    {code}
                  </Link>
                </td>
                {COLUMNS.map((column) => (
                  <td key={column.key} className="tabular px-4 py-2">
                    {formatKobo(BigInt(Number(entity[column.key] ?? 0)))}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
