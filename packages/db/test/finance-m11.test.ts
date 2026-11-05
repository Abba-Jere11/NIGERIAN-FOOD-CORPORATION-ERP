/**
 * M11 finance: AR/AP, inter-company, procurement GL postings, dashboards.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  DEFAULT_ROLE_GRANTS,
  NFC_BANK_ACCOUNT_ID,
  NFC_YFZ_ICT_ID,
  NFC_YFZ_MISMATCH_ICT_ID,
  SEED_USERS,
  XYZ_VENDOR_ID,
  YFZ_AR_30_ID,
  YFZ_AR_60_ID,
  YFZ_AR_90_ID,
  YFZ_AR_90PLUS_ID,
  YFZ_AR_CURRENT_ID,
  YFZ_BANK_ACCOUNT_ID,
  YFZ_CUSTOMER_ID,
  YFZ_OVERDUE_BILL_ID,
  type PermissionKey,
} from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { DocumentsService } from '../../../apps/api/src/documents/documents.service';
import { FileStorageDriver } from '../../../apps/api/src/documents/file-storage';
import { NoopMalwareScanner } from '../../../apps/api/src/documents/malware';
import { CustomersService } from '../../../apps/api/src/finance/customers.service';
import { DashboardService } from '../../../apps/api/src/finance/dashboard.service';
import { ExpensesService } from '../../../apps/api/src/finance/expenses.service';
import { IncomeService } from '../../../apps/api/src/finance/income.service';
import { IntercompanyService } from '../../../apps/api/src/finance/intercompany.service';
import { JournalsService } from '../../../apps/api/src/finance/journals.service';
import { LedgerPostingService } from '../../../apps/api/src/finance/ledger-posting.service';
import { PayablesService } from '../../../apps/api/src/finance/payables.service';
import { ReceivablesService } from '../../../apps/api/src/finance/receivables.service';
import { DeliveryService } from '../../../apps/api/src/procurement/delivery.service';
import { FinancialChecksService } from '../../../apps/api/src/procurement/financial-checks.service';
import { PaymentsService } from '../../../apps/api/src/procurement/payments.service';
import { ProcurementService } from '../../../apps/api/src/procurement/procurement.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { VendorValidationService } from '../../../apps/api/src/vendors/vendor-validation.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import { RequisitionsService } from '../../../apps/api/src/procurement/requisitions.service';
import { ForbiddenError, NotFoundError } from '../../../apps/api/src/common/errors/domain-error';
import {
  openNeedApprovedDraft,
  pricePreparedDraft,
  walkPastOpsAndMd,
  type DualApprovalDeps,
} from './procurement-flow';
import { appPool, entityIdFor, ownerPool } from './support';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const TWENTY_M = 2_000_000_000;
const TWENTY_TWO_M = 2_200_000_000;

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

describe('M11 finance 2', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let nfc: string;
  let workflows: WorkflowsService;
  let documents: DocumentsService;
  let procurement: ProcurementService;
  let requisitions: RequisitionsService;
  let flow: DualApprovalDeps;
  let payments: PaymentsService;
  let delivery: DeliveryService;
  let checks: FinancialChecksService;
  let customers: CustomersService;
  let income: IncomeService;
  let expenses: ExpensesService;
  let receivables: ReceivablesService;
  let payables: PayablesService;
  let intercompany: IntercompanyService;
  let dashboard: DashboardService;
  let journals: JournalsService;
  let musa: ActorContext;
  let officer: ActorContext;
  let admin: ActorContext;
  let halima: ActorContext;
  let abubakar: ActorContext;
  let emeka: ActorContext;
  let yahuza: ActorContext;
  let dmaFh: ActorContext;
  let departmentId: string;
  let servicesId: string;
  let unitId: string;
  let fundingA: string;
  let budgetLineId: string;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-m11-owner');
    app = appPool('nfc-erp-test-m11-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
    nfc = await entityIdFor(owner, 'NFC');
    const uow = new UnitOfWork(app);
    workflows = new WorkflowsService(uow, new SealsService());
    documents = new DocumentsService(uow, new FileStorageDriver(), new NoopMalwareScanner());
    checks = new FinancialChecksService(uow);
    const vendorValidation = new VendorValidationService(uow);
    procurement = new ProcurementService(uow, workflows, documents, vendorValidation, checks);
    requisitions = new RequisitionsService(uow, workflows, documents);
    journals = new JournalsService(uow, workflows);
    const ledger = new LedgerPostingService(journals);
    customers = new CustomersService(uow);
    income = new IncomeService(uow, workflows, ledger);
    expenses = new ExpensesService(uow, workflows, ledger);
    payables = new PayablesService(uow, workflows, ledger);
    receivables = new ReceivablesService(uow, ledger, customers);
    intercompany = new IntercompanyService(uow, ledger);
    dashboard = new DashboardService(uow);
    Object.assign(workflows, { income, expenses, payables });
    payments = new PaymentsService(uow, workflows, vendorValidation, procurement, ledger, intercompany, payables);
    delivery = new DeliveryService(uow, procurement, workflows, documents, ledger);
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
    officer = actorFromSeed('inventory@nfc.local', [yfz, dma, nfc]);
    admin = actorFromSeed('administrator@nfc.local', [nfc, yfz]);
    halima = actorFromSeed('ed.operations@nfc.local', [yfz, dma, nfc]);
    abubakar = actorFromSeed('md@nfc.local', [yfz, dma, nfc]);
    emeka = actorFromSeed('ed.finance@nfc.local', [yfz, dma, nfc]);
    yahuza = actorFromSeed('fh.yfz@nfc.local', [yfz]);
    dmaFh = actorFromSeed('fh.dma@nfc.local', [dma]);

    const dept = await owner.query<{ id: string }>(
      `SELECT id FROM departments WHERE entity_id = $1 AND status = 'ACTIVE' ORDER BY name LIMIT 1`,
      [yfz],
    );
    departmentId = dept.rows[0]?.id ?? '';
    const cats = await procurement.categories(musa);
    servicesId = cats.find((row) => row.key === 'services')?.id ?? '';
    const units = await procurement.units(musa);
    unitId = units.find((row) => row.code === 'PCS')?.id ?? '';
    const funding = await procurement.fundingSources(musa);
    fundingA = funding.find((row) => row.key === 'subsidiary_operating')?.id ?? '';
    const lines = await procurement.budgetLines(musa, yfz);
    budgetLineId = lines.find((row) => row.code === 'YFZ-CAPEX')?.id ?? '';
    flow = {
      requisitions,
      procurement,
      workflows,
      documents,
      gm: musa,
      md: abubakar,
      officer,
      entityId: yfz,
      departmentId,
      categoryId: servicesId,
      unitId,
      fundingId: fundingA,
      budgetLineId,
      vendorId: XYZ_VENDOR_ID,
    };
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  async function fillPr(title: string, unitPriceKobo: number) {
    const draft = await openNeedApprovedDraft(flow, { title, quantity: 1 });
    return pricePreparedDraft(flow, draft, { title, quantity: 1, unitPriceKobo });
  }

  async function budgetActions(requestId: string) {
    const rows = await owner.query<{ action: string; amount_kobo: string }>(
      `SELECT action, amount_kobo::text FROM budget_commitment_events
        WHERE request_id = $1 ORDER BY created_at, action`,
      [requestId],
    );
    return rows.rows.map((row) => `${row.action}:${Number(row.amount_kobo)}`);
  }

  async function proof(actor: ActorContext, requestId: string, name: string) {
    return documents.upload(actor, {
      title: name,
      category: 'payment_proof',
      context: 'procurement',
      entityId: yfz,
      ownerType: 'procurement_request',
      ownerId: requestId,
      file: { buffer: PNG, originalname: `${name}.png` },
    });
  }

  it('commits ₦20m, releases on return, then recommits ₦22m on YFZ-CAPEX', async () => {
    const filled = await fillPr(`M11 commit ${randomUUID()}`, TWENTY_M);
    const submitted = await procurement.submit(officer, filled.id, {
      rowVersion: filled.rowVersion,
      idempotencyKey: `m11-c-${filled.id}`,
    });
    expect(await budgetActions(submitted.id)).toContain(`COMMIT:${TWENTY_M}`);
    const open = await owner.query<{ net: string }>(
      `SELECT coalesce(sum(CASE WHEN action = 'OPEN' THEN amount_kobo ELSE -amount_kobo END), 0)::text AS net
         FROM procurement_commitment_events WHERE request_id = $1`,
      [submitted.id],
    );
    expect(Number(open.rows[0]?.net)).toBe(TWENTY_M);

    const returned = await procurement.act(abubakar, submitted.id, {
      action: 'RETURN_FOR_CORRECTION',
      reason: 'Revise the amount before finance review.',
      rowVersion: (await workflows.get(abubakar, submitted.workflowInstanceId!)).rowVersion,
    });
    expect(await budgetActions(returned.id)).toEqual(
      expect.arrayContaining([`COMMIT:${TWENTY_M}`, `RELEASE:${TWENTY_M}`]),
    );

    const revised = await procurement.update(officer, returned.id, {
      rowVersion: returned.rowVersion,
      title: returned.title,
      subject: returned.title,
      departmentId,
      reason: 'Required for the mill programme.',
      description: 'M11 recommit line.',
      requiredDate: '2026-12-20',
      vendorId: XYZ_VENDOR_ID,
      deliveryLocation: 'YFZ mill stores',
      fundingSourceId: fundingA,
      lines: [
        {
          description: 'M11 recommit line.',
          categoryId: servicesId,
          quantity: 1,
          unitId,
          unitPriceKobo: TWENTY_TWO_M,
          budgetLineId,
        },
      ],
      urgency: 'NORMAL',
    });
    const again = await procurement.submit(officer, revised.id, {
      rowVersion: revised.rowVersion,
      idempotencyKey: `m11-c2-${revised.id}`,
    });
    expect(await budgetActions(again.id)).toEqual(
      expect.arrayContaining([`COMMIT:${TWENTY_M}`, `RELEASE:${TWENTY_M}`, `COMMIT:${TWENTY_TWO_M}`]),
    );
  });

  it('posts a prepayment journal on PAY and reclasses 5220 on completion', async () => {
    const filled = await fillPr(`M11 pay-reclass ${randomUUID()}`, TWENTY_M);
    const submitted = await procurement.submit(officer, filled.id, {
      rowVersion: filled.rowVersion,
      idempotencyKey: `m11-p-${filled.id}`,
    });
    const atFinance = await walkPastOpsAndMd(procurement, workflows, halima, abubakar, submitted);
    const approved = await procurement.act(emeka, atFinance.id, {
      action: 'APPROVE',
      rowVersion: (await workflows.get(emeka, atFinance.workflowInstanceId!)).rowVersion,
      fundingRoute: 'subsidiary_operating',
      sourceAccountId: YFZ_BANK_ACCOUNT_ID,
      checklistAcknowledged: true,
    });
    const file = await proof(yahuza, approved.id, 'm11-pay');
    const paid = await payments.completePayment(yahuza, approved.id, {
      payingAccountId: YFZ_BANK_ACCOUNT_ID,
      amountKobo: TWENTY_M,
      method: 'bank_transfer',
      bankReference: `M11-${randomUUID().slice(0, 8)}`,
      paymentDate: '2026-10-03',
      proofDocumentId: file.id,
      idempotencyKey: `m11-pay-${approved.id}`,
    });
    expect(paid.status).toBe('AWAITING_DELIVERY');

    const payJournal = await owner.query<{
      id: string;
      source: string;
      debit: string;
      credit: string;
      debit_code: string;
      credit_code: string;
    }>(
      `SELECT j.id, j.source,
              sum(l.debit_kobo)::text AS debit, sum(l.credit_kobo)::text AS credit,
              max(CASE WHEN l.debit_kobo > 0 THEN a.code END) AS debit_code,
              max(CASE WHEN l.credit_kobo > 0 THEN a.code END) AS credit_code
         FROM journals j
         JOIN journal_lines l ON l.journal_id = j.id
         JOIN accounts a ON a.id = l.account_id
        WHERE j.idempotency_key = $1
        GROUP BY j.id, j.source`,
      [`pay:${(await owner.query<{ id: string }>(
        `SELECT id FROM procurement_payments WHERE request_id = $1 AND reversed_at IS NULL`,
        [paid.id],
      )).rows[0]?.id}`],
    );
    expect(payJournal.rows[0]?.source).toBe('PROCUREMENT_PAYMENT');
    expect(Number(payJournal.rows[0]?.debit)).toBe(Number(payJournal.rows[0]?.credit));
    expect(payJournal.rows[0]?.debit_code).toBe('1300');
    expect(payJournal.rows[0]?.credit_code).toBe('1120');

    const linked = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM journal_lines
        WHERE journal_id = $1 AND procurement_request_id = $2 AND vendor_id = $3`,
      [payJournal.rows[0]?.id, paid.id, XYZ_VENDOR_ID],
    );
    expect(Number(linked.rows[0]?.n)).toBe(2);

    const cert = await documents.upload(musa, {
      title: 'm11 complete',
      category: 'completion_certificate',
      context: 'procurement',
      entityId: yfz,
      ownerType: 'procurement_request',
      ownerId: paid.id,
      file: { buffer: PNG, originalname: 'complete.png' },
    });
    const completed = await delivery.recordReceipt(officer, paid.id, {
      receivedDate: '2026-10-03',
      location: 'YFZ mill stores',
      quantityReceived: 1,
      quantityAccepted: 1,
      idempotencyKey: `m11-grn-${paid.id}`,
      documents: [{ documentId: cert.id, kind: 'completion_certificate' }],
    });
    expect(completed.status).toBe('COMPLETED');

    const reclass = await owner.query<{ source: string; debit_code: string; credit_code: string; debit: string; credit: string }>(
      `SELECT j.source,
              max(CASE WHEN l.debit_kobo > 0 THEN a.code END) AS debit_code,
              max(CASE WHEN l.credit_kobo > 0 THEN a.code END) AS credit_code,
              sum(l.debit_kobo)::text AS debit, sum(l.credit_kobo)::text AS credit
         FROM journals j
         JOIN journal_lines l ON l.journal_id = j.id
         JOIN accounts a ON a.id = l.account_id
        WHERE j.idempotency_key = $1
        GROUP BY j.source`,
      [`reclass:${paid.id}`],
    );
    expect(reclass.rows[0]?.source).toBe('PROCUREMENT_RECLASS');
    expect(reclass.rows[0]?.debit_code).toBe('5220');
    expect(reclass.rows[0]?.credit_code).toBe('1300');
    expect(Number(reclass.rows[0]?.debit)).toBe(Number(reclass.rows[0]?.credit));
    expect(await budgetActions(paid.id)).toEqual(expect.arrayContaining([`PAY:${TWENTY_M}`, `ACTUAL:${TWENTY_M}`]));
  });

  it('keeps the ₦100m NFC→YFZ pair posted and flags the one-sided reversal', async () => {
    const pair = await intercompany.get(emeka, NFC_YFZ_ICT_ID);
    expect(pair.amountKobo).toBe(10_000_000_000);
    expect(pair.sourceEntityCode).toBe('NFC');
    expect(pair.destinationEntityCode).toBe('YFZ');
    expect(pair.mismatched).toBe(false);
    expect(pair.sourceJournalId).toBeTruthy();
    expect(pair.destinationJournalId).toBeTruthy();
    const src = await journals.get(emeka, pair.sourceJournalId!);
    const dst = await journals.get(emeka, pair.destinationJournalId!);
    expect(src.status).toBe('POSTED');
    expect(dst.status).toBe('POSTED');
    expect(src.debitTotalKobo).toBe(src.creditTotalKobo);
    expect(src.lines.every((line) => line.intercompanyTransactionId === NFC_YFZ_ICT_ID)).toBe(true);

    const broken = await intercompany.get(emeka, NFC_YFZ_MISMATCH_ICT_ID);
    expect(broken.mismatched).toBe(true);
    const mismatches = await intercompany.mismatches(emeka);
    expect(mismatches.some((row) => row.id === NFC_YFZ_MISMATCH_ICT_ID)).toBe(true);
  });

  it('ages seeded YFZ receivables and marks the overdue bill', async () => {
    const aging = await receivables.aging(emeka, yfz);
    expect(aging.buckets.current).toBeGreaterThan(0);
    expect(aging.buckets['1_30']).toBeGreaterThan(0);
    expect(aging.buckets['31_60']).toBeGreaterThan(0);
    expect(aging.buckets['61_90']).toBeGreaterThan(0);
    expect(aging.buckets['90_plus']).toBeGreaterThan(0);
    const byId = new Map(aging.invoices.map((row) => [row.id, row.agingBucket]));
    expect(byId.get(YFZ_AR_CURRENT_ID)).toBe('current');
    expect(byId.get(YFZ_AR_30_ID)).toBe('1_30');
    expect(byId.get(YFZ_AR_60_ID)).toBe('31_60');
    expect(byId.get(YFZ_AR_90_ID)).toBe('61_90');
    expect(byId.get(YFZ_AR_90PLUS_ID)).toBe('90_plus');

    const statement = await receivables.statement(emeka, YFZ_CUSTOMER_ID);
    expect(statement.customer.name).toMatch(/Maiduguri/);
    expect(statement.balanceKobo).toBeGreaterThan(0);

    const bill = await payables.get(emeka, YFZ_OVERDUE_BILL_ID);
    expect(bill.overdue).toBe(true);
    expect(bill.status).toBe('UNPAID');
  });

  it('hides DMA customers from the YFZ Finance Head and refuses the Administrator', async () => {
    const yfzCustomer = await customers.get(yahuza, YFZ_CUSTOMER_ID);
    expect(yfzCustomer.entityCode).toBe('YFZ');
    const dmaCustomer = await customers.upsert(emeka, {
      entityId: dma,
      name: `DMA only ${randomUUID().slice(0, 8)}`,
    });
    await expect(customers.get(yahuza, dmaCustomer.id)).rejects.toBeInstanceOf(NotFoundError);
    const hidden = await customers.list(yahuza, dma);
    expect(hidden).toEqual([]);
    await expect(customers.get(dmaFh, YFZ_CUSTOMER_ID)).rejects.toBeInstanceOf(NotFoundError);

    await expect(customers.list(admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      income.create(admin, {
        entityId: yfz,
        categoryKey: 'sales',
        settlement: 'INVOICE',
        customerId: YFZ_CUSTOMER_ID,
        amountKobo: 100,
        occurredOn: '2026-10-03',
        narration: 'Admin must not create income',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(dashboard.get(admin)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(dashboard.get(yahuza, dma)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets the preparer submit income and expense but not approve them', async () => {
    const draft = await expenses.create(yahuza, {
      entityId: yfz,
      categoryKey: 'utilities',
      settlement: 'ON_ACCOUNT',
      vendorId: XYZ_VENDOR_ID,
      amountKobo: 25_000_00,
      occurredOn: '2026-10-03',
      dueDate: '2026-10-31',
      narration: 'YFZ utilities',
      idempotencyKey: randomUUID(),
    });
    const submitted = await expenses.submit(yahuza, draft.id, draft.rowVersion);
    expect(submitted.status).toBe('PENDING_APPROVAL');
    expect(submitted.workflowInstanceId).toBeTruthy();
    const instance = await workflows.get(yahuza, submitted.workflowInstanceId!);
    await expect(
      workflows.act(yahuza, { instanceId: instance.id, action: 'APPROVE', rowVersion: instance.rowVersion }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const posted = await workflows.act(emeka, {
      instanceId: (await workflows.get(emeka, instance.id)).id,
      action: 'APPROVE',
      rowVersion: (await workflows.get(emeka, instance.id)).rowVersion,
    });
    expect(posted.status).toBe('COMPLETED');
    const expense = await expenses.get(emeka, draft.id);
    expect(expense.status).toBe('POSTED');
    expect(expense.journalId).toBeTruthy();
  });

  it('uses the posted GL cash balance as the primary funding figure', async () => {
    const filled = await fillPr(`M11 funding ${randomUUID()}`, 100_000_00);
    const submitted = await procurement.submit(officer, filled.id, {
      rowVersion: filled.rowVersion,
      idempotencyKey: `m11-f-${filled.id}`,
    });
    const rows = await checks.evaluate(emeka, submitted.id);
    const funding = rows.find((row) => row.key === 'funding');
    expect(funding?.summary).toMatch(/ledger/i);
    expect(funding?.summary).toMatch(/recorded/i);
    expect(funding?.summary).not.toMatch(/pre-ledger/i);
  });

  it('builds ED Finance consolidated tiles and keeps FH and GM on their entity', async () => {
    const group = await dashboard.get(emeka);
    expect(group.consolidated).toBeTruthy();
    expect(group.consolidated?.outstandingReceivablesKobo).toBeGreaterThan(0);
    expect(group.consolidated?.outstandingPayablesKobo).toBeGreaterThan(0);
    expect(group.consolidated?.intercompanyTransfersKobo).toBeGreaterThan(0);
    expect(group.entities.some((row) => row.entityCode === 'YFZ')).toBe(true);

    const own = await dashboard.get(yahuza);
    expect(own.consolidated).toBeNull();
    expect(own.entities).toHaveLength(1);
    expect(own.entities[0]?.entityCode).toBe('YFZ');

    const gmOwn = await dashboard.get(musa);
    expect(gmOwn.consolidated).toBeNull();
    expect(gmOwn.entities).toHaveLength(1);
    expect(gmOwn.entities[0]?.entityCode).toBe('YFZ');
    await expect(dashboard.get(musa, dma)).rejects.toBeInstanceOf(ForbiddenError);
    void NFC_BANK_ACCOUNT_ID;
  });
});
