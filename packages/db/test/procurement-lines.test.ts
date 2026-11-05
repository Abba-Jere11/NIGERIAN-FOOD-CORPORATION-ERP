/**
 * M3 multi-item lines: one request, one vendor, many lines; GRN per line.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  DEFAULT_ROLE_GRANTS,
  SEED_USERS,
  XYZ_VENDOR_ID,
  YFZ_BANK_ACCOUNT_ID,
  YFZ_PROCUREMENT_DRAFT_ID,
  type PermissionKey,
} from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { DocumentsService } from '../../../apps/api/src/documents/documents.service';
import { FileStorageDriver } from '../../../apps/api/src/documents/file-storage';
import { NoopMalwareScanner } from '../../../apps/api/src/documents/malware';
import { DeliveryService } from '../../../apps/api/src/procurement/delivery.service';
import { FinancialChecksService } from '../../../apps/api/src/procurement/financial-checks.service';
import { PaymentsService } from '../../../apps/api/src/procurement/payments.service';
import { ProcurementService } from '../../../apps/api/src/procurement/procurement.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { VendorValidationService } from '../../../apps/api/src/vendors/vendor-validation.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import { RequisitionsService } from '../../../apps/api/src/procurement/requisitions.service';
import { ValidationFailedError } from '../../../apps/api/src/common/errors/domain-error';
import {
  openNeedApprovedDraft,
  pricePreparedDraft,
  submitNeedApprovedProposal,
  walkPastOpsAndMd,
  type DualApprovalDeps,
} from './procurement-flow';
import { appPool, entityIdFor, ownerPool } from './support';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

describe('M3 procurement lines', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let nfc: string;
  let procurement: ProcurementService;
  let requisitions: RequisitionsService;
  let workflows: WorkflowsService;
  let documents: DocumentsService;
  let flow: DualApprovalDeps;
  let payments: PaymentsService;
  let delivery: DeliveryService;
  let musa: ActorContext;
  let officer: ActorContext;
  let halima: ActorContext;
  let abubakar: ActorContext;
  let emeka: ActorContext;
  let grace: ActorContext;
  let departmentId: string;
  let servicesId: string;
  let equipmentId: string;
  let unitId: string;
  let fundingA: string;
  let budgetCapex: string;
  let budgetOpex: string;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-m3-lines-owner');
    app = appPool('nfc-erp-test-m3-lines-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
    nfc = await entityIdFor(owner, 'NFC');
    const uow = new UnitOfWork(app);
    workflows = new WorkflowsService(uow, new SealsService());
    documents = new DocumentsService(uow, new FileStorageDriver(), new NoopMalwareScanner());
    const checks = new FinancialChecksService(uow);
    const vendorValidation = new VendorValidationService(uow);
    procurement = new ProcurementService(uow, workflows, documents, vendorValidation, checks);
    requisitions = new RequisitionsService(uow, workflows, documents);
    payments = new PaymentsService(uow, workflows, vendorValidation, procurement);
    delivery = new DeliveryService(uow, procurement, workflows, documents);
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
    officer = actorFromSeed('inventory@nfc.local', [yfz, dma, nfc]);
    halima = actorFromSeed('ed.operations@nfc.local', [yfz, dma, nfc]);
    abubakar = actorFromSeed('md@nfc.local', [yfz, dma, nfc]);
    emeka = actorFromSeed('ed.finance@nfc.local', [yfz, dma, nfc]);
    grace = actorFromSeed('fh.yfz@nfc.local', [yfz]);

    const dept = await owner.query<{ id: string }>(
      `SELECT id FROM departments WHERE entity_id = $1 AND status = 'ACTIVE' ORDER BY name LIMIT 1`,
      [yfz],
    );
    departmentId = dept.rows[0]?.id ?? '';
    const cats = await procurement.categories(musa);
    servicesId = cats.find((row) => row.key === 'services')?.id ?? '';
    equipmentId = cats.find((row) => row.key === 'equipment')?.id ?? '';
    const units = await procurement.units(musa);
    unitId = units.find((row) => row.code === 'PCS')?.id ?? '';
    const funding = await procurement.fundingSources(musa);
    fundingA = funding.find((row) => row.key === 'subsidiary_operating')?.id ?? '';
    const lines = await procurement.budgetLines(musa, yfz);
    budgetCapex = lines.find((row) => row.code === 'YFZ-CAPEX')?.id ?? '';
    const extra = await procurement.createBudgetLine(emeka, {
      entityId: yfz,
      fiscalYear: 2026,
      code: `M3-${randomUUID().slice(0, 6)}`,
      name: 'M3 second budget',
      approvedAmountKobo: 50_000_000_000,
    });
    budgetOpex = extra.id;
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
      budgetLineId: budgetCapex,
      vendorId: XYZ_VENDOR_ID,
    };
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  async function fillTwoLines(title: string) {
    const draft = await openNeedApprovedDraft(flow, { title });
    return pricePreparedDraft(flow, draft, {
      title,
      invoiceRequired: true,
      extraLines: [
        {
          description: 'Idlers',
          categoryId: equipmentId,
          quantity: 2,
          unitId,
          unitPriceKobo: 150_000,
          budgetLineId: budgetCapex,
        },
        {
          description: 'Service visit',
          categoryId: servicesId,
          quantity: 1,
          unitId,
          unitPriceKobo: 100_000,
          budgetLineId: budgetOpex,
        },
      ],
    });
  }

  async function walkToPayment(view: Awaited<ReturnType<ProcurementService['submit']>>) {
    const atFinance = await walkPastOpsAndMd(procurement, workflows, halima, abubakar, view);
    expect(atFinance.status).toBe('AWAITING_ED_FINANCE');
    return procurement.act(emeka, atFinance.id, {
      action: 'APPROVE',
      rowVersion: (await workflows.get(emeka, atFinance.workflowInstanceId!)).rowVersion,
      fundingRoute: 'subsidiary_operating',
      sourceAccountId: YFZ_BANK_ACCOUNT_ID,
      checklistAcknowledged: true,
    });
  }

  it('shows the seeded single-item draft as line 1', async () => {
    const view = await procurement.get(musa, YFZ_PROCUREMENT_DRAFT_ID);
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]?.lineNumber).toBe(1);
    expect(view.quantity).toBe(view.lines[0]?.quantity);
    expect(view.totalAmountKobo).toBe(view.lines[0]?.lineAmountKobo);
  });

  it('refuses submit with zero or incomplete lines', async () => {
    const created = await openNeedApprovedDraft(flow, { title: `M3 empty ${randomUUID()}` });
    await expect(procurement.submit(officer, created.id, { rowVersion: created.rowVersion })).rejects.toThrow(
      ValidationFailedError,
    );
    await expect(procurement.submit(officer, created.id, { rowVersion: created.rowVersion })).rejects.toThrow(
      /Complete the request before submitting: /,
    );

    const incomplete = await procurement.update(officer, created.id, {
      rowVersion: created.rowVersion,
      title: created.title,
      subject: created.title,
      departmentId,
      reason: 'Required for the mill programme.',
      description: 'Incomplete line.',
      requiredDate: '2026-12-20',
      vendorId: XYZ_VENDOR_ID,
      deliveryLocation: 'YFZ mill stores',
      fundingSourceId: fundingA,
      urgency: 'NORMAL',
      proposedPaymentTiming: 'before_delivery',
      priceComparison: 'XYZ quoted the lowest compliant price.',
      recommendation: 'Award to XYZ Limited.',
      lines: [{ description: 'Missing commercial fields', quantity: 2 }],
    });
    await expect(procurement.submit(officer, incomplete.id, { rowVersion: incomplete.rowVersion })).rejects.toThrow(
      /Complete the request before submitting: .*line 1/,
    );
  });

  it('submits two lines, lists both on the memo, splits commitment, and keeps pay-then-deliver', async () => {
    const filled = await fillTwoLines(`M3 two-line ${randomUUID()}`);
    expect(filled.lines).toHaveLength(2);
    expect(filled.totalAmountKobo).toBe(400_000);
    expect(filled.invoiceRequired).toBe(true);

    const submitted = await procurement.submit(officer, filled.id, {
      rowVersion: filled.rowVersion,
      idempotencyKey: `m3-${filled.id}`,
    });
    const snapshot = await owner.query<{ canonical_json: { lines?: Array<{ description: string }>; totalAmountKobo: number } }>(
      `SELECT canonical_json FROM procurement_memo_snapshots WHERE request_id = $1`,
      [submitted.id],
    );
    expect(snapshot.rows[0]?.canonical_json.lines?.map((line) => line.description)).toEqual([
      'Idlers',
      'Service visit',
    ]);
    expect(snapshot.rows[0]?.canonical_json.totalAmountKobo).toBe(400_000);

    const commits = await owner.query<{ budget_line_id: string; amount_kobo: string }>(
      `SELECT budget_line_id, amount_kobo::text
         FROM procurement_commitment_events
        WHERE request_id = $1 AND action = 'OPEN'
        ORDER BY amount_kobo DESC`,
      [submitted.id],
    );
    expect(commits.rows).toHaveLength(2);
    expect(commits.rows.map((row) => Number(row.amount_kobo)).sort((a, b) => b - a)).toEqual([300_000, 100_000]);

    const afterMd = await walkToPayment(submitted);
    expect(afterMd.status).toBe('AWAITING_PAYMENT');
  });

  it('records officer GRN on line 1 of a two-line request as partial', async () => {
    const filled = await fillTwoLines(`M3 grn ${randomUUID()}`);
    const submitted = await procurement.submit(officer, filled.id, {
      rowVersion: filled.rowVersion,
      idempotencyKey: `m3-grn-${filled.id}`,
    });
    const paid = await walkToPayment(submitted);
    const proof = await documents.upload(grace, {
      title: `pay ${paid.title}`,
      category: 'payment_proof',
      context: 'procurement',
      entityId: yfz,
      ownerType: 'procurement_request',
      ownerId: paid.id,
      file: { buffer: PNG, originalname: 'pay.png' },
    });
    const awaiting = await payments.completePayment(grace, paid.id, {
      payingAccountId: YFZ_BANK_ACCOUNT_ID,
      amountKobo: paid.authorizedAmountKobo ?? 400_000,
      method: 'bank_transfer',
      bankReference: `M3-${randomUUID().slice(0, 8)}`,
      paymentDate: '2026-10-03',
      proofDocumentId: proof.id,
      idempotencyKey: `m3-pay-${paid.id}`,
    });
    expect(awaiting.status).toBe('AWAITING_DELIVERY');

    const line1 = awaiting.lines.find((line) => line.lineNumber === 1);
    const line2 = awaiting.lines.find((line) => line.lineNumber === 2);
    const after = await delivery.recordReceipt(officer, awaiting.id, {
      receivedDate: '2026-10-04',
      location: 'YFZ mill stores',
      lineId: line1?.id,
      quantityReceived: 2,
      quantityAccepted: 2,
      idempotencyKey: `m3-grn-${awaiting.id}`,
      documents: [],
    });
    expect(after.status).toBe('PARTIALLY_RECEIVED');
    expect(after.lines.find((line) => line.lineNumber === 1)?.outstandingQuantity).toBe(0);
    expect(after.lines.find((line) => line.lineNumber === 2)?.outstandingQuantity).toBe(line2?.quantity);
    expect(after.outstandingQuantity).toBeGreaterThan(0);
  });

  it('lets the Procurement Manager submit a one-line request', async () => {
    const submitted = await submitNeedApprovedProposal(flow, {
      title: `M3 one-line ${randomUUID()}`,
      quantity: 2,
      unitPriceKobo: 200_000,
    });
    expect(submitted.lines).toHaveLength(1);
    expect(submitted.totalAmountKobo).toBe(400_000);
    expect(submitted.status).toBe('AWAITING_MD');
  });
});
