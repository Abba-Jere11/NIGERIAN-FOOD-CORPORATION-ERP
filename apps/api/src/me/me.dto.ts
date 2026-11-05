import { z } from 'zod';

export const registerInviteSchema = z.object({
  password: z.string().min(12).max(200),
  otherNames: z.string().trim().max(120).optional().nullable(),
  gender: z.string().trim().max(40).optional().nullable(),
  personalPhone: z.string().trim().max(40).optional().nullable(),
  emergencyName: z.string().trim().max(120).optional().nullable(),
  emergencyPhone: z.string().trim().max(40).optional().nullable(),
  bankName: z.string().trim().max(120).optional().nullable(),
  bankAccountName: z.string().trim().max(160).optional().nullable(),
  bankAccountNumber: z.string().trim().max(40).optional().nullable(),
});

export const profilePatchSchema = z.object({
  otherNames: z.string().trim().max(120).optional().nullable(),
  gender: z.string().trim().max(40).optional().nullable(),
  personalEmail: z.string().trim().email().optional().nullable(),
  personalPhone: z.string().trim().max(40).optional().nullable(),
  emergencyName: z.string().trim().max(120).optional().nullable(),
  emergencyPhone: z.string().trim().max(40).optional().nullable(),
  rowVersion: z.number().int().positive(),
});

export const ownLeaveSchema = z.object({
  typeKey: z.string().trim().min(1).max(40),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().max(2000).optional().nullable(),
  reliefEmployeeId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
});

export const noticeSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(8000),
  entityId: z.string().uuid().optional().nullable(),
  pinned: z.boolean().optional(),
  audience: z.object({
    all: z.boolean().optional(),
    roles: z.array(z.string()).optional(),
    departmentIds: z.array(z.string().uuid()).optional(),
  }),
});

export const complaintSchema = z.object({
  category: z.string().trim().min(1).max(80),
  subject: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(8000),
  anonymous: z.boolean().optional(),
});

export const complaintReplySchema = z.object({
  body: z.string().trim().min(1).max(4000),
  status: z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED']).optional(),
});

export const directMessageSchema = z.object({ userId: z.string().uuid() });
export const groupMessageSchema = z.object({
  title: z.string().trim().min(1).max(120),
  memberIds: z.array(z.string().uuid()).min(1),
});
export const messageBodySchema = z.object({ body: z.string().trim().min(1).max(4000) });
export const linkUserSchema = z.object({ userId: z.string().uuid() });
export const decideInviteSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export const departmentHeadSchema = z.object({ employeeId: z.string().uuid() });
