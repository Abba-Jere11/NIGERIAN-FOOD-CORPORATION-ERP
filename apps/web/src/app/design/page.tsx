import { formatKobo, formatLagosDateTime, parseNairaToKobo } from '@nfc/shared';
import { ApprovalTracker } from '@/components/ui/ApprovalTracker';
import { Button, ButtonLink } from '@/components/ui/Button';
import { DefinitionList, PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Timeline } from '@/components/ui/Timeline';
import { DesignFormExhibit, DesignTableExhibit, DesignToastExhibit } from './exhibits';

/**
 * The design-system reference (M1 item 6).
 *
 * Every shared component appears here once, in its real states. This is the page
 * later milestones consult before inventing a new component, which is how the
 * system stays one system rather than eighteen.
 */
export const metadata = { title: 'Design system — NFC' };

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <Surface padded={false} className="avoid-break">
      <SurfaceHeader title={title} description={note} />
      <div className="px-4 py-4">{children}</div>
    </Surface>
  );
}

export default function DesignPage() {
  const sampleKobo = parseNairaToKobo('4,500.50');

  return (
    <>
      <PageHeader
        eyebrow="Reference"
        title="Design system"
        description="The complete component vocabulary. Clarity, hierarchy, speed, traceability and trust — a restrained palette, no gradients, no decoration."
      />

      <div className="space-y-4">
        <Section
          title="Colour"
          note="A deep green accent, neutral greys, one warning and one danger."
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {[
              ['accent-900', 'bg-accent-900'],
              ['accent-700', 'bg-accent-700'],
              ['accent-100', 'bg-accent-100'],
              ['ink-900', 'bg-ink-900'],
              ['ink-500', 'bg-ink-500'],
              ['ink-200', 'bg-ink-200'],
              ['warning-600', 'bg-warning-600'],
              ['warning-100', 'bg-warning-100'],
              ['danger-600', 'bg-danger-600'],
              ['danger-100', 'bg-danger-100'],
              ['info-700', 'bg-info-700'],
              ['info-100', 'bg-info-100'],
            ].map(([name, className]) => (
              <div key={name} className="border border-ink-200">
                <div className={`h-10 ${className}`} />
                <p className="px-1.5 py-1 font-mono text-[10px] text-ink-600">{name}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Buttons"
          note="One primary action per screen. Danger is reserved for destructive intent."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="subtle">Subtle</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button variant="secondary" size="sm">
              Small
            </Button>
            <ButtonLink href="/design" variant="secondary">
              Link styled as a button
            </ButtonLink>
          </div>
        </Section>

        <Section
          title="Status badges"
          note="The status vocabulary is shared, so the same status reads identically in every module."
        >
          <div className="flex flex-wrap gap-2">
            {[
              'ACTIVE',
              'INACTIVE',
              'DRAFT',
              'AWAITING_OPERATIONS',
              'AWAITING_MD',
              'AWAITING_ED_FINANCE',
              'PAYMENT_PROCESSING',
              'PARTIALLY_RECEIVED',
              'COMPLETED',
              'REJECTED',
              'SUSPENDED',
              'BLACKLISTED',
              'ARCHIVED',
            ].map((status) => (
              <StatusBadge key={status} status={status} />
            ))}
          </div>
        </Section>

        <Section
          title="Approval tracker"
          note="Done, current and pending are the three required marks; returned and rejected exist for the approval chains from M6 onwards."
        >
          <div className="space-y-6">
            <ApprovalTracker
              stages={[
                {
                  key: 'raise',
                  label: 'Raised',
                  state: 'done',
                  actor: 'Finance Head, YFZ',
                  at: formatLagosDateTime('2026-09-21T09:14:00Z'),
                },
                {
                  key: 'gm',
                  label: 'GM approval',
                  state: 'done',
                  actor: 'GM, YFZ',
                  at: formatLagosDateTime('2026-09-21T11:02:00Z'),
                },
                {
                  key: 'ops',
                  label: 'Operations review',
                  state: 'current',
                  actor: 'ED Operations',
                },
                { key: 'md', label: 'MD approval', state: 'pending' },
                { key: 'pay', label: 'Payment', state: 'pending' },
              ]}
            />
            <ApprovalTracker
              stages={[
                { key: 'raise', label: 'Raised', state: 'done', actor: 'Finance Head, DMA' },
                { key: 'gm', label: 'GM approval', state: 'returned', actor: 'GM, DMA' },
                { key: 'md', label: 'MD approval', state: 'rejected', actor: 'Managing Director' },
              ]}
            />
          </div>
        </Section>

        <Section
          title="Forms"
          note="Fields display the error the server enforced. Money is typed as naira and submitted as exact integer kobo."
        >
          <DesignFormExhibit />
        </Section>

        <Section
          title="Money and time"
          note="Money is stored as integer kobo and never as a float. Times are stored in UTC and displayed in Africa/Lagos on a 24-hour clock."
        >
          <DefinitionList
            columns={2}
            items={[
              { label: 'Typed', value: <span className="tabular">4,500.50</span> },
              {
                label: 'Stored (kobo)',
                value: <span className="tabular font-mono">{sampleKobo.toString()}</span>,
              },
              {
                label: 'Displayed',
                value: <span className="tabular">{formatKobo(sampleKobo)}</span>,
              },
              {
                label: 'Timestamp',
                value: (
                  <span className="tabular">{formatLagosDateTime('2026-09-21T09:14:00Z')}</span>
                ),
              },
            ]}
          />
        </Section>

        <Section
          title="Data table"
          note="Sortable, filterable, paginated and exportable. The only table pattern in the system."
        >
          <DesignTableExhibit />
        </Section>

        <Section
          title="Timeline"
          note="Date, time, actor and what happened. The shape every record history uses."
        >
          <Timeline
            entries={[
              {
                id: '1',
                occurredAt: '2026-09-21T09:14:00Z',
                actor: 'Ibrahim Danjuma · YFZ',
                text: 'Created — YFZ Production',
              },
              {
                id: '2',
                occurredAt: '2026-09-21T11:02:00Z',
                actor: 'Adebayo Okonkwo · Corporate',
                text: 'Edited — YFZ Production',
                detail: <span className="italic">“Renamed to match the new plant structure.”</span>,
              },
            ]}
          />
        </Section>

        <Section
          title="Empty, loading and error states"
          note="No panel is ever rendered blank. Each state says something true."
        >
          <div className="space-y-4">
            <div className="border border-ink-200">
              <EmptyState
                title="No purchase requisitions yet"
                description="Requisitions raised by a Finance Head appear here once procurement is in use."
                action={<Button variant="primary">Raise a requisition</Button>}
              />
            </div>
            <div className="border border-ink-200">
              <LoadingState label="Loading requisitions" rows={3} />
            </div>
            <ErrorState
              title="This could not be loaded"
              message="The database did not respond within five seconds."
              requestId="01J8Z9K3QX4M7VH2"
              action={<Button variant="secondary">Try again</Button>}
            />
            <Notice tone="info">
              You are viewing Yuci Flour Zaria only. Other subsidiaries are outside your access.
            </Notice>
            <Notice tone="warning">
              This requisition has been awaiting MD approval for four working days.
            </Notice>
            <Notice tone="danger">This vendor is blacklisted and cannot be selected.</Notice>
          </div>
        </Section>

        <Section
          title="Dialogs and toasts"
          note="Destructive and irreversible actions are confirmed. Where a reason is required it is typed here and stored permanently."
        >
          <DesignToastExhibit />
        </Section>

        <Section
          title="Print"
          note="Use the browser's print command on any record page. The top bar, navigation and controls are removed, panels lose their borders, and the page is laid out for A4."
        >
          <p className="text-[13px] text-ink-700">
            Everything marked <code className="font-mono text-[12px]">no-print</code> is hidden,
            table headers repeat across pages, and rows are kept off page breaks.
          </p>
        </Section>
      </div>
    </>
  );
}
