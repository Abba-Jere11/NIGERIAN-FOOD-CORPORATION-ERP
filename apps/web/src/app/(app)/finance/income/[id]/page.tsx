import type { IncomeEntryView, MeView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { apiFetch } from '@/lib/api';
import { submitIncomeAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function IncomeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, row] = await Promise.all([
    apiFetch<MeView>('/api/me'),
    apiFetch<IncomeEntryView>(`/api/finance/income/${id}`),
  ]);
  return (
    <>
      <PageHeader eyebrow="Income" title={row.referenceNumber} description={row.narration} />
      <Surface>
        <p className="px-4 pt-3 text-[13px]">
          {formatKobo(BigInt(row.amountKobo))} · {row.categoryName} · <StatusBadge status={row.status} />
        </p>
        {row.status === 'DRAFT' && me.permissions.includes('finance.income.manage') ? (
          <form action={submitIncomeAction} className="px-4 py-3">
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
