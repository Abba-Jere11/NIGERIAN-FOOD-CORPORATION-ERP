import type { PermissionKey } from './permissions';

export const PROCUREMENT_STATUSES = [
  'DRAFT',
  'AWAITING_NEED_APPROVAL',
  'AWAITING_PREPARATION',
  'AWAITING_OPERATIONS',
  'AWAITING_MD',
  'AWAITING_ED_FINANCE',
  'FUNDING_PENDING',
  'AWAITING_PAYMENT',
  'PAYMENT_PROCESSING',
  'AWAITING_DELIVERY',
  'PARTIALLY_RECEIVED',
  'COMPLETED',
  'REJECTED',
  'ARCHIVED',
  'DISCARDED',
] as const;

export type ProcurementStatus = (typeof PROCUREMENT_STATUSES)[number];

export function isProcurementStatus(value: string): value is ProcurementStatus {
  return (PROCUREMENT_STATUSES as readonly string[]).includes(value);
}

/** Tiles that M6 owns with live data. Later statuses stay at zero until M7–M9. */
export const PROCUREMENT_M6_TILE_STATUSES: readonly ProcurementStatus[] = [
  'DRAFT',
  'AWAITING_NEED_APPROVAL',
  'AWAITING_PREPARATION',
  'AWAITING_OPERATIONS',
  'REJECTED',
  'DISCARDED',
];

/** Status tiles that M7 keeps live. Funding/payment/delivery remain M8–M9. */
export const PROCUREMENT_M7_TILE_STATUSES: readonly ProcurementStatus[] = [
  'DRAFT',
  'AWAITING_NEED_APPROVAL',
  'AWAITING_PREPARATION',
  'AWAITING_OPERATIONS',
  'AWAITING_MD',
  'AWAITING_ED_FINANCE',
  'REJECTED',
  'ARCHIVED',
  'DISCARDED',
];

/** Status tiles that M8 keeps live. Delivery remains M9. */
export const PROCUREMENT_M8_TILE_STATUSES: readonly ProcurementStatus[] = [
  'DRAFT',
  'AWAITING_NEED_APPROVAL',
  'AWAITING_PREPARATION',
  'AWAITING_OPERATIONS',
  'AWAITING_MD',
  'AWAITING_ED_FINANCE',
  'FUNDING_PENDING',
  'AWAITING_PAYMENT',
  'AWAITING_DELIVERY',
  'REJECTED',
  'ARCHIVED',
  'DISCARDED',
];

/** Status tiles that M9 keeps live. */
export const PROCUREMENT_M9_TILE_STATUSES: readonly ProcurementStatus[] = [
  'DRAFT',
  'AWAITING_NEED_APPROVAL',
  'AWAITING_PREPARATION',
  'AWAITING_OPERATIONS',
  'AWAITING_MD',
  'AWAITING_ED_FINANCE',
  'FUNDING_PENDING',
  'AWAITING_PAYMENT',
  'AWAITING_DELIVERY',
  'PARTIALLY_RECEIVED',
  'COMPLETED',
  'REJECTED',
  'ARCHIVED',
  'DISCARDED',
];

/** GM / home status strip (excludes archive/discard noise). */
export const PROCUREMENT_HOME_TILE_STATUSES: readonly ProcurementStatus[] = [
  'DRAFT',
  'AWAITING_NEED_APPROVAL',
  'AWAITING_PREPARATION',
  'AWAITING_OPERATIONS',
  'AWAITING_MD',
  'AWAITING_ED_FINANCE',
  'AWAITING_PAYMENT',
  'AWAITING_DELIVERY',
  'PARTIALLY_RECEIVED',
  'COMPLETED',
  'REJECTED',
];

/** MD major-transaction threshold: ₦50,000,000.00 */
export const MAJOR_TRANSACTION_THRESHOLD_KOBO = 5_000_000_000;

