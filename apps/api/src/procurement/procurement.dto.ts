import {
  FUNDING_ROUTES,
  PAYMENT_TIMINGS,
  PROCUREMENT_STATUSES,
  PROCUREMENT_URGENCIES,
  WORKFLOW_ACTIONS,
} from '@nfc/shared';
import { z } from 'zod';

export const createProcurementSchema = z.object({
  title: z.string().trim().min(1).max(200),
  departmentId: z.string().uuid().optional(),
  entityId: z.string().uuid().optional(),
  requisitionId: z.string().uuid().optional(),
});

export const createRequisitionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  departmentId: z.string().uuid().optional(),
  entityId: z.string().uuid().optional(),
});

export const requisitionLineInputSchema = z.object({
  description: z.string().trim().min(1).max(8000),
  quantity: z.number().int().positive(),
  unitId: z.string().uuid(),
});

export const updateRequisitionSchema = z
  .object({
    rowVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    departmentId: z.string().uuid().nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    background: z.string().trim().max(8000).nullable().optional(),
    justification: z.string().trim().max(4000).nullable().optional(),
    prayer: z.string().trim().max(4000).nullable().optional(),
    requiredDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    deliveryLocation: z.string().trim().max(400).nullable().optional(),
    urgency: z.enum(PROCUREMENT_URGENCIES).optional(),
    lines: z.array(requisitionLineInputSchema).optional(),
  })
  .strict();

export const procurementLineInputSchema = z.object({
  description: z.string().trim().max(8000).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  quantity: z.number().int().positive().nullable().optional(),
  unitId: z.string().uuid().nullable().optional(),
  unitPriceKobo: z.number().int().positive().nullable().optional(),
  budgetLineId: z.string().uuid().nullable().optional(),
});

export const updateProcurementSchema = z.object({
  rowVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  subject: z.string().trim().max(300).nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().max(4000).nullable().optional(),
  description: z.string().trim().max(8000).nullable().optional(),
  quantity: z.number().int().positive().nullable().optional(),
  unitId: z.string().uuid().nullable().optional(),
  unitPriceKobo: z.number().int().positive().nullable().optional(),
  totalAmountKobo: z.number().int().optional(),
  requiredDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  vendorId: z.string().uuid().nullable().optional(),
  deliveryLocation: z.string().trim().max(400).nullable().optional(),
  fundingSourceId: z.string().uuid().nullable().optional(),
  budgetLineId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  urgency: z.enum(PROCUREMENT_URGENCIES).optional(),
  additionalInstructions: z.string().trim().max(4000).nullable().optional(),
  proposedPaymentTiming: z.enum(PAYMENT_TIMINGS).nullable().optional(),
  priceComparison: z.string().trim().max(8000).nullable().optional(),
  recommendation: z.string().trim().max(8000).nullable().optional(),
  lines: z.array(procurementLineInputSchema).optional(),
});

export const listProcurementSchema = z.object({
  status: z
    .string()
    .optional()
    .transform((value) => (value === '' || value === undefined ? undefined : value))
    .pipe(z.enum(PROCUREMENT_STATUSES).optional()),
  q: z
    .string()
    .optional()
    .transform((value) => (value === '' || value === undefined ? undefined : value)),
});

export const submitProcurementSchema = z.object({
  rowVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
});

export const discardProcurementSchema = z.object({
  rowVersion: z.number().int().positive(),
});

export const procurementActionSchema = z.object({
  action: z.enum(WORKFLOW_ACTIONS),
  reason: z.string().trim().max(4000).optional(),
  rowVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
  fundingRoute: z.enum(FUNDING_ROUTES).optional(),
  sourceAccountId: z.string().uuid().optional(),
  destinationAccountId: z.string().uuid().optional(),
  checklistAcknowledged: z.boolean().optional(),
  overrideReason: z.string().trim().max(4000).optional(),
  finalPaymentTiming: z.enum(PAYMENT_TIMINGS).optional(),
  timingAcknowledged: z.boolean().optional(),
});

export const changePaymentTimingSchema = z.object({
  timing: z.enum(PAYMENT_TIMINGS),
  reason: z.string().trim().min(1).max(4000),
  rowVersion: z.number().int().positive(),
});

export const acknowledgePaymentTimingSchema = z.object({
  rowVersion: z.number().int().positive(),
});

