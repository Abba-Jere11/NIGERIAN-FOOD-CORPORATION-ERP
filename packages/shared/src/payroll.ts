import type { PermissionKey } from './permissions';

export const PAYROLL_RUN_STATUSES = [
  'DRAFT',
  'CALCULATED',
  'SUBMITTED',
  'APPROVED',
  'LOCKED',
  'PAID',
  'REVERSED',
] as const;
export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];

export const PAYROLL_STRUCTURE_STATUSES = ['DRAFT', 'CONFIRMED', 'SUPERSEDED'] as const;
export type PayrollStructureStatus = (typeof PAYROLL_STRUCTURE_STATUSES)[number];

export const PAYROLL_REMITTANCE_STATUSES = ['UNREMITTED', 'REMITTED'] as const;
export type PayrollRemittanceStatus = (typeof PAYROLL_REMITTANCE_STATUSES)[number];

export const PAYROLL_REMITTANCE_KINDS = ['PAYE', 'PENSION', 'OTHER'] as const;
export type PayrollRemittanceKind = (typeof PAYROLL_REMITTANCE_KINDS)[number];

export const PAYROLL_NAV_PERMISSIONS: readonly PermissionKey[] = [
  'payroll.view',
  'payroll.run.prepare',
  'payroll.run.approve',
  'payroll.pay',
];

export function hasPayrollNavPermission(permissions: readonly string[]): boolean {
  return PAYROLL_NAV_PERMISSIONS.some((key) => permissions.includes(key));
}

export interface PayrollComponent {
  key: string;
  label: string;
  amountKobo: number;
}

export interface PayrollPayeBandView {
  id: string;
  effectiveOn: string;
  fromKobo: number;
  toKobo: number | null;
  rateBps: number;
}

export interface PayrollPensionRateView {
  id: string;
  effectiveOn: string;
  employeeBps: number;
  employerBps: number;
}

export interface PayrollStatutoryView {
  id: string;
  key: string;
  name: string;
  effectiveOn: string;
  rateBps: number | null;
  amountKobo: number | null;
}

export interface PayrollSettingsView {
  id: string;
  edFinanceThresholdKobo: number;
  overtimeMultiplierBps: number;
  includeSuspended: boolean;
  unpaidLeaveDailyDivisor: number;
  rowVersion: number;
}

export interface PayrollStructureView {
  id: string;
  employeeId: string | null;
  employeeName: string | null;
  gradeKey: string | null;
  entityId: string;
  entityCode: string | null;
  basicKobo: number;
  allowances: PayrollComponent[];
  overtimeRule: string | null;
  effectiveOn: string;
  supersedesId: string | null;
  status: PayrollStructureStatus;
  rowVersion: number;
}

export interface PayrollLoanView {
  id: string;
  employeeId: string;
  employeeName: string | null;
  entityId: string;
  principalKobo: number;
  remainingKobo: number;
  installmentKobo: number;
  startsOn: string;
  status: string;
}

export interface PayrollExceptionView {
  code: string;
  message: string;
  employeeId?: string;
}

export interface PayrollRunLineView {
  id: string;
  employeeId: string;
  employeeName: string | null;
  employeeNumber: string | null;
  basicKobo: number | null;
  allowancesKobo: number | null;
  overtimeKobo: number | null;
  unpaidLeaveKobo: number | null;
  loanKobo: number | null;
  payeKobo: number | null;
  pensionEmployeeKobo: number | null;
  pensionEmployerKobo: number | null;
  otherStatutoryKobo: number | null;
  grossKobo: number | null;
  netKobo: number | null;
  exceptions: PayrollExceptionView[];
}

export interface PayrollRunView {
  id: string;
  referenceNumber: string;
  entityId: string;
  entityCode: string | null;
  fiscalPeriodId: string;
  periodName: string | null;
  periodEndsOn: string | null;
  status: PayrollRunStatus;
  workflowInstanceId: string | null;
  employeeCount: number;
  grossKobo: number;
  netKobo: number;
  payeKobo: number;
  pensionEmployeeKobo: number;
  pensionEmployerKobo: number;
  exceptions: PayrollExceptionView[];
  lines: PayrollRunLineView[];
  rowVersion: number;
}

export interface PayrollRunListItemView {
  id: string;
  referenceNumber: string;
  entityId: string;
  entityCode: string | null;
  periodName: string | null;
  status: PayrollRunStatus;
  employeeCount: number;
  netKobo: number | null;
  exceptionCount: number;
}

export interface PayrollPayslipView {
  id: string;
  runId: string;
  employeeId: string;
  documentId: string;
  referenceNumber: string;
}

export interface PayrollPaymentBatchView {
  id: string;
  runId: string;
  evidenceDocumentId: string | null;
  bankFileName: string | null;
  journalId: string | null;
  paidAt: string | null;
}

export interface PayrollRemittanceView {
  id: string;
  runId: string;
  kind: PayrollRemittanceKind;
  amountKobo: number;
  status: PayrollRemittanceStatus;
  evidenceDocumentId: string | null;
}

export interface PayrollDashboardView {
  calculated: number;
  submitted: number;
  lockedUnpaid: number;
  unremitted: number;
}

export interface PayrollHrReportView {
  periodLabel: string;
  headcountByEntity: Array<{ entityCode: string; count: number }>;
  openVacancies: number;
  leaveDaysInPeriod: number;
  snapshotAt: string;
}

export interface PayrollOrgSnapshot {
  kind: 'hr_staff' | 'payroll';
  stampedAt: string;
  periodLabel: string;
  headcountByEntity?: Array<{ entityCode: string; count: number }>;
  openVacancies?: number;
  leaveDaysInPeriod?: number;
  grossKobo?: number;
  netKobo?: number;
  payeKobo?: number;
  pensionKobo?: number;
  varianceVsPriorNetKobo?: number | null;
  runReference?: string | null;
}
