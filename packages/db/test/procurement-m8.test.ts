/**
 * M8 finance review, funding routes, payments, reversals, money-moved lock.
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
  YFZ_PROCUREMENT_AWAITING_FINANCE_ID,
  type PermissionKey,
} from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { DocumentsService } from '../../../apps/api/src/documents/documents.service';
import { FileStorageDriver } from '../../../apps/api/src/documents/file-storage';
import { NoopMalwareScanner } from '../../../apps/api/src/documents/malware';
import { BankAccountsService } from '../../../apps/api/src/procurement/bank-accounts.service';
import { FinancialChecksService } from '../../../apps/api/src/procurement/financial-checks.service';
import { PaymentsService } from '../../../apps/api/src/procurement/payments.service';
import { ProcurementService } from '../../../apps/api/src/procurement/procurement.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { VendorValidationService } from '../../../apps/api/src/vendors/vendor-validation.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../../apps/api/src/common/errors/domain-error';
import { RequisitionsService } from '../../../apps/api/src/procurement/requisitions.service';
import {
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

describe('M8 procurement finance', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let nfc: string;
  let procurement: ProcurementService;
  let requisitions: RequisitionsService;
  let workflows: WorkflowsService;
  let documents: DocumentsService;
  let payments: PaymentsService;
  let checks: FinancialChecksService;
  let musa: ActorContext;
  let officer: ActorContext;
  let flow: DualApprovalDeps;
  let admin: ActorContext;
  let halima: ActorContext;
  let abubakar: ActorContext;
  let emeka: ActorContext;
  let grace: ActorContext;
  let dmaFh: ActorContext;
  let departmentId: string;
  let servicesId: string;
  let unitId: string;
  let fundingA: string;
  let fundingB: string;
  let fundingC: string;
  let budgetLineId: string;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-m8-owner');
    app = appPool('nfc-erp-test-m8-app');
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
    payments = new PaymentsService(uow, workflows, vendorValidation, procurement);
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
    officer = actorFromSeed('inventory@nfc.local', [yfz, dma, nfc]);
    admin = actorFromSeed('administrator@nfc.local', [nfc, yfz]);
    halima = actorFromSeed('ed.operations@nfc.local', [yfz, dma, nfc]);
    abubakar = actorFromSeed('md@nfc.local', [yfz, dma, nfc]);
    emeka = actorFromSeed('ed.finance@nfc.local', [yfz, dma, nfc]);
    grace = actorFromSeed('fh.yfz@nfc.local', [yfz]);
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
    fundingB = funding.find((row) => row.key === 'nfc_holding')?.id ?? '';
    fundingC = funding.find((row) => row.key === 'corporate_allocation')?.id ?? '';
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

  async function fillAndSubmit(title: string, fundingSourceId = fundingA, withBudget = true) {
    return submitNeedApprovedProposal(
      { ...flow, fundingId: fundingSourceId, budgetLineId: withBudget ? budgetLineId : null },
      { title, quantity: 2, unitPriceKobo: 200_000 },
    );
  }

  async function walkToFinance(title: string, fundingSourceId = fundingA, withBudget = true) {
    const submitted = await fillAndSubmit(title, fundingSourceId, withBudget);
    return walkPastOpsAndMd(procurement, workflows, halima, abubakar, submitted);
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

  it('returns live checks including the cross-subsidiary duplicate invoice', async () => {
    const seeded = await checks.evaluate(emeka, YFZ_PROCUREMENT_AWAITING_FINANCE_ID);
    expect(seeded.find((row) => row.key === 'amount')?.result).toBe('PASS');
    expect(seeded.find((row) => row.key === 'vendor')?.result).toBe('PASS');
    expect(seeded.find((row) => row.key === 'duplicate_invoice')?.result).toBe('FAIL');
    const banks = await new BankAccountsService(new UnitOfWork(app)).list(emeka);
    expect(banks.some((row) => row.id === YFZ_BANK_ACCOUNT_ID)).toBe(true);
  });

  it('refuses finance approve over FAIL without an override, then records route A', async () => {
    const tiny = await procurement.createBudgetLine(emeka, {
      entityId: yfz,
      fiscalYear: 2026,
      code: `TINY-${randomUUID().slice(0, 8)}`,
      name: 'Insufficient line',
      approvedAmountKobo: 100,
    });
    const submitted = await submitNeedApprovedProposal(
      { ...flow, budgetLineId: tiny.id },
      { title: `M8 fail override ${randomUUID()}`, quantity: 2, unitPriceKobo: 200_000 },
    );
    const atFinance = await walkPastOpsAndMd(procurement, workflows, halima, abubakar, submitted);
    const workflow = await workflows.get(emeka, atFinance.workflowInstanceId!);
    await expect(
      procurement.act(emeka, atFinance.id, {
        action: 'APPROVE',
        rowVersion: workflow.rowVersion,
        fundingRoute: 'subsidiary_operating',
        sourceAccountId: YFZ_BANK_ACCOUNT_ID,
        checklistAcknowledged: true,
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);

    const approved = await procurement.act(emeka, atFinance.id, {
      action: 'APPROVE',
      rowVersion: workflow.rowVersion,
      fundingRoute: 'subsidiary_operating',
      sourceAccountId: YFZ_BANK_ACCOUNT_ID,
      checklistAcknowledged: true,
      overrideReason: 'Duplicate invoice is a known re-issue from XYZ.',
    });
    expect(approved.status).toBe('AWAITING_PAYMENT');
    expect(approved.fundingRoute).toBe('subsidiary_operating');
    expect(approved.financialReview?.overrideReason).toMatch(/re-issue/);
    expect(approved.authorizedAmountKobo).toBe(400_000);
  });

  it('lets the YFZ Finance Head pay; refuses DMA, a different amount, a double bank ref, and the Administrator', async () => {
    const atFinance = await walkToFinance(`M8 pay ${randomUUID()}`);
    const workflow = await workflows.get(emeka, atFinance.workflowInstanceId!);
    const approved = await procurement.act(emeka, atFinance.id, {
      action: 'APPROVE',
      rowVersion: workflow.rowVersion,
      fundingRoute: 'subsidiary_operating',
      sourceAccountId: YFZ_BANK_ACCOUNT_ID,
      checklistAcknowledged: true,
    });
    const file = await proof(grace, approved.id, 'pay-a');
    await expect(
      payments.completePayment(dmaFh, approved.id, {
        payingAccountId: YFZ_BANK_ACCOUNT_ID,
        amountKobo: 400_000,
        method: 'bank_transfer',
        bankReference: `BNK-${randomUUID().slice(0, 8)}`,
        paymentDate: '2026-10-03',
        proofDocumentId: file.id,
        idempotencyKey: `dma-${approved.id}`,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      payments.completePayment(admin, approved.id, {
        payingAccountId: YFZ_BANK_ACCOUNT_ID,
        amountKobo: 400_000,
        method: 'bank_transfer',
        bankReference: `ADM-${randomUUID().slice(0, 8)}`,
        paymentDate: '2026-10-03',
        proofDocumentId: file.id,
        idempotencyKey: `adm-${approved.id}`,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      payments.completePayment(grace, approved.id, {
        payingAccountId: YFZ_BANK_ACCOUNT_ID,
        amountKobo: 400_001,
        method: 'bank_transfer',
        bankReference: `AMT-${randomUUID().slice(0, 8)}`,
        paymentDate: '2026-10-03',
        proofDocumentId: file.id,
        idempotencyKey: `amt-${approved.id}`,
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);

    const bankRef = `YFZ-${randomUUID().slice(0, 8)}`;
    const key = `pay-${approved.id}`;
    const paid = await payments.completePayment(grace, approved.id, {
      payingAccountId: YFZ_BANK_ACCOUNT_ID,
      amountKobo: 400_000,
      method: 'bank_transfer',
      bankReference: bankRef,
      paymentDate: '2026-10-03',
      proofDocumentId: file.id,
      idempotencyKey: key,
    });
    expect(paid.status).toBe('AWAITING_DELIVERY');
    expect(paid.payments).toHaveLength(1);
    const again = await payments.completePayment(grace, approved.id, {
      payingAccountId: YFZ_BANK_ACCOUNT_ID,
      amountKobo: 400_000,
      method: 'bank_transfer',
      bankReference: bankRef,
      paymentDate: '2026-10-03',
      proofDocumentId: file.id,
      idempotencyKey: key,
    });
    expect(again.payments).toHaveLength(1);

    const seals = (await workflows.get(grace, paid.workflowInstanceId!)).seals;
    const actions = seals.map((seal) => seal.action);
    expect(actions).toEqual(expect.arrayContaining(['submitted', 'approved', 'paid']));
    expect(seals.every((seal) => seal.verification === 'VALID')).toBe(true);

    const wf = await workflows.get(emeka, paid.workflowInstanceId!);
    await expect(
      procurement.act(emeka, paid.id, {
        action: 'REJECT',
        reason: 'Too late',
        rowVersion: wf.rowVersion,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('blocks payment after the vendor is suspended, then pays route B as ED Finance', async () => {
    const atFinance = await walkToFinance(`M8 route B ${randomUUID()}`, fundingB);
    const workflow = await workflows.get(emeka, atFinance.workflowInstanceId!);
    const approved = await procurement.act(emeka, atFinance.id, {
      action: 'APPROVE',
      rowVersion: workflow.rowVersion,
      fundingRoute: 'nfc_holding',
      sourceAccountId: NFC_BANK_ACCOUNT_ID,
      checklistAcknowledged: true,
    });
    expect(approved.status).toBe('AWAITING_PAYMENT');
    await owner.query(`UPDATE vendors SET status = 'SUSPENDED', updated_by = $2 WHERE id = $1`, [
      XYZ_VENDOR_ID,
      emeka.ref,
    ]);
    const file = await proof(emeka, approved.id, 'pay-b');
    await expect(
      payments.completePayment(emeka, approved.id, {
        payingAccountId: NFC_BANK_ACCOUNT_ID,
        amountKobo: 400_000,
        method: 'bank_transfer',
        bankReference: `HOLD-${randomUUID().slice(0, 8)}`,
        paymentDate: '2026-10-03',
        proofDocumentId: file.id,
        idempotencyKey: `hold-${approved.id}`,
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
    await owner.query(`UPDATE vendors SET status = 'ACTIVE', updated_by = $2 WHERE id = $1`, [
      XYZ_VENDOR_ID,
      emeka.ref,
    ]);
    await expect(
      payments.completePayment(grace, approved.id, {
        payingAccountId: NFC_BANK_ACCOUNT_ID,
        amountKobo: 400_000,
        method: 'bank_transfer',
        bankReference: `FH-${randomUUID().slice(0, 8)}`,
        paymentDate: '2026-10-03',
        proofDocumentId: file.id,
        idempotencyKey: `fh-b-${approved.id}`,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const paid = await payments.completePayment(emeka, approved.id, {
      payingAccountId: NFC_BANK_ACCOUNT_ID,
      amountKobo: 400_000,
      method: 'bank_transfer',
      bankReference: `NFC-${randomUUID().slice(0, 8)}`,
      paymentDate: '2026-10-03',
      proofDocumentId: file.id,
      idempotencyKey: `b-${approved.id}`,
    });
    expect(paid.status).toBe('AWAITING_DELIVERY');
    expect(paid.fundingRoute).toBe('nfc_holding');
  });

  it('records a route C transfer then a Finance Head payment, and a visible reversal', async () => {
    const atFinance = await walkToFinance(`M8 route C ${randomUUID()}`, fundingC);
    const workflow = await workflows.get(emeka, atFinance.workflowInstanceId!);
    const approved = await procurement.act(emeka, atFinance.id, {
      action: 'APPROVE',
      rowVersion: workflow.rowVersion,
      fundingRoute: 'corporate_allocation',
      sourceAccountId: NFC_BANK_ACCOUNT_ID,
      destinationAccountId: YFZ_BANK_ACCOUNT_ID,
      checklistAcknowledged: true,
    });
    expect(approved.status).toBe('FUNDING_PENDING');
    const proofDoc = await proof(emeka, approved.id, 'trf');
    const transferred = await payments.recordTransfer(emeka, {
      requestId: approved.id,
      sourceAccountId: NFC_BANK_ACCOUNT_ID,
      destinationAccountId: YFZ_BANK_ACCOUNT_ID,
      amountKobo: 400_000,
      purpose: `Allocation for ${approved.referenceNumber}`,
      transferDate: '2026-10-02',
      transferMethod: 'bank_transfer',
      bankReference: `TRF-${randomUUID().slice(0, 8)}`,
      proofDocumentId: proofDoc.id,
    });
    expect(transferred.status).toBe('AWAITING_PAYMENT');
    expect(transferred.transfers[0]?.referenceNumber).toMatch(/^TRF-/);
    const payProof = await proof(grace, approved.id, 'pay-c');
    const paid = await payments.completePayment(grace, approved.id, {
      payingAccountId: YFZ_BANK_ACCOUNT_ID,
      amountKobo: 400_000,
      method: 'bank_transfer',
      bankReference: `C-${randomUUID().slice(0, 8)}`,
      paymentDate: '2026-10-03',
      proofDocumentId: payProof.id,
      idempotencyKey: `c-${approved.id}`,
    });
    expect(paid.status).toBe('AWAITING_DELIVERY');
    const paymentId = paid.payments[0]?.id;
    expect(paymentId).toBeTruthy();
    await payments.requestReversal(grace, paymentId!, 'Bank advised the amount was posted short.');
    const reversed = await payments.approveReversal(
      emeka,
      paymentId!,
      'Finance Head changed payment amount from ₦4,000.00 to a replacement payment.',
    );
    expect(reversed.payments[0]?.reversedAt).toBeTruthy();
    expect(reversed.status).toBe('AWAITING_PAYMENT');
    expect(reversed.reversals.some((row) => row.status === 'APPROVED')).toBe(true);
  });

  it('records payment from funding defaults without method, bank reference, date, or proof', async () => {
    const atFinance = await walkToFinance(`M8 pay defaults ${randomUUID()}`);
    const workflow = await workflows.get(emeka, atFinance.workflowInstanceId!);
    const approved = await procurement.act(emeka, atFinance.id, {
      action: 'APPROVE',
      rowVersion: workflow.rowVersion,
      fundingRoute: 'subsidiary_operating',
      sourceAccountId: YFZ_BANK_ACCOUNT_ID,
      checklistAcknowledged: true,
    });
    const paid = await payments.completePayment(grace, approved.id, {
      idempotencyKey: `defaults-${approved.id}`,
    });
    expect(paid.status).toBe('AWAITING_DELIVERY');
    expect(paid.payments).toHaveLength(1);
    expect(paid.payments[0]?.method).toBe('bank_transfer');
    expect(paid.payments[0]?.bankReference).toMatch(/^PAY-/);
    expect(paid.payments[0]?.payingAccountName).toBeTruthy();
    expect(paid.payments[0]?.proofDocumentId).toBeNull();
  });
});
