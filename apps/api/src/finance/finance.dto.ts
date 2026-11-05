import { z } from 'zod';

export const entityScopeQuery = z.object({
  entityId: z.string().uuid().optional(),
  consolidated: z.coerce.boolean().optional(),
  periodId: z.string().uuid().optional(),
});
export type EntityScopeQuery = z.infer<typeof entityScopeQuery>;

export const createFiscalYearSchema = z.object({
  entityId: z.string().uuid(),
  year: z.number().int().min(2000),
  startsOn: z.string().min(8),
  endsOn: z.string().min(8),
});
export type CreateFiscalYearInput = z.infer<typeof createFiscalYearSchema>;

export const closePeriodSchema = z.object({
  rowVersion: z.number().int().positive(),
});
export type ClosePeriodInput = z.infer<typeof closePeriodSchema>;

export const upsertAccountSchema = z.object({
  entityId: z.string().uuid(),
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(200),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']),
  parentId: z.string().uuid().nullable().optional(),
  normalBalance: z.enum(['DEBIT', 'CREDIT']),
  consolidationCode: z.string().min(1).max(32),
  intercompany: z.boolean().optional(),
  active: z.boolean().optional(),
  rowVersion: z.number().int().positive().optional(),
});
export type UpsertAccountInput = z.infer<typeof upsertAccountSchema>;

const journalLineSchema = z.object({
  accountId: z.string().uuid(),
  debitKobo: z.number().int().min(0),
  creditKobo: z.number().int().min(0),
  narration: z.string().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  procurementRequestId: z.string().uuid().nullable().optional(),
  vendorId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  intercompanyTransactionId: z.string().uuid().nullable().optional(),
  payableInvoiceId: z.string().uuid().nullable().optional(),
  receivableInvoiceId: z.string().uuid().nullable().optional(),
  inventoryMovementId: z.string().uuid().nullable().optional(),
});

export const createJournalSchema = z.object({
  entityId: z.string().uuid(),
  fiscalPeriodId: z.string().uuid(),
  narration: z.string().min(1).max(500),
  idempotencyKey: z.string().min(8).max(80),
  lines: z.array(journalLineSchema).min(2),
  source: z
    .enum([
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
    ])
    .optional(),
  reversesJournalId: z.string().uuid().optional(),
});
export type CreateJournalInput = z.infer<typeof createJournalSchema>;

