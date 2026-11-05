import type { PermissionKey } from './permissions';

export interface ReportCategory {
  key: string;
  title: string;
  description: string;
  permission: PermissionKey;
  href: string | null;
  available: boolean;
  unavailableLabel: string | null;
}

export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  {
    key: 'procurement',
    title: 'Procurement',
    description: 'Status, ageing and spend across requests.',
    permission: 'procurement.report.view',
    href: '/procurement/reports',
    available: true,
    unavailableLabel: null,
  },
  {
    key: 'finance',
    title: 'Finance',
    description: 'Statements, trial balance and integrity checks.',
    permission: 'finance.view',
    href: '/finance/reports',
    available: true,
    unavailableLabel: null,
  },
  {
    key: 'inventory',
    title: 'Inventory',
    description: 'Stock on hand, warehouse movement, production and sales.',
    permission: 'inventory.view',
    href: '/inventory/reports',
    available: true,
    unavailableLabel: null,
  },
  {
    key: 'hr',
    title: 'Human resources',
    description: 'Headcount and payroll summaries.',
    permission: 'hr.employee.view',
    href: '/hr/reports',
    available: true,
    unavailableLabel: null,
  },
];

export function visibleReportCategories(
  permissions: readonly PermissionKey[],
): ReportCategory[] {
  return REPORT_CATEGORIES.filter((category) => permissions.includes(category.permission));
}
