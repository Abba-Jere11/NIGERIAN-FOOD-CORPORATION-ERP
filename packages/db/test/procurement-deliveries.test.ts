/**
 * Multi-item deliveries, after-delivery payer activation, my-actions and paid notice targets.
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
import { DeliveryService } from '../../../apps/api/src/procurement/delivery.service';
import { FinancialChecksService } from '../../../apps/api/src/procurement/financial-checks.service';
import { PaymentsService } from '../../../apps/api/src/procurement/payments.service';
import { ProcurementService } from '../../../apps/api/src/procurement/procurement.service';
import { RequisitionsService } from '../../../apps/api/src/procurement/requisitions.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { VendorValidationService } from '../../../apps/api/src/vendors/vendor-validation.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import { ValidationFailedError } from '../../../apps/api/src/common/errors/domain-error';
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

describe('Procurement deliveries and next actions', () => {
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
  let delivery: DeliveryService;
  let flow: DualApprovalDeps;
  let musa: ActorContext;
  let officer: ActorContext;
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
    owner = ownerPool('nfc-erp-test-deliveries-owner');
    app = appPool('nfc-erp-test-deliveries-app');
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

  async function evidence(requestId: string, name: string) {
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

  async function payBeforeDelivery(title: string) {
    const submitted = await submitNeedApprovedProposal(flow, {
      title,
      extraLines: [
        {
          description: `${title} A`,
          categoryId: servicesId,
          quantity: 10,
          unitId,
          unitPriceKobo: 1_000,
          budgetLineId,
        },
        {
          description: `${title} B`,
          categoryId: servicesId,
          quantity: 5,
          unitId,
          unitPriceKobo: 2_000,
          budgetLineId,
        },
        {
          description: `${title} C`,
          categoryId: servicesId,
          quantity: 2,
          unitId,
          unitPriceKobo: 5_000,
          budgetLineId,
        },
      ],
      proposedPaymentTiming: 'before_delivery',
    });
    const atFinance = await walkPastOpsAndMd(procurement, workflows, halima, abubakar, submitted);
    const approved = await procurement.act(emeka, atFinance.id, {
      action: 'APPROVE',
      rowVersion: (await workflows.get(emeka, atFinance.workflowInstanceId!)).rowVersion,
      fundingRoute: 'subsidiary_operating',
      sourceAccountId: YFZ_BANK_ACCOUNT_ID,
      checklistAcknowledged: true,
    });
    const file = await documents.upload(grace, {
      title: `pay ${title}`,
      category: 'payment_proof',
      context: 'procurement',
      entityId: yfz,
      ownerType: 'procurement_request',
      ownerId: approved.id,
      file: { buffer: PNG, originalname: 'pay.png' },
    });
    return payments.completePayment(grace, approved.id, {
      payingAccountId: YFZ_BANK_ACCOUNT_ID,
      amountKobo: approved.authorizedAmountKobo ?? 30_000,
      method: 'bank_transfer',
      bankReference: `DEL-${randomUUID().slice(0, 8)}`,
      paymentDate: '2026-10-03',
      proofDocumentId: file.id,
      idempotencyKey: `del-pay-${approved.id}`,
    });
  }

  async function fundAfterDelivery(title: string) {
    const submitted = await submitNeedApprovedProposal(flow, {
      title,
      quantity: 4,
      unitPriceKobo: 25_000,
      proposedPaymentTiming: 'after_delivery',
    });
    const atFinance = await walkPastOpsAndMd(procurement, workflows, halima, abubakar, submitted, {
      finalPaymentTiming: 'after_delivery',
    });
    return procurement.act(emeka, atFinance.id, {
      action: 'APPROVE',
      rowVersion: (await workflows.get(emeka, atFinance.workflowInstanceId!)).rowVersion,
      fundingRoute: 'subsidiary_operating',
      sourceAccountId: YFZ_BANK_ACCOUNT_ID,
      checklistAcknowledged: true,
    });
  }

  it('records one shared delivery header with per-item accepted and rejected quantities', async () => {
    const paid = await payBeforeDelivery(`DEL multi ${randomUUID()}`);
    expect(paid.status).toBe('AWAITING_DELIVERY');
    expect(paid.lines).toHaveLength(3);
    const doc = await evidence(paid.id, 'multi-cert');
    const [lineA, lineB, lineC] = paid.lines;

    const recorded = await delivery.recordDelivery(officer, paid.id, {
      receivedDate: '2026-10-05',
      location: 'YFZ mill stores',
      documentKind: 'completion_certificate',
      notes: 'First consignment',
      idempotencyKey: `del-multi-${paid.id}`,
      documents: [{ documentId: doc.id, kind: 'completion_certificate' }],
      items: [
        {
          lineId: lineA!.id,
          quantityReceived: 10,
          quantityAccepted: 9,
          quantityRejected: 1,
          rejectReason: 'One unit damaged in transit',
          secondBatchDueOn: '2026-12-15',
        },
        {
          lineId: lineB!.id,
          quantityReceived: 5,
          quantityAccepted: 5,
          quantityRejected: 0,
        },
        {
          lineId: lineC!.id,
          quantityReceived: 2,
          quantityAccepted: 2,
          quantityRejected: 0,
        },
      ],
    });

    expect(recorded.deliveries).toHaveLength(1);
    const consignment = recorded.deliveries[0]!;
    expect(consignment.referenceNumber).toMatch(/^DEL-/);
    expect(consignment.location).toBe('YFZ mill stores');
    expect(consignment.items).toHaveLength(3);
    expect(consignment.items.find((item) => item.lineId === lineA!.id)?.quantityRejected).toBe(1);
    expect(recorded.lines.find((line) => line.id === lineA!.id)?.acceptedQuantity).toBe(9);
    expect(recorded.lines.find((line) => line.id === lineA!.id)?.outstandingQuantity).toBe(1);
    expect(recorded.status).toBe('PARTIALLY_RECEIVED');
    expect(recorded.nextAction?.key).toBe('verify_delivery');
  });

  it('rejects a delivery that over-accepts a line', async () => {
    const paid = await payBeforeDelivery(`DEL over ${randomUUID()}`);
    const doc = await evidence(paid.id, 'over-cert');
    const line = paid.lines[0]!;
    await expect(
      delivery.recordDelivery(officer, paid.id, {
        receivedDate: '2026-10-05',
        location: 'YFZ mill stores',
        documentKind: 'completion_certificate',
        idempotencyKey: `del-over-${paid.id}`,
        documents: [{ documentId: doc.id, kind: 'completion_certificate' }],
        items: [
          {
            lineId: line.id,
            quantityReceived: 99,
            quantityAccepted: 99,
            quantityRejected: 0,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('defers Finance Head holds until after-delivery verification, then notifies the payer', async () => {
    const funded = await fundAfterDelivery(`DEL after ${randomUUID()}`);
    expect(funded.status).toBe('AWAITING_DELIVERY');
    expect(funded.nextAction?.key).toBe('verify_delivery');

    const openBefore = await owner.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM workflow_holds
        WHERE subject_id = $1 AND status = 'open' AND holder_user_id = $2`,
      [funded.id, grace.ref],
    );
    expect(Number(openBefore.rows[0]?.count ?? 0)).toBe(0);

    const pendingBefore = await workflows.pending(grace);
    expect(pendingBefore.some((row) => row.subjectId === funded.id)).toBe(false);

    const doc = await evidence(funded.id, 'after-cert');
    const line = funded.lines[0]!;
    const verified = await delivery.recordDelivery(officer, funded.id, {
      receivedDate: '2026-10-06',
      location: 'YFZ mill stores',
      documentKind: 'completion_certificate',
      idempotencyKey: `del-after-${funded.id}`,
      documents: [{ documentId: doc.id, kind: 'completion_certificate' }],
      items: [
        {
          lineId: line.id,
          quantityReceived: line.quantity,
          quantityAccepted: line.quantity,
          quantityRejected: 0,
        },
      ],
    });
    expect(verified.status).toBe('AWAITING_PAYMENT');
    expect(verified.nextAction?.key).toBe('pay_vendor');
    expect(verified.nextAction?.label).toMatch(/verified delivery/i);

    const openAfter = await owner.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM workflow_holds
        WHERE subject_id = $1 AND status = 'open' AND holder_user_id = $2`,
      [verified.id, grace.ref],
    );
    expect(Number(openAfter.rows[0]?.count ?? 0)).toBeGreaterThan(0);

    const events = await owner.query<{ payload: { recipientUserId?: string; action?: string } }>(
      `SELECT payload FROM domain_events
        WHERE subject_id = $1 AND event_type = 'procurement.awaiting_review'
        ORDER BY occurred_at DESC`,
      [verified.id],
    );
    expect(events.rows.some((row) => row.payload.recipientUserId === grace.ref)).toBe(true);
    expect(events.rows.some((row) => /pay/i.test(String(row.payload.action ?? '')))).toBe(true);

    const mine = await procurement.myActions(grace);
    expect(mine.some((row) => row.requestId === verified.id && row.actionKey === 'pay_vendor')).toBe(true);
  });

  it('surfaces invoice upload on the Procurement Manager my-actions list', async () => {
    const submitted = await submitNeedApprovedProposal(flow, {
      title: `DEL invoice action ${randomUUID()}`,
      quantity: 1,
      unitPriceKobo: 40_000,
    });
    const atFinance = await walkPastOpsAndMd(procurement, workflows, halima, abubakar, submitted, {
      skipFinanceInvoice: true,
    });
    expect(atFinance.status).toBe('AWAITING_ED_FINANCE');
    expect(atFinance.nextAction?.key).toBe('upload_invoice');

    const officerActions = await procurement.myActions(officer);
    expect(
      officerActions.some((row) => row.requestId === atFinance.id && row.actionKey === 'upload_invoice'),
    ).toBe(true);

    const financeActions = await procurement.myActions(emeka);
    expect(financeActions.some((row) => row.requestId === atFinance.id)).toBe(false);
  });

  it('notifies the Procurement Manager after payment to verify each item', async () => {
    const paid = await payBeforeDelivery(`DEL paid notice ${randomUUID()}`);
    expect(paid.status).toBe('AWAITING_DELIVERY');

    const events = await owner.query<{ payload: { recipientUserId?: string } }>(
      `SELECT payload FROM domain_events
        WHERE subject_id = $1 AND event_type = 'procurement.paid'
        ORDER BY occurred_at`,
      [paid.id],
    );
    const recipients = events.rows.map((row) => row.payload.recipientUserId).filter(Boolean);
    expect(recipients).toContain(officer.ref);
    expect(recipients).toContain(musa.ref);
  });
});

