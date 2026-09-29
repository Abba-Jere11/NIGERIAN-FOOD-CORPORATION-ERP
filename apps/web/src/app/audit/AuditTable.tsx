import type { AuditEntryView } from '@nfc/shared';
import { AUDIT_ACTION_LABELS, formatLagosDateTime, ROLES } from '@nfc/shared';
import { EmptyState } from '@/components/ui/States';

/**
 * The audit table.
 *
 * Rendered on the server because the log is paginated on the server: the browser
 * is never sent rows it is not displaying. Each row expands to show the whole
 * entry - before and after values, reason, address, device and request id - so
 * "who did what, when, and why" is answerable without leaving the page.
 */
export function AuditTable({ entries }: { entries: AuditEntryView[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No entries match these filters"
        description="Widen the date range, or clear the filters to see the whole log."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">Audit log entries</caption>
        <thead>
          <tr className="border-b border-ink-200 bg-surface-muted text-left">
            {['When', 'Who', 'Action', 'Record', 'Entity', 'Reason', 'Detail'].map((header) => (
              <th
                key={header}
                scope="col"
                className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-600"
              >
                {header === 'Detail' ? <span className="sr-only">{header}</span> : header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.id}
              className="avoid-break border-b border-ink-100 align-top last:border-0"
            >
              <td className="tabular whitespace-nowrap px-3 py-2 text-ink-700">
                {formatLagosDateTime(entry.occurredAt)}
              </td>
              <td className="px-3 py-2">
                <span className="block text-ink-900">{entry.actorName ?? entry.actorRef}</span>
                <span className="block text-[11px] text-ink-500">
                  {entry.actorRole ? ROLES[entry.actorRole].shortName : 'System'}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-ink-900">
                {AUDIT_ACTION_LABELS[entry.action]}
              </td>
              <td className="px-3 py-2">
                <span className="block text-ink-900">
                  {entry.subjectLabel ?? entry.subjectReferenceNumber ?? '—'}
                </span>
                <span className="block font-mono text-[11px] text-ink-500">
                  {entry.subjectType}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-ink-700">
                {entry.entityCode ?? <span className="text-ink-400">—</span>}
              </td>
              <td className="px-3 py-2 text-ink-700">
                {entry.reason ? (
                  <span className="italic">{entry.reason}</span>
                ) : (
                  <span className="text-ink-400">—</span>
                )}
              </td>
              <td className="px-3 py-2">
                <details className="no-print">
                  <summary className="cursor-pointer text-[12px] text-accent-700 underline">
                    Detail
                  </summary>
                  <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[11px]">
                    <Detail label="Entry id" value={entry.id} mono />
                    <Detail label="Actor id" value={entry.actorRef} mono />
                    <Detail label="Record id" value={entry.subjectId} mono />
                    <Detail label="Reference" value={entry.subjectReferenceNumber} mono />
                    <Detail label="Address" value={entry.ipAddress} mono />
                    <Detail label="Session" value={entry.sessionId} mono />
                    <Detail label="Request" value={entry.requestId} mono />
                    <Detail label="Device" value={entry.userAgent} />
                    <Detail label="Before" value={formatValue(entry.oldValue)} mono />
                    <Detail label="After" value={formatValue(entry.newValue)} mono />
                  </dl>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  if (value === null || value === '') return null;
  return (
    <>
      <dt className="font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className={mono ? 'break-all font-mono text-ink-700' : 'text-ink-700'}>{value}</dd>
    </>
  );
}

function formatValue(value: Record<string, unknown> | null): string | null {
  if (value === null) return null;
  const parts = Object.entries(value).map(
    ([key, item]) => `${key}: ${item === null ? 'none' : String(item)}`,
  );
  return parts.length === 0 ? null : parts.join(', ');
}