export const RECEIPT_DOCUMENT_KINDS = [
  'vendor_receipt',
  'delivery_note',
  'goods_received_note',
  'vendor_invoice',
  'photograph',
  'installation_certificate',
  'completion_certificate',
  'other',
] as const;
export type ReceiptDocumentKind = (typeof RECEIPT_DOCUMENT_KINDS)[number];

export interface ProcurementLineView {
  id: string;
  lineNumber: number;
  description: string;
  categoryId: string | null;
  categoryKey: string | null;
  categoryName: string | null;
  invoiceRequired: boolean;
  stockItem: boolean;
  asset: boolean;
  quantity: number;
  unitId: string | null;
  unitCode: string | null;
  unitName: string | null;
  unitPriceKobo: number;
  lineAmountKobo: number;
  budgetLineId: string | null;
  budgetLineCode: string | null;
  budgetLineName: string | null;
  receivedQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  outstandingQuantity: number;
  secondBatchDueOn: string | null;
}

export interface GoodsReceiptView {
  id: string;
  /** The delivery this item verification belongs to; null for older single-line receipts. */
  deliveryId: string | null;
  referenceNumber: string;
  receivedDate: string;
  location: string;
  lineId: string | null;
  lineNumber: number | null;
  quantityOrdered: number;
  quantityReceived: number;
  quantityAccepted: number;
  quantityRejected: number;
  rejectReason: string | null;
  conditionNotes: string | null;
  supersedesId: string | null;
  superseded: boolean;
  documents: Array<{ documentId: string; kind: string; title: string | null }>;
  createdAt: string;
  createdByName: string | null;
}

/** One delivery from the vendor: shared details once, then a verification per item. */
export interface ProcurementDeliveryView {
  id: string;
  referenceNumber: string;
  receivedDate: string;
  location: string;
  documentKind: string;
  notes: string | null;
  documents: Array<{ documentId: string; kind: string; title: string | null }>;
  items: Array<GoodsReceiptView & { description: string | null; unitCode: string | null }>;
  createdAt: string;
  createdByName: string | null;
}

