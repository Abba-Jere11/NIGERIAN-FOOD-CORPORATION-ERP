import Link from 'next/link';
import type { ProcurementMyActionView } from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import { apiFetch } from '@/lib/api';

/**
 * Every procurement step waiting for the signed-in user, shown first on their
 * dashboard so nothing has to be found through the procurement list.
 */
export async function PendingActionsPanel() {
  const actions = await apiFetch<ProcurementMyActionView[]>('/api/procurement/my-actions').catch(
    () => [] as ProcurementMyActionView[],
  );
  if (actions.length === 0) {
    return (
      <p
        id="pending-actions"
        data-testid="pending-actions-empty"
        className="mb-4 border border-ink-200 bg-surface px-4 py-2 text-[13px] text-ink-600"
      >
        No procurement actions are waiting for you.
      </p>
    );
  }
  return (
    <section
      id="pending-actions"
      aria-labelledby="pending-actions-title"
      data-testid="pending-actions"
      className="mb-4 border-l-4 border-accent-700 bg-accent-50 px-4 py-3"
    >
      <h2 id="pending-actions-title" className="text-[15px] font-semibold text-ink-900">
        {actions.length === 1 ? '1 action needs you' : `${actions.length} actions need you`}
      </h2>
      <ul className="mt-2 divide-y divide-accent-100">
        {actions.map((item) => (
          <li key={`${item.requestId}-${item.actionKey}`} className="py-2">
            <Link
              href={item.href}
              className="group flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
              data-testid="pending-action"
            >
              <span>
                <span className="font-semibold text-ink-900 underline">{item.referenceNumber}</span>
                <span className="text-ink-900"> — {item.actionLabel}</span>
                <span className="block text-[12px] text-ink-700">
                  {item.title}
                  {item.detail ? ` · ${item.detail}` : ''}
                </span>
              </span>
              <span className="text-[12px] text-ink-500">Updated {formatLagosDateTime(item.since)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
