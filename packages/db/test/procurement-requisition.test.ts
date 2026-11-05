/**
 * Dual-approval addendum: GM requisition, MD need-approval, PM proposal,
 * category-gated ED Operations, commitment on PM submit, 7/8-seal chains.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { DEFAULT_ROLE_GRANTS, SEED_USERS, XYZ_VENDOR_ID, YFZ_BANK_ACCOUNT_ID, type PermissionKey } from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { DocumentsService } from '../../../apps/api/src/documents/documents.service';
import { FileStorageDriver } from '../../../apps/api/src/documents/file-storage';
import { NoopMalwareScanner } from '../../../apps/api/src/documents/malware';
import { FinancialChecksService } from '../../../apps/api/src/procurement/financial-checks.service';
import { ProcurementService } from '../../../apps/api/src/procurement/procurement.service';
import { RequisitionsService } from '../../../apps/api/src/procurement/requisitions.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { VendorValidationService } from '../../../apps/api/src/vendors/vendor-validation.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import { ForbiddenError } from '../../../apps/api/src/common/errors/domain-error';
import { PaymentsService } from '../../../apps/api/src/procurement/payments.service';
import { DeliveryService } from '../../../apps/api/src/procurement/delivery.service';
import { updateRequisitionSchema } from '../../../apps/api/src/procurement/procurement.dto';
import {
  submitNeedApprovedProposal,
  walkPastOpsAndMd,
  type DualApprovalDeps,
} from './procurement-flow';
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
  resetApiEnvCache();
}

function actorFromSeed(email: string, entityIds: string[]): ActorContext {
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
    permissions: [...DEFAULT_ROLE_GRANTS[user.role]] as PermissionKey[],
    homePath: '/',
  };
}

describe('dual-approval requisition', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let procurement: ProcurementService;
  let requisitions: RequisitionsService;
  let workflows: WorkflowsService;
  let documents: DocumentsService;
  let payments: PaymentsService;
  let delivery: DeliveryService;
  let musa: ActorContext;
  let officer: ActorContext;
  let abubakar: ActorContext;
  let halima: ActorContext;
  let emeka: ActorContext;
  let grace: ActorContext;
  let flow: DualApprovalDeps;
  let equipmentId: string;
  let servicesId: string;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-req-owner');
    app = appPool('nfc-erp-test-req-app');
    yfz = await entityIdFor(owner, 'YFZ');
    const dma = await entityIdFor(owner, 'DMA');
    const uow = new UnitOfWork(app);
    workflows = new WorkflowsService(uow, new SealsService());
    documents = new DocumentsService(uow, new FileStorageDriver(), new NoopMalwareScanner());
    const vendorValidation = new VendorValidationService(uow);
    procurement = new ProcurementService(
      uow,
      workflows,
      documents,
      vendorValidation,
      new FinancialChecksService(uow),
    );
    requisitions = new RequisitionsService(uow, workflows, documents);
    payments = new PaymentsService(uow, workflows, vendorValidation, procurement);
    delivery = new DeliveryService(uow, procurement, workflows, documents);
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
    officer = actorFromSeed('inventory@nfc.local', [yfz, dma]);
    abubakar = actorFromSeed('md@nfc.local', [yfz, dma]);
    halima = actorFromSeed('ed.operations@nfc.local', [yfz, dma]);
    emeka = actorFromSeed('ed.finance@nfc.local', [yfz, dma]);
    grace = actorFromSeed('fh.yfz@nfc.local', [yfz]);
    const dept = await owner.query<{ id: string }>(
      `SELECT id FROM departments WHERE entity_id = $1 AND status = 'ACTIVE' ORDER BY name LIMIT 1`,
      [yfz],
    );
    const cats = await procurement.categories(musa);
    equipmentId = cats.find((row) => row.key === 'equipment')?.id ?? '';
    servicesId = cats.find((row) => row.key === 'services')?.id ?? '';
    const units = await procurement.units(musa);
    const funding = await procurement.fundingSources(musa);
    const lines = await procurement.budgetLines(musa, yfz);
    flow = {
      requisitions,
      procurement,
      workflows,
      documents,
      gm: musa,
      md: abubakar,
      officer,
      entityId: yfz,
      departmentId: dept.rows[0]?.id ?? '',
      categoryId: servicesId,
      unitId: units.find((row) => row.code === 'PCS')?.id ?? '',
      fundingId: funding.find((row) => row.key === 'subsidiary_operating')?.id ?? '',
      budgetLineId: lines.find((row) => row.code === 'YFZ-CAPEX')?.id ?? '',
      vendorId: XYZ_VENDOR_ID,
    };
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  it('rejects prices on a requisition DTO and hides costs on the need memo', async () => {
    expect(() =>
      updateRequisitionSchema.parse({
        rowVersion: 1,
        title: 'Need',
        unitPriceKobo: 1,
      }),
    ).toThrow();
    const created = await requisitions.create(musa, { title: `Need ${randomUUID()}`, departmentId: flow.departmentId });
    const filled = await requisitions.update(musa, created.id, {
      rowVersion: created.rowVersion,
      title: created.title,
      departmentId: flow.departmentId,
      categoryId: servicesId,
      background: 'Background text.',
      justification: 'Justification text.',
      prayer: 'Approve the need.',
      requiredDate: '2026-12-20',
      deliveryLocation: 'YFZ mill stores',
      lines: [{ description: 'Need item', quantity: 2, unitId: flow.unitId }],
    });
    const submitted = await requisitions.submit(musa, created.id, { rowVersion: filled.rowVersion });
    const html = (await requisitions.memoHtml(musa, submitted.id)).html;
    expect(html).not.toMatch(/Naira/i);
    expect(html).not.toMatch(/amount/i);
    expect(html).toContain('Need item');
    expect(html).toContain(submitted.referenceNumber);
    await expect(procurement.create(musa, { title: 'GM priced PR' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('autofills the shell PR from the requisition and commits budget only on PM submit', async () => {
    const created = await requisitions.create(musa, {
      title: `Autofill ${randomUUID()}`,
      departmentId: flow.departmentId,
    });
    const filled = await requisitions.update(musa, created.id, {
      rowVersion: created.rowVersion,
      title: created.title,
      departmentId: flow.departmentId,
      categoryId: servicesId,
      background: 'Carry this background.',
      justification: 'Carry this justification.',
      prayer: 'Approve the need.',
      requiredDate: '2026-12-20',
      deliveryLocation: 'YFZ mill stores',
      lines: [{ description: 'Autofill item', quantity: 3, unitId: flow.unitId }],
    });
    const submitted = await requisitions.submit(musa, created.id, { rowVersion: filled.rowVersion });
    const shell = await procurement.get(officer, submitted.procurementRequestId!);
    expect(shell.title).toBe(created.title);
    expect(shell.description).toContain('Carry this background');
    expect(shell.reason).toContain('Carry this justification');
    expect(shell.lines[0]?.quantity).toBe(3);
    expect(shell.lines[0]?.unitPriceKobo ?? 0).toBe(0);
    const before = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM procurement_commitment_events WHERE request_id = $1`,
      [shell.id],
    );
    expect(Number(before.rows[0]?.n ?? 0)).toBe(0);
    const atNeed = await workflows.get(abubakar, submitted.workflowInstanceId!);
    await procurement.act(abubakar, shell.id, { action: 'APPROVE', rowVersion: atNeed.rowVersion });
    const still = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM procurement_commitment_events WHERE request_id = $1`,
      [shell.id],
    );
    expect(Number(still.rows[0]?.n ?? 0)).toBe(0);
    const prepared = await submitNeedApprovedProposal(flow, {
      title: `Commit ${randomUUID()}`,
      quantity: 2,
      unitPriceKobo: 100_000,
    });
    const events = await owner.query<{ action: string }>(
      `SELECT action FROM procurement_commitment_events WHERE request_id = $1 ORDER BY created_at`,
      [prepared.id],
    );
    expect(events.rows.map((row) => row.action)).toEqual(['OPEN']);
  });

  it('skips ED Operations for services and hits it for equipment', async () => {
    const services = await submitNeedApprovedProposal(flow, {
      title: `Skip ops ${randomUUID()}`,
    });
    expect(services.status).toBe('AWAITING_MD');
    const instance = await workflows.get(abubakar, services.workflowInstanceId!);
    expect(instance.currentStageKey).toBe('md');
    expect(instance.seals.some((seal) => seal.badgeLabel === 'OPERATIONS REVIEWED')).toBe(false);

    const equipment = await submitNeedApprovedProposal(
      { ...flow, categoryId: equipmentId },
      { title: `Hit ops ${randomUUID()}`, invoiceRequired: true },
    );
    expect(equipment.status).toBe('AWAITING_OPERATIONS');
    const atOps = await workflows.get(halima, equipment.workflowInstanceId!);
    expect(atOps.currentStageKey).toBe('ed-operations');
    await expect(
      procurement.act(abubakar, equipment.id, { action: 'APPROVE', rowVersion: atOps.rowVersion }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('returns need-approval to the GM and later stages to the Procurement Manager', async () => {
    const created = await requisitions.create(musa, {
      title: `Return need ${randomUUID()}`,
      departmentId: flow.departmentId,
    });
    const filled = await requisitions.update(musa, created.id, {
      rowVersion: created.rowVersion,
      title: created.title,
      departmentId: flow.departmentId,
      categoryId: servicesId,
      background: 'Background.',
      justification: 'Justification.',
      prayer: 'Approve the need.',
      requiredDate: '2026-12-20',
      deliveryLocation: 'YFZ mill stores',
      lines: [{ description: 'Item', quantity: 1, unitId: flow.unitId }],
    });
    const submitted = await requisitions.submit(musa, created.id, { rowVersion: filled.rowVersion });
    const atNeed = await workflows.get(abubakar, submitted.workflowInstanceId!);
    const returned = await procurement.act(abubakar, submitted.procurementRequestId!, {
      action: 'RETURN_FOR_CORRECTION',
      reason: 'Clarify the mill location.',
      rowVersion: atNeed.rowVersion,
    });
    expect(returned.status).toBe('DRAFT');
    const req = await requisitions.get(musa, created.id);
    expect(req.status).toBe('DRAFT');
    expect(req.currentVersion).toBe(2);

    const priced = await submitNeedApprovedProposal(
      { ...flow, categoryId: equipmentId },
      { title: `Return PM ${randomUUID()}`, invoiceRequired: true },
    );
    const atOps = await workflows.get(halima, priced.workflowInstanceId!);
    const backToPm = await procurement.act(halima, priced.id, {
      action: 'RETURN_FOR_CORRECTION',
      reason: 'Attach a second quotation.',
      rowVersion: atOps.rowVersion,
    });
    expect(backToPm.status).toBe('DRAFT');
    const stillNeed = await requisitions.get(musa, priced.requisitionId!);
    expect(stillNeed.status).toBe('NEED_APPROVED');
    await expect(
      procurement.update(musa, backToPm.id, { rowVersion: backToPm.rowVersion, title: backToPm.title }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  async function completeThroughDelivery(request: Awaited<ReturnType<typeof submitNeedApprovedProposal>>) {
    const atFinance = await walkPastOpsAndMd(procurement, workflows, halima, abubakar, request);
    const approved = await procurement.act(emeka, atFinance.id, {
      action: 'APPROVE',
      rowVersion: (await workflows.get(emeka, atFinance.workflowInstanceId!)).rowVersion,
      fundingRoute: 'subsidiary_operating',
      sourceAccountId: YFZ_BANK_ACCOUNT_ID,
      checklistAcknowledged: true,
    });
    const proof = await documents.upload(grace, {
      title: `pay ${approved.title}`,
      category: 'payment_proof',
      context: 'procurement',
      entityId: yfz,
      ownerType: 'procurement_request',
      ownerId: approved.id,
      file: {
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
        originalname: 'pay.png',
      },
    });
    const paid = await payments.completePayment(grace, approved.id, {
      payingAccountId: YFZ_BANK_ACCOUNT_ID,
      amountKobo: approved.authorizedAmountKobo ?? 400_000,
      method: 'bank_transfer',
      bankReference: `REQ-${randomUUID().slice(0, 8)}`,
      paymentDate: '2026-10-03',
      proofDocumentId: proof.id,
      idempotencyKey: `req-pay-${approved.id}`,
    });
    const png = {
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    };
    const cert = await documents.upload(officer, {
      title: `cert ${approved.title}`,
      category: 'completion_certificate',
      context: 'procurement',
      entityId: yfz,
      ownerType: 'procurement_request',
      ownerId: paid.id,
      file: { ...png, originalname: 'cert.png' },
    });
    const note = await documents.upload(officer, {
      title: `note ${approved.title}`,
      category: 'delivery_note',
      context: 'procurement',
      entityId: yfz,
      ownerType: 'procurement_request',
      ownerId: paid.id,
      file: { ...png, originalname: 'note.png' },
    });
    return delivery.recordReceipt(officer, paid.id, {
      receivedDate: '2026-10-04',
      location: 'YFZ mill stores',
      quantityReceived: paid.lines[0]?.quantity ?? 2,
      quantityAccepted: paid.lines[0]?.quantity ?? 2,
      idempotencyKey: `req-grn-${paid.id}`,
      documents: [
        { documentId: cert.id, kind: 'completion_certificate' },
        { documentId: note.id, kind: 'delivery_note' },
      ],
    });
  }

  it('keeps VALID 7-seal and 8-seal chains on v3 memos', async () => {
    const skipped = await completeThroughDelivery(
      await submitNeedApprovedProposal(flow, { title: `Seven seals ${randomUUID()}` }),
    );
    const skipHtml = (await procurement.memoHtml(musa, skipped.id)).html;
    expect(skipHtml).toContain('NEED APPROVED');
    expect(skipHtml).toContain('PREPARED BY');
    expect(skipHtml).not.toContain('OPERATIONS REVIEWED');
    expect(skipHtml).toContain('PROCUREMENT APPROVED');
    expect(skipHtml).toContain('FINANCE APPROVED');
    expect(skipHtml).toContain('PAID BY');
    expect(skipHtml).toContain('DELIVERY VERIFIED');
    const skipSeals = (await workflows.get(musa, skipped.workflowInstanceId!)).seals;
    expect(skipSeals.every((seal) => seal.verification === 'VALID')).toBe(true);
    expect(skipSeals).toHaveLength(7);

    const withOps = await completeThroughDelivery(
      await submitNeedApprovedProposal(
        { ...flow, categoryId: equipmentId },
        { title: `Eight seals ${randomUUID()}`, invoiceRequired: true },
      ),
    );
    const html = (await procurement.memoHtml(musa, withOps.id)).html;
    expect(html).toContain('OPERATIONS REVIEWED');
    expect(html).toContain('PROCUREMENT APPROVED');
    const seals = (await workflows.get(musa, withOps.workflowInstanceId!)).seals;
    expect(seals.every((seal) => seal.verification === 'VALID')).toBe(true);
    expect(seals.some((seal) => seal.badgeLabel === 'OPERATIONS REVIEWED')).toBe(true);
    expect(seals).toHaveLength(8);
  });
});
