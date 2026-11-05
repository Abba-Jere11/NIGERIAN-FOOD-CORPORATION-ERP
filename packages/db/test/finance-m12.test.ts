/**
 * M12 finance: statements, eliminations, exports, integrity.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { DEFAULT_ROLE_GRANTS, SEED_USERS, type PermissionKey } from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { IntegrityService } from '../../../apps/api/src/finance/integrity.service';
import { JournalsService } from '../../../apps/api/src/finance/journals.service';
import { ReportsService } from '../../../apps/api/src/finance/reports.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import { ForbiddenError } from '../../../apps/api/src/common/errors/domain-error';
import { appPool, entityIdFor, ownerPool } from './support';

const HUNDRED_M = 10_000_000_000;

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
  resetApiEnvCache();
}

function actorFromSeed(email: string, entityIds: string[], extra: PermissionKey[] = []): ActorContext {
  const user = SEED_USERS.find((row) => row.email === email);
  if (!user) throw new Error(`Unknown seed user ${email}`);
  return {
    ref: user.id,
    name: user.name,
    role: user.role,
    scopeType: user.scopeType,
    entityIds,
    isCorporate: user.scopeType === 'CORPORATE' && user.role !== 'administrator',
    isAdmin: user.role === 'administrator',
    permissions: [...DEFAULT_ROLE_GRANTS[user.role], ...extra],
    homePath: '/',
  };
}

describe('M12 finance 3', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let nfc: string;
  let reports: ReportsService;
  let integrity: IntegrityService;
  let journals: JournalsService;
  let emeka: ActorContext;
  let yahuza: ActorContext;
  let admin: ActorContext;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-m12-owner');
    app = appPool('nfc-erp-test-m12-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
    nfc = await entityIdFor(owner, 'NFC');
    const uow = new UnitOfWork(app);
    const workflows = new WorkflowsService(uow, new SealsService());
    journals = new JournalsService(uow, workflows);
    reports = new ReportsService(uow);
    integrity = new IntegrityService(uow);
    emeka = actorFromSeed('ed.finance@nfc.local', [yfz, dma, nfc]);
    yahuza = actorFromSeed('fh.yfz@nfc.local', [yfz]);
    admin = actorFromSeed('administrator@nfc.local', [nfc, yfz]);
  });

  afterAll(async () => {
    await owner.end();
    await app.end();
  });

  it('eliminates the seeded ₦100m IC pair on the consolidated trial balance', async () => {
    const tb = await journals.trialBalance(emeka, { consolidated: true });
    expect(tb.scope).toBe('consolidated');
    expect(tb.debitTotalKobo).toBe(tb.creditTotalKobo);
    expect(tb.eliminationTotalKobo).toBe(HUNDRED_M);
    const icRecv = tb.rows.find((row) => row.accountCode === '1210');
    expect(icRecv?.debitKobo ?? 0).toBe(2_000_000_000);
  });

  it('balances the consolidated income statement and balance sheet', async () => {
    const is = await reports.run(emeka, 'income_statement', { consolidated: true, year: 2026 });
    const ni = is.rows.find((row) => row.key === 'net_income');
    expect(ni).toBeTruthy();
    const bs = await reports.run(emeka, 'balance_sheet', { consolidated: true, year: 2026 });
    const assets = bs.rows.find((row) => row.key === 'assets_total')?.cells.currentKobo ?? 0;
    const liabEquity = bs.rows.find((row) => row.key === 'liab_equity')?.cells.currentKobo ?? 0;
    expect(assets).toBe(liabEquity);
    expect(assets).toBeGreaterThan(0);
  });

  it('builds cash flow from bank movements', async () => {
    const cf = await reports.run(emeka, 'cash_flow', { entityId: yfz });
    const bank = await owner.query<{ total: string }>(
      `SELECT coalesce(sum(amount_kobo), 0)::text AS total
         FROM bank_transactions
        WHERE entity_id = $1
          AND kind IN ('RECEIPT', 'PAYMENT', 'FUNDING_IN', 'FUNDING_OUT', 'ADJUSTMENT')`,
      [yfz],
    );
    const net = cf.rows.find((row) => row.key === 'cf_net')?.cells.currentKobo ?? 0;
    expect(net).toBe(Number(bank.rows[0]?.total ?? 0));
  });

  it('refuses another entity and consolidated reports for the YFZ Finance Head', async () => {
    await expect(reports.run(yahuza, 'income_statement', { entityId: dma })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reports.run(yahuza, 'income_statement', { consolidated: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(integrity.report(yahuza, { entityId: dma })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses the Administrator', async () => {
    await expect(reports.run(admin, 'income_statement', { entityId: yfz })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('exports the same grid as the screen run', async () => {
    const screen = await reports.run(emeka, 'income_statement', { consolidated: true, year: 2026 });
    const exported = await reports.export(emeka, 'income_statement', { consolidated: true, year: 2026 }, 'CSV');
    expect(exported.view.rows.map((row) => row.cells.currentKobo)).toEqual(
      screen.rows.map((row) => row.cells.currentKobo),
    );
    const run = await owner.query<{ format: string }>(
      `SELECT format FROM report_runs WHERE reference_number = $1`,
      [exported.view.runReference],
    );
    expect(run.rows[0]?.format).toBe('CSV');
    const audit = await owner.query(
      `SELECT 1 FROM audit_log WHERE subject_reference_number = $1 AND action = 'download'`,
      [exported.view.runReference],
    );
    expect(audit.rows[0]).toBeTruthy();
  });

  it('flags the seeded IC mismatch and keeps other checks clean', async () => {
    const report = await integrity.report(emeka, { consolidated: true });
    const ic = report.checks.find((check) => check.key === 'intercompany');
    expect(ic?.status).toBe('FAIL');
    const hard = report.checks.filter(
      (check) => check.status === 'FAIL' && check.key !== 'intercompany' && check.key !== 'inventory',
    );
    expect(hard).toEqual([]);
    const yfzReport = await integrity.report(yahuza, { entityId: yfz });
    expect(yfzReport.checks.find((check) => check.key === 'intercompany')?.status).toBe('OK');
  });
});
