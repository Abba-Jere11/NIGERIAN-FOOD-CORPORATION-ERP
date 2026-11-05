import type { PermissionKey } from './permissions';

export const HR_NAV_PERMISSIONS: readonly PermissionKey[] = [
  'hr.employee.view',
  'hr.employee.manage',
  'hr.recruitment.manage',
  'hr.leave.approve',
  'hr.attendance.manage',
  'hr.performance.manage',
  'hr.disciplinary.view',
  'hr.training.view',
  'payroll.view',
];

export function hasHrNavPermission(permissions: readonly string[]): boolean {
  return HR_NAV_PERMISSIONS.some((key) => permissions.includes(key));
}

export const HR_EMPLOYMENT_TYPES = ['PERMANENT', 'CONTRACT', 'TEMP', 'INTERN'] as const;
export type HrEmploymentType = (typeof HR_EMPLOYMENT_TYPES)[number];

export const HR_EMPLOYEE_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'PROBATION',
  'CONFIRMED',
  'SUSPENDED',
  'TERMINATED',
  'RESIGNED',
  'INACTIVE',
] as const;
export type HrEmployeeStatus = (typeof HR_EMPLOYEE_STATUSES)[number];

export const HR_CHANGE_KINDS = [
  'TRANSFER',
  'PROMOTION',
  'CONFIRMATION',
  'DEPARTMENT_CHANGE',
  'UNIT_CHANGE',
  'TERMINATION',
  'RESIGNATION',
] as const;
export type HrChangeKind = (typeof HR_CHANGE_KINDS)[number];

export const HR_CHANGE_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type HrChangeStatus = (typeof HR_CHANGE_STATUSES)[number];

export const HR_VACANCY_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'OPEN',
  'SHORTLISTING',
  'INTERVIEWING',
  'OFFER',
  'FILLED',
  'CANCELLED',
] as const;
export type HrVacancyStatus = (typeof HR_VACANCY_STATUSES)[number];

export const HR_OFFER_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'ISSUED', 'ACCEPTED', 'DECLINED'] as const;
export type HrOfferStatus = (typeof HR_OFFER_STATUSES)[number];

export const HR_LEAVE_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type HrLeaveStatus = (typeof HR_LEAVE_STATUSES)[number];

export const HR_OVERTIME_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type HrOvertimeStatus = (typeof HR_OVERTIME_STATUSES)[number];

export const HR_ATTENDANCE_KINDS = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE', 'HOLIDAY'] as const;
export type HrAttendanceKind = (typeof HR_ATTENDANCE_KINDS)[number];

export const HR_APPRAISAL_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type HrAppraisalStatus = (typeof HR_APPRAISAL_STATUSES)[number];

export const HR_DISC_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'PRELIMINARY_REVIEW',
  'INVESTIGATION',
  'EMPLOYEE_RESPONSE',
  'RECOMMENDATION',
  'AWAITING_MD',
  'DECIDED',
  'COMMUNICATED',
  'APPEAL',
  'CLOSED',
] as const;
export type HrDiscStatus = (typeof HR_DISC_STATUSES)[number];

export const HR_DISC_OUTCOMES = [
  'NO_CASE_TO_ANSWER',
  'ADVISORY',
  'WRITTEN_WARNING',
  'FURTHER_TRAINING',
  'SUSPENSION',
  'OTHER',
  'REFERRAL',
] as const;
export type HrDiscOutcome = (typeof HR_DISC_OUTCOMES)[number];

export const HR_DISC_SERIOUS_OUTCOMES: readonly HrDiscOutcome[] = ['SUSPENSION', 'OTHER', 'REFERRAL'];

export const HR_TRAINING_STATUSES = [
  'DRAFT',
  'PROPOSED',
  'AWAITING_FINANCE',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CLOSED',
  'CANCELLED',
] as const;
export type HrTrainingStatus = (typeof HR_TRAINING_STATUSES)[number];

