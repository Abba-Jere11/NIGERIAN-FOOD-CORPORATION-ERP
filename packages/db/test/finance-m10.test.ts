/**
 * M10 finance: calendar, COA, journals, banking, versioned budgets.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  DEFAULT_ROLE_GRANTS,
  YFZ_BANK_ACCOUNT_ID,
  YFZ_BUDGET_2026_ID,
  YFZ_PENDING_JOURNAL_ID,
  YFZ_POSTED_JOURNAL_ID,
  type PermissionKey,
} from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { AccountsService } from '../../../apps/api/src/finance/accounts.service';
import { BudgetsService } from '../../../apps/api/src/finance/budgets.service';
import { CalendarService } from '../../../apps/api/src/finance/calendar.service';
import { JournalsService } from '../../../apps/api/src/finance/journals.service';
import { TreasuryService } from '../../../apps/api/src/finance/treasury.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import { ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../../apps/api/src/common/errors/domain-error';
import { SEED_USERS } from '@nfc/shared';
import { appPool, captureError, entityIdFor, ownerPool } from './support';

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

describe('M10 finance foundation', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let nfc: string;
  let accounts: AccountsService;
  let calendar: CalendarService;
  let journals: JournalsService;
  let treasury: TreasuryService;
  let budgets: BudgetsService;
  let workflows: WorkflowsService;
  let emeka: ActorContext;
  let yahuza: ActorContext;
  let md: ActorContext;
  let dmaFh: ActorContext;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-m10-owner');
    app = appPool('nfc-erp-test-m10-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
    nfc = await entityIdFor(owner, 'NFC');
    const uow = new UnitOfWork(app);
    workflows = new WorkflowsService(uow, new SealsService());
    accounts = new AccountsService(uow);
    calendar = new CalendarService(uow);
    journals = new JournalsService(uow, workflows);
    treasury = new TreasuryService(uow, journals);
    budgets = new BudgetsService(uow, workflows);
    emeka = actorFromSeed('ed.finance@nfc.local', [yfz, dma, nfc]);
    yahuza = actorFromSeed('fh.yfz@nfc.local', [yfz]);
    md = actorFromSeed('md@nfc.local', [yfz, dma, nfc]);
    dmaFh = actorFromSeed('fh.dma@nfc.local', [dma]);
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  async function yfzAccounts() {
    const list = await accounts.list(emeka, yfz);
    const expense = list.find((row) => row.code === '5220');
    const cash = list.find((row) => row.code === '1120');
    if (!expense || !cash) throw new Error('YFZ COA missing 5220/1120');
    return { expense, cash };
  }

  async function openPeriod(entityId: string, index = 11) {
    const years = await calendar.listYears(emeka, entityId);
    const period = years[0]?.periods.find((row) => row.periodIndex === index && row.status === 'OPEN');
    if (!period) throw new Error('An open test period was not found.');
    return period;
  }

  it('copies a standard COA per entity and maps seeded bank accounts', async () => {
    const yfzCoa = await accounts.list(emeka, yfz);
    expect(yfzCoa.some((row) => row.code === '1120')).toBe(true);
    expect(yfzCoa.some((row) => row.code === '1210' && row.intercompany)).toBe(true);
    const bank = await owner.query<{ gl_account_id: string | null }>(
      `SELECT gl_account_id FROM entity_bank_accounts WHERE id = $1`,
      [YFZ_BANK_ACCOUNT_ID],
    );
    expect(bank.rows[0]?.gl_account_id).toBeTruthy();
  });

  it('refuses an unbalanced journal at the service and on PENDING at the database', async () => {
    const { expense, cash } = await yfzAccounts();
    const period = await openPeriod(yfz);
    await expect(
      journals.create(yahuza, {
        entityId: yfz,
        fiscalPeriodId: period.id,
        narration: 'Unbalanced',
        idempotencyKey: randomUUID(),
        lines: [
          { accountId: expense.id, debitKobo: 100, creditKobo: 0 },
          { accountId: cash.id, debitKobo: 0, creditKobo: 50 },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);

    const inserted = await owner.query<{ id: string }>(
      `INSERT INTO journals (
         reference_number, entity_id, fiscal_period_id, narration, idempotency_key, created_by, updated_by
       ) VALUES ($1, $2, $3, 'Unbalanced db', $4, $5, $5)
       RETURNING id`,
      [`JNL-TEST-${randomUUID().slice(0, 8)}`, yfz, period.id, randomUUID(), yahuza.ref],
    );
    const error = await captureError(() =>
      owner.query(`UPDATE journals SET status = 'PENDING_APPROVAL' WHERE id = $1`, [inserted.rows[0]!.id]),
    );
    expect(error.message).toMatch(/unbalanced journal/i);
  });

  it('refuses edits and deletes on a posted journal', async () => {
    const posted = await journals.get(emeka, YFZ_POSTED_JOURNAL_ID);
    await expect(
      journals.update(yahuza, posted.id, { rowVersion: posted.rowVersion, narration: 'tamper' }),
    ).rejects.toBeInstanceOf(ConflictError);
    const error = await captureError(() =>
      owner.query(`DELETE FROM journals WHERE id = $1`, [YFZ_POSTED_JOURNAL_ID]),
    );
    expect(error.message.length).toBeGreaterThan(0);
    const lineError = await captureError(() =>
      owner.query(`UPDATE journal_lines SET narration = 'x' WHERE journal_id = $1`, [YFZ_POSTED_JOURNAL_ID]),
    );
    expect(lineError.message).toMatch(/posted journal cannot be edited/i);
  });

  it('lets the preparer submit but not approve, then posts on a different approver', async () => {
    const { expense, cash } = await yfzAccounts();
    const period = await openPeriod(yfz);
    const draft = await journals.create(yahuza, {
      entityId: yfz,
      fiscalPeriodId: period.id,
      narration: 'M10 approval path',
      idempotencyKey: randomUUID(),
      lines: [
        { accountId: expense.id, debitKobo: 25_000_00, creditKobo: 0 },
        { accountId: cash.id, debitKobo: 0, creditKobo: 25_000_00 },
      ],
    });
    const submitted = await journals.submit(yahuza, draft.id, draft.rowVersion);
    expect(submitted.status).toBe('PENDING_APPROVAL');
    expect(submitted.workflowInstanceId).toBeTruthy();
    const instance = await workflows.get(yahuza, submitted.workflowInstanceId!);
    await expect(
      workflows.act(yahuza, { instanceId: instance.id, action: 'APPROVE', rowVersion: instance.rowVersion }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const after = await workflows.get(emeka, instance.id);
    const posted = await workflows.act(emeka, {
      instanceId: after.id,
      action: 'APPROVE',
      rowVersion: after.rowVersion,
    });
    expect(posted.status).toBe('COMPLETED');
    const journal = await journals.get(emeka, draft.id);
    expect(journal.status).toBe('POSTED');
    expect(journal.postedAt).toBeTruthy();
  });

  it('corrects a posted journal by reversal plus a new journal, both visible', async () => {
    const { expense, cash } = await yfzAccounts();
    const period = await openPeriod(yfz);
    const draft = await journals.create(yahuza, {
      entityId: yfz,
      fiscalPeriodId: period.id,
      narration: 'To reverse',
      idempotencyKey: randomUUID(),
      lines: [
        { accountId: expense.id, debitKobo: 10_000_00, creditKobo: 0 },
        { accountId: cash.id, debitKobo: 0, creditKobo: 10_000_00 },
      ],
    });
    const submitted = await journals.submit(yahuza, draft.id, draft.rowVersion);
    const instance = await workflows.get(emeka, submitted.workflowInstanceId!);
    await workflows.act(emeka, { instanceId: instance.id, action: 'APPROVE', rowVersion: instance.rowVersion });
    const reversal = await journals.reverse(yahuza, draft.id, {
      reason: 'Wrong expense coding',
      fiscalPeriodId: period.id,
      idempotencyKey: randomUUID(),
    });
    expect(reversal.source).toBe('REVERSAL');
    expect(reversal.reversesJournalId).toBe(draft.id);
    const revInstance = await workflows.get(emeka, reversal.workflowInstanceId!);
    await workflows.act(emeka, {
      instanceId: revInstance.id,
      action: 'APPROVE',
      rowVersion: revInstance.rowVersion,
    });
    const original = await journals.get(emeka, draft.id);
    const reversing = await journals.get(emeka, reversal.id);
    expect(original.status).toBe('REVERSED');
    expect(reversing.status).toBe('POSTED');
    expect(original.reversedByJournalId).toBe(reversal.id);
  });

  it('blocks posting to a closed period', async () => {
    const years = await calendar.listYears(emeka, yfz);
    const period = years[0]?.periods.find((row) => row.periodIndex === 12);
    if (!period) throw new Error('December period missing');
    if (period.status === 'OPEN') {
      await calendar.closePeriod(emeka, period.id, period.rowVersion);
    }
    const { expense, cash } = await yfzAccounts();
    await expect(
      journals.create(yahuza, {
        entityId: yfz,
        fiscalPeriodId: period.id,
        narration: 'Closed period',
        idempotencyKey: randomUUID(),
        lines: [
          { accountId: expense.id, debitKobo: 100, creditKobo: 0 },
          { accountId: cash.id, debitKobo: 0, creditKobo: 100 },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('balances the trial balance per entity and consolidated', async () => {
    const yfzTb = await journals.trialBalance(emeka, { entityId: yfz });
    expect(yfzTb.debitTotalKobo).toBe(yfzTb.creditTotalKobo);
    expect(yfzTb.debitTotalKobo).toBeGreaterThan(0);
    const consol = await journals.trialBalance(emeka, { consolidated: true });
    expect(consol.scope).toBe('consolidated');
    expect(consol.debitTotalKobo).toBe(consol.creditTotalKobo);
    await expect(journals.trialBalance(yahuza, { consolidated: true })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('hides DMA books from the YFZ Finance Head and keeps them for ED Finance', async () => {
    const dmaYears = await calendar.listYears(emeka, dma);
    expect(dmaYears.length).toBeGreaterThan(0);
    const hiddenYears = await calendar.listYears(yahuza, dma);
    expect(hiddenYears).toEqual([]);
    await expect(journals.get(yahuza, YFZ_POSTED_JOURNAL_ID)).resolves.toMatchObject({
      id: YFZ_POSTED_JOURNAL_ID,
    });
    const dmaAccounts = await accounts.list(dmaFh, dma);
    const yfzAsDma = await accounts.list(dmaFh, yfz);
    expect(dmaAccounts.length).toBeGreaterThan(0);
    expect(yfzAsDma).toEqual([]);
    await expect(journals.get(dmaFh, YFZ_POSTED_JOURNAL_ID)).rejects.toBeInstanceOf(NotFoundError);
    const context = await accounts.context(yahuza);
    expect(context.canConsolidate).toBe(false);
    expect(context.entities.every((entity) => entity.code !== 'DMA')).toBe(true);
    const edContext = await accounts.context(emeka);
    expect(edContext.canConsolidate).toBe(true);
    expect(edContext.entities.some((entity) => entity.code === 'DMA')).toBe(true);
  });

  it('matches and unmatches statement lines and reports unmatched', async () => {
    const report = await treasury.report(emeka, YFZ_BANK_ACCOUNT_ID);
    expect(report.unmatchedStatementCount).toBeGreaterThan(0);
    const line = report.unmatchedStatement[0];
    if (!line) throw new Error('Seeded unmatched statement missing');
    const posted = await journals.get(emeka, YFZ_POSTED_JOURNAL_ID);
    const cashLine = posted.lines.find((row) => row.creditKobo > 0);
    await treasury.match(emeka, {
      statementLineId: line.id,
      journalLineId: cashLine?.id,
    });
    const matched = await treasury.report(emeka, YFZ_BANK_ACCOUNT_ID);
    expect(matched.matchedCount).toBeGreaterThan(0);
    await treasury.unmatch(emeka, line.id, 'Reopened for the test');
    const again = await treasury.report(emeka, YFZ_BANK_ACCOUNT_ID);
    expect(again.unmatchedStatement.some((row) => row.id === line.id)).toBe(true);
  });

  it('keeps YFZ-CAPEX on the migrated 2026 budget and computes variance', async () => {
    const budget = await budgets.get(emeka, YFZ_BUDGET_2026_ID);
    expect(budget.status).toBe('APPROVED');
    const capex = budget.lines.find((line) => line.code === 'YFZ-CAPEX');
    expect(capex).toBeTruthy();
    expect(capex!.approvedKobo).toBeGreaterThan(0);
    expect(capex!.availableKobo).toBe(capex!.approvedKobo - capex!.committedKobo);
    expect(capex!.varianceKobo).toBe(capex!.approvedKobo - capex!.paidKobo);
    const live = await owner.query<{ code: string }>(
      `SELECT code FROM budget_lines WHERE entity_id = $1 AND code = 'YFZ-CAPEX' AND fiscal_year = 2026`,
      [yfz],
    );
    expect(live.rows[0]?.code).toBe('YFZ-CAPEX');
  });

  it('does not let a pending budget version change live approved amounts', async () => {
    const years = await calendar.listYears(emeka, yfz);
    const year = years.find((row) => row.year === 2026);
    if (!year) throw new Error('2026 year missing');
    const before = await owner.query<{ approved_amount_kobo: string }>(
      `SELECT approved_amount_kobo::text FROM budget_lines WHERE entity_id = $1 AND code = 'YFZ-CAPEX'`,
      [yfz],
    );
    const draft = await budgets.create(yahuza, {
      entityId: yfz,
      fiscalYearId: year.id,
      lines: [{ code: 'YFZ-CAPEX', name: 'Capex inflated', approvedAmountKobo: 1 }],
    });
    const after = await owner.query<{ approved_amount_kobo: string }>(
      `SELECT approved_amount_kobo::text FROM budget_lines WHERE entity_id = $1 AND code = 'YFZ-CAPEX'`,
      [yfz],
    );
    expect(after.rows[0]?.approved_amount_kobo).toBe(before.rows[0]?.approved_amount_kobo);
    expect(draft.status).toBe('DRAFT');
    expect(draft.lines[0]?.approvedKobo).toBe(1);
  });

  it('exposes the seeded pending journal for the approval queue', async () => {
    const pending = await journals.get(emeka, YFZ_PENDING_JOURNAL_ID);
    expect(pending.status).toBe('PENDING_APPROVAL');
    const queues = await accounts.queues(emeka);
    expect(queues.pendingJournals).toBeGreaterThan(0);
    expect(queues.unreconciledLines).toBeGreaterThan(0);
  });

  it('refuses NFC journal approval by the originator so MD is the second user', async () => {
    const nfcAccounts = await accounts.list(emeka, nfc);
    const expense = nfcAccounts.find((row) => row.code === '5220');
    const cash = nfcAccounts.find((row) => row.code === '1130') ?? nfcAccounts.find((row) => row.code === '1120');
    const period = await openPeriod(nfc, 11);
    if (!expense || !cash) throw new Error('NFC COA missing');
    const draft = await journals.create(emeka, {
      entityId: nfc,
      fiscalPeriodId: period.id,
      narration: 'NFC holding journal',
      idempotencyKey: randomUUID(),
      lines: [
        { accountId: expense.id, debitKobo: 5_000_00, creditKobo: 0 },
        { accountId: cash.id, debitKobo: 0, creditKobo: 5_000_00 },
      ],
    });
    const submitted = await journals.submit(emeka, draft.id, draft.rowVersion);
    const instance = await workflows.get(emeka, submitted.workflowInstanceId!);
    await expect(
      workflows.act(emeka, { instanceId: instance.id, action: 'APPROVE', rowVersion: instance.rowVersion }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const forMd = await workflows.get(md, instance.id);
    const completed = await workflows.act(md, {
      instanceId: forMd.id,
      action: 'APPROVE',
      rowVersion: forMd.rowVersion,
    });
    expect(completed.status).toBe('COMPLETED');
  });
});
