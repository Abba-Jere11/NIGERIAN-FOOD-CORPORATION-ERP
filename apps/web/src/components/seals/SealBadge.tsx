import { formatLagosDateTime, type SealView } from '@nfc/shared';
import { cx } from '@/lib/cx';

export function SealBadge({ seal }: { seal: SealView }) {
  const invalid = seal.verification !== 'VALID';
  return (
    <article
      className={cx(
        'border px-3 py-2',
        invalid ? 'border-danger-600 bg-danger-100' : 'border-ink-800 bg-surface',
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">
        {seal.badgeLabel}
      </p>
      <p className="mt-1 text-[14px] font-semibold text-ink-900">{seal.approverName}</p>
      <p className="text-[12px] text-ink-600">
        {seal.approverRoleLabel}
        {seal.entityName ? ` · ${seal.entityName}` : ''}
      </p>
      <p className="mt-1 tabular text-[12px] text-ink-500">{formatLagosDateTime(seal.occurredAt)}</p>
      <p className="font-mono text-[11px] text-ink-500">{seal.referenceNumber}</p>
      {seal.reason ? <p className="mt-1 text-[12px] text-ink-700">Reason: {seal.reason}</p> : null}
      {seal.paymentRef ? (
        <p className="mt-1 text-[12px] text-ink-700">Payment: {seal.paymentRef}</p>
      ) : null}
      <p
        className={cx(
          'mt-2 text-[11px] font-semibold uppercase tracking-wider',
          invalid ? 'text-danger-700' : 'text-accent-700',
        )}
      >
        {invalid ? 'INVALID / TAMPERED' : 'VALID'}
      </p>
    </article>
  );
}
