import { z } from 'zod';
import {
  ORG_MINUTE_PRIORITIES,
  ORG_MINUTE_STATUSES,
  ORG_REPORT_STATUSES,
} from '@nfc/shared';

export const createOrgReportSchema = z.object({
  entityId: z.string().uuid(),
  templateKey: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(20000),
  observations: z.string().trim().max(8000).optional().nullable(),
  reportingPeriod: z.string().trim().max(120).optional().nullable(),
  reportDate: z.string().trim().min(8).max(10).optional().nullable(),
  ccUserIds: z.array(z.string().uuid()).max(20).optional(),
  idempotencyKey: z.string().trim().min(8).max(80),
});
export type CreateOrgReportInput = z.infer<typeof createOrgReportSchema>;

export const updateOrgReportSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
  observations: z.string().trim().max(8000).optional().nullable(),
  reportingPeriod: z.string().trim().max(120).optional().nullable(),
  reportDate: z.string().trim().min(8).max(10).optional().nullable(),
  ccUserIds: z.array(z.string().uuid()).max(20).optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateOrgReportInput = z.infer<typeof updateOrgReportSchema>;

export const submitOrgReportSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(80),
  rowVersion: z.number().int().positive(),
});
export type SubmitOrgReportInput = z.infer<typeof submitOrgReportSchema>;

export const amendOrgReportSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
  observations: z.string().trim().max(8000).optional().nullable(),
  reason: z.string().trim().min(1).max(500),
  rowVersion: z.number().int().positive(),
});
export type AmendOrgReportInput = z.infer<typeof amendOrgReportSchema>;

export const forwardOrgReportSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(20),
  note: z.string().trim().max(2000).optional().nullable(),
  rowVersion: z.number().int().positive(),
});
export type ForwardOrgReportInput = z.infer<typeof forwardOrgReportSchema>;

export const closeOrgReportSchema = z.object({
  status: z.enum(['CLOSED', 'ARCHIVED'] as const),
  rowVersion: z.number().int().positive(),
});
export type CloseOrgReportInput = z.infer<typeof closeOrgReportSchema>;

export const revokeAccessSchema = z.object({
  userId: z.string().uuid(),
});
export type RevokeAccessInput = z.infer<typeof revokeAccessSchema>;

export const createMinuteSchema = z.object({
  subject: z.string().trim().min(1).max(240),
  instruction: z.string().trim().min(1).max(20000),
  expectedOutcome: z.string().trim().max(4000).optional().nullable(),
  dueAt: z.string().trim().min(1).max(40).optional().nullable(),
  responseRequired: z.boolean().optional(),
  acknowledgementRequired: z.boolean().optional(),
  priority: z.enum(ORG_MINUTE_PRIORITIES).optional(),
  toUserId: z.string().uuid(),
  ccUserIds: z.array(z.string().uuid()).max(20).optional(),
  idempotencyKey: z.string().trim().min(8).max(80),
});
export type CreateMinuteInput = z.infer<typeof createMinuteSchema>;

export const issueMinuteSchema = z.object({
  rowVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
});
export type IssueMinuteInput = z.infer<typeof issueMinuteSchema>;

export const minuteStatusSchema = z.object({
  status: z.enum(ORG_MINUTE_STATUSES),
  rowVersion: z.number().int().positive(),
});
export type MinuteStatusInput = z.infer<typeof minuteStatusSchema>;

export const createResponseSchema = z.object({
  subject: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(20000),
  outcome: z.string().trim().max(4000).optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(80),
});
export type CreateResponseInput = z.infer<typeof createResponseSchema>;

export const reviewResponseSchema = z.object({
  action: z.enum(['accept', 'further', 'reopen']),
  note: z.string().trim().max(4000).optional().nullable(),
  rowVersion: z.number().int().positive(),
});
export type ReviewResponseInput = z.infer<typeof reviewResponseSchema>;

export const createDecisionSchema = z.object({
  subject: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(20000),
  minuteId: z.string().uuid().optional().nullable(),
});
export type CreateDecisionInput = z.infer<typeof createDecisionSchema>;

export const sendExternalSchema = z.object({
  recipientEmail: z.string().trim().email().max(200),
  subject: z.string().trim().min(1).max(240),
  message: z.string().trim().min(1).max(8000),
  idempotencyKey: z.string().trim().min(8).max(80),
});
export type SendExternalInput = z.infer<typeof sendExternalSchema>;

export const updateTemplateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  available: z.boolean().optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export const orgReportInboxSchema = z.object({
  box: z.enum(['mine', 'incoming', 'information', 'forwarded']).optional(),
  status: z.enum(ORG_REPORT_STATUSES).optional(),
  q: z.string().trim().max(200).optional(),
});
export type OrgReportInboxInput = z.infer<typeof orgReportInboxSchema>;

export const orgSearchSchema = z.object({
  q: z.string().trim().min(1).max(200),
});
export type OrgSearchInput = z.infer<typeof orgSearchSchema>;