export interface HrUnitView {
  id: string;
  entityId: string;
  entityCode: string;
  departmentId: string;
  departmentName: string;
  name: string;
  code: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  rowVersion: number;
}

export interface HrPositionView {
  id: string;
  entityId: string;
  entityCode: string;
  departmentId: string | null;
  departmentName: string | null;
  title: string;
  grade: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  rowVersion: number;
}

export interface HrEmployeeListItemView {
  id: string;
  referenceNumber: string;
  name: string;
  entityId: string;
  entityCode: string;
  departmentName: string | null;
  unitName: string | null;
  positionTitle: string | null;
  grade: string | null;
  status: HrEmployeeStatus;
  employmentType: HrEmploymentType;
}

export interface HrEmployeeView extends HrEmployeeListItemView {
  firstName: string;
  lastName: string;
  otherNames: string | null;
  gender: string | null;
  dateEmployed: string | null;
  reportingManagerId: string | null;
  reportingManagerName: string | null;
  departmentId: string | null;
  unitId: string | null;
  positionId: string | null;
  photoDocumentId: string | null;
  edmsFolderId: string | null;
  workEmail: string | null;
  workPhone: string | null;
  personalEmail: string | null;
  personalPhone: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  salaryKobo: number | null;
  rowVersion: number;
  assignments: HrAssignmentView[];
}

export interface HrAssignmentView {
  id: string;
  entityCode: string;
  departmentName: string | null;
  unitName: string | null;
  positionTitle: string | null;
  effectiveOn: string;
  endedOn: string | null;
  kind: string;
}

export interface HrChangeView {
  id: string;
  employeeId: string;
  employeeName: string;
  kind: HrChangeKind;
  status: HrChangeStatus;
  effectiveOn: string;
  reason: string;
  fromDepartmentId: string | null;
  toDepartmentId: string | null;
  fromUnitId: string | null;
  toUnitId: string | null;
  fromPositionId: string | null;
  toPositionId: string | null;
  workflowInstanceId: string | null;
  rowVersion: number;
}

export interface HrVacancyView {
  id: string;
  referenceNumber: string;
  entityId: string;
  entityCode: string;
  title: string;
  departmentId: string | null;
  unitId: string | null;
  positionId: string | null;
  status: HrVacancyStatus;
  headcount: number;
  workflowInstanceId: string | null;
  rowVersion: number;
}

export interface HrApplicantView {
  id: string;
  vacancyId: string;
  name: string;
  email: string | null;
  stage: string;
  score: number | null;
  employeeId: string | null;
}

export interface HrOfferView {
  id: string;
  vacancyId: string;
  applicantId: string;
  status: HrOfferStatus;
  salaryKobo: number | null;
  workflowInstanceId: string | null;
}

