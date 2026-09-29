import { ENTITY_TYPES } from '@nfc/shared';
import { z } from 'zod';

const code = z
  .string()
  .trim()
  .min(2)
  .max(10)
  .regex(/^[A-Z0-9]+$/, 'Use capital letters and digits only, for example YFZ.');

const name = z.string().trim().min(2).max(160);

/** Rule R11: removing something from active use always needs an explanation. */
const reason = z
  .string()
  .trim()
  .min(5, 'Give a reason of at least five characters. It is stored permanently.')
  .max(1000);

const rowVersion = z.coerce
  .number()
  .int()
  .min(1, 'The record version is required so a concurrent change is not overwritten.');

export const createEntitySchema = z.object({
  code,
  name,
  legalName: name,
  type: z.enum(ENTITY_TYPES),
  /** Optional for subsidiaries: defaults to the holding company (A4). */
  parentEntityId: z.string().uuid().optional(),
});

export const updateEntitySchema = z.object({
  name,
  legalName: name,
  rowVersion,
});

export const entityStatusChangeSchema = z.object({
  reason,
  rowVersion,
});

export const createDepartmentSchema = z.object({
  name,
  code: code.optional(),
  description: z.string().trim().max(1000).optional(),
});

export const updateDepartmentSchema = z.object({
  name,
  code: code.optional(),
  description: z.string().trim().max(1000).optional(),
  rowVersion,
});

export const departmentStatusChangeSchema = entityStatusChangeSchema;

export const listDepartmentsSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).default('ALL'),
});

export type CreateEntityInput = z.infer<typeof createEntitySchema>;
export type UpdateEntityInput = z.infer<typeof updateEntitySchema>;
export type EntityStatusChangeInput = z.infer<typeof entityStatusChangeSchema>;
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
export type ListDepartmentsInput = z.infer<typeof listDepartmentsSchema>;
