import type { ReactNode } from 'react';
import Link from 'next/link';
import type { MeView } from '@nfc/shared';
import {
  FINANCE_NAV_PERMISSIONS,
  HR_NAV_PERMISSIONS,
  INVENTORY_NAV_PERMISSIONS,
  ME_NAV_PERMISSIONS,
  ORGANIZATION_NAME,
  ORG_REPORT_NAV_PERMISSIONS,
  PROCUREMENT_NAV_PERMISSIONS,
  REQUISITION_NAV_PERMISSIONS,
  VENDOR_NAV_PERMISSIONS,
  WORKFLOW_NAV_PERMISSIONS,
} from '@nfc/shared';
import { NfcLogo } from '@/components/brand/NfcLogo';
import { NotificationsPopover } from './NotificationsPopover';
import { UserMenu } from './UserMenu';
import { SideNav, type NavItem } from './SideNav';

function navItems(
  roleDashboardPath: string,
  workspace: { unreadMessages: number; unreadNotices: number } | null,
): NavItem[] {
  const items: NavItem[] = [
    { href: '/home', label: 'Corporate home', description: 'Group summary and subsidiaries', permission: null, exact: true },
    {
      href: roleDashboardPath,
      label: 'My dashboard',
      description: 'Role-specific queues and tiles',
      permission: null,
      exact: true,
    },
    {
      href: '/home/inventory/pending',
      label: 'Pending deliveries',
      description: 'Goods not yet received',
      permission: 'procurement.verify.delivery',
    },
    {
      href: '/home/inventory/shortages',
      label: 'Shortage tracker',
      description: 'Partial receipts with remainder',
      permission: 'procurement.verify.delivery',
    },
    {
      href: '/home/inventory/history',
      label: 'Delivery history',
      description: 'Delivered and paid requests',
      permission: 'procurement.verify.delivery',
    },
    {
      href: '/cases',
      label: 'Cases',
      description: 'Confidential case register',
      permission: 'cases.view',
    },
    {
      href: '/vendors',
      label: 'Vendors',
      description: 'Group vendor register',
      permission: VENDOR_NAV_PERMISSIONS,
    },
    {
      href: '/requisitions',
      label: 'Requisitions',
      description: 'Need requests before pricing',
      permission: REQUISITION_NAV_PERMISSIONS,
    },
    {
      href: '/procurement',
      label: 'Procurement',
      description: 'Structured requests and memos',
      permission: PROCUREMENT_NAV_PERMISSIONS,
    },
    {
      href: '/reports',
      label: 'Reports',
      description: 'Operational and financial reports',
      permission: null,
    },
    {
      href: '/org-reports',
      label: 'Official reports',
      description: 'Correspondence to the Managing Director',
      permission: ORG_REPORT_NAV_PERMISSIONS,
      children: [
        { href: '/org-reports', label: 'Dashboard', group: 'Work', permission: 'org_report.view' },
        { href: '/org-reports/new', label: 'Create report', group: 'Work', permission: 'org_report.create' },
        { href: '/org-reports/mine', label: 'My reports', group: 'Work', permission: 'org_report.view' },
        { href: '/org-reports/information', label: 'Received for information', group: 'Work', permission: 'org_report.view' },
        { href: '/org-reports/minutes', label: 'Assigned minutes', group: 'Work', permission: 'org_report.minute.respond' },
        { href: '/org-reports/responses/mine', label: 'My responses', group: 'Work', permission: 'org_report.minute.respond' },
        { href: '/notifications', label: 'Notifications', group: 'Work', permission: 'org_report.view' },
        { href: '/org-reports/incoming', label: 'Incoming reports', group: 'Management', permission: 'org_report.forward' },
        { href: '/org-reports/forwarded', label: 'Forwarded reports', group: 'Management', permission: 'org_report.forward' },
        { href: '/org-reports/minutes/issued', label: 'Official minutes', group: 'Management', permission: 'org_report.minute.issue' },
        { href: '/org-reports/responses', label: 'Responses awaiting review', group: 'Management', permission: 'org_report.minute.review' },
        { href: '/org-reports/decisions', label: 'Management decisions', group: 'Management', permission: 'org_report.decide' },
        { href: '/org-reports/correspondence', label: 'External correspondence', group: 'Management', permission: 'org_report.email' },
        { href: '/org-reports/search', label: 'Search / records', group: 'Records', permission: 'org_report.view' },
        { href: '/org-reports/admin/templates', label: 'Templates', group: 'Administration', permission: 'org_report.template.manage' },
      ],
    },
    {
      href: '/home/hr',
      label: 'HR',
      description: 'People, leave, attendance and training',
      permission: HR_NAV_PERMISSIONS,
      children: [
        { href: '/home/hr', label: 'Dashboard', group: 'Overview', permission: 'hr.employee.view' },
        { href: '/hr/employees', label: 'Employees', group: 'People', permission: 'hr.employee.view' },
        { href: '/hr/access', label: 'Access approvals', group: 'People', permission: 'hr.invite.manage' },
        { href: '/hr/notices', label: 'Notices', group: 'People', permission: 'notice.manage' },
        { href: '/hr/complaints', label: 'Complaints', group: 'People', permission: 'complaint.manage' },
        { href: '/hr/recruitment', label: 'Recruitment', group: 'People', permission: 'hr.recruitment.manage' },
        { href: '/hr/leave', label: 'Leave', group: 'Time', permission: 'hr.leave.approve' },
        { href: '/hr/attendance', label: 'Attendance', group: 'Time', permission: 'hr.attendance.manage' },
        { href: '/hr/performance', label: 'Performance', group: 'Development', permission: 'hr.performance.manage' },
        { href: '/hr/disciplinary', label: 'Disciplinary', group: 'Confidential', permission: 'hr.disciplinary.view' },
        { href: '/hr/training', label: 'Training', group: 'Development', permission: 'hr.training.view' },
        { href: '/hr/payroll', label: 'Payroll', group: 'Pay', permission: 'payroll.view' },
        { href: '/hr/reports', label: 'Reports', group: 'Pay', permission: 'hr.employee.view' },
      ],
    },
    {
      href: '/me',
      label: 'My workspace',
      description:
        workspace && workspace.unreadMessages + workspace.unreadNotices > 0
          ? `${workspace.unreadNotices} unread notices, ${workspace.unreadMessages} unread messages`
          : 'Leave, notices, messages and directory',
      permission: ME_NAV_PERMISSIONS,
      badge: workspace ? workspace.unreadMessages + workspace.unreadNotices : 0,
      children: [
        { href: '/me', label: 'Home', group: 'Me', permission: 'self.workspace' },
        { href: '/me/profile', label: 'Profile', group: 'Me', permission: 'self.workspace' },
        { href: '/me/attendance', label: 'Attendance', group: 'Me', permission: 'self.workspace' },
        { href: '/me/payslips', label: 'Payslips', group: 'Me', permission: 'self.payslip.view' },
        { href: '/me/leave', label: 'Leave', group: 'Time', permission: 'self.leave.request' },
        { href: '/me/relief-requests', label: 'Relief requests', group: 'Time', permission: 'self.workspace' },
        {
          href: '/me/notices',
          label: workspace?.unreadNotices ? `Notices (${workspace.unreadNotices})` : 'Notices',
          group: 'Board',
          permission: 'notice.view',
        },
        { href: '/me/complaints', label: 'Contact HR', group: 'Board', permission: 'complaint.submit' },
        {
          href: '/me/messages',
          label: workspace?.unreadMessages ? `Messages (${workspace.unreadMessages})` : 'Messages',
          group: 'People',
          permission: 'message.use',
        },
        { href: '/me/directory', label: 'Directory', group: 'People', permission: 'directory.view' },
      ],
    },
    {
      href: '/inventory',
      label: 'Inventory',
      description: 'Stock, warehouses and movements',
      permission: INVENTORY_NAV_PERMISSIONS,
      children: [
        { href: '/inventory', label: 'Dashboard', group: 'Overview' },
        { href: '/inventory/items', label: 'Item catalogue', group: 'Master data' },
        { href: '/inventory/categories', label: 'Categories', group: 'Master data' },
        { href: '/inventory/warehouses', label: 'Warehouses', group: 'Master data' },
        { href: '/inventory/expected', label: 'Expected stock', group: 'Operations' },
        { href: '/inventory/receipts', label: 'Receipts', group: 'Operations' },
        { href: '/home/inventory/pending', label: 'Delivery verification', group: 'Operations' },
        { href: '/inventory/issues', label: 'Issues', group: 'Operations' },
        { href: '/inventory/transfers', label: 'Transfers', group: 'Operations' },
        { href: '/inventory/production', label: 'Production', group: 'Operations' },
        { href: '/inventory/sales', label: 'Sales', group: 'Operations' },
        { href: '/inventory/sales/dispatches', label: 'Dispatches', group: 'Operations' },
        { href: '/inventory/sales/invoices', label: 'Invoices', group: 'Operations' },
        { href: '/inventory/counts', label: 'Stocktaking', group: 'Control' },
        { href: '/inventory/adjustments', label: 'Damaged and expired', group: 'Control' },
        { href: '/inventory/movements', label: 'Movement ledger', group: 'Control' },
        { href: '/inventory/alerts', label: 'Alerts', group: 'Control' },
        { href: '/inventory/reports', label: 'Reports', group: 'Reporting' },
      ],
    },
    {
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
      href: '/workflows',
      label: 'Workflows',
      description: 'Approvals waiting for you',
      permission: WORKFLOW_NAV_PERMISSIONS,
    },
    {
      href: '/workflows/overdue',
      label: 'Overdue',
      description: 'Holds past two days',
      permission: 'oversight.overdue.view',
    },
    {
      href: '/notifications',
      label: 'Inbox',
      description: 'Notices for you',
      permission: null,
    },
    {
      href: '/admin/users',
      label: 'Users',
      description: 'Accounts and assignments',
      permission: 'admin.user.manage',
    },
    {
      href: '/admin/roles',
      label: 'Roles',
      description: 'Default grants',
      permission: 'admin.user.manage',
    },
    {
      href: '/admin/entities',
      label: 'Entities',
      description: 'Subsidiaries and departments',
      permission: 'organization.entity.manage',
    },
    {
      href: '/admin/sessions',
      label: 'Sessions',
      description: 'Signed-in devices',
      permission: 'admin.session.revoke',
    },
    {
      href: '/admin/permission-log',
      label: 'Permission log',
      description: 'Account and grant changes',
      permission: 'admin.permission_log.view',
    },
    {
      href: '/admin/health',
      label: 'Health',
      description: 'Outbox, mail and counters',
      permission: 'admin.health.view',
    },
    {
      href: '/audit',
      label: 'Audit log',
      description: 'Every action, with its reason',
      permission: 'audit.view',
    },
  ];
  // HR Officer: My dashboard and HR module share /home/hr — keep the module entry only.
  return items.filter((item, index) => {
    if (item.label !== 'My dashboard') return true;
    return !items.some((other, otherIndex) => otherIndex !== index && other.href === item.href);
  });
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
    <div className="min-h-screen">
      <header className="app-top-bar sticky top-0 z-30 border-b border-accent-900 bg-accent-700">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2">
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

          <NotificationsPopover initialUnread={unreadCount} />

          <UserMenu me={me} />
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px] flex-col md:flex-row">
        <SideNav items={navItems(me.homePath, workspace)} permissions={me.permissions} />
        <main className="min-w-0 flex-1 px-4 py-5">{children}</main>
      </div>
    </div>
  );
}
