import { HomeQueueTable } from '@/components/home/HomeQueueTable';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { loadOfficerQueues, toQueueRow } from '../officer-queues';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pending deliveries — NFC' };

export default async function PendingDeliveriesPage() {
  const { pending } = await loadOfficerQueues();

  return (
    <>
      <PageHeader
        eyebrow="Deliveries"
        title="Pending deliveries"
        description="Requests waiting for a goods received note. Open a row to record receipt."
      />
      <Surface padded={false}>
        <SurfaceHeader title="Awaiting first receipt" description={`${pending.length} in this queue.`} />
        <HomeQueueTable
          rows={pending.map((item) => toQueueRow(item))}
          emptyTitle="Nothing awaiting delivery"
          emptyDescription="Requests move here when delivery is due."
        />
      </Surface>
    </>
  );
}
