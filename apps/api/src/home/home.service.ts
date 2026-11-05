import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { HomePendingLineView, HomeSummaryView } from '@nfc/shared';
import { WORKFLOW_NAV_PERMISSIONS } from '@nfc/shared';
import { can } from '../auth/can';
import { EntityDirectory } from '../auth/entity-directory.service';
import { JobsService } from '../engines/jobs.service';
import { NotificationsService } from '../engines/notifications.service';
import { AccountsService } from '../finance/accounts.service';
import { HrService } from '../hr/hr.service';
import { InventoryService } from '../inventory/inventory.service';
import { ProcurementService } from '../procurement/procurement.service';
import { WorkflowsService } from '../workflows/workflows.service';

@Injectable()
export class HomeService {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly accounts: AccountsService,
    private readonly hr: HrService,
    private readonly inventory: InventoryService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly entities: EntityDirectory,
    private readonly procurement: ProcurementService,
  ) {}

  async summary(actor: ActorContext): Promise<HomeSummaryView> {
    const lines: HomePendingLineView[] = [];
    const businessViewer = this.hasBusinessVisibility(actor);

    if (actor.isAdmin && !businessViewer) {
      const [deadLetters, failedNotificationDeliveries, failedMail] = await Promise.all([
        this.jobs.deadLetters(),
        this.notifications.failedDeliveryCount(actor),
        this.notifications.failedMailCount(actor),
      ]);
      if (deadLetters.length > 0) {
        lines.push({
          key: 'dead-letters',
          label: 'Failed job deliveries',
          count: deadLetters.length,
          href: '/admin/health',
        });
      }
      if (failedNotificationDeliveries > 0) {
        lines.push({
          key: 'failed-notifications',
          label: 'Failed notification deliveries',
          count: failedNotificationDeliveries,
          href: '/admin/health',
        });
      }
      if (failedMail > 0) {
        lines.push({
          key: 'failed-mail',
          label: 'Failed outbound mail',
          count: failedMail,
          href: '/admin/health',
        });
      }
      return {
        roleDashboardPath: actor.homePath ?? '/home/admin',
        pendingTotal: lines.reduce((sum, line) => sum + line.count, 0),
        pendingLines: lines,
        subsidiaries: [],
        adminOps: {
          deadLetterCount: deadLetters.length,
          failedNotificationDeliveries,
          failedMail,
        },
      };
    }

    if (WORKFLOW_NAV_PERMISSIONS.some((permission) => can(actor, permission))) {
      // Procurement steps are counted from the procurement next-action rule below.
      const pending = (await this.workflows.pending(actor)).filter((item) => item.subjectType !== 'PROCUREMENT');
      if (pending.length > 0) {
        lines.push({
          key: 'workflows',
          label: 'Workflow approvals waiting for you',
          count: pending.length,
          href: '/workflows',
        });
      }
    }

    const actions = await this.procurement.myActions(actor);
    const byAction = new Map<string, { label: string; count: number; href: string }>();
    for (const item of actions) {
      const group = byAction.get(item.actionKey);
      if (group) {
        group.count += 1;
        group.href = '#pending-actions';
      } else {
        byAction.set(item.actionKey, {
          label: PROCUREMENT_ACTION_LINE_LABELS[item.actionKey] ?? item.actionLabel,
          count: 1,
          href: item.href,
        });
      }
    }
    for (const [key, group] of byAction) {
      lines.push({ key: `procurement-${key}`, label: group.label, count: group.count, href: group.href });
    }

    if (can(actor, 'finance.view') || can(actor, 'finance.budget.view')) {
      try {
        const queues = await this.accounts.queues(actor);
        if (queues.pendingJournals > 0) {
          lines.push({
            key: 'journals',
            label: 'Journals pending approval',
            count: queues.pendingJournals,
            href: '/finance/journals',
          });
        }
        if (queues.pendingBudgets > 0) {
          lines.push({
            key: 'budgets',
            label: 'Budgets pending approval',
            count: queues.pendingBudgets,
            href: '/finance/budgets',
          });
        }
        if (queues.unreconciledLines > 0 && can(actor, 'finance.view')) {
          lines.push({
            key: 'bank',
            label: 'Unreconciled bank lines',
            count: queues.unreconciledLines,
            href: '/finance/bank',
          });
        }
      } catch {
        // Finance queues unavailable for this actor scope.
      }
    }

    if (can(actor, 'hr.employee.view')) {
      try {
        const dash = await this.hr.dashboard(actor);
        if (dash.pendingLeave > 0 && can(actor, 'hr.leave.approve')) {
          lines.push({
            key: 'leave',
            label: 'Leave requests awaiting approval',
            count: dash.pendingLeave,
            href: '/hr/leave',
          });
        }
        if (dash.pendingPayroll > 0 && can(actor, 'payroll.view')) {
          lines.push({
            key: 'payroll',
            label: 'Payroll runs awaiting action',
            count: dash.pendingPayroll,
            href: '/hr/payroll',
          });
        }
      } catch {
        // HR dashboard unavailable.
      }
    }

    if (can(actor, 'inventory.view')) {
      try {
        const kpis = await this.inventory.kpis(actor);
        if (kpis.lowStockCount > 0) {
          lines.push({
            key: 'low-stock',
            label: 'Items at or below reorder level',
            count: kpis.lowStockCount,
            href: '/inventory/alerts',
          });
        }
      } catch {
        // Inventory KPIs unavailable.
      }
    }

    if (can(actor, 'admin.health.view')) {
      const [deadLetters, failedNotificationDeliveries, failedMail] = await Promise.all([
        this.jobs.deadLetters(),
        this.notifications.failedDeliveryCount(actor),
        this.notifications.failedMailCount(actor),
      ]);
      const adminTotal = deadLetters.length + failedNotificationDeliveries + failedMail;
      if (adminTotal > 0) {
        lines.push({
          key: 'platform-health',
          label: 'Platform delivery failures',
          count: adminTotal,
          href: '/admin/health',
        });
      }
    }

    const directory = await this.entities.all();
    const visible = directory.filter((entity) => actor.entityIds.includes(entity.id));
    const subsidiaries = visible
      .filter((entity) => entity.type === 'SUBSIDIARY')
      .map((entity) => ({
        id: entity.id,
        code: entity.code,
        name: entity.name,
        financeHref: `/finance?scope=${entity.code}`,
        inventoryHref: `/inventory?entity=${entity.code}`,
        procurementHref: `/procurement?entity=${entity.code}`,
      }));

    return {
      roleDashboardPath: actor.homePath ?? '/home',
      pendingTotal: lines.reduce((sum, line) => sum + line.count, 0),
      pendingLines: lines,
      subsidiaries,
      adminOps: null,
    };
  }

  private hasBusinessVisibility(actor: ActorContext): boolean {
    return (
      can(actor, 'procurement.view') ||
      can(actor, 'finance.view') ||
      can(actor, 'inventory.view') ||
      can(actor, 'hr.employee.view') ||
      can(actor, 'requisition.create')
    );
  }

}

const PROCUREMENT_ACTION_LINE_LABELS: Record<string, string> = {
  approve_need: 'Requisitions awaiting your need approval',
  prepare_proposal: 'Approved needs to prepare as proposals',
  correct_draft: 'Returned requests to correct',
  review_operations: 'Procurement awaiting your Operations review',
  approve_md: 'Procurement awaiting your approval',
  upload_invoice: 'Vendor invoices to upload',
  decide_invoice_variance: 'Invoice differences awaiting your decision',
  approve_funding: 'Procurement ready for your funding approval',
  record_transfer: 'Funding transfers to record',
  pay_vendor: 'Vendor payments to make',
  verify_delivery: 'Deliveries to verify',
};
