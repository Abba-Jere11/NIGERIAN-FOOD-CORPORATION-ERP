import type { WorkflowPendingView } from '@nfc/shared';
import { PR_2026_000184 } from '@nfc/shared';
import Link from 'next/link';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { apiFetch } from '@/lib/api';
import { submitFixtureAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Workflows — NFC' };

export default async function WorkflowsPage() {
  const pending = await apiFetch<WorkflowPendingView[]>('/api/workflows/pending');

  return (
    <>
      <PageHeader
        eyebrow="Shared services"
        title="Workflows"
        description="What is waiting for you. The tracker and the seals are a read-out of the same append-only table."
      />
      <Surface className="mb-4">
        <SurfaceHeader
          title={PR_2026_000184}
          description="Milling-machine fixture. Submit as the Yobe Fertilizer GM to start the chain."
        />
        <div className="px-4 py-3">
          <form action={submitFixtureAction}>
            <Button type="submit" variant="secondary" size="sm">
              Submit milling-machine request
            </Button>
          </form>
        </div>
      </Surface>
      <Surface padded={false}>
        <SurfaceHeader title="Waiting for you" />
        {pending.length === 0 ? (
          <EmptyState title="Nothing is waiting" description="When a stage is assigned to you it appears here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Reference</th>
                <th className="px-4 py-2 font-semibold">Title</th>
                <th className="px-4 py-2 font-semibold">Stage</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2 font-mono">
                    <Link href={row.href ?? `/workflows/${row.id}`} className="text-accent-800 underline">
                      {row.referenceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.title}</td>
                  <td className="px-4 py-2">{row.currentStageLabel}</td>
                  <td className="px-4 py-2">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
