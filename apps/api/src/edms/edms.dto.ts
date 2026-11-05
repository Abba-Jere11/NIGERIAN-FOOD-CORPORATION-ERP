import { EDMS_CONFIDENTIALITY, EDMS_MODULES, ROLE_KEYS, type RoleKey } from '@nfc/shared';
import { z } from 'zod';

const ROLE_ENUM = ROLE_KEYS as unknown as [RoleKey, ...RoleKey[]];

export const shareSchema = z
  .object({
    granteeUserId: z.string().uuid().optional(),
    granteeRole: z.enum(ROLE_ENUM).optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .refine((value) => Boolean(value.granteeUserId) !== Boolean(value.granteeRole), {
    message: 'Share with a named user or a role.',
  });

export const reasonSchema = z.object({
  reason: z.string().trim().min(1),
});

export const refileSchema = z.object({
  destEntityId: z.string().uuid(),
  destFolderId: z.string().uuid().optional(),
  reason: z.string().trim().min(1),
});

export const categorySchema = z.object({
  id: z.string().uuid().optional(),
  key: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1),
  module: z.enum(EDMS_MODULES),
  retainYears: z.coerce.number().int().min(1).max(50),
  requiresApproval: z.coerce.boolean(),
  confidentiality: z.enum(EDMS_CONFIDENTIALITY),
});

export const tagSchema = z.object({
  id: z.string().uuid().optional(),
  key: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1),
});

export const holdSchema = z.object({
  reason: z.string().trim().min(1),
});
