import type { PermissionKey } from './permissions';

export const WORKFLOW_ACTIONS = [
  'APPROVE',
  'REJECT',
  'RETURN_FOR_CORRECTION',
  'ARCHIVE',
  'RESTORE',
] as const;

export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

export function isWorkflowAction(value: string): value is WorkflowAction {
  return (WORKFLOW_ACTIONS as readonly string[]).includes(value);
}

export const WORKFLOW_REASON_ACTIONS: readonly WorkflowAction[] = [
  'REJECT',
  'RETURN_FOR_CORRECTION',
  'ARCHIVE',
  'RESTORE',
];

export function workflowActionRequiresReason(action: WorkflowAction): boolean {
  return WORKFLOW_REASON_ACTIONS.includes(action);
}

export const WORKFLOW_INSTANCE_STATUSES = [
  'IN_PROGRESS',
  'DRAFT',
  'REJECTED',
  'ARCHIVED',
  'COMPLETED',
] as const;

export type WorkflowInstanceStatus = (typeof WORKFLOW_INSTANCE_STATUSES)[number];

export const WORKFLOW_SCOPE_RESOLVERS = ['SAME_ENTITY', 'CORPORATE', 'ALL', 'NAMED_ASSIGNEE'] as const;
export type WorkflowScopeResolver = (typeof WORKFLOW_SCOPE_RESOLVERS)[number];

export const WORKFLOW_SUBJECT_TYPES = [
  'DEMO_PROCUREMENT',
  'VENDOR',
  'PROCUREMENT',
  'CLOSE_SHORT',
  'JOURNAL',
  'BUDGET',
  'INCOME',
  'EXPENSE',
  'BILL',
  'INVENTORY_ADJUSTMENT',
  'INVENTORY_TRANSFER',
  'PRODUCTION_ORDER',
  'SALES_ORDER',
  'EDMS_DOCUMENT',
  'HR_CHANGE',
  'HR_LEAVE',
  'HR_OVERTIME',
  'HR_PERFORMANCE',
  'HR_DISCIPLINARY',
  'PAYROLL_RUN',
] as const;
export type WorkflowSubjectType = (typeof WORKFLOW_SUBJECT_TYPES)[number];

/** Nav / pending-page gate: any of these means the actor may open Workflows. */
export const WORKFLOW_NAV_PERMISSIONS: readonly PermissionKey[] = [
  'requisition.create',
  'requisition.approve.need',
  'procurement.create',
  'procurement.prepare',
  'procurement.approve.operations',
  'procurement.approve.final',
  'procurement.review.finance',
  'finance.payment.execute',
  'workflow.archive',
  'workflow.restore',
  'vendor.activate',
  'procurement.view',
  'finance.journal.prepare',
  'finance.journal.approve',
  'finance.budget.prepare',
  'finance.budget.approve',
  'finance.expense.manage',
  'finance.expense.approve',
  'finance.income.manage',
  'finance.payables.manage',
  'inventory.adjust.approve',
  'inventory.adjust.prepare',
  'inventory.transfer',
  'production.approve',
  'production.complete',
  'sales.order.approve',
  'sales.order.create',
  'edms.approve',
  'hr.change.approve',
  'hr.leave.approve',
  'self.leave.request',
  'hr.disciplinary.approve',
  'hr.attendance.manage',
  'hr.performance.manage',
  'payroll.run.approve',
  'payroll.pay',
  'payroll.view',
];

export function hasWorkflowNavPermission(permissions: readonly string[]): boolean {
  return WORKFLOW_NAV_PERMISSIONS.some((key) => permissions.includes(key));
}

export const PROCUREMENT_WORKFLOW_KEY = 'procurement-v1';
export const CLOSE_SHORT_WORKFLOW_KEY = 'close-short-v1';
export const JOURNAL_WORKFLOW_KEY = 'journal-v1';
export const BUDGET_WORKFLOW_KEY = 'budget-v1';
export const INCOME_WORKFLOW_KEY = 'income-v1';
export const EXPENSE_WORKFLOW_KEY = 'expense-v1';
export const BILL_WORKFLOW_KEY = 'bill-v1';
export const INVENTORY_ADJUST_WORKFLOW_KEY = 'inventory-adjust-v1';
export const INVENTORY_TRANSFER_WORKFLOW_KEY = 'inventory-transfer-v1';
export const PRODUCTION_COMPLETE_WORKFLOW_KEY = 'production-complete-v1';
export const SALES_ORDER_WORKFLOW_KEY = 'sales-order-v1';
export const EDMS_DOCUMENT_WORKFLOW_KEY = 'edms-document-v1';
export const HR_CHANGE_WORKFLOW_KEY = 'hr-change-v1';
export const HR_LEAVE_WORKFLOW_KEY = 'hr-leave-v1';
export const HR_LEAVE_WORKFLOW_KEY_V2 = 'hr-leave-v2';
export const HR_OVERTIME_WORKFLOW_KEY = 'hr-overtime-v1';
export const HR_PERFORMANCE_WORKFLOW_KEY = 'hr-performance-v1';
export const HR_DISCIPLINARY_WORKFLOW_KEY = 'hr-disciplinary-md-v1';
export const PAYROLL_RUN_WORKFLOW_KEY = 'payroll-run-v1';
export const DUMMY_WORKFLOW_KEY = 'dummy-v1';
