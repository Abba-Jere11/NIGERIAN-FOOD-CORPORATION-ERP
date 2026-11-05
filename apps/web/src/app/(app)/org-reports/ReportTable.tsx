import Link from 'next/link';
import type { OrgMinuteListItemView, OrgReportListItemView } from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';

export function ReportTable({
  rows,
  emptyTitle,
  emptyDescription,
}: {
  rows: OrgReportListItemView[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <table className="w-full text-left text-[13px]">
      <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase tracking-wider text-ink-500">
        <tr>
          <th className="px-4 py-2 font-semibold">Reference</th>
          <th className="px-4 py-2 font-semibold">Title</th>
          <th className="px-4 py-2 font-semibold">Category</th>
          <th className="px-4 py-2 font-semibold">Sender</th>
          <th className="px-4 py-2 font-semibold">Unit</th>
          <th className="px-4 py-2 font-semibold">Status</th>
          <th className="px-4 py-2 font-semibold">Updated</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-ink-100">
            <td className="px-4 py-2 font-mono">
              <Link href={`/org-reports/${row.id}`} className="text-accent-800 underline">
                {row.referenceNumber}
              </Link>
              {row.actionOutstanding ? (
                <span className="ml-2 text-[11px] font-semibold uppercase text-warning-700">Action</span>
              ) : row.myKind === 'CC' || row.myKind === 'FORWARD' ? (
                <span className="ml-2 text-[11px] uppercase text-ink-500">Information</span>
              ) : null}
            </td>
            <td className="px-4 py-2">{row.title}</td>
            <td className="px-4 py-2">{row.templateTitle}</td>
            <td className="px-4 py-2">{row.senderName ?? '—'}</td>
            <td className="px-4 py-2">{row.entityCode ?? '—'}</td>
            <td className="px-4 py-2">
              <StatusBadge status={row.status} />
            </td>
            <td className="px-4 py-2 tabular text-ink-500">{formatLagosDateTime(row.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MinuteTable({
  rows,
  emptyTitle,
  emptyDescription,
}: {
  rows: OrgMinuteListItemView[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <table className="w-full text-left text-[13px]">
      <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase tracking-wider text-ink-500">
        <tr>
          <th className="px-4 py-2 font-semibold">Reference</th>
          <th className="px-4 py-2 font-semibold">Subject</th>
          <th className="px-4 py-2 font-semibold">Issuer</th>
          <th className="px-4 py-2 font-semibold">Source</th>
          <th className="px-4 py-2 font-semibold">Due</th>
          <th className="px-4 py-2 font-semibold">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-ink-100">
            <td className="px-4 py-2 font-mono">
              <Link href={`/org-reports/minutes/${row.id}`} className="text-accent-800 underline">
                {row.referenceNumber}
              </Link>
            </td>
            <td className="px-4 py-2">{row.subject}</td>
            <td className="px-4 py-2">{row.issuerName ?? '—'}</td>
            <td className="px-4 py-2 font-mono">
              <Link href={`/org-reports/${row.sourceReportId}`} className="underline">
                {row.sourceReportReference}
              </Link>
            </td>
            <td className="px-4 py-2">{row.dueAt ? formatLagosDateTime(row.dueAt) : '—'}</td>
            <td className="px-4 py-2">
              <StatusBadge status={row.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
