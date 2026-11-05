import type { MeView, ProcurementListItemView, ProcurementListView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import type { HomeQueueRow } from '@/components/home/HomeQueueTable';
import { apiFetch } from '@/lib/api';

export type OfficerQueues = {
  me: MeView;
  pending: ProcurementListItemView[];
  shortages: ProcurementListItemView[];
  history: ProcurementListItemView[];
  prepare: ProcurementListItemView[];
  pendingCount: number;
  shortageCount: number;
  completedCount: number;
  prepareCount: number;
};

export async function loadOfficerQueues(): Promise<OfficerQueues> {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('procurement.verify.delivery')) redirect('/forbidden');

  const list = await apiFetch<ProcurementListView>('/api/procurement').catch(
    () => ({ items: [], counts: {} }) as ProcurementListView,
  );

  return {
    me,
    pending: list.items.filter((item) => item.status === 'AWAITING_DELIVERY'),
    shortages: list.items.filter((item) => item.status === 'PARTIALLY_RECEIVED'),
    history: list.items.filter((item) => item.status === 'COMPLETED'),
    prepare: list.items.filter(
      (item) =>
        item.status === 'AWAITING_PREPARATION' ||
        (item.status === 'DRAFT' && Boolean(item.preparedByUserId)),
    ),
    pendingCount: list.counts.AWAITING_DELIVERY ?? 0,
    shortageCount: list.counts.PARTIALLY_RECEIVED ?? 0,
    completedCount: list.counts.COMPLETED ?? 0,
    prepareCount: list.counts.AWAITING_PREPARATION ?? 0,
  };
}

export function toQueueRow(
  item: ProcurementListItemView,
  opts?: { outstanding?: boolean },
): HomeQueueRow {
  return {
    id: item.id,
    reference: item.referenceNumber,
    title: item.title,
    meta: [item.entityCode, item.status.replaceAll('_', ' '), item.vendorName].filter(Boolean).join(' · '),
    amountKobo: item.totalAmountKobo,
    href: `/procurement/${item.id}`,
    detail: opts?.outstanding ? shortageDetail(item) : null,
  };
}

function outstandingLabel(quantity: number): string {
  return quantity === 1 ? '1 outstanding' : `${quantity} outstanding`;
}

function shortageDetail(item: ProcurementListItemView): string {
  const qty = outstandingLabel(item.outstandingQuantity);
  if (item.shortageOverdue && item.secondBatchDueOn) {
    return `${qty} · overdue since ${item.secondBatchDueOn}`;
  }
  if (item.secondBatchDueOn) return `${qty} · due ${item.secondBatchDueOn}`;
  return qty;
}
