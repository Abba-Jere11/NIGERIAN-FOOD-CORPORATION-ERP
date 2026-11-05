import type { AuditAction } from './audit';
import type { EntityType, RecordStatus, RoleKey, ScopeType, UserStatus } from './org';
import type { PermissionKey } from './permissions';
import type {
  CloseShortView,
  DeliveryNoteView,
  FinancialReviewView,
  FundingRoute,
  FundingTransferView,
  GoodsReceiptView,
  PaymentReversalView,
  ProcurementLineView,
  PaymentTiming,
  ProcurementArchivedFromView,
  ProcurementDeliveryView,
  ProcurementDocumentAccessView,
  ProcurementNextAction,
  ProcurementPaymentView,
  ProcurementProgressStep,
  ProcurementRelatedHistoryItem,
  ProcurementVersionHistoryView,
} from './procurement';
import type { SealView } from './seals';

/**
 * The HTTP contract between the API and the web application.
 *
 * Both sides import these, so a change to a response shape is a compile error
 * in the consumer rather than a runtime surprise.
 */

export interface EntityView {
  id: string;
  organizationId: string;
  parentEntityId: string | null;
  code: string;
  name: string;
  legalName: string;
  type: EntityType;
  status: RecordStatus;
  rowVersion: number;
  departmentCount: number;
  activeDepartmentCount: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface DepartmentView {
  id: string;
  entityId: string;
  entityCode: string;
  name: string;
  code: string | null;
  description: string | null;
  status: RecordStatus;
  rowVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface AuditEntryView {
  id: string;
  occurredAt: string;
  actorRef: string | null;
  actorName: string | null;
  actorRole: RoleKey | null;
  actorScopeType: ScopeType | null;
  action: AuditAction;
  subjectType: string;
  subjectId: string | null;
  subjectLabel: string | null;
  subjectReferenceNumber: string | null;
  entityId: string | null;
  entityCode: string | null;
  entityName: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  sessionId: string | null;
  requestId: string | null;
}

export interface AuditFiltersView {
  actions: Array<{ value: AuditAction; label: string }>;
  subjectTypes: string[];
}

export interface MeView {
  ref: string;
  name: string;
  email: string;
  position: string;
  role: RoleKey | null;
  roleName: string | null;
  roleShortName: string | null;
  scopeType: ScopeType | null;
  isCorporate: boolean;
  isAdmin: boolean;
  homePath: string;
  mustChangePassword: boolean;
  mfaRequired: boolean;
  mfaEnrolled: boolean;
  permissions: readonly PermissionKey[];
  entities: Array<{ id: string; code: string; name: string; type: EntityType }>;
}

export interface SessionView {
  id: string;
  deviceLabel: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  current: boolean;
}

export interface UserSummaryView {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: UserStatus;
  position: string;
  primaryEntityId: string;
  primaryEntityCode: string;
  departmentId: string | null;
  departmentName: string | null;
  photographUrl: string | null;
  mustChangePassword: boolean;
  /** Administrator toggled MFA for this account (Administrator role is always effective). */
  mfaRequired: boolean;
  mfaEffectiveRequired: boolean;
  mfaEnrolled: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  rowVersion: number;
  roles: Array<{
    assignmentId: string;
    role: RoleKey;
    roleName: string;
    scopeType: ScopeType;
    entityId: string | null;
    entityCode: string | null;
  }>;
}

export interface PermissionChangeView {
  id: string;
  occurredAt: string;
  actorName: string | null;
  actorRole: RoleKey | null;
  action: AuditAction;
  subjectType: string;
  subjectId: string | null;
  subjectLabel: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  reason: string | null;
}

export interface LoginResultView {
  mfaRequired: boolean;
  mustChangePassword: boolean;
  mfaEnrolRequired: boolean;
  homePath: string | null;
}

export interface CsrfView {
  csrfToken: string;
}

export interface HealthView {
  status: 'ok' | 'degraded';
  environment: string;
  checks: {
    database: 'up' | 'down';
    databaseError?: string;
    databaseLatencyMs: number;
  };
  time: string;
}

export interface EngineRecordView {
  id: string;
  entityId: string;
  kind: string;
  referenceNumber: string;
  title: string;
  status: RecordStatus;
  rowVersion: number;
  createdAt: string;
}

export interface ReferenceCounterView {
  kind: string;
  year: number;
  lastValue: number;
  updatedAt: string;
}

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string;
  referenceNumber: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreferenceView {
  category: string;
  emailEnabled: boolean;
  mandatory: boolean;
}

export interface SearchHitView {
  recordType: string;
  recordId: string;
  referenceNumber: string | null;
  title: string;
  entityId: string;
  href: string | null;
}

export interface SearchResultsView {
  query: string;
  groups: Array<{ type: string; hits: SearchHitView[] }>;
}

export interface TimelineEventView {
  id: string;
  occurredAt: string;
  actor: string;
  text: string;
  href: string | null;
}

export interface OverdueWorkflowView {
  id: string;
  subjectType: string;
  subjectId: string;
  referenceNumber: string;
  title: string;
  holderName: string;
  holderUserId: string;
  daysPending: number;
  entityId: string;
  entityCode: string;
  entityName: string;
  pendingSince: string;
}

export interface DeadLetterView {
  deliveryId: string;
  eventType: string;
  handlerKey: string;
  lastError: string | null;
  attempts: number;
  processedAt: string | null;
}

export interface AdminOpsView {
  deadLetters: DeadLetterView[];
  failedNotificationDeliveries: number;
  failedMail: number;
  unreadNotifications: number;
}

export interface DocumentVersionView {
  id: string;
  versionNumber: number;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  originalFilename: string;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: string;
  replacementReason: string | null;
}

export interface DocumentView {
  id: string;
  referenceNumber: string;
  ownerType: string;
  ownerId: string | null;
  entityId: string;
  entityCode: string | null;
  category: string;
  title: string;
  status: string;
  currentVersion: DocumentVersionView;
  versions: DocumentVersionView[];
  rowVersion: number;
}

export interface DocumentListItemView {
  id: string;
  referenceNumber: string;
  title: string;
  category: string;
  status: string;
  mimeType: string;
  originalFilename: string;
  currentVersionNumber: number;
  uploadedAt: string;
  entityId: string;
}

export interface DownloadUrlView {
  url: string;
  expiresAt: string;
}

export interface WorkflowTrackerStageView {
  key: string;
  label: string;
  state: 'done' | 'current' | 'pending' | 'returned' | 'rejected';
  actor: string | null;
  at: string | null;
}

export interface WorkflowActionView {
  id: string;
  stageKey: string;
  action: string;
  actorId: string;
  actorName: string;
  reason: string | null;
  previousStatus: string;
  newStatus: string;
  subjectVersion: number;
  snapshotHash: string;
  occurredAt: string;
}

export interface WorkflowInstanceView {
  id: string;
  definitionKey: string;
  subjectType: string;
  subjectId: string;
  subjectVersion: number;
  referenceNumber: string;
  title: string;
  entityId: string;
  entityCode: string | null;
  originatorUserId: string;
  originatorName: string;
  currentStageKey: string | null;
  status: string;
  archivedFromStageKey: string | null;
  moneyMoved: boolean;
  rowVersion: number;
  allowedActions: string[];
  tracker: WorkflowTrackerStageView[];
  history: WorkflowActionView[];
  seals: SealView[];
}

export interface WorkflowPendingView {
  id: string;
  referenceNumber: string;
  title: string;
  status: string;
  currentStageKey: string | null;
  currentStageLabel: string | null;
  entityId: string;
  entityCode: string | null;
  waitingSince: string;
  subjectType: string;
  subjectId: string;
  href: string;
  urgency: string | null;
  amountKobo: number | null;
  daysPending: number;
}

export interface VendorBankDetailsView {
  bankName: string;
  accountName: string;
  accountNumber: string;
}

export interface VendorContactView {
  name: string;
  phone: string | null;
  email: string | null;
  role: string | null;
}

export interface VendorComplianceItemView {
  id: string;
  complianceType: string;
  required: boolean;
  documentId: string;
  documentReference: string | null;
  title: string;
  expiresAt: string | null;
  expired: boolean;
}

export interface VendorListItemView {
  id: string;
  referenceNumber: string;
  legalName: string;
  cacRegistrationNumber: string;
  categoryKey: string;
  categoryLabel: string;
  status: string;
  complianceExpired: boolean;
  createdAt: string;
}

export interface VendorView {
  id: string;
  referenceNumber: string;
  legalName: string;
  cacRegistrationNumber: string;
  categoryId: string;
  categoryKey: string;
  categoryLabel: string;
  status: string;
  notes: string | null;
  contacts: VendorContactView[];
  bank: VendorBankDetailsView | null;
  complianceExpired: boolean;
  compliance: VendorComplianceItemView[];
  activatedAt: string | null;
  activatedBy: string | null;
  createdBy: string;
  createdAt: string;
  rowVersion: number;
  entityId: string;
  warnings: string[];
}

export interface VendorHistoryView {
  procurement: Array<{
    referenceNumber: string;
    title: string;
    status: string;
    entityCode: string | null;
    occurredAt: string;
  }>;
  payments: Array<{
    referenceNumber: string;
    amountKobo: number;
    entityCode: string | null;
    paidAt: string;
  }>;
  subsidiaries: string[];
  firstUsedAt: string | null;
  lastUsedAt: string | null;
  totalSpendKobo: number;
  blockedAttempts: Array<{
    id: string;
    reason: string;
    context: string;
    occurredAt: string;
    actorRef: string;
  }>;
  openClaims: Array<{
    procurementReference: string | null;
    quantity: number;
    amountKobo: number;
    reason: string;
    createdAt: string;
  }>;
}

export interface VendorCategoryView {
  id: string;
  key: string;
  label: string;
}

export interface VendorValidateView {
  vendorId: string;
  selectable: boolean;
  status: string;
  reason: string | null;
}

export interface ProcurementCategoryView {
  id: string;
  key: string;
  name: string;
  invoiceRequired: boolean;
  stockItem: boolean;
  asset: boolean;
  operationsMachinery: boolean;
}

export interface UnitOfMeasureView {
  id: string;
  code: string;
  name: string;
}

export interface FundingSourceView {
  id: string;
  key: string;
  label: string;
}

export interface ProjectView {
  id: string;
  entityId: string;
  code: string;
  name: string;
  status: string;
  rowVersion: number;
}

export interface BudgetLineView {
  id: string;
  entityId: string;
  fiscalYear: number;
  code: string;
  name: string;
  approvedAmountKobo: number;
  availableAmountKobo: number;
  status: string;
  rowVersion: number;
}

export interface ProcurementInvoiceView {
  id: string;
  documentId: string;
  documentReference: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  amountKobo: number;
  vendorId: string | null;
  vendorName: string | null;
}

/**
 * Where the vendor invoice stands. Requisition proposals take their invoice at
 * ED Finance: `awaiting_invoice` until it is uploaded, `variance_pending` or
 * `variance_rejected` while an amount that differs from the approved total
 * waits for or was refused by the MD, and `ready` once ED Finance may continue.
 */
export type ProcurementInvoiceStage =
  | 'not_requested'
  | 'awaiting_invoice'
  | 'variance_pending'
  | 'variance_rejected'
  | 'ready';

export interface ProcurementInvoiceVarianceView {
  id: string;
  approvedAmountKobo: number;
  invoiceAmountKobo: number;
  /** Invoice minus approved; positive when the invoice is higher. */
  differenceKobo: number;
  invoiceNumber: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  reason: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface ProcurementCommentView {
  id: string;
  body: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
}

export interface ProcurementListItemView {
  id: string;
  referenceNumber: string;
  title: string;
  status: string;
  entityId: string;
  entityCode: string | null;
  vendorName: string | null;
  totalAmountKobo: number | null;
  originatorUserId: string;
  originatorName: string | null;
  updatedAt: string;
  currentVersion: number;
  lastReturnReason: string | null;
  createdAt: string;
  outstandingQuantity: number;
  secondBatchDueOn: string | null;
  shortageOverdue: boolean;
  requisitionId: string | null;
  preparedByUserId: string | null;
  invoiceStage: ProcurementInvoiceStage;
  finalPaymentTiming: PaymentTiming | null;
  fundingRoute: FundingRoute | null;
  nextAction: ProcurementNextAction | null;
}

/** A procurement step waiting for the signed-in user. */
export interface ProcurementMyActionView {
  requestId: string;
  referenceNumber: string;
  title: string;
  entityCode: string | null;
  vendorName: string | null;
  totalAmountKobo: number | null;
  actionKey: string;
  actionLabel: string;
  detail: string;
  href: string;
  since: string;
}

export interface FinanceOverrideView {
  id: string;
  requestId: string;
  referenceNumber: string;
  entityCode: string | null;
  overrideReason: string;
  failedChecks: string[];
  approvedAt: string;
  href: string;
}

export interface RecentProcurementPaymentView {
  id: string;
  requestId: string;
  referenceNumber: string;
  procurementReference: string;
  vendorName: string | null;
  entityCode: string | null;
  amountKobo: number;
  paidAt: string;
  href: string;
}

export interface ProcurementListView {
  items: ProcurementListItemView[];
  counts: Record<string, number>;
}

/** One memo item as priced by a single vendor. */
export interface ProcurementQuotationLineView {
  lineNumber: number;
  description: string;
  quantity: number;
  unitCode: string | null;
  unitPriceKobo: number;
  lineAmountKobo: number;
}

export interface ProcurementQuotationView {
  id: string;
  documentId: string;
  title: string | null;
  referenceNumber: string | null;
  vendorId: string | null;
  vendorName: string | null;
  vendorReference: string | null;
  /**
   * Header unit price (kobo) on quotations recorded before per-item prices.
   * New quotations leave this null and use `lines`.
   */
  unitPriceKobo: number | null;
  /** Quoted total (kobo): sum of each item's quantity × unit price. */
  amountKobo: number | null;
  /** Unit price for every memo line. Empty on older single-price quotations. */
  lines: ProcurementQuotationLineView[];
  notes: string | null;
  /** True for every quotation that ties on the lowest total. */
  isLowest: boolean;
}

export interface ProcurementQuotationComparisonView {
  minimumQuotations: number;
  /** Quotations that name a vendor and a price. */
  pricedCount: number;
  lowestAmountKobo: number | null;
  recommendedVendorIds: string[];
  selectedVendorId: string | null;
  /** True when the selected vendor offers the lowest price. */
  selectionIsRecommended: boolean;
  selectionJustification: string | null;
}

export interface ProcurementView {
  id: string;
  referenceNumber: string;
  requisitionId: string | null;
  requisitionReference: string | null;
  requisitionStatus: string | null;
  preparedByUserId: string | null;
  preparedByName: string | null;
  operationsMachinery: boolean;
  /** Legacy free-text fields from proposals priced before structured quotations. */
  priceComparison: string | null;
  recommendation: string | null;
  /** Sorted by quoted amount, lowest first; legacy file-only quotations last. */
  quotations: ProcurementQuotationView[];
  quotationComparison: ProcurementQuotationComparisonView;
  entityId: string;
  entityCode: string | null;
  entityName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  originatorUserId: string;
  originatorName: string | null;
  originatorPosition: string | null;
  vendorId: string | null;
  vendorName: string | null;
  vendorCac: string | null;
  vendorContactName: string | null;
  vendorContactPhone: string | null;
  vendorContactEmail: string | null;
  currentVersion: number;
  status: string;
  title: string;
  subject: string | null;
  categoryId: string | null;
  categoryKey: string | null;
  categoryName: string | null;
  invoiceRequired: boolean;
  reason: string | null;
  description: string | null;
  quantity: number | null;
  unitId: string | null;
  unitCode: string | null;
  unitName: string | null;
  unitPriceKobo: number | null;
  totalAmountKobo: number | null;
  requiredDate: string | null;
  deliveryLocation: string | null;
  fundingSourceId: string | null;
  fundingSourceKey: string | null;
  fundingSourceLabel: string | null;
  budgetLineId: string | null;
  budgetLineCode: string | null;
  budgetLineName: string | null;
  budgetAvailableKobo: number | null;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  urgency: string;
  additionalInstructions: string | null;
  versionId: string;
  rowVersion: number;
  createdAt: string;
  invoice: ProcurementInvoiceView | null;
  invoiceStage: ProcurementInvoiceStage;
  invoiceVariance: ProcurementInvoiceVarianceView | null;
  invoiceAmountMismatch: boolean;
  duplicateInvoiceNumber: boolean;
  memoSnapshotHash: string | null;
  pdfDocumentId: string | null;
  workflowInstanceId: string | null;
  comments: ProcurementCommentView[];
  warnings: string[];
  versions: ProcurementVersionHistoryView[];
  lastReturnReason: string | null;
  lastReturnAt: string | null;
  lastReturnedByName: string | null;
  clonedFromId: string | null;
  clonedFromReference: string | null;
  archivedFrom: ProcurementArchivedFromView | null;
  relatedHistory: ProcurementRelatedHistoryItem[];
  vendorSpendToDateKobo: number;
  proposedPaymentTiming: PaymentTiming | null;
  finalPaymentTiming: PaymentTiming | null;
  finalPaymentTimingSetAt: string | null;
  finalPaymentTimingSetBy: string | null;
  timingChangePendingAck: boolean;
  fundingRoute: FundingRoute | null;
  authorizedAmountKobo: number | null;
  payingAccountId: string | null;
  destinationAccountId: string | null;
  vendorStatus: string | null;
  vendorBankName: string | null;
  vendorAccountName: string | null;
  vendorAccountNumber: string | null;
  financialReview: FinancialReviewView | null;
  transfers: FundingTransferView[];
  payments: ProcurementPaymentView[];
  reversals: PaymentReversalView[];
  moneyMoved: boolean;
  paidAmountKobo: number;
  payableAmountKobo: number;
  deliveryComplete: boolean;
  paymentComplete: boolean;
  receipts: GoodsReceiptView[];
  deliveries: ProcurementDeliveryView[];
  deliveryNotes: DeliveryNoteView[];
  closeShort: CloseShortView | null;
  lines: ProcurementLineView[];
  acceptedQuantityTotal: number;
  outstandingQuantity: number;
  requiredDeliveryDocumentSet: string[];
  nextAction: ProcurementNextAction | null;
  progress: ProcurementProgressStep[];
  documents: ProcurementDocumentAccessView[];
}

export interface HomePendingLineView {
  key: string;
  label: string;
  count: number;
  href: string;
}

export interface HomeSubsidiaryView {
  id: string;
  code: string;
  name: string;
  financeHref: string;
  inventoryHref: string;
  procurementHref: string;
}

export interface HomeAdminOpsView {
  deadLetterCount: number;
  failedNotificationDeliveries: number;
  failedMail: number;
}

export interface HomeSummaryView {
  roleDashboardPath: string;
  pendingTotal: number;
  pendingLines: HomePendingLineView[];
  subsidiaries: HomeSubsidiaryView[];
  adminOps: HomeAdminOpsView | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    fieldErrors?: Record<string, string[]>;
    requestId: string | null;
  };
}
