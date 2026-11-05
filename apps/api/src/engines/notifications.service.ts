import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { ClaimedDelivery } from '@nfc/db';
import { ForbiddenError, ValidationFailedError } from '../common/errors/domain-error';
import type { PoolClient } from 'pg';
import { UnitOfWork } from '../database/unit-of-work';
import { loadApiEnv } from '../config/env';

function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_, key: string) => vars[key] ?? '');
}

@Injectable()
export class NotificationsService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async createFromEvent(
    client: PoolClient,
    actor: ActorContext,
    delivery: ClaimedDelivery,
  ): Promise<void> {
    const payload = delivery.payload;
    const recipientUserId =
      typeof payload.recipientUserId === 'string' ? payload.recipientUserId : null;
    if (!recipientUserId) return;

    const type =
      typeof payload.type === 'string' ? payload.type : mapEventType(delivery.eventType);
    const vars: Record<string, string> = {
      reference: String(payload.reference ?? ''),
      title: String(payload.title ?? ''),
      days: String(payload.days ?? ''),
      reason: String(payload.reason ?? ''),
      summary: String(payload.summary ?? ''),
      stage: String(payload.stage ?? ''),
      action: String(payload.action ?? payload.stage ?? ''),
      actor: actor.name,
    };

    const typeRow = await client.query<{
      title_template: string;
      body_template: string;
      email_enabled: boolean;
      mandatory: boolean;
      category: string;
    }>(
      `SELECT title_template, body_template, email_enabled, mandatory, category
         FROM notification_types WHERE type = $1`,
      [type],
    );
    const spec = typeRow.rows[0];
    if (!spec) return;

    const title = render(spec.title_template, vars);
    const body = render(spec.body_template, vars);
    const href = typeof payload.href === 'string' ? payload.href : null;
    const reference = vars.reference || null;

    const existing = await client.query<{ id: string }>(
      `SELECT id FROM notifications
        WHERE recipient_user_id = $1
          AND type = $2
          AND coalesce(reference_number, '') = coalesce($3, '')
          AND coalesce(href, '') = coalesce($4, '')
        LIMIT 1`,
      [recipientUserId, type, reference, href],
    );
    if (existing.rows[0]) return;

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO notifications (
         recipient_user_id, type, title, body, reference_number, href, entity_id, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING id`,
      [
        recipientUserId,
        type,
        title,
        body,
        reference,
        href,
        delivery.entityId,
        actor.ref,
      ],
    );
    const notificationId = inserted.rows[0]?.id;
    if (!notificationId) return;

    await client.query(
      `INSERT INTO notification_deliveries (notification_id, channel, status, created_by)
       VALUES ($1, 'in_app', 'sent', $2)`,
      [notificationId, actor.ref],
    );

    const emailWanted = spec.email_enabled && (spec.mandatory || (await this.emailAllowed(client, recipientUserId, spec.category)));
    if (!emailWanted) return;

    const recipient = await client.query<{ email: string }>(
      'SELECT app.user_email_by_id($1) AS email',
      [recipientUserId],
    );
    const email = recipient.rows[0]?.email;
    if (!email) return;

    await client.query(
      `INSERT INTO mail_outbox (kind, recipient, subject, body, payload, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        type,
        email,
        title,
        body,
        JSON.stringify({ notificationId, href, reference }),
        actor.ref,
      ],
    );

    const env = loadApiEnv();
    const smtpReady = Boolean(env.SMTP_HOST && env.SMTP_FROM);
    await client.query(
      `INSERT INTO notification_deliveries (notification_id, channel, status, error, created_by)
       VALUES ($1, 'email', $2, $3, $4)`,
      [
        notificationId,
        smtpReady ? 'sent' : 'logged',
        smtpReady ? null : 'SMTP is not configured; the message was stored on mail_outbox.',
        actor.ref,
      ],
    );

    if (!smtpReady && env.NODE_ENV === 'development') {
      console.log(`[mail_outbox] ${type} to ${email}: ${title}`);
    }
  }

  private async emailAllowed(
    client: PoolClient,
    userId: string,
    category: string,
  ): Promise<boolean> {
    const row = await client.query<{ email_enabled: boolean }>(
      `SELECT email_enabled FROM notification_preferences WHERE user_id = $1 AND category = $2`,
      [userId, category],
    );
    return row.rows[0]?.email_enabled ?? true;
  }

  async list(actor: ActorContext, unreadOnly = false, limit = 100) {
    const rows = Math.min(Math.max(Math.trunc(limit) || 100, 1), 100);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        type: string;
        title: string;
        body: string;
        reference_number: string | null;
        href: string | null;
        read_at: Date | null;
        created_at: Date;
      }>(
        `SELECT id, type, title, body, reference_number, href, read_at, created_at
           FROM notifications
          WHERE recipient_user_id = $1
            ${unreadOnly ? 'AND read_at IS NULL' : ''}
          ORDER BY created_at DESC
          LIMIT $2`,
        [actor.ref, rows],
      );
      return result.rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        referenceNumber: row.reference_number,
        href: row.href,
        readAt: row.read_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
      }));
    });
  }

  async unreadCount(actor: ActorContext): Promise<{ count: number }> {
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM notifications
          WHERE recipient_user_id = $1 AND read_at IS NULL`,
        [actor.ref],
      );
      return { count: Number(result.rows[0]?.count ?? 0) };
    });
  }

  async setRead(actor: ActorContext, id: string, read: boolean): Promise<void> {
    await this.unitOfWork.write(actor, async (tx) => {
      const result = await tx.client.query(
        `UPDATE notifications
            SET read_at = CASE WHEN $2 THEN coalesce(read_at, now()) ELSE NULL END,
                updated_by = $3
          WHERE id = $1 AND recipient_user_id = $3`,
        [id, read, actor.ref],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ForbiddenError('That notification is not available.');
      }
    });
  }

  async markAllRead(actor: ActorContext): Promise<{ updated: number }> {
    return this.unitOfWork.write(actor, async (tx) => {
      const result = await tx.client.query(
        `UPDATE notifications
            SET read_at = now(), updated_by = $1
          WHERE recipient_user_id = $1 AND read_at IS NULL`,
        [actor.ref],
      );
      return { updated: result.rowCount ?? 0 };
    });
  }

  async preferences(actor: ActorContext) {
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        category: string;
        mandatory: boolean;
        email_enabled: boolean;
      }>(
        `SELECT t.category,
                bool_or(t.mandatory) AS mandatory,
                coalesce(bool_and(p.email_enabled), true) AS email_enabled
           FROM notification_types t
           LEFT JOIN notification_preferences p
             ON p.category = t.category AND p.user_id = $1
          GROUP BY t.category
          ORDER BY t.category`,
        [actor.ref],
      );
      return result.rows.map((row) => ({
        category: row.category,
        emailEnabled: row.email_enabled,
        mandatory: row.mandatory,
      }));
    });
  }

  async setPreference(actor: ActorContext, category: string, emailEnabled: boolean): Promise<void> {
    await this.unitOfWork.write(actor, async (tx) => {
      const mandatory = await tx.client.query<{ exists: boolean }>(
        `SELECT exists(SELECT 1 FROM notification_types WHERE category = $1 AND mandatory) AS exists`,
        [category],
      );
      if (mandatory.rows[0]?.exists && !emailEnabled) {
        throw new ValidationFailedError(
          'Action-required notices cannot be turned off.',
          { category },
        );
      }
      await tx.client.query(
        `INSERT INTO notification_preferences (user_id, category, email_enabled, created_by, updated_by)
         VALUES ($1::uuid, $2, $3, $4, $4)
         ON CONFLICT (user_id, category) DO UPDATE
           SET email_enabled = EXCLUDED.email_enabled,
               updated_by = EXCLUDED.updated_by`,
        [actor.ref, category, emailEnabled, actor.ref],
      );
    });
  }

  async failedDeliveryCount(actor: ActorContext): Promise<number> {
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM notification_deliveries WHERE status = 'failed'`,
      );
      return Number(result.rows[0]?.count ?? 0);
    });
  }

  async failedMailCount(actor: ActorContext): Promise<number> {
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM notification_deliveries WHERE channel = 'email' AND status = 'failed'`,
      );
      return Number(result.rows[0]?.count ?? 0);
    });
  }
}

function mapEventType(eventType: string): string {
  if (eventType === 'engine.record.created') return 'engine.created';
  if (eventType === 'workflow.reminder') return 'workflow.reminder';
  if (eventType === 'procurement.approved') return 'procurement.approved';
  if (eventType === 'procurement.rejected') return 'procurement.rejected';
  if (eventType === 'procurement.returned') return 'procurement.returned';
  if (eventType === 'procurement.archived') return 'procurement.archived';
  if (eventType === 'procurement.awaiting_review') return 'procurement.awaiting_review';
  if (eventType === 'procurement.committed') return 'procurement.committed';
  if (eventType === 'procurement.commitment_released') return 'procurement.commitment_released';
  if (eventType === 'procurement.paid') return 'procurement.paid';
  if (eventType === 'goods.received') return 'goods.received';
  if (eventType === 'procurement.completed') return 'procurement.completed';
  if (eventType === 'procurement.close_short.requested') return 'procurement.close_short.requested';
  if (eventType === 'procurement.close_short.approved') return 'procurement.close_short.approved';
  if (eventType === 'procurement.close_short.rejected') return 'procurement.close_short.rejected';
  if (eventType === 'procurement.delivery_reminder') return 'procurement.delivery_reminder';
  if (eventType === 'journal.submitted') return 'journal.submitted';
  if (eventType === 'journal.approved') return 'journal.approved';
  if (eventType === 'journal.rejected') return 'journal.rejected';
  if (eventType === 'budget.submitted') return 'budget.submitted';
  if (eventType === 'budget.approved') return 'budget.approved';
  if (eventType === 'budget.rejected') return 'budget.rejected';
  if (eventType === 'procurement.funds_allocated') return 'procurement.funds_allocated';
  if (eventType === 'inventory.expected_stock.requested') return 'inventory.expected_stock.requested';
  if (eventType === 'inventory.low_stock') return 'inventory.low_stock';
  if (eventType === 'inventory.adjustment.submitted') return 'inventory.adjustment.submitted';
  if (eventType === 'inventory.transfer.submitted') return 'inventory.transfer.submitted';
  if (eventType === 'document.uploaded') return 'document.uploaded';
  if (eventType === 'seal.tampered') return 'seal.tampered';
  if (eventType.startsWith('org_report.')) return eventType;
  if (eventType.startsWith('hr.')) return eventType;
  return 'engine.created';
}
