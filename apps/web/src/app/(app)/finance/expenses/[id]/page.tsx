import type { ExpenseEntryView, MeView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import { Button } from '@/components/ui/Button';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { submitExpenseAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, row] = await Promise.all([
    apiFetch<MeView>('/api/me'),
    apiFetch<ExpenseEntryView>(`/api/finance/expenses/${id}`),
  ]);
  return (
    <>
      <PageHeader eyebrow="Expense" title={row.referenceNumber} description={row.narration} />
      <Surface>
        <p className="px-4 pt-3 text-[13px]">
          {formatKobo(BigInt(row.amountKobo))} · {row.categoryName} · <StatusBadge status={row.status} />
        </p>
        {row.status === 'DRAFT' && me.permissions.includes('finance.expense.manage') ? (
          <form action={submitExpenseAction} className="px-4 py-3">
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="rowVersion" value={row.rowVersion} />
            <Button type="submit" variant="primary">
              Submit for approval
            </Button>
          </form>
        ) : null}
      </Surface>
    </>
  );
}