export const recordTransferSchema = z.object({
  requestId: z.string().uuid(),
  sourceAccountId: z.string().uuid(),
  destinationAccountId: z.string().uuid(),
  amountKobo: z.number().int().positive(),
  purpose: z.string().trim().min(1).max(400),
  transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  transferMethod: z.string().trim().min(1).max(80),
  bankReference: z.string().trim().min(1).max(80),
});

export const completePaymentSchema = z.object({
  payingAccountId: z
    .string()
    .optional()
    .transform((value) => (value === '' || value === undefined ? undefined : value))
    .pipe(z.string().uuid().optional()),
  amountKobo: z.number().int().positive().optional(),
  method: z
    .string()
    .optional()
    .transform((value) => (value === '' || value === undefined ? undefined : value.trim()))
    .pipe(z.string().min(1).max(80).optional()),
  bankReference: z
    .string()
    .optional()
    .transform((value) => (value === '' || value === undefined ? undefined : value.trim()))
    .pipe(z.string().min(1).max(80).optional()),
  paymentDate: z
    .string()
    .optional()
    .transform((value) => (value === '' || value === undefined ? undefined : value))
    .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  idempotencyKey: z.string().trim().min(8).max(80),
});

export const reversePaymentSchema = z.object({
  reason: z.string().trim().min(1).max(4000),
});

export const createBankAccountSchema = z.object({
  entityId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  bankName: z.string().trim().min(1).max(120),
  accountName: z.string().trim().min(1).max(120),
  accountNumber: z.string().trim().min(4).max(40),
  recordedBalanceKobo: z.number().int().nonnegative(),
  balanceAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const updateBankAccountSchema = z.object({
  rowVersion: z.number().int().positive(),
  recordedBalanceKobo: z.number().int().nonnegative(),
  balanceAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const cloneProcurementSchema = z.object({
  rowVersion: z.number().int().positive().optional(),
});

export const commentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export const invoiceMetaSchema = z.object({
  invoiceNumber: z.string().trim().min(1).max(80),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountKobo: z.coerce.number().int().positive(),
  reason: z.string().trim().max(500).optional(),
  /** The vendor that issued the invoice; at ED Finance it must be the approved vendor. */
  vendorId: z.string().uuid().optional(),
});

export const invoiceVarianceDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().max(4000).optional(),
});

export const quotationLineMetaSchema = z.object({
  lineNumber: z.coerce.number().int().positive(),
  unitPriceKobo: z.coerce
    .number({ message: 'Enter a unit price for every item.' })
    .int()
    .positive({ message: 'Enter a unit price for every item.' }),
});

export const quotationMetaSchema = z.object({
  vendorId: z.string().uuid({ message: 'Choose the vendor that issued this quotation.' }),
  lines: z.array(quotationLineMetaSchema).min(1, { message: 'Enter a unit price for every item.' }),
  notes: z.string().trim().max(1000).optional(),
});

export const selectQuotedVendorSchema = z.object({
  rowVersion: z.number().int().positive(),
  vendorId: z.string().uuid(),
  justification: z.string().trim().max(4000).nullable().optional(),
});

export const createProjectSchema = z.object({
  entityId: z.string().uuid(),
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
});

export const createBudgetLineSchema = z.object({
  entityId: z.string().uuid(),
  fiscalYear: z.number().int().min(2000).max(2100),
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  approvedAmountKobo: z.number().int().nonnegative(),
});

export const updateBudgetLineSchema = z.object({
  rowVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(200).optional(),
  approvedAmountKobo: z.number().int().nonnegative().optional(),
});

export type CreateProcurementInput = z.infer<typeof createProcurementSchema>;
export type CreateRequisitionInput = z.infer<typeof createRequisitionSchema>;
export type UpdateRequisitionInput = z.infer<typeof updateRequisitionSchema>;
export type UpdateProcurementInput = z.infer<typeof updateProcurementSchema>;
export type ListProcurementQuery = z.infer<typeof listProcurementSchema>;
export type SubmitProcurementInput = z.infer<typeof submitProcurementSchema>;
export type DiscardProcurementInput = z.infer<typeof discardProcurementSchema>;
export type ProcurementActionInput = z.infer<typeof procurementActionSchema>;
export type RecordTransferInput = z.infer<typeof recordTransferSchema>;
export type CompletePaymentInput = z.infer<typeof completePaymentSchema>;
export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;
export type CreateBankAccountInput = z.infer<typeof createBankAccountSchema>;
export type UpdateBankAccountInput = z.infer<typeof updateBankAccountSchema>;
export type CloneProcurementInput = z.infer<typeof cloneProcurementSchema>;
export type CommentInput = z.infer<typeof commentSchema>;
export type InvoiceMetaInput = z.infer<typeof invoiceMetaSchema>;
export type InvoiceVarianceDecisionInput = z.infer<typeof invoiceVarianceDecisionSchema>;
export type QuotationMetaInput = z.infer<typeof quotationMetaSchema>;
export type SelectQuotedVendorInput = z.infer<typeof selectQuotedVendorSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateBudgetLineInput = z.infer<typeof createBudgetLineSchema>;
export const deliveryNoteSchema = z.object({
  note: z.string().trim().min(1).max(4000),
});

/** Form posts often send "" for blank optional fields; treat those as omitted. */
function emptyToUndef(value: string | undefined): string | undefined {
  return value === '' || value === undefined ? undefined : value;
}

const optionalUuid = z
  .string()
  .optional()
  .transform(emptyToUndef)
  .pipe(z.string().uuid().optional());

const optionalDate = z
  .string()
  .optional()
  .transform(emptyToUndef)
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());

const optionalText = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = emptyToUndef(value)?.trim();
    return trimmed === undefined || trimmed === '' ? undefined : trimmed;
  });