export const updateJournalSchema = z.object({
  narration: z.string().min(1).max(500).optional(),
  fiscalPeriodId: z.string().uuid().optional(),
  lines: z.array(journalLineSchema).min(2).optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateJournalInput = z.infer<typeof updateJournalSchema>;

export const submitJournalSchema = z.object({
  rowVersion: z.number().int().positive(),
});

export const reverseJournalSchema = z.object({
  reason: z.string().min(1).max(500),
  fiscalPeriodId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(80),
});
export type ReverseJournalInput = z.infer<typeof reverseJournalSchema>;

export const bankTransferSchema = z.object({
  entityId: z.string().uuid(),
  sourceAccountId: z.string().uuid(),
  destinationAccountId: z.string().uuid(),
  amountKobo: z.number().int().positive(),
  occurredOn: z.string().min(8),
  narration: z.string().min(1).max(500),
  fiscalPeriodId: z.string().uuid(),
});
export type BankTransferInput = z.infer<typeof bankTransferSchema>;

export const statementMapSchema = z.object({
  dateColumn: z.string().min(1),
  descriptionColumn: z.string().min(1),
  amountColumn: z.string().min(1),
});

export const reconcileSchema = z.object({
  statementLineId: z.string().uuid(),
  bankTransactionId: z.string().uuid().nullable().optional(),
  journalLineId: z.string().uuid().nullable().optional(),
});
export type ReconcileInput = z.infer<typeof reconcileSchema>;

export const unmatchSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const createBudgetSchema = z.object({
  entityId: z.string().uuid(),
  fiscalYearId: z.string().uuid(),
  lines: z.array(
    z.object({
      code: z.string().min(1).max(32),
      name: z.string().min(1).max(200),
      approvedAmountKobo: z.number().int().min(0),
      departmentId: z.string().uuid().nullable().optional(),
    }),
  ).min(1),
});
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

export const submitBudgetSchema = z.object({
  rowVersion: z.number().int().positive(),
});

export const upsertCustomerSchema = z.object({
  entityId: z.string().uuid(),
  name: z.string().min(1).max(200),
  termsDays: z.number().int().min(0).max(365).optional(),
  creditLimitKobo: z.number().int().min(0).optional(),
  contacts: z.unknown().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  rowVersion: z.number().int().positive().optional(),
});
export type UpsertCustomerInput = z.infer<typeof upsertCustomerSchema>;

export const createIncomeSchema = z.object({
  entityId: z.string().uuid(),
  categoryKey: z.string().min(1),
  settlement: z.enum(['INVOICE', 'CASH']),
  customerId: z.string().uuid().optional(),
  bankAccountId: z.string().uuid().optional(),
  amountKobo: z.number().int().positive(),
  occurredOn: z.string().min(8),
  dueDate: z.string().min(8).optional(),
  narration: z.string().min(1).max(500),
  documentId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(8).max(80),
});
export type CreateIncomeInput = z.infer<typeof createIncomeSchema>;

export const createExpenseSchema = z.object({
  entityId: z.string().uuid(),
  categoryKey: z.string().min(1),
  settlement: z.enum(['ON_ACCOUNT', 'CASH']),
  vendorId: z.string().uuid().optional(),
  bankAccountId: z.string().uuid().optional(),
  amountKobo: z.number().int().positive(),
  occurredOn: z.string().min(8),
  dueDate: z.string().min(8).optional(),
  narration: z.string().min(1).max(500),
  documentId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(8).max(80),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const submitFinanceDocSchema = z.object({
  rowVersion: z.number().int().positive(),
});

export const createBillSchema = z.object({
  entityId: z.string().uuid(),
  vendorId: z.string().uuid(),
  invoiceDate: z.string().min(8),
  dueDate: z.string().min(8),
  amountKobo: z.number().int().positive(),
  narration: z.string().min(1).max(500),
  documentId: z.string().uuid().optional(),
  categoryKey: z.string().min(1).optional(),
  idempotencyKey: z.string().min(8).max(80),
});
export type CreateBillInput = z.infer<typeof createBillSchema>;

export const createReceiptSchema = z.object({
  entityId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  bankAccountId: z.string().uuid(),
  receivedOn: z.string().min(8),
  amountKobo: z.number().int().positive(),
  allocations: z.array(z.object({
    invoiceId: z.string().uuid(),
    amountKobo: z.number().int().positive(),
  })).min(1),
  idempotencyKey: z.string().min(8).max(80),
});
export type CreateReceiptInput = z.infer<typeof createReceiptSchema>;

export const createIntercompanySchema = z.object({
  type: z.enum(['funding_allocation', 'loan', 'recharge', 'transfer']),
  sourceEntityId: z.string().uuid(),
  destinationEntityId: z.string().uuid(),
  sourceBankAccountId: z.string().uuid(),
  destBankAccountId: z.string().uuid(),
  amountKobo: z.number().int().positive(),
  occurredOn: z.string().min(8),
  narration: z.string().min(1).max(500),
  idempotencyKey: z.string().min(8).max(80),
});
export type CreateIntercompanyInput = z.infer<typeof createIntercompanySchema>;

export const acknowledgeIntercompanySchema = z.object({
  rowVersion: z.number().int().positive(),
  reason: z.string().max(500).optional(),
});

export const reportQuerySchema = z.object({
  entityId: z.string().uuid().optional(),
  consolidated: z.coerce.boolean().optional(),
  fiscalYearId: z.string().uuid().optional(),
  year: z.coerce.number().int().optional(),
  periodId: z.string().uuid().optional(),
  ytd: z.coerce.boolean().optional(),
  comparePeriodId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  accountCodes: z.string().optional(),
  format: z.enum(['csv', 'xlsx', 'pdf', 'CSV', 'XLSX', 'PDF']).optional(),
});
export type ReportQueryInput = z.infer<typeof reportQuerySchema>;

export const shareReportSchema = reportQuerySchema.omit({ format: true }).extend({
  recipient: z.string().trim().min(3).max(200),
  message: z.string().trim().max(2000).optional(),
});
export type ShareReportInput = z.infer<typeof shareReportSchema>;

export const saveReportSetSchema = z.object({
  name: z.string().min(1).max(120),
  reportKind: z.enum([
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
  ]),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type SaveReportSetInput = z.infer<typeof saveReportSetSchema>;

