import type { PermissionKey } from './permissions';

export const ORG_REPORT_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'CLOSED',
  'ARCHIVED',
] as const;
export type OrgReportStatus = (typeof ORG_REPORT_STATUSES)[number];

export const ORG_MINUTE_STATUSES = [
  'DRAFT',
  'ISSUED',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'RESPONSE_SUBMITTED',
  'FURTHER_ACTION_REQUIRED',
  'COMPLETED',
  'REOPENED',
] as const;
export type OrgMinuteStatus = (typeof ORG_MINUTE_STATUSES)[number];

export const ORG_RESPONSE_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'FURTHER_ACTION_REQUIRED',
  'ACCEPTED',
] as const;
export type OrgResponseStatus = (typeof ORG_RESPONSE_STATUSES)[number];

export const ORG_REPORT_ACCESS_KINDS = [
  'OWNER',
  'TO',
  'CC',
  'FORWARD',
  'MINUTE_TO',
  'MINUTE_CC',
] as const;
export type OrgReportAccessKind = (typeof ORG_REPORT_ACCESS_KINDS)[number];

export const ORG_RECIPIENT_KINDS = ['TO', 'CC', 'FORWARD'] as const;
export type OrgRecipientKind = (typeof ORG_RECIPIENT_KINDS)[number];

export const ORG_MINUTE_RECIPIENT_KINDS = ['TO', 'CC'] as const;
export type OrgMinuteRecipientKind = (typeof ORG_MINUTE_RECIPIENT_KINDS)[number];

export const ORG_MINUTE_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export type OrgMinutePriority = (typeof ORG_MINUTE_PRIORITIES)[number];

export const ORG_TEMPLATE_KINDS = ['general', 'specialist'] as const;
export type OrgTemplateKind = (typeof ORG_TEMPLATE_KINDS)[number];

export const ORG_EXTERNAL_STATUSES = ['queued', 'submitted', 'failed'] as const;
export type OrgExternalStatus = (typeof ORG_EXTERNAL_STATUSES)[number];

export const ORG_REPORT_STATUS_TRANSITIONS: Record<OrgReportStatus, readonly OrgReportStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW', 'CLOSED'],
  UNDER_REVIEW: ['CLOSED', 'ARCHIVED'],
  CLOSED: ['ARCHIVED'],
  ARCHIVED: [],
};

export const ORG_MINUTE_STATUS_TRANSITIONS: Record<OrgMinuteStatus, readonly OrgMinuteStatus[]> = {
  DRAFT: ['ISSUED'],
  ISSUED: ['ACKNOWLEDGED', 'IN_PROGRESS', 'RESPONSE_SUBMITTED', 'COMPLETED'],
  ACKNOWLEDGED: ['IN_PROGRESS', 'RESPONSE_SUBMITTED', 'COMPLETED'],
  IN_PROGRESS: ['RESPONSE_SUBMITTED', 'COMPLETED'],
  RESPONSE_SUBMITTED: ['FURTHER_ACTION_REQUIRED', 'COMPLETED'],
  FURTHER_ACTION_REQUIRED: ['IN_PROGRESS', 'RESPONSE_SUBMITTED', 'COMPLETED'],
  COMPLETED: ['REOPENED'],
  REOPENED: ['IN_PROGRESS', 'RESPONSE_SUBMITTED', 'COMPLETED'],
};

export const ORG_RESPONSE_STATUS_TRANSITIONS: Record<OrgResponseStatus, readonly OrgResponseStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['FURTHER_ACTION_REQUIRED', 'ACCEPTED'],
  FURTHER_ACTION_REQUIRED: ['SUBMITTED'],
  ACCEPTED: [],
};

export interface OrgReportTemplateView {
  id: string;
  key: string;
  title: string;
  kind: OrgTemplateKind;
  requiredPermission: PermissionKey;
  available: boolean;
  sortOrder: number;
  acknowledgementDefault: boolean;
  rowVersion: number;
  fields: Record<string, unknown>;
}

export interface OrgReportPersonView {
  id: string;
  name: string;
  position?: string | null;
  entityCode?: string | null;
}

export interface OrgReportRecipientView {
  userId: string;
  userName: string | null;
  kind: OrgRecipientKind;
  sourceEventId: string | null;
}

export interface OrgReportListItemView {
  id: string;
  referenceNumber: string;
  title: string;
  templateKey: string;
  templateTitle: string;
  status: OrgReportStatus;
  entityId: string;
  entityCode: string | null;
  senderUserId: string;
  senderName: string | null;
  toUserId: string | null;
  toName: string | null;
  submittedAt: string | null;
  updatedAt: string;
  actionOutstanding: boolean;
  myKind: OrgReportAccessKind | null;
}

