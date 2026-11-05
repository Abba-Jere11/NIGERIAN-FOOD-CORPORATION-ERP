import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import {
  claimDueDeliveries,
  insertDueSlaReminders,
  listDeadLetters,
  markDeliveryDelivered,
  markDeliveryFailure,
  systemActorContext,
} from '@nfc/db';
import type { Pool } from 'pg';
import { APP_POOL } from '../database/tokens';
import { UnitOfWork, type TxScope } from '../database/unit-of-work';
import { loadApiEnv } from '../config/env';
import { sendSmtp, smtpConfigured } from '../mail/smtp-transport';
import { EdmsService } from '../edms/edms.service';
import { InventoryService } from '../inventory/inventory.service';
import { HrService } from '../hr/hr.service';
import { PayrollService } from '../payroll/payroll.service';
import { OrgReportsService } from '../org-reports/org-reports.service';
import { DeliveryService } from '../procurement/delivery.service';
import { deliveryVerificationRecipients } from '../procurement/notify-targets';
import { NotificationsService } from './notifications.service';

@Injectable()
export class JobsService {
  constructor(
    @Inject(APP_POOL) private readonly pool: Pool,
    private readonly unitOfWork: UnitOfWork,
    private readonly notifications: NotificationsService,
    private readonly delivery: DeliveryService,
    @Optional() private readonly inventory?: InventoryService,
    @Optional() private readonly edms?: EdmsService,
    @Optional() private readonly orgReports?: OrgReportsService,
    @Optional() private readonly hr?: HrService,
    @Optional() private readonly payroll?: PayrollService,
  ) {}

  private timer: NodeJS.Timeout | null = null;
  /** Prevent overlapping 5s polls from exhausting the DB pool during SMTP/outbox work. */
  private running = false;

