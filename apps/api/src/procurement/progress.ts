import type { ProcurementProgressStep, ProcurementView } from '@nfc/shared';

/** A workflow action on the procurement instance, as the tracker needs it. */
export interface ProgressAction {
  stageKey: string;
  action: string;
  actorName: string | null;
  occurredAt: string;
  subjectVersion: number;
}

type ProgressView = Pick<
  ProcurementView,
  | 'status'
  | 'currentVersion'
  | 'requisitionId'
  | 'preparedByName'
  | 'originatorName'
  | 'versions'
  | 'invoice'
  | 'financialReview'
  | 'fundingRoute'
  | 'finalPaymentTiming'
  | 'transfers'
  | 'payments'
  | 'deliveries'
  | 'receipts'
  | 'deliveryComplete'
  | 'paymentComplete'
  | 'nextAction'
>;

const STATUS_RANK: Record<string, number> = {
  DRAFT: 0,
  AWAITING_NEED_APPROVAL: 1,
  AWAITING_PREPARATION: 2,
  AWAITING_OPERATIONS: 3,
  AWAITING_MD: 4,
  AWAITING_ED_FINANCE: 5,
  FUNDING_PENDING: 6,
  AWAITING_PAYMENT: 6,
  PAYMENT_PROCESSING: 6,
  AWAITING_DELIVERY: 6,
  PARTIALLY_RECEIVED: 6,
  COMPLETED: 7,
};

/** Workflow stage that rejects or returns at each tracker step. */
const STEP_STAGE: Record<string, string> = {
  need: 'need-approval',
  operations: 'ed-operations',
  md: 'md',
  finance: 'ed-finance',
};

/**
 * The procurement tracker: one ordered list of steps with who is responsible,
 * following the payment arrangement (pay before delivery puts payment first,
 * pay after delivery puts delivery verification first).
 */