export interface OrgReportForwardView {
  id: string;
  forwardedBy: string;
  forwardedByName: string | null;
  note: string | null;
  revisionId: string | null;
  recipients: OrgReportPersonView[];
  createdAt: string;
}

export interface OrgMinuteListItemView {
  id: string;
  referenceNumber: string;
  subject: string;
  status: OrgMinuteStatus;
  sourceReportId: string;
  sourceReportReference: string;
  issuerName: string | null;
  toUserId: string | null;
  toName: string | null;
  issuedAt: string | null;
  dueAt: string | null;
  responseRequired: boolean;
  entityId: string;
}

export interface OrgMinuteRecipientView {
  userId: string;
  userName: string | null;
  kind: OrgMinuteRecipientKind;
}

export interface OrgResponseView {
  id: string;
  referenceNumber: string;
  minuteId: string;
  subject: string;
  body: string;
  outcome: string | null;
  status: OrgResponseStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  attachments: OrgReportAttachmentView[];
}

export interface OrgDecisionView {
  id: string;
  referenceNumber: string;
  reportId: string;
  minuteId: string | null;
  subject: string;
  body: string;
  decidedAt: string;
  authorityName: string | null;
  createdBy: string;
}

export interface OrgExternalView {
  id: string;
  reportId: string;
  recipientEmail: string;
  subject: string;
  senderIdentity: string;
  providerStatus: OrgExternalStatus;
  lastError: string | null;
  createdAt: string;
  createdBy: string;
}

export interface OrgReportAttachmentView {
  id: string;
  title: string;
  referenceNumber: string;
  originalFilename: string | null;
  versionNumber: number | null;
}

export interface OrgReportHistoryEventView {
  at: string;
  actor: string | null;
  actorName: string | null;
  action: string;
  detail: string;
  href: string | null;
}

export interface OrgMinuteView extends OrgMinuteListItemView {
  instruction: string;
  expectedOutcome: string | null;
  acknowledgementRequired: boolean;
  priority: OrgMinutePriority;
  rowVersion: number;
  recipients: OrgMinuteRecipientView[];
  responses: OrgResponseView[];
  attachments: OrgReportAttachmentView[];
  myKind: OrgMinuteRecipientKind | 'ISSUER' | null;
}

export interface OrgReportView extends OrgReportListItemView {
  body: string;
  observations: string | null;
  reportingPeriod: string | null;
  reportDate: string;
  currentRevisionId: string | null;
  rowVersion: number;
  originalTo: OrgReportPersonView | null;
  originalCc: OrgReportPersonView[];
  recipients: OrgReportRecipientView[];
  forwards: OrgReportForwardView[];
  minutes: OrgMinuteListItemView[];
  decisions: OrgDecisionView[];
  attachments: OrgReportAttachmentView[];
  history: OrgReportHistoryEventView[];
  snapshot: Record<string, unknown> | null;
}

export interface OrgReportDashboardView {
  incoming: number;
  underReview: number;
  recentlyForwarded: number;
  minutesIssued: number;
  minutesAwaitingResponse: number;
  responsesAwaitingReview: number;
  outstandingActions: number;
  recentDecisions: number;
  myReports: number;
  receivedForInformation: number;
  assignedMinutes: number;
  responsesAwaitingSubmission: number;
}

export interface OrgReportSearchHitView {
  id: string;
  recordType: 'ORG_REPORT' | 'ORG_MINUTE' | 'ORG_RESPONSE' | 'ORG_DECISION';
  referenceNumber: string;
  title: string;
  status: string;
  entityCode: string | null;
  href: string;
}

export function canTransitionOrgReport(from: OrgReportStatus, to: OrgReportStatus): boolean {
  return ORG_REPORT_STATUS_TRANSITIONS[from].includes(to);
}

export function canTransitionOrgMinute(from: OrgMinuteStatus, to: OrgMinuteStatus): boolean {
  return ORG_MINUTE_STATUS_TRANSITIONS[from].includes(to);
}

export function canTransitionOrgResponse(from: OrgResponseStatus, to: OrgResponseStatus): boolean {
  return ORG_RESPONSE_STATUS_TRANSITIONS[from].includes(to);
}

export const ORG_REPORT_NAV_PERMISSIONS = [
  'org_report.view',
  'org_report.create',
  'org_report.template.manage',
] as const satisfies readonly PermissionKey[];
