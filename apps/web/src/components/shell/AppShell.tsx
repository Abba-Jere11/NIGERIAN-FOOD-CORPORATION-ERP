import type { ReactNode } from 'react';
import Link from 'next/link';
import type { MeView } from '@nfc/shared';
import {
  FINANCE_NAV_PERMISSIONS,
  HR_NAV_PERMISSIONS,
  INVENTORY_NAV_PERMISSIONS,
  ME_NAV_PERMISSIONS,
  ORGANIZATION_NAME,
  PROCUREMENT_NAV_PERMISSIONS,
  REQUISITION_NAV_PERMISSIONS,
  VENDOR_NAV_PERMISSIONS,
  WORKFLOW_NAV_PERMISSIONS,
} from '@nfc/shared';
import { NfcLogo } from '@/components/brand/NfcLogo';
import { NotificationsPopover } from './NotificationsPopover';
import { ScanIconLink } from './ScanIconLink';
import { UserMenu } from './UserMenu';
import { FormDirtyProvider } from './FormDirty';
import { SideNav, type NavItem } from './SideNav';

function navItems(
  roleDashboardPath: string,
  workspace: { unreadMessages: number; unreadNotices: number } | null,
): NavItem[] {
  const homeChildren = [
    { href: roleDashboardPath, label: 'Dashboard' },
    ...(roleDashboardPath === '/home' ? [] : [{ href: '/home', label: 'Corporate Home' }]),
  ];
  return [
    {
      id: 'home',
      href: '/home',
      label: 'Home',
      description: 'Dashboard and corporate home',
      permission: null,
      children: homeChildren,
    },
    {
      id: 'procurement',
      href: '/procurement',
      label: 'Procurement',
      description: 'Requests, vendors and deliveries',
      permission: [...PROCUREMENT_NAV_PERMISSIONS, ...REQUISITION_NAV_PERMISSIONS, ...VENDOR_NAV_PERMISSIONS],
      children: [
        { href: '/procurement', label: 'Requests', group: 'Work', permission: PROCUREMENT_NAV_PERMISSIONS },
        { href: '/requisitions', label: 'Requisitions', group: 'Work', permission: REQUISITION_NAV_PERMISSIONS },
        { href: '/vendors', label: 'Vendors', group: 'Work', permission: VENDOR_NAV_PERMISSIONS },
        { href: '/home/inventory/pending', label: 'Pending deliveries', group: 'Goods', permission: 'procurement.verify.delivery' },
        { href: '/home/inventory/shortages', label: 'Shortage tracker', group: 'Goods', permission: 'procurement.verify.delivery' },
        { href: '/home/inventory/history', label: 'Delivery history', group: 'Goods', permission: 'procurement.verify.delivery' },
      ],
    },
    {
      id: 'inventory',
      href: '/inventory',
      label: 'Inventory',
      description: 'Stock, warehouses and movements',
      permission: INVENTORY_NAV_PERMISSIONS,
      children: [
        { href: '/inventory', label: 'Dashboard', group: 'Overview' },
        { href: '/inventory/desk', label: 'Operations Desk', group: 'Overview' },
        { href: '/inventory/scan', label: 'Scan lookup', group: 'Overview' },
        { href: '/inventory/items', label: 'Stock Register', group: 'Stock Management' },
        { href: '/inventory/categories', label: 'Categories', group: 'Stock Management' },
        { href: '/inventory/warehouses', label: 'Warehouses', group: 'Stock Management' },
        { href: '/inventory/batches', label: 'Batches', group: 'Stock Management' },
        { href: '/inventory/assets', label: 'Assets', group: 'Stock Management' },
        { href: '/inventory/expected', label: 'Expected', group: 'Operations' },
        { href: '/inventory/receipts', label: 'Goods received', group: 'Operations' },
        { href: '/inventory/qc', label: 'QC', group: 'Operations' },
        { href: '/inventory/issues', label: 'Issues', group: 'Operations' },
        { href: '/inventory/transfers', label: 'Transfers', group: 'Operations' },
        { href: '/inventory/returns', label: 'Returns', group: 'Operations' },
        { href: '/inventory/production', label: 'Production', group: 'Operations' },
        { href: '/inventory/sales', label: 'Sales', group: 'Operations' },
        { href: '/inventory/sales/dispatches', label: 'Dispatches', group: 'Operations' },
        { href: '/inventory/sales/invoices', label: 'Invoices', group: 'Operations' },
        { href: '/inventory/counts', label: 'Counts', group: 'Records' },
        { href: '/inventory/adjustments', label: 'Adjustments', group: 'Records' },
        { href: '/inventory/movements', label: 'Ledger', group: 'Records' },
        { href: '/inventory/alerts', label: 'Alerts', group: 'Records' },
        { href: '/inventory/reports', label: 'Inventory reports', group: 'Records' },
      ],
    },
    {
      id: 'finance',
      href: '/finance',
      label: 'Finance',
      description: 'Chart, ledger, bank and budgets',
      permission: FINANCE_NAV_PERMISSIONS,
      children: [
        { href: '/finance', label: 'Overview', group: 'Overview' },
        { href: '/finance/bank', label: 'Bank', group: 'Money' },
        { href: '/finance/income', label: 'Income', group: 'Money' },
        { href: '/finance/expenses', label: 'Expenses', group: 'Money' },
        { href: '/finance/customers', label: 'Customers', group: 'Money' },
        { href: '/finance/receivables', label: 'Receivables', group: 'Money' },
        { href: '/finance/payables', label: 'Payables', group: 'Money' },
        { href: '/finance/budgets', label: 'Budgets', group: 'Control' },
        { href: '/finance/intercompany', label: 'Inter-company', group: 'Control' },
        { href: '/finance/coa', label: 'Chart', group: 'Accounting' },
        { href: '/finance/journals', label: 'Journals', group: 'Accounting' },
        { href: '/finance/ledger', label: 'Ledger', group: 'Accounting' },
        { href: '/finance/trial-balance', label: 'Trial balance', group: 'Accounting' },
        { href: '/finance/periods', label: 'Periods', group: 'Accounting' },
        { href: '/finance/reports', label: 'Reports', group: 'Reports' },
        { href: '/finance/reports/integrity', label: 'Integrity', group: 'Integrity' },
      ],
    },
    {
      id: 'workspace',
      href: '/me',
      label: 'Workspace',
      description: 'Staff workspace, HR and queues',
      permission: [...ME_NAV_PERMISSIONS, ...HR_NAV_PERMISSIONS, ...WORKFLOW_NAV_PERMISSIONS, 'cases.view'],
      badge: workspace ? workspace.unreadMessages + workspace.unreadNotices : 0,
      children: [
        { href: '/me', label: 'Home', group: 'Staff workspace', permission: 'self.workspace' },
        { href: '/me/profile', label: 'Profile', group: 'Staff workspace', permission: 'self.workspace' },
        { href: '/me/attendance', label: 'Attendance', group: 'Staff workspace', permission: 'self.workspace' },
        { href: '/me/payslips', label: 'Payslips', group: 'Staff workspace', permission: 'self.payslip.view' },
        { href: '/me/leave', label: 'Leave', group: 'Staff workspace', permission: 'self.leave.request' },
        { href: '/me/relief-requests', label: 'Relief requests', group: 'Staff workspace', permission: 'self.workspace' },
        {
          href: '/me/notices',
          label: workspace?.unreadNotices ? `Notices (${workspace.unreadNotices})` : 'Notices',
          group: 'Staff workspace',
          permission: 'notice.view',
        },
        { href: '/me/complaints', label: 'Contact HR', group: 'Staff workspace', permission: 'complaint.submit' },
        {
          href: '/me/messages',
          label: workspace?.unreadMessages ? `Messages (${workspace.unreadMessages})` : 'Messages',
          group: 'Staff workspace',
          permission: 'message.use',
        },
        { href: '/me/directory', label: 'Directory', group: 'Staff workspace', permission: 'directory.view' },
        { href: '/home/hr', label: 'HR dashboard', group: 'HR', permission: 'hr.employee.view' },
        { href: '/hr/employees', label: 'Employees', group: 'HR', permission: 'hr.employee.view' },
        { href: '/hr/access', label: 'Access approvals', group: 'HR', permission: 'hr.invite.manage' },
        { href: '/hr/notices', label: 'HR notices', group: 'HR', permission: 'notice.manage' },
        { href: '/hr/complaints', label: 'Complaints', group: 'HR', permission: 'complaint.manage' },
        { href: '/hr/recruitment', label: 'Recruitment', group: 'HR', permission: 'hr.recruitment.manage' },
        { href: '/hr/leave', label: 'Leave admin', group: 'HR', permission: 'hr.leave.approve' },
        { href: '/hr/attendance', label: 'Attendance admin', group: 'HR', permission: 'hr.attendance.manage' },
        { href: '/hr/performance', label: 'Performance', group: 'HR', permission: 'hr.performance.manage' },
        { href: '/hr/disciplinary', label: 'Disciplinary', group: 'HR', permission: 'hr.disciplinary.view' },
        { href: '/hr/training', label: 'Training', group: 'HR', permission: 'hr.training.view' },
        { href: '/hr/payroll', label: 'Payroll', group: 'HR', permission: 'payroll.view' },
        { href: '/notifications', label: 'Inbox', group: 'Queues' },
        { href: '/workflows', label: 'Workflows', group: 'Queues', permission: WORKFLOW_NAV_PERMISSIONS },
        { href: '/workflows/overdue', label: 'Overdue', group: 'Queues', permission: 'oversight.overdue.view' },
        { href: '/cases', label: 'Cases', group: 'Queues', permission: 'cases.view' },
      ],
    },
    {
      id: 'reports',
      href: '/reports',
      label: 'Reports',
      description: 'Operational reports and official correspondence',
      permission: null,
      children: [
        { href: '/reports', label: 'Operational hub', group: 'Operational' },
        { href: '/procurement/reports', label: 'Procurement', group: 'Operational', permission: 'procurement.report.view' },
        { href: '/finance/reports', label: 'Finance', group: 'Operational', permission: 'finance.view' },
        { href: '/inventory/reports', label: 'Inventory', group: 'Operational', permission: 'inventory.view' },
        { href: '/hr/reports', label: 'Human resources', group: 'Operational', permission: 'hr.employee.view' },
        { href: '/org-reports', label: 'Official dashboard', group: 'Official', permission: 'org_report.view' },
        { href: '/org-reports/new', label: 'Create report', group: 'Official', permission: 'org_report.create' },
        { href: '/org-reports/mine', label: 'My reports', group: 'Official', permission: 'org_report.view' },
        { href: '/org-reports/information', label: 'Received for information', group: 'Official', permission: 'org_report.view' },
        { href: '/org-reports/minutes', label: 'Assigned minutes', group: 'Official', permission: 'org_report.minute.respond' },
        { href: '/org-reports/responses/mine', label: 'My responses', group: 'Official', permission: 'org_report.minute.respond' },
        { href: '/org-reports/incoming', label: 'Incoming reports', group: 'Official', permission: 'org_report.forward' },
        { href: '/org-reports/forwarded', label: 'Forwarded reports', group: 'Official', permission: 'org_report.forward' },
        { href: '/org-reports/minutes/issued', label: 'Official minutes', group: 'Official', permission: 'org_report.minute.issue' },
        { href: '/org-reports/responses', label: 'Responses awaiting review', group: 'Official', permission: 'org_report.minute.review' },
        { href: '/org-reports/decisions', label: 'Management decisions', group: 'Official', permission: 'org_report.decide' },
        { href: '/org-reports/correspondence', label: 'External correspondence', group: 'Official', permission: 'org_report.email' },
        { href: '/org-reports/search', label: 'Search / records', group: 'Official', permission: 'org_report.view' },
        { href: '/org-reports/admin/templates', label: 'Templates', group: 'Official', permission: 'org_report.template.manage' },
      ],
    },
    {
      id: 'administration',
      href: '/admin/users',
      label: 'Administration',
      description: 'Users, roles and audit',
      permission: [
        'admin.user.manage',
        'organization.entity.manage',
        'admin.session.revoke',
        'admin.permission_log.view',
        'admin.health.view',
        'audit.view',
      ],
      children: [
        { href: '/admin/users', label: 'Users', group: 'Access', permission: 'admin.user.manage' },
        { href: '/admin/roles', label: 'Roles', group: 'Access', permission: 'admin.user.manage' },
        { href: '/admin/entities', label: 'Entities', group: 'Access', permission: 'organization.entity.manage' },
        { href: '/admin/sessions', label: 'Sessions', group: 'Access', permission: 'admin.session.revoke' },
        { href: '/admin/permission-log', label: 'Permission log', group: 'Access', permission: 'admin.permission_log.view' },
        { href: '/admin/health', label: 'Health', group: 'System', permission: 'admin.health.view' },
        { href: '/audit', label: 'Audit log', group: 'System', permission: 'audit.view' },
      ],
    },
  ];
}

