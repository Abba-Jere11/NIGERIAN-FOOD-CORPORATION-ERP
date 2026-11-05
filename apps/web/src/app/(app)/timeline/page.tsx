import type { TimelineEventView } from '@nfc/shared';
import { TIMELINE_SUBJECT_ID } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { Timeline } from '@/components/ui/Timeline';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Timeline — NFC' };

export default async function TimelineDemoPage() {
  const events = await apiFetch<TimelineEventView[]>('/api/timeline', {
    query: { subjectType: 'ENGINE', subjectId: TIMELINE_SUBJECT_ID },
  });

  return (
    <>
      <PageHeader
        eyebrow="Shared services"
        title="Timeline"
        description="Seeded events for the generic timeline used by later modules."
      />
      <Surface padded={false}>
        <SurfaceHeader title="Events" description="Oldest first." />
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
