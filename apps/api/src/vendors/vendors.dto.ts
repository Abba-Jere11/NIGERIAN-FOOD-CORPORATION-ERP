import { VENDOR_COMPLIANCE_TYPES, VENDOR_STATUSES } from '@nfc/shared';
import { z } from 'zod';

const contactSchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().max(200).nullable().optional(),
  role: z.string().trim().max(80).nullable().optional(),
});

export const vendorContactSchema = contactSchema;

export const createVendorSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  cacRegistrationNumber: z.string().trim().min(1).max(40),
  categoryId: z.string().uuid(),
  notes: z.string().trim().max(2000).nullable().optional(),
  contacts: z.array(contactSchema).max(20).optional(),
  bankName: z.string().trim().max(120).nullable().optional(),
  accountName: z.string().trim().max(200).nullable().optional(),
  accountNumber: z.string().trim().max(40).nullable().optional(),
});

export const updateVendorSchema = createVendorSchema.extend({
  rowVersion: z.number().int().positive(),
});

export const vendorReasonSchema = z.object({
  reason: z.string().trim().min(1),
  rowVersion: z.number().int().positive(),
});

export const bankDetailsSchema = z.object({
  bankName: z.string().trim().min(1).max(120),
  accountName: z.string().trim().min(1).max(200),
  accountNumber: z.string().trim().min(1).max(40),
  rowVersion: z.number().int().positive(),
});

export const bankApproveSchema = z.object({
  rowVersion: z.number().int().positive(),
});

export const attachComplianceSchema = z.object({
  documentId: z.string().uuid().optional(),
  complianceType: z.enum(VENDOR_COMPLIANCE_TYPES),
  required: z.boolean().optional(),
  expiresAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export const listVendorsSchema = z.object({
  status: z
    .string()
    .optional()
    .transform((value) => (value === '' || value === undefined ? undefined : value))
    .pipe(z.enum(VENDOR_STATUSES).optional()),
  category: z
    .string()
    .optional()
    .transform((value) => (value === '' || value === undefined ? undefined : value)),
  q: z
    .string()
    .optional()
    .transform((value) => (value === '' || value === undefined ? undefined : value)),
});

export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;
export type VendorReasonInput = z.infer<typeof vendorReasonSchema>;
export type BankDetailsInput = z.infer<typeof bankDetailsSchema>;
export type AttachComplianceInput = z.infer<typeof attachComplianceSchema>;
export type ListVendorsQuery = z.infer<typeof listVendorsSchema>;
