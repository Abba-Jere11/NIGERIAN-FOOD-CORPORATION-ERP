/**
 * M2 payment timing: proposed on submit, MD final, post-lock exception + ED Finance ack.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  DEFAULT_ROLE_GRANTS,
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
import { FinancialChecksService } from '../../../apps/api/src/procurement/financial-checks.service';
import { PaymentsService } from '../../../apps/api/src/procurement/payments.service';
import { ProcurementService } from '../../../apps/api/src/procurement/procurement.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { VendorValidationService } from '../../../apps/api/src/vendors/vendor-validation.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import { RequisitionsService } from '../../../apps/api/src/procurement/requisitions.service';
import { ConflictError } from '../../../apps/api/src/common/errors/domain-error';
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

describe('M2 payment timing', () => {
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
  let musa: ActorContext;
  let officer: ActorContext;
  let flow: DualApprovalDeps;
  let halima: ActorContext;
  let abubakar: ActorContext;
  let emeka: ActorContext;
  let grace: ActorContext;
  let departmentId: string;
  let servicesId: string;
  let unitId: string;
  let fundingA: string;
  let budgetLineId: string;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-m2-timing-owner');
    app = appPool('nfc-erp-test-m2-timing-app');
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

  async function fillDraft(title: string, proposed?: 'before_delivery' | 'after_delivery' | null) {
    const created = await openNeedApprovedDraft(flow, { title });
    return pricePreparedDraft(flow, created, {
      title,
      quantity: 2,
      unitPriceKobo: 200_000,
      ...(proposed === undefined || proposed === null ? {} : { proposedPaymentTiming: proposed }),
    }).then(async (priced) => {
      if (proposed !== null) return priced;
      return procurement.update(officer, priced.id, {
        rowVersion: priced.rowVersion,
        proposedPaymentTiming: null,
      });
    });
  }

  async function fillAndSubmit(
    title: string,
    proposed: 'before_delivery' | 'after_delivery' = 'before_delivery',
  ) {
    return submitNeedApprovedProposal(flow, {
      title,
      quantity: 2,
      unitPriceKobo: 200_000,
      proposedPaymentTiming: proposed,
    });
  }

  async function walkToFinance(
    title: string,
    finalPaymentTiming?: 'before_delivery' | 'after_delivery',
  ) {
    const submitted = await fillAndSubmit(title);
    return walkPastOpsAndMd(
      procurement,
      workflows,
      halima,
      abubakar,
      submitted,
      finalPaymentTiming ? { finalPaymentTiming } : {},
    );
  }

  async function walkToPayment(title: string) {
    const atFinance = await walkToFinance(title);
    return procurement.act(emeka, atFinance.id, {
      action: 'APPROVE',
      rowVersion: (await workflows.get(emeka, atFinance.workflowInstanceId!)).rowVersion,
      fundingRoute: 'subsidiary_operating',
      sourceAccountId: YFZ_BANK_ACCOUNT_ID,
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

  it('refuses submit without proposed payment timing', async () => {
    const filled = await fillDraft(`M2 missing ${randomUUID()}`, null);
    await expect(procurement.submit(officer, filled.id, { rowVersion: filled.rowVersion })).rejects.toThrow(
      /proposed payment timing/,
    );
  });

  it('lets MD retain the proposed timing and keeps the pay-then-deliver queue', async () => {
    const afterMd = await walkToFinance(`M2 retain ${randomUUID()}`);
    expect(afterMd.status).toBe('AWAITING_ED_FINANCE');
    expect(afterMd.proposedPaymentTiming).toBe('before_delivery');
    expect(afterMd.finalPaymentTiming).toBe('before_delivery');
    expect(afterMd.timingChangePendingAck).toBe(false);
    expect(afterMd.finalPaymentTimingSetBy).toBe(abubakar.ref);
  });

  it('lets MD flip to after delivery without changing the M2 queue', async () => {
    const afterMd = await walkToFinance(`M2 flip ${randomUUID()}`, 'after_delivery');
    expect(afterMd.status).toBe('AWAITING_ED_FINANCE');
    expect(afterMd.proposedPaymentTiming).toBe('before_delivery');
    expect(afterMd.finalPaymentTiming).toBe('after_delivery');
  });

  it('locks timing after MD approve on PATCH and non-MD APPROVE', async () => {
    const afterMd = await walkToFinance(`M2 lock ${randomUUID()}`);
    await expect(
      procurement.update(officer, afterMd.id, {
        rowVersion: afterMd.rowVersion,
        proposedPaymentTiming: 'after_delivery',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      procurement.act(emeka, afterMd.id, {
        action: 'APPROVE',
        rowVersion: (await workflows.get(emeka, afterMd.workflowInstanceId!)).rowVersion,
        finalPaymentTiming: 'after_delivery',
        fundingRoute: 'subsidiary_operating',
        sourceAccountId: YFZ_BANK_ACCOUNT_ID,
        checklistAcknowledged: true,
      }),
    ).rejects.toThrow(/Managing Director/);
  });

  it('requires ED Finance ack after an exception and blocks payment until then', async () => {
    const awaitingPay = await walkToPayment(`M2 ack-pay ${randomUUID()}`);
    expect(awaitingPay.status).toBe('AWAITING_PAYMENT');

    const changed = await procurement.changePaymentTiming(abubakar, awaitingPay.id, {
      timing: 'after_delivery',
      reason: 'Vendor will deliver before invoice settlement.',
      rowVersion: awaitingPay.rowVersion,
    });
    expect(changed.finalPaymentTiming).toBe('after_delivery');
    expect(changed.timingChangePendingAck).toBe(true);
    expect(changed.status).toBe('AWAITING_PAYMENT');

    const file = await proof(changed.id, 'm2-blocked');
    await expect(
      payments.completePayment(grace, changed.id, {
        payingAccountId: YFZ_BANK_ACCOUNT_ID,
        amountKobo: 400_000,
        method: 'bank_transfer',
        bankReference: `M2-${randomUUID().slice(0, 8)}`,
        paymentDate: '2026-10-03',
        proofDocumentId: file.id,
        idempotencyKey: `m2-block-${changed.id}`,
      }),
    ).rejects.toThrow(/acknowledge/);

    const acked = await procurement.acknowledgePaymentTiming(emeka, changed.id, {
      rowVersion: changed.rowVersion,
    });
    expect(acked.timingChangePendingAck).toBe(false);

    await expect(
      payments.completePayment(grace, acked.id, {
        payingAccountId: YFZ_BANK_ACCOUNT_ID,
        amountKobo: 400_000,
        method: 'bank_transfer',
        bankReference: `M2-${randomUUID().slice(0, 8)}`,
        paymentDate: '2026-10-03',
        proofDocumentId: file.id,
        idempotencyKey: `m2-paid-${acked.id}`,
      }),
    ).rejects.toThrow(/accepted delivery/);
  });

  it('clears pending ack when ED Finance approves with the acknowledgement flag', async () => {
    const atFinance = await walkToFinance(`M2 finance-ack ${randomUUID()}`);
    const changed = await procurement.changePaymentTiming(abubakar, atFinance.id, {
      timing: 'after_delivery',
      reason: 'Align with the supply contract.',
      rowVersion: atFinance.rowVersion,
    });
    expect(changed.timingChangePendingAck).toBe(true);

    await expect(
      procurement.act(emeka, changed.id, {
        action: 'APPROVE',
        rowVersion: (await workflows.get(emeka, changed.workflowInstanceId!)).rowVersion,
        fundingRoute: 'subsidiary_operating',
        sourceAccountId: YFZ_BANK_ACCOUNT_ID,
        checklistAcknowledged: true,
      }),
    ).rejects.toThrow(/acknowledge the updated payment-timing/);

    const approved = await procurement.act(emeka, changed.id, {
      action: 'APPROVE',
      rowVersion: (await workflows.get(emeka, changed.workflowInstanceId!)).rowVersion,
      fundingRoute: 'subsidiary_operating',
      sourceAccountId: YFZ_BANK_ACCOUNT_ID,
      checklistAcknowledged: true,
      timingAcknowledged: true,
    });
    expect(approved.timingChangePendingAck).toBe(false);
    expect(approved.status).toBe('AWAITING_DELIVERY');
    expect(approved.finalPaymentTiming).toBe('after_delivery');
  });

  it('refuses an exception after a payment exists', async () => {
    const awaitingPay = await walkToPayment(`M2 after-pay ${randomUUID()}`);
    const file = await proof(awaitingPay.id, 'm2-paid-first');
    const paid = await payments.completePayment(grace, awaitingPay.id, {
      payingAccountId: YFZ_BANK_ACCOUNT_ID,
      amountKobo: 400_000,
      method: 'bank_transfer',
      bankReference: `M2-${randomUUID().slice(0, 8)}`,
      paymentDate: '2026-10-03',
      proofDocumentId: file.id,
      idempotencyKey: `m2-first-${awaitingPay.id}`,
    });
    await expect(
      procurement.changePaymentTiming(abubakar, paid.id, {
        timing: 'after_delivery',
        reason: 'Too late to change.',
        rowVersion: paid.rowVersion,
      }),
    ).rejects.toThrow(/after a payment/);
  });

  it('copies proposed timing only when cloning a rejected request', async () => {
    const submitted = await fillAndSubmit(`M2 clone ${randomUUID()}`);
    const rejected = await procurement.act(abubakar, submitted.id, {
      action: 'REJECT',
      reason: 'Outside the mill package.',
      rowVersion: (await workflows.get(abubakar, submitted.workflowInstanceId!)).rowVersion,
    });
    const cloned = await procurement.clone(officer, rejected.id);
    expect(cloned.status).toBe('DRAFT');
    expect(cloned.proposedPaymentTiming).toBe('before_delivery');
    expect(cloned.finalPaymentTiming).toBeNull();
    expect(cloned.timingChangePendingAck).toBe(false);
  });
});
