import { z } from 'zod';
import { CASE_STATUSES } from '@nfc/shared';

export const createCaseSchema = z.object({
  entityId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000),
});
export type CreateCaseInput = z.infer<typeof createCaseSchema>;

export const caseUserSchema = z.object({
  userId: z.string().uuid(),
});
export type CaseUserInput = z.infer<typeof caseUserSchema>;

export const caseCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});
export type CaseCommentInput = z.infer<typeof caseCommentSchema>;

export const caseStatusSchema = z.object({
  status: z.enum(CASE_STATUSES),
});
export type CaseStatusInput = z.infer<typeof caseStatusSchema>;