export function AppShell({
  me,
  unreadCount,
  workspace = null,
  children,
}: {
  me: MeView;
  unreadCount: number;
  workspace?: { unreadMessages: number; unreadNotices: number } | null;
  children: ReactNode;
}) {
  return (
    <FormDirtyProvider>
      <div className="flex h-screen flex-col overflow-hidden">
        <header className="app-top-bar z-30 shrink-0 border-b border-accent-900 bg-accent-700">
          <div className="flex items-center gap-3 px-4 py-2">
            <Link href="/home" className="flex shrink-0 items-center gap-2 leading-tight">
              <NfcLogo size="sm" className="rounded-full bg-white/95 p-0.5" />
              <span>
                <span className="block text-[13px] font-semibold uppercase tracking-wide text-white">
                  {ORGANIZATION_NAME}
                </span>
                <span className="block text-[10px] uppercase tracking-wider text-white/70">
                  Internal management system
                </span>
              </span>
            </Link>
            <form action="/search" method="get" className="mx-auto hidden w-full max-w-md md:block">
              <label className="sr-only" htmlFor="global-search">
                Global search
              </label>
              <input
                id="global-search"
                name="q"
                type="search"
                placeholder="Search reference, vendor, amount"
                aria-label="Global search"
                className="h-8 w-full border border-white/20 bg-accent-800 px-2 text-[12px] text-white placeholder:text-white/50"
              />
            </form>
            {me.permissions.includes('inventory.view') ? <ScanIconLink /> : null}
            <NotificationsPopover initialUnread={unreadCount} />
            <UserMenu me={me} />
          </div>
        </header>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <SideNav items={navItems(me.homePath, workspace)} permissions={me.permissions} />
          <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5">{children}</main>
        </div>
      </div>
    </FormDirtyProvider>
  );
}
