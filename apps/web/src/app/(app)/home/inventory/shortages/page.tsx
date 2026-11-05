import { HomeQueueTable } from '@/components/home/HomeQueueTable';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { loadOfficerQueues, toQueueRow } from '../officer-queues';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Shortage tracker — NFC' };

export default async function ShortageTrackerPage() {
  const { shortages } = await loadOfficerQueues();

  return (
    <>
      <PageHeader
        eyebrow="Deliveries"
        title="Shortage tracker"
        description="Partial receipts with remainder. Overdue second-batch dates are flagged."
      />
      <Surface padded={false}>
        <SurfaceHeader title="Outstanding quantities" description={`${shortages.length} in this queue.`} />
        <HomeQueueTable
          rows={shortages.map((item) => toQueueRow(item, { outstanding: true }))}
          columns={['reference', 'meta', 'detail', 'amount']}
          emptyTitle="No partial deliveries"
          emptyDescription="Partial receipts with remainder appear here."
        />
      </Surface>
    </>
  );
}