export const receiptDocumentSchema = z.object({
  documentId: z.string().uuid(),
  kind: z.string().trim().min(1).max(80),
});

export const recordReceiptSchema = z.object({
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  location: z.string().trim().min(1).max(400),
  lineId: optionalUuid,
  quantityReceived: z.coerce.number().int().nonnegative(),
  quantityAccepted: z.coerce.number().int().nonnegative(),
  quantityRejected: z.coerce.number().int().nonnegative().optional(),
  rejectReason: optionalText.pipe(z.string().max(4000).optional()),
  conditionNotes: optionalText.pipe(z.string().max(4000).optional()),
  secondBatchDueOn: optionalDate,
  idempotencyKey: z.string().trim().min(8).max(80),
  documents: z.array(receiptDocumentSchema).default([]),
  warehouseId: optionalUuid,
  batchCode: optionalText.pipe(z.string().max(80).optional()),
  serialCodes: z.array(z.string().trim().min(1).max(80)).optional(),
});

export const deliveryItemSchema = z.object({
  lineId: z.string().uuid(),
  quantityReceived: z.coerce.number().int().nonnegative(),
  quantityAccepted: z.coerce.number().int().nonnegative(),
  quantityRejected: z.coerce.number().int().nonnegative().optional().default(0),
  rejectReason: optionalText.pipe(z.string().max(4000).optional()),
  conditionNotes: optionalText.pipe(z.string().max(4000).optional()),
  secondBatchDueOn: optionalDate,
  batchCode: optionalText.pipe(z.string().max(80).optional()),
  serialCodes: z.array(z.string().trim().min(1).max(80)).optional(),
});

export const recordDeliverySchema = z.object({
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  location: z.string().trim().min(1).max(400),
  documentKind: z.string().trim().min(1).max(80),
  notes: optionalText.pipe(z.string().max(4000).optional()),
  warehouseId: optionalUuid,
  idempotencyKey: z.string().trim().min(8).max(80),
  documents: z.array(receiptDocumentSchema).default([]),
  items: z.array(deliveryItemSchema).min(1).max(200),
});

export const overrideShortageDeadlineSchema = z.object({
  lineId: z.string().uuid(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(1).max(4000),
});

export const supersedeReceiptSchema = recordReceiptSchema.extend({
  reason: z.string().trim().min(1).max(4000),
});

export const closeShortSchema = z.object({
  reason: z.string().trim().min(1).max(4000),
});

export type ChangePaymentTimingInput = z.infer<typeof changePaymentTimingSchema>;
export type AcknowledgePaymentTimingInput = z.infer<typeof acknowledgePaymentTimingSchema>;
export type UpdateBudgetLineInput = z.infer<typeof updateBudgetLineSchema>;
export type DeliveryNoteInput = z.infer<typeof deliveryNoteSchema>;
export type RecordReceiptInput = z.infer<typeof recordReceiptSchema>;
export type RecordDeliveryInput = z.infer<typeof recordDeliverySchema>;
export type SupersedeReceiptInput = z.infer<typeof supersedeReceiptSchema>;
export type CloseShortInput = z.infer<typeof closeShortSchema>;
export type OverrideShortageDeadlineInput = z.infer<typeof overrideShortageDeadlineSchema>;
