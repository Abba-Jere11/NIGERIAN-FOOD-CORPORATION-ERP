import type { MeView, PayableInvoiceView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import { Button } from '@/components/ui/Button';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { submitBillAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function PayableDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, row] = await Promise.all([
    apiFetch<MeView>('/api/me'),
    apiFetch<PayableInvoiceView>(`/api/finance/payables/${id}`),
  ]);
  return (
    <>
      <PageHeader eyebrow="Payable" title={row.referenceNumber} description={row.vendorName ?? row.source} />
      <Surface>
        <p className="px-4 pt-3 text-[13px]">
          {formatKobo(BigInt(row.outstandingKobo))} outstanding · due {row.dueDate} ·{' '}
          <StatusBadge status={row.overdue ? 'OVERDUE' : row.status} />
        </p>
        {row.status === 'DRAFT' && me.permissions.includes('finance.payables.manage') ? (
          <form action={submitBillAction} className="px-4 py-3">
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
