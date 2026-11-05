import type { OverdueWorkflowView } from '@nfc/shared';
import Link from 'next/link';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { apiFetch, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Overdue workflows — NFC' };

export default async function OverduePage() {
  let rows: OverdueWorkflowView[] = [];
  let error: string | null = null;
  try {
    rows = await apiFetch<OverdueWorkflowView[]>('/api/workflows/overdue');
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not load overdue workflows.';
  }

  return (
    <>
      <PageHeader
        eyebrow="Oversight"
        title="Overdue workflows"
        description="Items pending with a person for two days or more."
      />
      {error ? (
        <Surface>
          <ErrorState title="You cannot view overdue workflows" message={error} />
        </Surface>
      ) : rows.length === 0 ? (
        <Surface>
          <EmptyState title="Nothing overdue" description="No open holds have passed the two-day reminder." />
        </Surface>
      ) : (
        <Surface padded={false}>
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[12px] text-ink-500">
              <tr>
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-4 py-2 font-medium">Holder</th>
                <th className="px-4 py-2 font-medium">Days</th>
                <th className="px-4 py-2 font-medium">Entity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">
                    {row.subjectType === 'PROCUREMENT' ? (
                      <Link href={`/procurement/${row.subjectId}`} className="font-medium text-ink-900 underline">
                        {row.referenceNumber}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink-900">{row.referenceNumber}</span>
                    )}
                    <span className="block text-ink-600">{row.title}</span>
                  </td>
                  <td className="px-4 py-2">{row.holderName}</td>
                  <td className="px-4 py-2 tabular">{row.daysPending}</td>
                  <td className="px-4 py-2">
                    {row.entityCode} — {row.entityName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      )}
    </>
  );
}
