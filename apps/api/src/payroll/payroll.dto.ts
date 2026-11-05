import { z } from 'zod';

const uuid = z.string().uuid();
const idempotency = z.string().trim().min(8).max(80);
const date = z.string().trim().min(8).max(10);

const componentSchema = z.object({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  amountKobo: z.number().int().nonnegative(),
});

export const rowVersionSchema = z.object({
  rowVersion: z.number().int().positive(),
});
export type RowVersionInput = z.infer<typeof rowVersionSchema>;

export const updateSettingsSchema = z.object({
  edFinanceThresholdKobo: z.number().int().nonnegative().optional(),
  overtimeMultiplierBps: z.number().int().nonnegative().optional(),
  includeSuspended: z.boolean().optional(),
  unpaidLeaveDailyDivisor: z.number().int().positive().optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export const createPayeBandSchema = z.object({
  effectiveOn: date,
  fromKobo: z.number().int().nonnegative(),
  toKobo: z.number().int().positive().nullable().optional(),
  rateBps: z.number().int().min(0).max(10000),
});
export type CreatePayeBandInput = z.infer<typeof createPayeBandSchema>;

export const createPensionSchema = z.object({
  effectiveOn: date,
  employeeBps: z.number().int().min(0).max(10000),
  employerBps: z.number().int().min(0).max(10000),
});
export type CreatePensionInput = z.infer<typeof createPensionSchema>;

export const createStatutorySchema = z.object({
  key: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  effectiveOn: date,
  rateBps: z.number().int().min(0).max(10000).nullable().optional(),
  amountKobo: z.number().int().nonnegative().nullable().optional(),
});
export type CreateStatutoryInput = z.infer<typeof createStatutorySchema>;

export const createStructureSchema = z.object({
  entityId: uuid,
  employeeId: uuid.nullable().optional(),
  gradeKey: z.string().trim().min(1).max(40).nullable().optional(),
  basicKobo: z.number().int().nonnegative(),
  allowances: z.array(componentSchema).optional(),
  overtimeRule: z.string().trim().max(80).nullable().optional(),
  effectiveOn: date,
});
export type CreateStructureInput = z.infer<typeof createStructureSchema>;

export const createLoanSchema = z.object({
  employeeId: uuid,
  entityId: uuid,
  principalKobo: z.number().int().positive(),
  installmentKobo: z.number().int().positive(),
  startsOn: date,
});
export type CreateLoanInput = z.infer<typeof createLoanSchema>;

export const createRunSchema = z.object({
  entityId: uuid,
  fiscalPeriodId: uuid,
  idempotencyKey: idempotency,
});
export type CreateRunInput = z.infer<typeof createRunSchema>;

export const payRunSchema = z.object({
  evidenceDocumentId: uuid,
  rowVersion: z.number().int().positive(),
  idempotencyKey: idempotency,
});
export type PayRunInput = z.infer<typeof payRunSchema>;

export const remitSchema = z.object({
  kind: z.enum(['PAYE', 'PENSION', 'OTHER']),
  evidenceDocumentId: uuid,
  rowVersion: z.number().int().positive(),
});
export type RemitInput = z.infer<typeof remitSchema>;

export const adjustRunSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
  rowVersion: z.number().int().positive(),
  idempotencyKey: idempotency,
});
export type AdjustRunInput = z.infer<typeof adjustRunSchema>;