  start(): void {
    if (!loadApiEnv().JOBS_ENABLED) return;
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[jobs] poller failed: ${message}`);
      });
    }, 5_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(now: Date = new Date()): Promise<{ deliveries: number; reminders: number; mail: number }> {
    if (this.running) return { deliveries: 0, reminders: 0, mail: 0 };
    this.running = true;
    try {
      const deliveries = await this.dispatchOutbox();
      const mail = await this.sendMail();
      const reminders = await this.runSla(now);
      const deliveryReminders = await this.runDeliveryReminders(now);
      const missedDeadlines = await this.runMissedShortageDeadlines(now);
      const minuteReminders = await this.runOrgMinuteReminders(now);
      const hrReminders = await this.runHrReminders(now);
      const payrollReminders = await this.runPayrollReminders(now);
      return {
        deliveries,
        reminders: reminders + deliveryReminders + missedDeadlines + minuteReminders + hrReminders + payrollReminders,
        mail,
      };
    } finally {
      this.running = false;
    }
  }

  /**
   * SMTP sending is optional; messages already sit on `mail_outbox`.
   * Claim rows in a short TX, deliver outside any open transaction, then mark
   * sent/failed — so a slow SMTP host cannot hold a pool client.
   */
  async sendMail(): Promise<number> {
    if (!smtpConfigured()) return 0;
    const actor = systemActorContext('system:outbox', 'Mail dispatcher');
    let due: Array<{
      id: string;
      recipient: string;
      subject: string;
      body: string;
      payload: Record<string, unknown> | null;
    }> = [];
    await this.unitOfWork.write(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        recipient: string;
        subject: string;
        body: string;
        payload: Record<string, unknown> | null;
      }>(
        `SELECT id, recipient, subject, body, payload
           FROM mail_outbox
          WHERE status = 'queued'
          ORDER BY occurred_at
          LIMIT 50`,
      );
      due = result.rows;
    });

    let sent = 0;
    for (const row of due) {
      try {
        await this.deliverSmtp(row);
        await this.unitOfWork.write(actor, async (tx) => {
          await tx.client.query(
            `UPDATE mail_outbox
                SET status = 'sent', sent_at = now(), attempt_count = attempt_count + 1, last_error = NULL
              WHERE id = $1 AND status = 'queued'`,
            [row.id],
          );
        });
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.unitOfWork.write(actor, async (tx) => {
          await tx.client.query(
            `UPDATE mail_outbox
                SET status = 'failed', attempt_count = attempt_count + 1, last_error = $2
              WHERE id = $1 AND status = 'queued'`,
            [row.id, message.slice(0, 500)],
          );
        });
        sent += 1;
      }
    }
    return sent;
  }

  private async deliverSmtp(row: {
    recipient: string;
    subject: string;
    body: string;
    payload: Record<string, unknown> | null;
  }): Promise<void> {
    const env = loadApiEnv();
    const payload = row.payload ?? {};
    const fromAddress =
      typeof payload.fromAddress === 'string' ? payload.fromAddress : env.SMTP_FROM ?? 'md@nfc.com';
    const fromName = typeof payload.fromName === 'string' ? payload.fromName : 'Nigeria Food Corporation';
    const html = typeof payload.html === 'string' ? payload.html : `<pre>${row.body}</pre>`;
    const filename = typeof payload.filename === 'string' ? payload.filename : undefined;
    const pdfBase64 = typeof payload.pdfBase64 === 'string' ? payload.pdfBase64 : undefined;
    await sendSmtp({
      fromName,
      fromAddress,
      to: row.recipient,
      subject: row.subject,
      text: row.body,
      html,
      attachments:
        filename && pdfBase64
          ? [
              {
                filename,
                contentType: 'application/pdf',
                content: Buffer.from(pdfBase64, 'base64'),
              },
            ]
          : undefined,
    });
  }

  async dispatchOutbox(): Promise<number> {
    const actor = systemActorContext('system:outbox', 'Outbox dispatcher');
    let processed = 0;
    for (let i = 0; i < 500; i += 1) {
      let handled = false;
      await this.unitOfWork.write(actor, async (tx) => {
        const due = await claimDueDeliveries(tx.client, 1);
        const delivery = due[0];
        if (!delivery) return;
        handled = true;
        await tx.client.query('SAVEPOINT outbox_handler');
        try {
          await this.handle(tx, delivery, actor);
          await markDeliveryDelivered(tx.client, delivery.deliveryId);
        } catch (error) {
          await tx.client.query('ROLLBACK TO SAVEPOINT outbox_handler');
          const message = error instanceof Error ? error.message : String(error);
          await markDeliveryFailure(tx.client, delivery.deliveryId, message);
        }
      });
      if (!handled) break;
      processed += 1;
    }
    return processed;
  }

  private async handle(
    tx: TxScope,
    delivery: Awaited<ReturnType<typeof claimDueDeliveries>>[number],
    actor: ActorContext,
  ): Promise<void> {
    if (delivery.handlerKey === 'test.fail') {
      throw new Error('forced handler failure');
    }
    if (
      delivery.handlerKey === 'test.echo' ||
      delivery.handlerKey.endsWith('.placeholder')
    ) {
      return;
    }
    if (delivery.handlerKey === 'notify.generic') {
      await this.notifications.createFromEvent(tx.client, actor, delivery);
      return;
    }
    if (delivery.handlerKey === 'inventory.apply_expected') {
      const lineId = typeof delivery.payload.lineId === 'string' ? delivery.payload.lineId : '';
      if (!this.inventory || !delivery.entityId || !lineId || !delivery.subjectId) return;
      await this.inventory.applyExpectedInTx(tx, actor, {
        requestId: delivery.subjectId,
        lineId,
        entityId: delivery.entityId,
      });
      return;
    }
    if (delivery.handlerKey === 'inventory.apply_receipt') {
      const grnId = typeof delivery.payload.grnId === 'string' ? delivery.payload.grnId : '';
      if (!this.inventory || !grnId) return;
      await this.inventory.applyReceiptInTx(tx, actor, {
        grnId,
        warehouseId: typeof delivery.payload.warehouseId === 'string' ? delivery.payload.warehouseId : null,
        batchCode: typeof delivery.payload.batchCode === 'string' ? delivery.payload.batchCode : null,
        serialCodes: Array.isArray(delivery.payload.serialCodes)
          ? delivery.payload.serialCodes.filter((value): value is string => typeof value === 'string')
          : undefined,
      });
      return;
    }
    if (delivery.handlerKey === 'edms.file_procurement') {
      if (!this.edms || !delivery.subjectId) return;
      await this.edms.fileProcurementInTx(
        tx,
        systemActorContext('system:edms', 'EDMS archive'),
        delivery.subjectId,
      );
    }
  }

  async runSla(now: Date): Promise<number> {
    const actor = systemActorContext('system:escalation', 'Escalation engine');
    let sent = 0;
    await this.unitOfWork.write(actor, async (tx) => {
      const due = await insertDueSlaReminders(tx.client, actor, now);
      for (const reminder of due) {
        await tx.publish({
          eventType: 'workflow.reminder',
          subjectType: 'workflow_hold',
          subjectId: reminder.holdId,
          entityId: reminder.entityId,
          payload: {
            type: 'workflow.reminder',
            reference: reminder.referenceNumber,
            title: reminder.title,
            days: String(reminder.days),
            recipientUserId: reminder.holderUserId,
            href: '/workflows/overdue',
          },
        });
        sent += 1;
      }
    });
    if (sent > 0) await this.dispatchOutbox();
    return sent;
  }

  async runDeliveryReminders(now: Date): Promise<number> {
    const actor = systemActorContext('system:escalation', 'Delivery reminder');
    let sent = 0;
    await this.unitOfWork.write(actor, async (tx) => {
      const due = await tx.client.query<{
        id: string;
        request_id: string;
        entity_id: string;
        reference_number: string;
        title: string;
        prepared_by_user_id: string | null;
      }>(
        `SELECT n.id, n.request_id, n.entity_id, r.reference_number, v.title, r.prepared_by_user_id
           FROM procurement_delivery_notes n
           JOIN procurement_requests r ON r.id = n.request_id
           JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
          WHERE n.next_reminder_at IS NOT NULL AND n.next_reminder_at <= $1
            AND r.status IN ('AWAITING_DELIVERY', 'PARTIALLY_RECEIVED')`,
        [now],
      );
      for (const row of due.rows) {
        const recipients = await deliveryVerificationRecipients(tx.client, {
          entityId: row.entity_id,
          preparedByUserId: row.prepared_by_user_id,
        });
        for (const recipientUserId of recipients) {
          await tx.publish({
            eventType: 'procurement.delivery_reminder',
            subjectType: 'PROCUREMENT',
            subjectId: row.request_id,
            entityId: row.entity_id,
            payload: {
              type: 'procurement.delivery_reminder',
              reference: row.reference_number,
              title: row.title,
              recipientUserId,
              href: `/procurement/${row.request_id}#delivery`,
            },
          });
        }
        await tx.client.query(
          `UPDATE procurement_delivery_notes SET next_reminder_at = $1 + interval '3 days' WHERE id = $2`,
          [now, row.id],
        );
        sent += 1;
      }
    });
    return sent;
  }

  async runMissedShortageDeadlines(now: Date): Promise<number> {
    const actor = systemActorContext('system:escalation', 'Shortage deadline');
    return this.delivery.startCloseShortForMissedDeadlines(actor, now);
  }

  async runHrReminders(now: Date): Promise<number> {
    if (!this.hr) return 0;
    const actor = systemActorContext('system:escalation', 'HR reminder');
    let sent = 0;
    await this.unitOfWork.write(actor, async (tx) => {
      sent = await this.hr!.remindDue(tx, now);
    });
    if (sent > 0) await this.dispatchOutbox();
    return sent;
  }

  async runPayrollReminders(now: Date): Promise<number> {
    if (!this.payroll) return 0;
    const actor = systemActorContext('system:escalation', 'Payroll reminder');
    let sent = 0;
    await this.unitOfWork.write(actor, async (tx) => {
      sent = await this.payroll!.remindOpenDraftsInTx(tx, now);
    });
    if (sent > 0) await this.dispatchOutbox();
    return sent;
  }

  async runOrgMinuteReminders(now: Date): Promise<number> {
    if (!this.orgReports) return 0;
    const actor = systemActorContext('system:escalation', 'Official minute reminder');
    let sent = 0;
    await this.unitOfWork.write(actor, async (tx) => {
      sent = await this.orgReports!.remindDueMinutes(tx, now);
    });
    if (sent > 0) await this.dispatchOutbox();
    return sent;
  }

  async deadLetters() {
    const client = await this.pool.connect();
    try {
      return await listDeadLetters(client);
    } finally {
      client.release();
    }
  }
}