export interface DeliveryNoteView {
  id: string;
  note: string;
  nextReminderAt: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface CloseShortApprovalView {
  stageLabel: string;
  action: string;
  actorName: string;
  occurredAt: string;
  reason: string | null;
}

export interface CloseShortView {
  id: string;
  outstandingQuantity: number;
  outstandingAmountKobo: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  workflowInstanceId: string | null;
  createdAt: string;
  referenceNumber: string | null;
  approvals: CloseShortApprovalView[];
  vendorOpenClaim: {
    quantity: number;
    amountKobo: number;
    reason: string;
    recoveryId: string | null;
  } | null;
}

export interface VendorOpenClaimView {
  id: string;
  requestId: string;
  procurementReference: string | null;
  quantity: number;
  amountKobo: number;
  reason: string;
  createdAt: string;
}

/** One step of the procurement tracker, in the order the payment arrangement dictates. */
export interface ProcurementProgressStep {
  key: string;
  label: string;
  /** Role responsible for the step. */
  responsible: string;
  state: 'done' | 'current' | 'pending' | 'returned' | 'rejected';
  /** Who completed it, once done. */
  actor: string | null;
  at: string | null;
  /** The instruction shown while the step is current. */
  action: string | null;
}

export interface ProcurementDocumentAccessView {
  documentId: string;
  referenceNumber: string;
  title: string;
  category: string;
  kind: string | null;
  versions: Array<{
    versionNumber: number;
    sha256: string;
    originalFilename: string;
    uploadedAt: string;
  }>;
  access: Array<{
    actorName: string | null;
    action: string;
    occurredAt: string;
  }>;
}

export interface ProcurementReportRow {
  key: string;
  label: string;
  count: number;
  amountKobo: number;
}

export interface ProcurementReportsView {
  byStatus: ProcurementReportRow[];
  bySubsidiary: ProcurementReportRow[];
  byVendor: ProcurementReportRow[];
  byCategory: ProcurementReportRow[];
  ageing: ProcurementReportRow[];
}

export const FUNDING_ROUTES = ['subsidiary_operating', 'nfc_holding', 'corporate_allocation'] as const;
export type FundingRoute = (typeof FUNDING_ROUTES)[number];

export function isFundingRoute(value: string): value is FundingRoute {
  return (FUNDING_ROUTES as readonly string[]).includes(value);
}

/** When the vendor should be paid, separate from `funding_route`. */
export const PAYMENT_TIMINGS = ['before_delivery', 'after_delivery'] as const;
export type PaymentTiming = (typeof PAYMENT_TIMINGS)[number];

export function isPaymentTiming(value: string): value is PaymentTiming {
  return (PAYMENT_TIMINGS as readonly string[]).includes(value);
}

export const PAYMENT_TIMING_LABELS: Record<PaymentTiming, string> = {
  before_delivery: 'Pay before delivery',
  after_delivery: 'Pay after delivery',
};

export const FUNDING_ROUTE_LABELS: Record<FundingRoute, string> = {
  subsidiary_operating: 'Subsidiary operating account',
  nfc_holding: 'NFC Holding pays the vendor',
  corporate_allocation: 'Corporate allocation to the subsidiary',
};

export const FINANCIAL_CHECK_RESULTS = ['PASS', 'WARN', 'FAIL'] as const;
export type FinancialCheckResult = (typeof FINANCIAL_CHECK_RESULTS)[number];

export interface FinancialCheckView {
  key: string;
  label: string;
  result: FinancialCheckResult;
  summary: string;
  href: string | null;
}

export interface FinancialReviewView {
  id: string;
  checks: FinancialCheckView[];
  checklistAcknowledged: boolean;
  overrideReason: string | null;
  fundingRoute: FundingRoute;
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  authorizedAmountKobo: number;
  createdAt: string;
  createdByName: string | null;
}

export interface BankAccountView {
  id: string;
  entityId: string;
  entityCode: string | null;
  entityName: string | null;
  name: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  accountNumberMasked: string;
  currency: string;
  status: string;
  recordedBalanceKobo: number;
  balanceAsOf: string | null;
  glAccountId: string | null;
  rowVersion: number;
}

export interface FundingTransferView {
  id: string;
  referenceNumber: string;
  requestId: string;
  procurementReference: string | null;
  sourceEntityCode: string | null;
  destinationEntityCode: string | null;
  sourceAccountName: string | null;
  destinationAccountName: string | null;
  amountKobo: number;
  purpose: string;
  transferDate: string;
  transferMethod: string;
  bankReference: string;
  proofDocumentId: string;
  status: string;
  createdAt: string;
}

export interface ProcurementPaymentView {
  id: string;
  referenceNumber: string;
  requestId: string;
  amountKobo: number;
  method: string;
  bankReference: string;
  paymentDate: string;
  payingAccountName: string | null;
  proofDocumentId: string | null;
  status: string;
  reversedAt: string | null;
  createdAt: string;
}

export interface PaymentReversalView {
  id: string;
  paymentId: string;
  reason: string;
  status: string;
  requestedByName: string | null;
  approvedByName: string | null;
  replacementPaymentId: string | null;
  createdAt: string;
}

/** Seeded YFZ request awaiting ED Finance (M8). */
export const YFZ_PROCUREMENT_AWAITING_FINANCE_ID = '00000000-0000-4000-8000-000000000215';
/** Seeded YFW request used for the cross-subsidiary duplicate-invoice check. */
export const YFW_PROCUREMENT_DUPLICATE_INVOICE_ID = '00000000-0000-4000-8000-000000000216';

export const NFC_BANK_ACCOUNT_ID = '00000000-0000-4000-8000-000000000220';
export const YFZ_BANK_ACCOUNT_ID = '00000000-0000-4000-8000-000000000221';
export const YFW_BANK_ACCOUNT_ID = '00000000-0000-4000-8000-000000000222';
export const DMA_BANK_ACCOUNT_ID = '00000000-0000-4000-8000-000000000223';
export const NOM_BANK_ACCOUNT_ID = '00000000-0000-4000-8000-000000000224';

/** Seeded YFZ request awaiting delivery verification (M9). */
export const YFZ_PROCUREMENT_AWAITING_DELIVERY_ID = '00000000-0000-4000-8000-000000000217';
/** Seeded YFZ request partially received 800/1000 (M9). */
export const YFZ_PROCUREMENT_PARTIAL_RECEIPT_ID = '00000000-0000-4000-8000-000000000218';
/** Seeded completed YFZ request filed into the Document Portal (M15). */
export const YFZ_EDMS_COMPLETED_ID = '00000000-0000-4000-8000-000000000230';

export const PROCUREMENT_URGENCIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;
export type ProcurementUrgency = (typeof PROCUREMENT_URGENCIES)[number];

export function isProcurementUrgency(value: string): value is ProcurementUrgency {
  return (PROCUREMENT_URGENCIES as readonly string[]).includes(value);
}

export const PROCUREMENT_URGENCY_LABELS: Record<ProcurementUrgency, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

export const MEMO_TEMPLATE_VERSION = 3;

/** A priced proposal needs quotations from at least this many registered vendors. */
export const MIN_VENDOR_QUOTATIONS = 2;

/**
 * The best price among vendor quotations. Every vendor that ties on the lowest
 * total is recommended, so the Procurement Manager may award to any of them
 * without a justification.
 */
export function recommendLowestQuote(
  quotes: ReadonlyArray<{ vendorId: string | null; amountKobo: number | null }>,
): { lowestAmountKobo: number | null; recommendedVendorIds: string[] } {
  const priced = quotes.filter(
    (quote): quote is { vendorId: string; amountKobo: number } =>
      quote.vendorId !== null && quote.amountKobo !== null && quote.amountKobo > 0,
  );
  if (priced.length === 0) return { lowestAmountKobo: null, recommendedVendorIds: [] };
  const lowest = Math.min(...priced.map((quote) => quote.amountKobo));
  return {
    lowestAmountKobo: lowest,
    recommendedVendorIds: [...new Set(priced.filter((quote) => quote.amountKobo === lowest).map((quote) => quote.vendorId))],
  };
}

export const PROCUREMENT_NAV_PERMISSIONS: readonly PermissionKey[] = [
  'procurement.view',
  'procurement.create',
  'requisition.create',
  'procurement.prepare',
];

export function hasProcurementNavPermission(permissions: readonly string[]): boolean {
  return PROCUREMENT_NAV_PERMISSIONS.some((key) => permissions.includes(key));
}

export interface ProcurementMemoVendor {
  id: string;
  name: string;
  cac: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

export interface ProcurementMemoInvoice {
  documentId: string;
  documentReference: string;
  invoiceNumber: string;
  invoiceDate: string;
  amountKobo: number;
  sha256: string;
}

export interface ProcurementMemoQuotationLine {
  lineNumber: number;
  description: string;
  quantity: number;
  unitCode: string;
  unitPriceKobo: number;
  lineAmountKobo: number;
}

export interface ProcurementMemoQuotation {
  vendorId: string;
  vendorName: string;
  vendorReference: string;
  amountKobo: number;
  /** Header unit price on memos frozen before per-item quotations. */
  unitPriceKobo?: number | null;
  /** Per-item unit prices. Absent on memos frozen before per-item quotations. */
  lines?: ProcurementMemoQuotationLine[];
  recommended: boolean;
  selected: boolean;
  /** The supporting quotation document; absent on memos frozen before it was recorded. */
  documentReference?: string | null;
}

/** Frozen at submit for proposals priced from vendor quotations. */
export interface ProcurementMemoComparison {
  quotations: ProcurementMemoQuotation[];
  lowestAmountKobo: number | null;
  selectedVendorId: string | null;
  selectionJustification: string | null;
}

export interface ProcurementMemoLine {
  lineNumber: number;
  description: string;
  categoryName: string;
  quantity: number;
  unitCode: string;
  unitName: string;
  unitPriceKobo: number;
  lineAmountKobo: number;
  budgetLineCode: string;
  budgetLineName: string;
}

/** Frozen canonical JSON stored on procurement_memo_snapshots. */
export interface ProcurementMemoSnapshot {
  templateVersion: number;
  referenceNumber: string;
  title: string;
  subject: string;
  memoDate: string;
  originatorName: string;
  originatorPosition: string;
  entityCode: string;
  entityName: string;
  departmentName: string;
  categoryName: string;
  reason: string;
  description: string;
  quantity: number;
  unitCode: string;
  unitName: string;
  unitPriceKobo: number;
  totalAmountKobo: number;
  amountInWords: string;
  requiredDate: string;
  vendor: ProcurementMemoVendor;
  deliveryLocation: string;
  fundingSource: string;
  budgetLineCode: string;
  budgetLineName: string;
  budgetApprovedKobo: number;
  budgetAvailableKobo: number;
  projectCode: string | null;
  projectName: string | null;
  urgency: string;
  additionalInstructions: string | null;
  invoices: ProcurementMemoInvoice[];
  version: number;
  /** Frozen at submit. Absent on memos generated before M2. */
  proposedPaymentTiming?: PaymentTiming | null;
  /** Frozen at submit. Absent on memos generated before M3. */
  lines?: ProcurementMemoLine[];
  priceComparison?: string | null;
  recommendation?: string | null;
  requisitionReference?: string | null;
  /** Absent on memos generated before structured quotations. */
  quotationComparison?: ProcurementMemoComparison | null;
}

export const PROCUREMENT_TILE_LABELS: Record<ProcurementStatus, string> = {
  DRAFT: 'Draft',
  AWAITING_NEED_APPROVAL: 'Awaiting need approval',
  AWAITING_PREPARATION: 'Awaiting proposal',
  AWAITING_OPERATIONS: 'Awaiting Operations',
  AWAITING_MD: 'Awaiting MD',
  AWAITING_ED_FINANCE: 'Awaiting Finance',
  FUNDING_PENDING: 'Funding pending',
  AWAITING_PAYMENT: 'Awaiting payment',
  PAYMENT_PROCESSING: 'Payment processing',
  AWAITING_DELIVERY: 'Awaiting delivery',
  PARTIALLY_RECEIVED: 'Partially received',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  ARCHIVED: 'Archived',
  DISCARDED: 'Discarded',
};

export type ProcurementActionKey =
  | 'approve_need'
  | 'prepare_proposal'
  | 'correct_draft'
  | 'review_operations'
  | 'approve_md'
  | 'upload_invoice'
  | 'decide_invoice_variance'
  | 'approve_funding'
  | 'record_transfer'
  | 'pay_vendor'
  | 'verify_delivery';

/**
 * How an actor qualifies for the action beyond holding `permission`:
 * `PREPARER` is the request's preparer (or any holder when none is set),
 * `ORIGINATOR` the GM who raised it, `SAME_ENTITY` a subsidiary user of the
 * request's entity, `CORPORATE` an NFC Holding user.
 */
export type ProcurementActionScope = 'ANY' | 'PREPARER' | 'ORIGINATOR' | 'SAME_ENTITY' | 'CORPORATE';

export interface ProcurementNextAction {
  key: ProcurementActionKey;
  /** What must be done, phrased as an instruction. */
  label: string;
  /** Who is responsible, as a role title. */
  responsible: string;
  permission: PermissionKey;
  scope: ProcurementActionScope;
  /** Section id on the procurement record where the action is taken. */
  anchor: string;
}

export interface ProcurementNextActionInput {
  status: string;
  requisitionId: string | null;
  /** True when a draft came back to its author for correction. */
  returned: boolean;
  finalPaymentTiming: PaymentTiming | null;
  fundingRoute: FundingRoute | null;
  /** `ProcurementInvoiceStage` from the API contract. */
  invoiceStage: string;
  deliveryComplete: boolean;
  paymentComplete: boolean;
}

function payerAction(route: FundingRoute | null, label: string): ProcurementNextAction {
  if (route === 'nfc_holding') {
    return {
      key: 'pay_vendor',
      label,
      responsible: 'ED Finance',
      permission: 'finance.payment.execute.corporate',
      scope: 'CORPORATE',
      anchor: 'payment',
    };
  }
  return {
    key: 'pay_vendor',
    label,
    responsible: 'Finance Head',
    permission: 'finance.payment.execute',
    scope: 'SAME_ENTITY',
    anchor: 'payment',
  };
}

/**
 * The single next step on a procurement and who must take it. The tracker,
 * dashboards, workflow inbox and notifications all read this, so they agree.
 */
export function procurementNextAction(input: ProcurementNextActionInput): ProcurementNextAction | null {
  switch (input.status) {
    case 'DRAFT':
      if (input.requisitionId) {
        return {
          key: 'prepare_proposal',
          label: input.returned ? 'Correct and resubmit the proposal' : 'Prepare and submit the proposal',
          responsible: 'Procurement Manager',
          permission: 'procurement.prepare',
          scope: 'PREPARER',
          anchor: 'edit',
        };
      }
      if (!input.returned) return null;
      return {
        key: 'correct_draft',
        label: 'Correct and resubmit the request',
        responsible: 'General Manager',
        permission: 'procurement.submit',
        scope: 'ORIGINATOR',
        anchor: 'edit',
      };
    case 'AWAITING_NEED_APPROVAL':
      return {
        key: 'approve_need',
        label: 'Approve the need',
        responsible: 'Managing Director',
        permission: 'requisition.approve.need',
        scope: 'ANY',
        anchor: 'actions',
      };
    case 'AWAITING_PREPARATION':
      return {
        key: 'prepare_proposal',
        label: 'Prepare the proposal',
        responsible: 'Procurement Manager',
        permission: 'procurement.prepare',
        scope: 'PREPARER',
        anchor: 'edit',
      };
    case 'AWAITING_OPERATIONS':
      return {
        key: 'review_operations',
        label: 'Review and approve the request',
        responsible: 'ED Operations',
        permission: 'procurement.approve.operations',
        scope: 'ANY',
        anchor: 'actions',
      };
    case 'AWAITING_MD':
      return {
        key: 'approve_md',
        label: 'Approve the procurement',
        responsible: 'Managing Director',
        permission: 'procurement.approve.final',
        scope: 'ANY',
        anchor: 'actions',
      };
    case 'AWAITING_ED_FINANCE':
      if (input.invoiceStage === 'awaiting_invoice' || input.invoiceStage === 'variance_rejected') {
        return {
          key: 'upload_invoice',
          label:
            input.invoiceStage === 'variance_rejected'
              ? 'Upload a corrected vendor invoice'
              : 'Upload the vendor invoice',
          responsible: 'Procurement Manager',
          permission: 'procurement.prepare',
          scope: 'PREPARER',
          anchor: 'invoice',
        };
      }
      if (input.invoiceStage === 'variance_pending') {
        return {
          key: 'decide_invoice_variance',
          label: 'Decide the invoice amount difference',
          responsible: 'Managing Director',
          permission: 'procurement.approve.final',
          scope: 'ANY',
          anchor: 'invoice',
        };
      }
      return {
        key: 'approve_funding',
        label: 'Review the checks and approve funding',
        responsible: 'ED Finance',
        permission: 'procurement.review.finance',
        scope: 'ANY',
        anchor: 'finance',
      };
    case 'FUNDING_PENDING':
      return {
        key: 'record_transfer',
        label: 'Record the funding transfer to the subsidiary',
        responsible: 'ED Finance',
        permission: 'finance.funding.transfer.record',
        scope: 'CORPORATE',
        anchor: 'payment',
      };
    case 'AWAITING_PAYMENT':
    case 'PAYMENT_PROCESSING':
      return payerAction(
        input.fundingRoute,
        input.finalPaymentTiming === 'after_delivery' && input.deliveryComplete
          ? 'Pay the vendor for the verified delivery'
          : 'Pay the vendor',
      );
    case 'AWAITING_DELIVERY':
    case 'PARTIALLY_RECEIVED':
      if (input.deliveryComplete) {
        return input.paymentComplete ? null : payerAction(input.fundingRoute, 'Pay the vendor');
      }
      return {
        key: 'verify_delivery',
        label:
          input.status === 'PARTIALLY_RECEIVED'
            ? 'Verify the outstanding items when they arrive'
            : 'Verify the delivery of each item',
        responsible: 'Procurement Manager',
        permission: 'procurement.verify.delivery',
        scope: 'ANY',
        anchor: 'delivery',
      };
    default:
      return null;
  }
}

/** True when this person is the one who must take the procurement's next action. */
export function canTakeProcurementAction(
  action: ProcurementNextAction,
  person: {
    ref: string;
    permissions: readonly string[];
    isCorporate: boolean;
    entityIds: readonly string[];
  },
  request: { entityId: string; preparedByUserId: string | null; originatorUserId?: string | null },
): boolean {
  if (!person.permissions.includes(action.permission)) return false;
  const inEntity = person.isCorporate || person.entityIds.includes(request.entityId);
  if (!inEntity) return false;
  switch (action.scope) {
    case 'PREPARER':
      return !request.preparedByUserId || request.preparedByUserId === person.ref;
    case 'ORIGINATOR':
      return request.originatorUserId === person.ref;
    case 'SAME_ENTITY':
      return !person.isCorporate && person.entityIds.includes(request.entityId);
    case 'CORPORATE':
      return person.isCorporate;
    default:
      return true;
  }
}

/** Seeded YFZ draft used by M6 tests and the GM list. */
export const YFZ_PROCUREMENT_DRAFT_ID = '00000000-0000-4000-8000-000000000210';
/** Seeded YFZ requisition draft (need only). */
export const YFZ_REQUISITION_DRAFT_ID = '00000000-0000-4000-8000-000000000240';

/** Seeded YFZ request awaiting ED Operations (M7). */
export const YFZ_PROCUREMENT_AWAITING_OPS_ID = '00000000-0000-4000-8000-000000000211';
/** Seeded YFZ request awaiting MD (M7). */
export const YFZ_PROCUREMENT_AWAITING_MD_ID = '00000000-0000-4000-8000-000000000212';
/** Seeded YFZ request returned to the GM as version 2 (M7). */
export const YFZ_PROCUREMENT_RETURNED_ID = '00000000-0000-4000-8000-000000000213';
/** Seeded YFZ rejected request used to exercise Clone as new (M7). */
export const YFZ_PROCUREMENT_REJECTED_ID = '00000000-0000-4000-8000-000000000214';

export interface ProcurementVersionHistoryView {
  versionNumber: number;
  submittedAt: string | null;
  submittedByName: string | null;
  returnedAt: string | null;
  returnedByName: string | null;
  returnReason: string | null;
  rejectedAt: string | null;
  rejectedByName: string | null;
  rejectReason: string | null;
}

export interface ProcurementRelatedHistoryItem {
  id: string;
  referenceNumber: string;
  title: string;
  status: string;
  totalAmountKobo: number | null;
  occurredAt: string;
}

export interface ProcurementArchivedFromView {
  status: string | null;
  stageKey: string | null;
}
