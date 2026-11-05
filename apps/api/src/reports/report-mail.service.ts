import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { ReportKind } from '@nfc/shared';
import { REPORT_KINDS } from '@nfc/shared';
import { assertCan } from '../auth/can';
import { ForbiddenError, ValidationFailedError } from '../common/errors/domain-error';
import { loadApiEnv } from '../config/env';
import { UnitOfWork } from '../database/unit-of-work';
import { resultHash } from '../finance/report-export';
import type { ReportQuery } from '../finance/report-window';
import { ReportsService } from '../finance/reports.service';
import { reportEmailHtml, reportEmailSubject, reportEmailText } from '../mail/report-email';
import { sendSmtp, smtpConfigured, type OutboundMail } from '../mail/smtp-transport';

const EMAIL = /^[^@]+@[^@]+\.[^@]+$/;

export interface ShareReportInput extends ReportQuery {
  recipient: string;
  message?: string | null;
}

@Injectable()
export class ReportMailService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly reports: ReportsService,
  ) {}

  async share(
    actor: ActorContext,
    kind: ReportKind,
    input: ShareReportInput,
  ): Promise<{ id: string; status: string; subject: string }> {
    assertCan(actor, 'reports.email');
    if (!REPORT_KINDS.includes(kind)) throw new ValidationFailedError('That report cannot be shared.');
    const recipient = input.recipient.trim().toLowerCase();
    if (!EMAIL.test(recipient)) throw new ValidationFailedError('A valid email address is required.');
    const message = input.message?.trim() || null;
    if (message && message.length > 2000) {
      throw new ValidationFailedError('The covering note is too long.');
    }

    const exported = await this.reports.export(actor, kind, input, 'PDF');
    const view = exported.view;
    const hash = resultHash(view);
    const env = loadApiEnv();
    const fromAddress = env.SMTP_FROM?.trim() || 'md@nfc.com';
    const fromName = actor.name;
    const sentAt = new Date();
    const copy = {
      senderName: fromName,
      fromAddress,
      recipient,
      title: view.title,
      runReference: view.runReference,
      entityLabel: view.entityLabel,
      periodLabel: view.periodLabel,
      sentAt,
      message,
      filename: exported.filename,
    };
    const subject = reportEmailSubject(copy);
    const text = reportEmailText(copy);
    const html = reportEmailHtml(copy);
    if (/https?:\/\//i.test(html) || /https?:\/\//i.test(text) || /\bhref=/i.test(html)) {
      throw new Error('Report email must not contain links.');
    }

    const outbound: OutboundMail = {
      fromName,
      fromAddress,
      to: recipient,
      subject,
      text,
      html,
      attachments: [
        { filename: exported.filename, contentType: 'application/pdf', content: exported.buffer },
      ],
    };

    const queued = await this.unitOfWork.write(actor, async (tx) => {
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO mail_outbox (kind, recipient, subject, body, payload, status, created_by)
         VALUES ('report.share', $1, $2, $3, $4::jsonb, 'queued', $5)
         RETURNING id`,
        [
          recipient,
          subject,
          text,
          JSON.stringify({
            html,
            fromName,
            fromAddress,
            filename: exported.filename,
            pdfBase64: exported.buffer.toString('base64'),
            resultHash: hash,
            kind,
            title: view.title,
            runReference: view.runReference,
            entityLabel: view.entityLabel,
            periodLabel: view.periodLabel,
            message,
            requestedBy: actor.ref,
          }),
          actor.ref,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The message was not queued.');

      await tx.audit({
        action: 'document_share',
        subjectType: 'report_run',
        subjectId: id,
        subjectLabel: view.title,
        subjectReferenceNumber: view.runReference,
        entityId: view.entityId,
        newValue: {
          recipient,
          kind,
          runReference: view.runReference,
          resultHash: hash,
          fromAddress,
          filename: exported.filename,
        },
      });
      return { id, status: 'queued', subject };
    });

    if (!smtpConfigured()) return queued;

    try {
      await sendSmtp(outbound);
      await this.markOutbox(actor, queued.id, 'sent');
      return { ...queued, status: 'sent' };
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await this.markOutbox(actor, queued.id, 'failed', err.slice(0, 500));
      throw new ValidationFailedError(
        `The report was recorded but the mailbox was not reached. ${err.slice(0, 180)}`,
      );
    }
  }

  private async markOutbox(
    actor: ActorContext,
    id: string,
    status: 'sent' | 'failed',
    lastError?: string,
  ): Promise<void> {
    await this.unitOfWork.write(actor, async (tx) => {
      if (status === 'sent') {
        await tx.client.query(
          `UPDATE mail_outbox
              SET status = 'sent', sent_at = now(), attempt_count = attempt_count + 1, last_error = NULL
            WHERE id = $1`,
          [id],
        );
        return;
      }
      await tx.client.query(
        `UPDATE mail_outbox
            SET status = 'failed', attempt_count = attempt_count + 1, last_error = $2
          WHERE id = $1`,
        [id, lastError ?? 'SMTP failed'],
      );
    });
  }

  /** @deprecated category notices — finance share is the executive path. */
  async queue(
    actor: ActorContext,
    _input: { category: string; recipient: string },
  ): Promise<{ id: string; status: string }> {
    if (!actor.permissions.includes('reports.email')) {
      throw new ForbiddenError('Your role does not permit this action.', { permission: 'reports.email' });
    }
    throw new ValidationFailedError('Open the report and use Share by email. Category notices are no longer sent.');
  }
}
