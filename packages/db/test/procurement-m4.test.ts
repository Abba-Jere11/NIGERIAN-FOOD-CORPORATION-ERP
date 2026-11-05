/**
 * M4 payment execution: timing queue, partials, after-delivery caps, dual COMPLETED.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  DEFAULT_ROLE_GRANTS,
  NFC_BANK_ACCOUNT_ID,
  SEED_USERS,
  XYZ_VENDOR_ID,
  YFZ_BANK_ACCOUNT_ID,
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
import { ConflictError, ValidationFailedError } from '../../../apps/api/src/common/errors/domain-error';
import { submitNeedApprovedProposal, walkPastOpsAndMd, type DualApprovalDeps } from './procurement-flow';
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

describe('M4 payment execution', () => {
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
  let fundingC: string;
  let budgetCapex: string;
  let budgetOpex: string;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-m4-pay-owner');
    app = appPool('nfc-erp-test-m4-pay-app');
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
    delivery = new DeliveryService(uow, procurement, workflows, documents);
    payments = new PaymentsService(uow, workflows, vendorValidation, procurement, undefined, undefined, undefined, delivery);
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
    fundingC = funding.find((row) => row.key === 'corporate_allocation')?.id ?? '';
    const lines = await procurement.budgetLines(musa, yfz);
    budgetCapex = lines.find((row) => row.code === 'YFZ-CAPEX')?.id ?? '';
    const extra = await procurement.createBudgetLine(emeka, {
      entityId: yfz,
      fiscalYear: 2026,
      code: `M4-${randomUUID().slice(0, 6)}`,
      name: 'M4 second budget',
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

  async function walkToFinance(
    title: string,
    opts: {
      proposed?: 'before_delivery' | 'after_delivery';
      final?: 'before_delivery' | 'after_delivery';
      twoLines?: boolean;
      fundingSourceId?: string;
    } = {},
  ) {
    const submitted = await submitNeedApprovedProposal(
      {
        ...flow,
        fundingId: opts.fundingSourceId ?? fundingA,
        budgetLineId: budgetCapex,
      },
      {
        title,
        proposedPaymentTiming: opts.proposed ?? 'before_delivery',
        invoiceRequired: opts.twoLines,
        extraLines: opts.twoLines
          ? [
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
            ]
          : undefined,
      },
    );
    return walkPastOpsAndMd(
      procurement,
      workflows,
      halima,
      abubakar,
      submitted,
      opts.final ? { finalPaymentTiming: opts.final } : {},
    );
  }

  async function financeApprove(
    atFinance: Awaited<ReturnType<ProcurementService['act']>>,
    route: 'subsidiary_operating' | 'corporate_allocation' = 'subsidiary_operating',
  ) {
    return procurement.act(emeka, atFinance.id, {
      action: 'APPROVE',
      rowVersion: (await workflows.get(emeka, atFinance.workflowInstanceId!)).rowVersion,
      fundingRoute: route,
      sourceAccountId: route === 'corporate_allocation' ? NFC_BANK_ACCOUNT_ID : YFZ_BANK_ACCOUNT_ID,
      ...(route === 'corporate_allocation' ? { destinationAccountId: YFZ_BANK_ACCOUNT_ID } : {}),
      checklistAcknowledged: true,
    });
  }

  async function proof(requestId: string, name: string) {
    return documents.upload(grace, {
      title: name,
      category: 'payment_proof',
      context: 'procurement',
      entityId: yfz,
      ownerType: 'procurement_request',
      ownerId: requestId,
      file: { buffer: PNG, originalname: `${name}.png` },
    });
  }

  async function cert(requestId: string, name: string) {
    return documents.upload(officer, {
      title: name,
      category: 'completion_certificate',
      context: 'procurement',
      entityId: yfz,
      ownerType: 'procurement_request',
      ownerId: requestId,
      file: { buffer: PNG, originalname: `${name}.png` },
    });
  }

  async function pay(
    requestId: string,
    amountKobo: number,
    key: string,
    bankReference = `M4-${randomUUID().slice(0, 8)}`,
  ) {
    const file = await proof(requestId, key);
    return payments.completePayment(grace, requestId, {
      payingAccountId: YFZ_BANK_ACCOUNT_ID,
      amountKobo,
      method: 'bank_transfer',
      bankReference,
      paymentDate: '2026-10-03',
      proofDocumentId: file.id,
      idempotencyKey: key,
    });
  }

  it('keeps pay-then-deliver when MD retains before_delivery and completes only after both', async () => {
    const atFinance = await walkToFinance(`M4 retain ${randomUUID()}`);
    const approved = await financeApprove(atFinance);
    expect(approved.status).toBe('AWAITING_PAYMENT');
    expect(approved.finalPaymentTiming).toBe('before_delivery');
    expect(approved.payableAmountKobo).toBe(400_000);

    const paid = await pay(approved.id, 400_000, `m4-full-${approved.id}`);
    expect(paid.status).toBe('AWAITING_DELIVERY');
    expect(paid.paymentComplete).toBe(true);
    expect(paid.deliveryComplete).toBe(false);
    const wf = await workflows.get(grace, paid.workflowInstanceId!);
    expect(wf.status).toBe('IN_PROGRESS');
    expect(wf.seals.map((seal) => seal.action)).toEqual(expect.arrayContaining(['paid']));

    await expect(delivery.complete(officer, paid.id)).rejects.toBeInstanceOf(ConflictError);

    const evidence = await cert(paid.id, 'm4-retain-cert');
    const done = await delivery.recordReceipt(officer, paid.id, {
      receivedDate: '2026-10-04',
      location: 'YFZ mill stores',
      quantityReceived: 2,
      quantityAccepted: 2,
      idempotencyKey: `m4-grn-${paid.id}`,
      documents: [{ documentId: evidence.id, kind: 'completion_certificate' }],
    });
    expect(done.status).toBe('COMPLETED');
    expect(done.deliveryComplete).toBe(true);
    expect(done.paymentComplete).toBe(true);
    expect((await workflows.get(musa, paid.workflowInstanceId!)).status).toBe('COMPLETED');
  });

  it('skips the vendor-pay queue after MD flips to after_delivery and caps pay at accepted value', async () => {
    const atFinance = await walkToFinance(`M4 flip after ${randomUUID()}`, {
      twoLines: true,
      final: 'after_delivery',
    });
    const approved = await financeApprove(atFinance);
    expect(approved.status).toBe('AWAITING_DELIVERY');
    expect(approved.payableAmountKobo).toBe(0);
    await expect(pay(approved.id, 400_000, `m4-early-${approved.id}`)).rejects.toBeInstanceOf(ConflictError);

    const line1 = approved.lines.find((line) => line.lineNumber === 1);
    const line2 = approved.lines.find((line) => line.lineNumber === 2);
    const evidence = await cert(approved.id, 'm4-after-cert');
    const partial = await delivery.recordReceipt(officer, approved.id, {
      receivedDate: '2026-10-04',
      location: 'YFZ mill stores',
      lineId: line1?.id,
      quantityReceived: 2,
      quantityAccepted: 2,
      idempotencyKey: `m4-l1-${approved.id}`,
      documents: [{ documentId: evidence.id, kind: 'completion_certificate' }],
    });
    expect(partial.status).toBe('PARTIALLY_RECEIVED');
    expect(partial.payableAmountKobo).toBe(300_000);

    await expect(pay(partial.id, 300_001, `m4-over-${partial.id}`)).rejects.toBeInstanceOf(ValidationFailedError);
    const slice = await pay(partial.id, 300_000, `m4-l1-pay-${partial.id}`);
    expect(slice.status).toBe('PARTIALLY_RECEIVED');
    expect(slice.paidAmountKobo).toBe(300_000);
    expect(slice.payableAmountKobo).toBe(0);
    expect(slice.paymentComplete).toBe(false);
    const wf = await workflows.get(grace, slice.workflowInstanceId!);
    expect(wf.status).toBe('IN_PROGRESS');
    expect(wf.seals.some((seal) => seal.action === 'paid')).toBe(false);

    await expect(pay(slice.id, 100_000, `m4-early2-${slice.id}`)).rejects.toBeInstanceOf(ConflictError);

    const rest = await delivery.recordReceipt(officer, slice.id, {
      receivedDate: '2026-10-05',
      location: 'YFZ mill stores',
      lineId: line2?.id,
      quantityReceived: 1,
      quantityAccepted: 1,
      idempotencyKey: `m4-l2-${slice.id}`,
      documents: [],
    });
    expect(rest.status).toBe('AWAITING_PAYMENT');
    expect(rest.deliveryComplete).toBe(true);
    expect(rest.payableAmountKobo).toBe(100_000);

    const settled = await pay(rest.id, 100_000, `m4-l2-pay-${rest.id}`);
    expect(settled.status).toBe('COMPLETED');
    expect(settled.paymentComplete).toBe(true);
    expect((await workflows.get(musa, settled.workflowInstanceId!)).status).toBe('COMPLETED');
    expect((await workflows.get(musa, settled.workflowInstanceId!)).seals.map((s) => s.action)).toEqual(
      expect.arrayContaining(['paid', 'verified']),
    );
  });

  it('queues vendor pay before delivery when MD flips after_delivery back to before_delivery', async () => {
    const atFinance = await walkToFinance(`M4 flip before ${randomUUID()}`, {
      proposed: 'after_delivery',
      final: 'before_delivery',
    });
    const approved = await financeApprove(atFinance);
    expect(approved.status).toBe('AWAITING_PAYMENT');
    expect(approved.finalPaymentTiming).toBe('before_delivery');
    expect(approved.payableAmountKobo).toBe(400_000);
  });

  it('records two before_delivery slices, notifies GM each time, and does not collide on the old unique index', async () => {
    const atFinance = await walkToFinance(`M4 slices ${randomUUID()}`);
    const approved = await financeApprove(atFinance);
    const first = await pay(approved.id, 150_000, `m4-s1-${approved.id}`);
    expect(first.status).toBe('AWAITING_PAYMENT');
    expect(first.paidAmountKobo).toBe(150_000);
    expect(first.payableAmountKobo).toBe(250_000);
    expect(first.payments).toHaveLength(1);
    const wf = await workflows.get(grace, first.workflowInstanceId!);
    expect(wf.status).toBe('IN_PROGRESS');
    expect(wf.seals.some((seal) => seal.action === 'paid')).toBe(false);

    const second = await pay(first.id, 250_000, `m4-s2-${first.id}`);
    expect(second.status).toBe('AWAITING_DELIVERY');
    expect(second.paidAmountKobo).toBe(400_000);
    expect(second.payments).toHaveLength(2);
    expect(second.paymentComplete).toBe(true);

    const events = await owner.query<{ event_type: string }>(
      `SELECT event_type FROM domain_events WHERE subject_id = $1 AND event_type = 'procurement.paid'`,
      [approved.id],
    );
    expect(events.rows).toHaveLength(2);
  });

  it('funds route C in full then waits for delivery when timing is after_delivery', async () => {
    const atFinance = await walkToFinance(`M4 route C ${randomUUID()}`, {
      final: 'after_delivery',
      fundingSourceId: fundingC,
    });
    const pending = await financeApprove(atFinance, 'corporate_allocation');
    expect(pending.status).toBe('FUNDING_PENDING');
    const proofDoc = await documents.upload(emeka, {
      title: 'm4-trf',
      category: 'funding_transfer',
      context: 'procurement',
      entityId: yfz,
      ownerType: 'procurement_request',
      ownerId: pending.id,
      file: { buffer: PNG, originalname: 'trf.png' },
    });
    const transferred = await payments.recordTransfer(emeka, {
      requestId: pending.id,
      sourceAccountId: NFC_BANK_ACCOUNT_ID,
      destinationAccountId: YFZ_BANK_ACCOUNT_ID,
      amountKobo: 400_000,
      purpose: `Allocation for ${pending.referenceNumber}`,
      transferDate: '2026-10-02',
      transferMethod: 'bank_transfer',
      bankReference: `M4T-${randomUUID().slice(0, 8)}`,
      proofDocumentId: proofDoc.id,
    });
    expect(transferred.status).toBe('AWAITING_DELIVERY');
    expect(transferred.payableAmountKobo).toBe(0);
  });
});