export interface HrLeaveTypeView {
  id: string;
  key: string;
  name: string;
  daysPerYear: number;
  paid: boolean;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface HrLeaveRequestView {
  id: string;
  referenceNumber: string;
  employeeId: string;
  employeeName: string;
  typeKey: string;
  typeName: string;
  startsOn: string;
  endsOn: string;
  days: number;
  status: HrLeaveStatus;
  reason: string | null;
  entityCode: string;
  workflowInstanceId: string | null;
  rowVersion: number;
}

export interface HrLeaveBalanceView {
  employeeId: string;
  typeKey: string;
  typeName: string;
  entitled: number;
  taken: number;
  remaining: number;
  year: number;
}

export interface HrHolidayView {
  id: string;
  name: string;
  observedOn: string;
  entityId: string | null;
}

export interface HrAttendanceView {
  id: string;
  employeeId: string;
  employeeName: string;
  entityCode: string;
  workDate: string;
  kind: HrAttendanceKind;
  minutesLate: number;
  hoursWorked: number | null;
  notes: string | null;
}

export interface HrOvertimeView {
  id: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  hours: number;
  status: HrOvertimeStatus;
  reason: string | null;
  workflowInstanceId: string | null;
  rowVersion: number;
}

export interface HrImportBatchView {
  id: string;
  fileName: string;
  importedAt: string;
  accepted: number;
  flagged: number;
  errors: Array<{ line: number; message: string }>;
}

export interface HrCycleView {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  status: string;
}

export interface HrAppraisalView {
  id: string;
  employeeId: string;
  employeeName: string;
  cycleId: string;
  cycleName: string;
  rating: string | null;
  summary: string | null;
  status: HrAppraisalStatus;
  workflowInstanceId: string | null;
  rowVersion: number;
}

export interface HrDiscEventView {
  id: string;
  kind: string;
  body: string;
  outcome: HrDiscOutcome | null;
  actorName: string;
  occurredAt: string;
}

export interface HrDisciplinaryView {
  id: string;
  referenceNumber: string;
  employeeId: string;
  employeeName: string;
  entityId: string;
  entityCode: string;
  departmentName: string | null;
  unitName: string | null;
  category: string;
  incidentOn: string;
  reportedOn: string;
  description: string;
  status: HrDiscStatus;
  outcome: HrDiscOutcome | null;
  handlerUserId: string | null;
  workflowInstanceId: string | null;
  rowVersion: number;
  events: HrDiscEventView[];
}

export interface HrTrainingParticipantView {
  employeeId: string;
  employeeName: string;
  attendance: string;
  completed: boolean;
  assessment: string | null;
  hours: number | null;
  certificateExpiresOn: string | null;
}

export interface HrTrainingView {
  id: string;
  referenceNumber: string;
  title: string;
  category: string;
  entityId: string;
  entityCode: string;
  startsOn: string | null;
  endsOn: string | null;
  status: HrTrainingStatus;
  provider: string | null;
  internal: boolean;
  estimatedCostKobo: number | null;
  actualCostKobo: number | null;
  expenseEntryId: string | null;
  rowVersion: number;
  participants: HrTrainingParticipantView[];
}

export interface HrDashboardView {
  headcount: number;
  byEntity: Array<{ entityCode: string; count: number }>;
  pendingLeave: number;
  openDisciplinary: number;
  upcomingTraining: number;
  openVacancies: number;
  overdueTraining: number;
  pendingPayroll: number;
}

export const HR_SENSITIVE_FIELDS = [
  'personalEmail',
  'personalPhone',
  'emergencyName',
  'emergencyPhone',
  'bankName',
  'bankAccountName',
  'bankAccountNumber',
  'salaryKobo',
] as const;

export const ME_NAV_PERMISSIONS = ['self.workspace'] as const satisfies readonly PermissionKey[];

export interface StaffInvitePreview {
  email: string;
  firstName: string;
  lastName: string;
  expiresAt: string;
}

export interface StaffInviteView {
  id: string;
  employeeId: string;
  email: string;
  status: 'ISSUED' | 'REGISTERED' | 'APPROVED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
}

export interface MeProfileView {
  employeeId: string;
  referenceNumber: string;
  name: string;
  entityCode: string;
  departmentName: string | null;
  positionTitle: string | null;
  workEmail: string | null;
  workPhone: string | null;
  otherNames: string | null;
  gender: string | null;
  personalEmail: string | null;
  personalPhone: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  rowVersion: number;
}

export interface DirectoryEntryView {
  employeeId: string;
  name: string;
  positionTitle: string | null;
  departmentName: string | null;
  departmentId: string | null;
  entityCode: string;
  workEmail: string | null;
  workPhone: string | null;
  userId: string | null;
}

export interface NoticeView {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  publishAt: string | null;
  read: boolean;
  status?: string;
}

export interface ComplaintView {
  id: string;
  referenceNumber: string;
  category: string;
  subject: string;
  body: string;
  anonymous: boolean;
  status: string;
  createdAt: string;
  rowVersion: number;
}

export interface ConversationView {
  id: string;
  kind: 'DIRECT' | 'GROUP' | 'DEPARTMENT';
  title: string;
  unread: number;
}

export interface MessageView {
  id: string;
  senderUserId: string;
  senderName: string;
  body: string;
  createdAt: string;
}
