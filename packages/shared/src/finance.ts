export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const NORMAL_BALANCES = ['DEBIT', 'CREDIT'] as const;
export type NormalBalance = (typeof NORMAL_BALANCES)[number];

export const FISCAL_STATUSES = ['OPEN', 'CLOSED', 'LOCKED'] as const;
export type FiscalStatus = (typeof FISCAL_STATUSES)[number];

export const JOURNAL_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'POSTED', 'REVERSED'] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export const JOURNAL_SOURCES = [
  'MANUAL',
  'BANK_TRANSFER',
  'RECONCILIATION',
  'REVERSAL',
  'PROCUREMENT_PAYMENT',
  'PROCUREMENT_RECLASS',
  'PROCUREMENT_RECOVERY',
  'FUNDING_TRANSFER',
  'INTERCOMPANY',
  'INCOME',
  'EXPENSE',
  'PAYABLE',
  'RECEIVABLE',
  'RECEIPT',
  'INVENTORY_RECEIPT',
  'INVENTORY_ISSUE',
  'INVENTORY_WRITE_OFF',
  'INVENTORY_ADJUSTMENT',
  'INVENTORY_TRANSFER',
  'PRODUCTION_WIP',
  'PRODUCTION_OUTPUT',
  'PRODUCTION_WASTE',
  'PRODUCTION_OVERHEAD',
  'SALES_REVENUE',
  'SALES_COGS',
  'SALES_RETURN',
  'PAYROLL',
] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

export const INCOME_SETTLEMENTS = ['INVOICE', 'CASH'] as const;
export type IncomeSettlement = (typeof INCOME_SETTLEMENTS)[number];

export const EXPENSE_SETTLEMENTS = ['ON_ACCOUNT', 'CASH'] as const;
export type ExpenseSettlement = (typeof EXPENSE_SETTLEMENTS)[number];

export const PAYABLE_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'UNPAID', 'PART_PAID', 'PAID', 'REJECTED'] as const;
export type PayableStatus = (typeof PAYABLE_STATUSES)[number];

export const RECEIVABLE_STATUSES = ['OPEN', 'PART_PAID', 'PAID'] as const;
export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number];

export const INTERCOMPANY_TYPES = ['funding_allocation', 'loan', 'recharge', 'transfer'] as const;
export type IntercompanyType = (typeof INTERCOMPANY_TYPES)[number];

export const INTERCOMPANY_STATUSES = ['RECORDED', 'ACKNOWLEDGED', 'MISMATCHED'] as const;
export type IntercompanyStatus = (typeof INTERCOMPANY_STATUSES)[number];

