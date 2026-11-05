import { HomeQueueTable } from '@/components/home/HomeQueueTable';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { loadOfficerQueues, toQueueRow } from '../officer-queues';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Delivery history — NFC' };

export default async function DeliveryHistoryPage() {
  const { history } = await loadOfficerQueues();

  return (
    <>
      <PageHeader
        eyebrow="Deliveries"
        title="Delivery history"
        description="Requests that are delivered and paid."
      />
      <Surface padded={false}>
        <SurfaceHeader title="Completed" description={`${history.length} in this queue.`} />
        <HomeQueueTable
          rows={history.map((item) => toQueueRow(item))}
          emptyTitle="No completed deliveries"
          emptyDescription="Fully received and paid requests appear here."
        />
      </Surface>
    </>
  );
}
