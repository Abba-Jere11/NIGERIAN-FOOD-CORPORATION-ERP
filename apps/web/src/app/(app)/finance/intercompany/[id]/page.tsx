import type { IntercompanyTransactionView, MeView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import { Button } from '@/components/ui/Button';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { acknowledgeIntercompanyAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function IntercompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, row] = await Promise.all([
    apiFetch<MeView>('/api/me'),
    apiFetch<IntercompanyTransactionView>(`/api/finance/intercompany/${id}`),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Inter-company"
        title={row.referenceNumber}
        description={`${row.sourceEntityCode} → ${row.destinationEntityCode}`}
      />
      <Surface>
        <p className="px-4 pt-3 text-[13px]">
          {formatKobo(BigInt(row.amountKobo))} · {row.type} · {row.mismatched ? 'Mismatch' : 'Balanced'}
        </p>
        {!row.acknowledgedAt && me.permissions.includes('finance.intercompany.acknowledge') ? (
          <form action={acknowledgeIntercompanyAction} className="px-4 py-3">
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="rowVersion" value={row.rowVersion} />
            <Button type="submit" variant="primary">
              Acknowledge receipt
            </Button>
          </form>
        ) : null}
      </Surface>
    </>
  );
}
