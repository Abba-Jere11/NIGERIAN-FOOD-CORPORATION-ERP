import { AUDIT_ACTIONS, MAX_PAGE_SIZE } from '@nfc/shared';
import { z } from 'zod';

const optionalTrimmed = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === undefined || value === '' ? undefined : value));

export const auditQuerySchema = z.object({
  /** Inclusive lower bound, as an ISO date or date-time. */
  from: optionalTrimmed,
  /** Inclusive upper bound. A bare date covers the whole day in Africa/Lagos. */
  to: optionalTrimmed,
  /** Matches the actor uuid, the system actor name, or part of the actor name. */
  actor: optionalTrimmed,
  action: z.enum(AUDIT_ACTIONS).optional(),
  subjectType: optionalTrimmed,
  subjectId: z.string().uuid().optional(),
  entityId: z.string().uuid().optional(),
  /** Free text across subject label, reference number and reason. */
  q: optionalTrimmed,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** Export shares the filters but has no pagination; the row cap is fixed. */
export const auditExportQuerySchema = auditQuerySchema.omit({ page: true, pageSize: true });

export type AuditExportQuery = z.infer<typeof auditExportQuerySchema>;

export const AUDIT_EXPORT_ROW_LIMIT = 10_000;
