import type { EngineRecordView, TimelineEventView } from '@nfc/shared';
import { notFound } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { Timeline } from '@/components/ui/Timeline';
import { apiFetch, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function EngineRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let record: EngineRecordView;
  try {
    record = await apiFetch<EngineRecordView>(`/api/engine/records/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  const events = await apiFetch<TimelineEventView[]>('/api/timeline', {
    query: { subjectType: 'ENGINE', subjectId: id },
  }).catch(() => [] as TimelineEventView[]);

  return (
    <>
      <PageHeader
        eyebrow="Numbered record"
        title={record.referenceNumber}
        description={record.title}
      />
      <Surface padded={false}>
        <SurfaceHeader title="Timeline" description="Events in order, with the actor and the time." />
        <div className="px-4 py-3">
          <Timeline
            entries={events.map((event) => ({
              id: event.id,
              occurredAt: event.occurredAt,
              actor: event.actor,
              text: event.text,
              href: event.href,
            }))}
          />
        </div>
      </Surface>
    </>
  );
}
