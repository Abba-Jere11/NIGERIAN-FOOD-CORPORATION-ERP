/**
 * Executive report share: MD-only, PDF snapshot, no access links, queued without SMTP.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { DEFAULT_ROLE_GRANTS, SEED_USERS, type PermissionKey } from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { JobsService } from '../../../apps/api/src/engines/jobs.service';
import { NotificationsService } from '../../../apps/api/src/engines/notifications.service';
import { DeliveryService } from '../../../apps/api/src/procurement/delivery.service';
import { ReportMailService } from '../../../apps/api/src/reports/report-mail.service';
import { ReportsService } from '../../../apps/api/src/finance/reports.service';
import { loadApiEnv, resetApiEnvCache } from '../../../apps/api/src/config/env';
import { ForbiddenError } from '../../../apps/api/src/common/errors/domain-error';
import { appPool, entityIdFor, ownerPool } from './support';

function ensureApiEnv(): void {
  process.env.SESSION_SECRET ??= 'test-session-secret-not-for-production-use-32';
  process.env.MFA_ENCRYPTION_KEY ??=
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.DOCUMENT_ENCRYPTION_KEY ??=
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.SEAL_SIGNING_KEYS ??= JSON.stringify({
    v1: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  });
  process.env.SEAL_ACTIVE_KID ??= 'v1';
  process.env.DOCUMENT_STORAGE ??= 'fs';
}

function actorFromSeed(email: string, entityIds: string[]): ActorContext {
  const user = SEED_USERS.find((row) => row.email === email);
  if (!user) throw new Error(`Unknown seed user ${email}`);
  return {
    ref: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    scopeType: user.scopeType,
    entityIds,
    isCorporate: user.scopeType === 'CORPORATE' && user.role !== 'administrator',
    isAdmin: user.role === 'administrator',
    permissions: [...DEFAULT_ROLE_GRANTS[user.role]] as PermissionKey[],
    homePath: '/',
  };
}

describe('executive report share', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let mail: ReportMailService;
  let jobs: JobsService;
  let uow: UnitOfWork;
  let abubakar: ActorContext;
  let musa: ActorContext;

  beforeAll(async () => {
    ensureApiEnv();
    loadApiEnv();
    process.env.SMTP_HOST = '';
    process.env.SMTP_FROM = '';
    resetApiEnvCache();
    owner = ownerPool('nfc-erp-test-report-share-owner');
    app = appPool('nfc-erp-test-report-share-app');
    yfz = await entityIdFor(owner, 'YFZ');
    uow = new UnitOfWork(app);
    mail = new ReportMailService(uow, new ReportsService(uow));
    jobs = new JobsService(
      app,
      uow,
      null as unknown as NotificationsService,
      null as unknown as DeliveryService,
    );
    abubakar = actorFromSeed('md@nfc.local', [yfz]);
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
  });

  afterAll(async () => {
    resetApiEnvCache();
    await Promise.all([owner.end(), app.end()]);
  });

  it('lets only the MD queue a branded PDF copy with no access links', async () => {
    await expect(
      mail.share(musa, 'income_statement', {
        recipient: 'auditor@example.com',
        entityId: yfz,
        year: 2026,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const queued = await mail.share(abubakar, 'income_statement', {
      recipient: 'board@example.com',
      entityId: yfz,
      year: 2026,
      message: 'For the board pack.',
    });
    expect(queued.status).toBe('queued');
    expect(queued.subject).toMatch(/Income statement/);
    expect(queued.subject).toMatch(/RPT-/);

    const stored = await owner.query<{
      subject: string;
      body: string;
      status: string;
      payload: {
        html?: string;
        pdfBase64?: string;
        resultHash?: string;
        runReference?: string;
        filename?: string;
      };
    }>(`SELECT subject, body, status, payload FROM mail_outbox WHERE id = $1`, [queued.id]);
    const row = stored.rows[0];
    expect(row?.status).toBe('queued');
    expect(row?.body).toMatch(/Managing Director/);
    expect(row?.body).toContain('For the board pack.');
    expect(row?.body).not.toMatch(/https?:\/\//i);
    expect(row?.payload.html).toContain('Nigeria Food Corporation');
    expect(row?.payload.html).not.toMatch(/https?:\/\//i);
    expect(row?.payload.html).not.toMatch(/\bhref=/i);
    expect(row?.payload.pdfBase64?.length).toBeGreaterThan(80);
    expect(row?.payload.filename).toMatch(/\.pdf$/);
    expect(row?.payload.resultHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.payload.runReference).toMatch(/^RPT-/);

    const audit = await owner.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE subject_id = $1 AND action = 'document_share'`,
      [queued.id],
    );
    expect(audit.rows.length).toBeGreaterThan(0);

    const processed = await jobs.sendMail();
    expect(processed).toBe(0);
    const again = await owner.query<{ status: string }>(
      `SELECT status FROM mail_outbox WHERE id = $1`,
      [queued.id],
    );
    expect(again.rows[0]?.status).toBe('queued');

    await uow.write(abubakar, async (tx) => {
      const updated = await tx.client.query(
        `UPDATE mail_outbox SET last_error = 'probe' WHERE id = $1 RETURNING id`,
        [queued.id],
      );
      expect(updated.rowCount).toBe(1);
    });
  });
});