export const AGING_BUCKETS = ['current', '1_30', '31_60', '61_90', '90_plus'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const BUDGET_COMMITMENT_ACTIONS = [
  'COMMIT',
  'APPROVE_FINANCE',
  'PAY',
  'ACTUAL',
  'RELEASE',
  'REVERSE_PAY',
  'REVERSE_ACTUAL',
] as const;
export type BudgetCommitmentAction = (typeof BUDGET_COMMITMENT_ACTIONS)[number];

export const BUDGET_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export const YFZ_POSTED_JOURNAL_ID = '00000000-0000-4000-8000-000000000301';
export const YFZ_PENDING_JOURNAL_ID = '00000000-0000-4000-8000-000000000302';
export const YFZ_BUDGET_2026_ID = '00000000-0000-4000-8000-000000000311';
export const YFZ_BANK_STATEMENT_ID = '00000000-0000-4000-8000-000000000321';
export const YFZ_CUSTOMER_ID = '00000000-0000-4000-8000-000000000331';
export const YFZ_AR_CURRENT_ID = '00000000-0000-4000-8000-000000000332';
export const YFZ_AR_30_ID = '00000000-0000-4000-8000-000000000333';
export const YFZ_AR_60_ID = '00000000-0000-4000-8000-000000000334';
export const YFZ_AR_90_ID = '00000000-0000-4000-8000-000000000335';
export const YFZ_AR_90PLUS_ID = '00000000-0000-4000-8000-000000000336';
export const YFZ_OVERDUE_BILL_ID = '00000000-0000-4000-8000-000000000337';
export const NFC_YFZ_ICT_ID = '00000000-0000-4000-8000-000000000338';
export const NFC_YFZ_MISMATCH_ICT_ID = '00000000-0000-4000-8000-000000000339';
export const ED_FINANCE_IS_SET_ID = '00000000-0000-4000-8000-000000000341';

export const REPORT_KINDS = [
  'income_statement',
  'balance_sheet',
  'cash_flow',
  'trial_balance',
  'general_ledger',
  'budget_vs_actual',
  'expense_analysis',
  'revenue_analysis',
  'payables',
  'receivables_aging',
  'procurement_expenditure',
  'subsidiary_comparison',
  'consolidated_statements',
  'intercompany',
  'payroll_summary',
  'integrity',
  'eliminations',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_FORMATS = ['SCREEN', 'CSV', 'XLSX', 'PDF'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export interface ReportDrill {
  accountCodes: string[];
  entityId?: string;
  periodId?: string | null;
  extra?: Record<string, string>;
}

export interface ReportCellView {
  currentKobo: number;
  compareKobo?: number;
  varianceKobo?: number;
  drill?: ReportDrill;
}

export interface ReportRowView {
  key: string;
  label: string;
  section?: string;
  indent?: number;
  bold?: boolean;
  cells: ReportCellView;
}

export interface ReportView {
  kind: ReportKind;
  title: string;
  scope: 'entity' | 'consolidated';
  entityId: string | null;
  entityLabel: string;
  periodLabel: string;
  comparePeriodLabel?: string;
  runReference: string;
  columns: string[];
  rows: ReportRowView[];
  notes?: string[];
  emptyState?: { title: string; description: string };
}

export interface ReportCatalogItem {
  kind: ReportKind;
  title: string;
  description: string;
  consolidatedOnly?: boolean;
  placeholder?: boolean;
}

export interface ReportParameterSetView {
  id: string;
  name: string;
  reportKind: ReportKind;
  params: Record<string, unknown>;
  status: 'ACTIVE' | 'INACTIVE';
  rowVersion: number;
}

export interface LedgerDrillEntryView extends LedgerEntryView {
  accountCode: string;
  accountName: string;
  entityId: string;
  entityCode: string | null;
  sourceHref: string | null;
  sourceLabel: string | null;
}

export interface EliminationRowView {
  id: string;
  referenceNumber: string;
  type: IntercompanyType;
  sourceEntityCode: string | null;
  destinationEntityCode: string | null;
  amountKobo: number;
  occurredOn: string;
  sourceJournalId: string | null;
  destinationJournalId: string | null;
  eliminated: boolean;
  skipReason: string | null;
}

export interface EliminationReportView {
  rows: EliminationRowView[];
  eliminatedTotalKobo: number;
  skippedTotalKobo: number;
}

export interface IntegrityCheckView {
  key: string;
  label: string;
  status: 'OK' | 'FAIL' | 'INFO' | 'UNAVAILABLE';
  detail: string;
  differenceKobo?: number;
}

export interface IntegrityReportView {
  scope: 'entity' | 'consolidated';
  entityId: string | null;
  checks: IntegrityCheckView[];
  discrepancyCount: number;
}

export interface FinanceContextView {
  canConsolidate: boolean;
  entities: Array<{ id: string; code: string; name: string; type: string }>;
}

export interface FiscalYearView {
  id: string;
  entityId: string;
  entityCode: string | null;
  year: number;
  startsOn: string;
  endsOn: string;
  status: FiscalStatus;
  rowVersion: number;
  periods: FiscalPeriodView[];
}

export interface FiscalPeriodView {
  id: string;
  fiscalYearId: string;
  periodIndex: number;
  name: string;
  startsOn: string;
  endsOn: string;
  status: FiscalStatus;
  rowVersion: number;
}

export interface AccountView {
  id: string;
  entityId: string;
  entityCode: string | null;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  normalBalance: NormalBalance;
  active: boolean;
  consolidationCode: string;
  intercompany: boolean;
  rowVersion: number;
}

export interface JournalLineInput {
  accountId: string;
  debitKobo: number;
  creditKobo: number;
  narration?: string;
  departmentId?: string | null;
  projectId?: string | null;
  procurementRequestId?: string | null;
  vendorId?: string | null;
  customerId?: string | null;
  intercompanyTransactionId?: string | null;
  payableInvoiceId?: string | null;
  receivableInvoiceId?: string | null;
}

export interface JournalLineView {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debitKobo: number;
  creditKobo: number;
  narration: string | null;
  departmentId: string | null;
  projectId: string | null;
  procurementRequestId: string | null;
  vendorId: string | null;
  customerId: string | null;
  intercompanyTransactionId: string | null;
  payableInvoiceId: string | null;
  receivableInvoiceId: string | null;
}

export interface JournalView {
  id: string;
  referenceNumber: string;
  entityId: string;
  entityCode: string | null;
  fiscalPeriodId: string;
  periodName: string;
  status: JournalStatus;
  source: JournalSource;
  narration: string;
  reversesJournalId: string | null;
  reversedByJournalId: string | null;
  workflowInstanceId: string | null;
  preparedByName: string | null;
  postedAt: string | null;
  rowVersion: number;
  debitTotalKobo: number;
  creditTotalKobo: number;
  lines: JournalLineView[];
  sourceHref?: string | null;
  sourceLabel?: string | null;
}

export interface TrialBalanceRowView {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  entityId: string;
  entityCode: string | null;
  debitKobo: number;
  creditKobo: number;
}

export interface TrialBalanceView {
  scope: 'entity' | 'consolidated';
  periodId: string | null;
  rows: TrialBalanceRowView[];
  debitTotalKobo: number;
  creditTotalKobo: number;
  eliminationTotalKobo?: number;
}

export interface LedgerEntryView {
  journalId: string;
  journalLineId: string;
  journalReference: string;
  occurredOn: string;
  narration: string;
  debitKobo: number;
  creditKobo: number;
  sourceHref?: string | null;
  sourceLabel?: string | null;
}

export interface FinanceQueuesView {
  pendingJournals: number;
  pendingBudgets: number;
  unreconciledLines: number;
}

export interface BankTransactionView {
  id: string;
  accountId: string;
  entityId: string;
  kind: string;
  amountKobo: number;
  occurredOn: string;
  narration: string;
  journalId: string | null;
  transferId: string | null;
}

export interface BankStatementLineView {
  id: string;
  statementId: string;
  occurredOn: string;
  description: string;
  amountKobo: number;
  matched: boolean;
}

export interface BankStatementView {
  id: string;
  accountId: string;
  reference: string;
  importedAt: string;
  lines: BankStatementLineView[];
}

export interface ReconciliationReportView {
  accountId: string;
  periodId: string | null;
  matchedCount: number;
  unmatchedStatementCount: number;
  unmatchedLedgerCount: number;
  matched: Array<{ statementLineId: string; bankTransactionId: string | null; journalLineId: string | null }>;
  unmatchedStatement: BankStatementLineView[];
  unmatchedLedger: LedgerEntryView[];
}

export interface BudgetLineBalanceView {
  id: string;
  code: string;
  name: string;
  departmentId: string | null;
  approvedKobo: number;
  committedKobo: number;
  approvedPendingKobo: number;
  paidKobo: number;
  actualKobo: number;
  availableKobo: number;
  varianceKobo: number;
}

export interface BudgetView {
  id: string;
  referenceNumber: string;
  entityId: string;
  entityCode: string | null;
  fiscalYearId: string;
  year: number;
  versionNumber: number;
  status: BudgetStatus;
  workflowInstanceId: string | null;
  preparedByName: string | null;
  rowVersion: number;
  lines: BudgetLineBalanceView[];
}

export interface CustomerView {
  id: string;
  referenceNumber: string;
  entityId: string;
  entityCode: string | null;
  name: string;
  contacts: unknown;
  termsDays: number;
  creditLimitKobo: number;
  status: 'ACTIVE' | 'INACTIVE';
  outstandingKobo: number;
  rowVersion: number;
}

export interface ReceivableInvoiceView {
  id: string;
  referenceNumber: string;
  entityId: string;
  entityCode: string | null;
  customerId: string | null;
  customerName: string | null;
  vendorId: string | null;
  recoveryId: string | null;
  incomeEntryId: string | null;
  invoiceDate: string;
  dueDate: string;
  amountKobo: number;
  allocatedKobo: number;
  outstandingKobo: number;
  status: ReceivableStatus;
  overdue: boolean;
  agingBucket: AgingBucket;
  journalId: string | null;
  rowVersion: number;
}

export interface CustomerStatementView {
  customer: CustomerView;
  invoices: ReceivableInvoiceView[];
  receipts: ReceiptView[];
  balanceKobo: number;
}

export interface ReceivableAgingView {
  entityId: string | null;
  buckets: Record<AgingBucket, number>;
  invoices: ReceivableInvoiceView[];
}

export interface ReceiptView {
  id: string;
  referenceNumber: string;
  entityId: string;
  customerId: string | null;
  customerName: string | null;
  receivedOn: string;
  amountKobo: number;
  journalId: string | null;
  allocations: Array<{ invoiceId: string; invoiceReference: string; amountKobo: number }>;
}

export interface IncomeEntryView {
  id: string;
  referenceNumber: string;
  entityId: string;
  entityCode: string | null;
  categoryKey: string;
  categoryName: string;
  settlement: IncomeSettlement;
  customerId: string | null;
  customerName: string | null;
  amountKobo: number;
  occurredOn: string;
  narration: string;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'POSTED' | 'REJECTED';
  documentId: string | null;
  journalId: string | null;
  receivableInvoiceId: string | null;
  workflowInstanceId: string | null;
  preparedByName: string | null;
  rowVersion: number;
}

export interface ExpenseEntryView {
  id: string;
  referenceNumber: string;
  entityId: string;
  entityCode: string | null;
  categoryKey: string;
  categoryName: string;
  settlement: ExpenseSettlement;
  vendorId: string | null;
  vendorName: string | null;
  amountKobo: number;
  occurredOn: string;
  dueDate: string | null;
  narration: string;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'POSTED' | 'REJECTED';
  documentId: string | null;
  journalId: string | null;
  payableInvoiceId: string | null;
  workflowInstanceId: string | null;
  preparedByName: string | null;
  rowVersion: number;
}

export interface PayableInvoiceView {
  id: string;
  referenceNumber: string;
  entityId: string;
  entityCode: string | null;
  vendorId: string | null;
  vendorName: string | null;
  source: 'BILL' | 'PROCUREMENT' | 'EXPENSE';
  procurementRequestId: string | null;
  expenseEntryId: string | null;
  invoiceDate: string;
  dueDate: string;
  amountKobo: number;
  paidKobo: number;
  outstandingKobo: number;
  status: PayableStatus;
  overdue: boolean;
  journalId: string | null;
  rowVersion: number;
}

export interface IntercompanyTransactionView {
  id: string;
  referenceNumber: string;
  type: IntercompanyType;
  sourceEntityId: string;
  sourceEntityCode: string | null;
  destinationEntityId: string;
  destinationEntityCode: string | null;
  amountKobo: number;
  occurredOn: string;
  narration: string;
  fundingTransferId: string | null;
  sourceJournalId: string | null;
  destinationJournalId: string | null;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  mismatched: boolean;
  rowVersion: number;
}

export interface FinanceDashboardTilesView {
  scope: 'entity' | 'consolidated';
  entityId: string | null;
  entityCode: string | null;
  totalBudgetKobo: number;
  availableBudgetKobo: number;
  budgetUtilizationKobo: number;
  cashPositionKobo: number;
  totalRevenueKobo: number;
  totalExpenditureKobo: number;
  outstandingPayablesKobo: number;
  outstandingReceivablesKobo: number;
  intercompanyTransfersKobo: number;
  procurementCommitmentsKobo: number;
  profitLossKobo: number;
  payrollCostKobo: number;
}

export interface FinanceDashboardView {
  consolidated: FinanceDashboardTilesView | null;
  entities: FinanceDashboardTilesView[];
}

export type BudgetActivityMetric = 'approved' | 'committed' | 'paid' | 'available';

export interface BudgetActivityRowView {
  date: string;
  reference: string;
  description: string;
  entityCode: string | null;
  budgetLineCode: string | null;
  amountKobo: number;
  href: string;
}

export interface BudgetActivityView {
  metric: BudgetActivityMetric;
  title: string;
  definition: string;
  totalKobo: number;
  rows: BudgetActivityRowView[];
}

export const FINANCE_NAV_PERMISSIONS = [
  'finance.view',
  'finance.budget.view',
  'finance.journal.prepare',
  'finance.journal.approve',
  'finance.dashboard.entity',
  'finance.dashboard.consolidated',
] as const;

export function hasFinanceNavPermission(permissions: readonly string[]): boolean {
  return FINANCE_NAV_PERMISSIONS.some((key) => permissions.includes(key));
}