export function buildProgress(view: ProgressView, actions: ProgressAction[]): ProcurementProgressStep[] {
  const current = actions.filter((row) => row.subjectVersion === view.currentVersion);
  const latest = (stageKey: string, action: string, rows = current): ProgressAction | undefined =>
    [...rows].reverse().find((row) => row.stageKey === stageKey && row.action === action);
  const terminal = view.status === 'REJECTED' || view.status === 'ARCHIVED' || view.status === 'DISCARDED';
  const rejection = actions.filter((row) => row.action === 'REJECT').at(-1);
  const rank = terminal ? terminalRank(actions) : (STATUS_RANK[view.status] ?? 0);
  const next = view.nextAction;
  const submitted = view.versions.find((version) => version.submittedAt);
  const fromRequisition = Boolean(view.requisitionId);
  const returned = view.status === 'DRAFT' && actions.some((row) => row.action === 'RETURN_FOR_CORRECTION');

  const steps: ProcurementProgressStep[] = [];
  const push = (
    key: string,
    label: string,
    responsible: string,
    done: boolean,
    isCurrent: boolean,
    actor: string | null = null,
    at: string | null = null,
  ) => {
    steps.push({
      key,
      label,
      responsible: isCurrent && next ? next.responsible : responsible,
      state: done ? 'done' : isCurrent ? 'current' : 'pending',
      actor: done ? actor : null,
      at: done ? at : null,
      action: isCurrent && next ? next.label : null,
    });
  };

  if (fromRequisition) {
    push('requisition', 'Requisition submitted', 'General Manager', true, false, view.originatorName, null);
    const need = latest('need-approval', 'APPROVE', actions);
    push('need', 'Need approved', 'Managing Director', rank >= 2, view.status === 'AWAITING_NEED_APPROVAL', need?.actorName ?? null, need?.occurredAt ?? null);
    push(
      'proposal',
      'Proposal prepared',
      'Procurement Manager',
      Boolean(submitted) && rank >= 3,
      next?.key === 'prepare_proposal',
      submitted?.submittedByName ?? view.preparedByName,
      submitted?.submittedAt ?? null,
    );
  } else {
    push(
      'proposal',
      'Request submitted',
      'General Manager',
      Boolean(submitted) && rank >= 3,
      view.status === 'DRAFT',
      submitted?.submittedByName ?? null,
      submitted?.submittedAt ?? null,
    );
  }

  const operations = latest('ed-operations', 'APPROVE');
  if (operations || view.status === 'AWAITING_OPERATIONS' || actions.some((row) => row.stageKey === 'ed-operations')) {
    push(
      'operations',
      'ED Operations review',
      'ED Operations',
      rank >= 4,
      view.status === 'AWAITING_OPERATIONS',
      operations?.actorName ?? null,
      operations?.occurredAt ?? null,
    );
  }

  const md = latest('md', 'APPROVE');
  push('md', 'MD approval', 'Managing Director', rank >= 5, view.status === 'AWAITING_MD', md?.actorName ?? null, md?.occurredAt ?? null);

  if (fromRequisition) {
    push(
      'invoice',
      'Vendor invoice',
      'Procurement Manager',
      Boolean(view.invoice) && (rank >= 6 || next?.key === 'approve_funding'),
      next?.key === 'upload_invoice' || next?.key === 'decide_invoice_variance',
    );
  }

  push(
    'finance',
    'ED Finance funding approval',
    'ED Finance',
    Boolean(view.financialReview),
    next?.key === 'approve_funding',
    view.financialReview?.createdByName ?? null,
    view.financialReview?.createdAt ?? null,
  );

  if (view.fundingRoute === 'corporate_allocation') {
    push(
      'transfer',
      'Funding transfer to subsidiary',
      'ED Finance',
      view.transfers.length > 0,
      next?.key === 'record_transfer',
      null,
      view.transfers[0]?.createdAt ?? null,
    );
  }

  const payer = view.fundingRoute === 'nfc_holding' ? 'ED Finance' : 'Finance Head';
  const payment = view.payments.filter((item) => !item.reversedAt).at(-1);
  const lastDelivery = view.deliveries.at(-1);
  const lastReceipt = view.receipts.at(-1);
  const pushPayment = () =>
    push(
      'payment',
      'Vendor payment',
      payer,
      view.paymentComplete && rank >= 6,
      next?.key === 'pay_vendor',
      null,
      payment?.createdAt ?? null,
    );
  const pushDelivery = () =>
    push(
      'delivery',
      'Delivery verified item by item',
      'Procurement Manager',
      (view.deliveryComplete && rank >= 6) || view.status === 'COMPLETED',
      next?.key === 'verify_delivery',
      lastDelivery?.createdByName ?? lastReceipt?.createdByName ?? null,
      lastDelivery?.createdAt ?? lastReceipt?.createdAt ?? null,
    );
  if (view.finalPaymentTiming === 'after_delivery') {
    pushDelivery();
    pushPayment();
  } else {
    pushPayment();
    pushDelivery();
  }

  push('completed', 'Completed', 'Procurement Manager', view.status === 'COMPLETED', false);

  if (returned) {
    const step = steps.find((item) => item.key === 'proposal');
    if (step) step.state = 'returned';
  }
  if (view.status === 'REJECTED' && rejection) {
    const key = Object.entries(STEP_STAGE).find(([, stage]) => stage === rejection.stageKey)?.[0];
    const step = steps.find((item) => item.key === key);
    if (step) {
      step.state = 'rejected';
      step.actor = rejection.actorName;
      step.at = rejection.occurredAt;
    }
  }
  return steps;
}

/** How far a rejected or archived request got, from its last approval. */
function terminalRank(actions: ProgressAction[]): number {
  const approved = new Set(actions.filter((row) => row.action === 'APPROVE').map((row) => row.stageKey));
  if (approved.has('ed-finance')) return 6;
  if (approved.has('md')) return 5;
  if (approved.has('ed-operations')) return 4;
  if (approved.has('need-approval')) return 2;
  return 0;
}
