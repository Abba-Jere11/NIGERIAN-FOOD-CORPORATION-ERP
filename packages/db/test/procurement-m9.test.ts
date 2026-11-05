/**
 * M9 GM verification, GRN, close-short, completion, package.
 */
import { createHash, randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  DEFAULT_ROLE_GRANTS,
  SEED_USERS,
  XYZ_VENDOR_ID,
  YFZ_BANK_ACCOUNT_ID,
  YFZ_PROCUREMENT_AWAITING_DELIVERY_ID,
  type PermissionKey,
} from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { DocumentsService } from '../../../apps/api/src/documents/documents.service';
import { FileStorageDriver } from '../../../apps/api/src/documents/file-storage';
import { NoopMalwareScanner } from '../../../apps/api/src/documents/malware';
import { TimelineService } from '../../../apps/api/src/engines/timeline.service';
import { DeliveryService } from '../../../apps/api/src/procurement/delivery.service';
import { renderProcurementRecordPdf } from '../../../apps/api/src/procurement/record-pdf';
import { readZipStoreEntry } from '../../../apps/api/src/procurement/zip-store';
import { FinancialChecksService } from '../../../apps/api/src/procurement/financial-checks.service';
import { PaymentsService } from '../../../apps/api/src/procurement/payments.service';
import { ProcurementService } from '../../../apps/api/src/procurement/procurement.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { VendorValidationService } from '../../../apps/api/src/vendors/vendor-validation.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import { RequisitionsService } from '../../../apps/api/src/procurement/requisitions.service';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../apps/api/src/common/errors/domain-error';
import {
  openNeedApprovedDraft,
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

function pdfContainsText(pdf: Buffer, text: string): boolean {
  const contiguous = pdf.toString('hex').includes(Buffer.from(text, 'utf8').toString('hex'));
  if (contiguous) return true;
  const stream = extractPdfText(pdf);
  const literals = [...stream.matchAll(/<([0-9a-fA-F]+)>/g)].map((match) =>
    Buffer.from(match[1]!, 'hex').toString('utf8'),
  );
  return literals.join('').includes(text);
}

function extractPdfText(pdf: Buffer): string {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < pdf.length) {
    let start = pdf.indexOf(Buffer.from('stream\n'), offset);
    let headerLen = 7;
    if (start < 0) {
      start = pdf.indexOf(Buffer.from('stream\r\n'), offset);
      headerLen = 8;
    }
    if (start < 0) break;
    const dataStart = start + headerLen;
    let end = pdf.indexOf(Buffer.from('\nendstream'), dataStart);
    if (end < 0) end = pdf.indexOf(Buffer.from('\r\nendstream'), dataStart);
    if (end < 0) break;
    try {
      chunks.push(inflateSync(pdf.subarray(dataStart, end)).toString('latin1'));
    } catch {
      // skip non-deflate streams
    }
    offset = end + 10;
  }
  return chunks.join('\n');
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

describe('M9 procurement delivery', () => {
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
  let timeline: TimelineService;
  let musa: ActorContext;
  let officer: ActorContext;
  let admin: ActorContext;
  let halima: ActorContext;
  let abubakar: ActorContext;
  let emeka: ActorContext;
  let grace: ActorContext;
  let dmaGm: ActorContext;
  let departmentId: string;
  let servicesId: string;
  let equipmentId: string;
  let unitId: string;
  let fundingA: string;
  let budgetLineId: string;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-m9-owner');
    app = appPool('nfc-erp-test-m9-app');
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
    timeline = new TimelineService(uow);
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
    officer = actorFromSeed('inventory@nfc.local', [yfz, dma, nfc]);
    admin = actorFromSeed('administrator@nfc.local', [nfc, yfz]);
    halima = actorFromSeed('ed.operations@nfc.local', [yfz, dma, nfc]);
    abubakar = actorFromSeed('md@nfc.local', [yfz, dma, nfc]);
    emeka = actorFromSeed('ed.finance@nfc.local', [yfz, dma, nfc]);
    grace = actorFromSeed('fh.yfz@nfc.local', [yfz]);
    dmaGm = actorFromSeed('gm.dma@nfc.local', [dma]);

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
    return documents.upload(musa, {
      title: name,
      category: 'completion_certificate',
      context: 'procurement',
      entityId: yfz,
      ownerType: 'procurement_request',
      ownerId: requestId,
      file: { buffer: PNG, originalname: `${name}.png` },
    });
  }

  async function payToDelivery(
    title: string,
    quantity = 1000,
    unitPriceKobo = 400,
    categoryId = servicesId,
  ) {
    const submitted = await submitNeedApprovedProposal(
      { ...flow, categoryId },
      {
        title,
        quantity,
        unitPriceKobo,
        invoiceRequired: categoryId === equipmentId,
      },
    );
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
      amountKobo: approved.authorizedAmountKobo ?? quantity * unitPriceKobo,
      method: 'bank_transfer',
      bankReference: `M9-${randomUUID().slice(0, 8)}`,
      paymentDate: '2026-10-03',
      proofDocumentId: file.id,
      idempotencyKey: `m9-pay-${approved.id}`,
    });
  }

  it('keeps paid distinct from completed on the seeded awaiting-delivery request', async () => {
    const view = await procurement.get(musa, YFZ_PROCUREMENT_AWAITING_DELIVERY_ID);
    expect(view.status).toBe('AWAITING_DELIVERY');
    expect(view.acceptedQuantityTotal).toBe(0);
    expect(view.outstandingQuantity).toBe(1000);
  });

  it('records 800 then 200 and completes on the filling GRN', async () => {
    const paid = await payToDelivery(`M9 800/200 ${randomUUID()}`);
    expect(paid.status).toBe('AWAITING_DELIVERY');
    const firstDoc = await evidence(paid.id, 'cert-1');
    const partial = await delivery.recordReceipt(officer, paid.id, {
      receivedDate: '2026-10-03',
      location: 'YFZ mill stores',
      quantityReceived: 800,
      quantityAccepted: 800,
      secondBatchDueOn: '2026-12-15',
      idempotencyKey: `grn-800-${paid.id}`,
      documents: [{ documentId: firstDoc.id, kind: 'completion_certificate' }],
    });
    expect(partial.status).toBe('PARTIALLY_RECEIVED');
    expect(partial.acceptedQuantityTotal).toBe(800);
    expect(partial.outstandingQuantity).toBe(200);
    expect(partial.receipts[0]?.referenceNumber).toMatch(/^GRN-/);

    const same = await delivery.recordReceipt(officer, paid.id, {
      receivedDate: '2026-10-03',
      location: 'YFZ mill stores',
      quantityReceived: 800,
      quantityAccepted: 800,
      secondBatchDueOn: '2026-12-15',
      idempotencyKey: `grn-800-${paid.id}`,
      documents: [{ documentId: firstDoc.id, kind: 'completion_certificate' }],
    });
    expect(same.receipts).toHaveLength(1);

    const remainder = await delivery.recordReceipt(officer, paid.id, {
      receivedDate: '2026-10-04',
      location: 'YFZ mill stores',
      quantityReceived: 200,
      quantityAccepted: 200,
      idempotencyKey: `grn-200-${paid.id}`,
      documents: [],
    });
    expect(remainder.status).toBe('COMPLETED');
    expect(remainder.acceptedQuantityTotal).toBe(1000);

    const events = await owner.query<{ event_type: string }>(
      `SELECT event_type FROM domain_events WHERE subject_id = $1 AND event_type IN ('goods.received', 'procurement.completed')`,
      [paid.id],
    );
    expect(events.rows.filter((row) => row.event_type === 'goods.received')).toHaveLength(2);
    expect(events.rows.filter((row) => row.event_type === 'procurement.completed')).toHaveLength(1);

    const seals = (await workflows.get(musa, paid.workflowInstanceId!)).seals;
    expect(seals.map((seal) => seal.action)).toEqual(
      expect.arrayContaining(['submitted', 'approved', 'paid', 'verified']),
    );
    expect(seals.every((seal) => seal.verification === 'VALID')).toBe(true);

    const again = await delivery.complete(officer, paid.id);
    expect(again.status).toBe('COMPLETED');
    const completedAgain = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM domain_events WHERE subject_id = $1 AND event_type = 'procurement.completed'`,
      [paid.id],
    );
    expect(Number(completedAgain.rows[0]?.n)).toBe(1);

    const pack = await delivery.packageZip(musa, paid.id);
    expect(pack.buffer.subarray(0, 2).toString()).toBe('PK');
    const text = pack.buffer.toString('utf8');
    expect(text).toContain('manifest.json');
    const start = text.indexOf('{');
    const manifestSlice = text.slice(start);
    expect(manifestSlice).toContain('"sha256"');
    expect(createHash('sha256').update(pack.buffer).digest('hex')).toHaveLength(64);
  });

  it('requires both close-short approvals and writes a vendor claim', async () => {
    const paid = await payToDelivery(`M9 close-short ${randomUUID()}`);
    const cert = await evidence(paid.id, 'cert-cs');
    await delivery.recordReceipt(officer, paid.id, {
      receivedDate: '2026-10-03',
      location: 'YFZ mill stores',
      quantityReceived: 800,
      quantityAccepted: 800,
      secondBatchDueOn: '2026-12-15',
      idempotencyKey: `cs-800-${paid.id}`,
      documents: [{ documentId: cert.id, kind: 'completion_certificate' }],
    });
    const requested = await delivery.requestCloseShort(officer, paid.id, 'Vendor short-shipped two hundred units.');
    expect(requested.status).toBe('PARTIALLY_RECEIVED');
    expect(requested.closeShort?.status).toBe('PENDING');
    const instanceId = requested.closeShort?.workflowInstanceId;
    expect(instanceId).toBeTruthy();

    await expect(delivery.complete(officer, paid.id)).rejects.toBeInstanceOf(ConflictError);

    const afterOps = await workflows.act(halima, {
      instanceId: instanceId!,
      action: 'APPROVE',
      rowVersion: (await workflows.get(halima, instanceId!)).rowVersion,
    });
    expect(afterOps.status).toBe('IN_PROGRESS');
    const claimsBefore = await owner.query(`SELECT 1 FROM vendor_open_claims WHERE request_id = $1`, [paid.id]);
    expect(claimsBefore.rows).toHaveLength(0);

    await workflows.act(emeka, {
      instanceId: instanceId!,
      action: 'APPROVE',
      rowVersion: (await workflows.get(emeka, instanceId!)).rowVersion,
    });
    const claims = await owner.query<{ quantity: number }>(
      `SELECT quantity FROM vendor_open_claims WHERE request_id = $1`,
      [paid.id],
    );
    expect(claims.rows[0]?.quantity).toBe(200);

    const completed = await delivery.complete(officer, paid.id);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.closeShort?.status).toBe('APPROVED');

    const umar = SEED_USERS.find((user) => user.email === 'ed.operations@nfc.local')!.name;
    const jere = SEED_USERS.find((user) => user.email === 'ed.finance@nfc.local')!.name;
    const events = await timeline.list(musa, 'PROCUREMENT', paid.id);
    const texts = events.map((event) => event.text);
    expect(events.some((event) => event.actor === umar && event.text.includes('Close-short reviewed'))).toBe(
      true,
    );
    expect(events.some((event) => event.actor === jere && event.text.includes('Close-short approved by'))).toBe(
      true,
    );
    expect(texts.some((text) => text.includes('Vendor open claim recorded') && text.includes('200 units'))).toBe(
      true,
    );

    const pack = await delivery.packageZip(musa, paid.id);
    const manifestRaw = readZipStoreEntry(pack.buffer, 'manifest.json');
    expect(manifestRaw).toBeTruthy();
    const manifest = JSON.parse(manifestRaw!.toString('utf8')) as {
      closeShort?: {
        decisions: unknown[];
        vendorOpenClaim?: { quantity: number };
      };
    };
    expect(manifest.closeShort?.decisions).toHaveLength(2);
    expect(manifest.closeShort?.vendorOpenClaim?.quantity).toBe(200);
    expect(readZipStoreEntry(pack.buffer, 'vendor-open-claim.json')).toBeTruthy();

    expect(completed.closeShort?.approvals).toHaveLength(2);
    expect(completed.closeShort?.approvals.map((row) => row.stageLabel)).toEqual([
      'ED Operations',
      'ED Finance',
    ]);
    expect(completed.closeShort?.vendorOpenClaim?.quantity).toBe(200);

    const pdf = await renderProcurementRecordPdf(completed);
    expect(pdfContainsText(pdf, 'Close-short')).toBe(true);
    expect(pdfContainsText(pdf, 'Vendor open claim')).toBe(true);
    expect(pdfContainsText(pdf, 'ED Operations')).toBe(true);
    expect(pdfContainsText(pdf, completed.closeShort!.approvals[0]!.actorName)).toBe(true);
    expect(pdfContainsText(pdf, completed.closeShort!.approvals[1]!.actorName)).toBe(true);
    expect(extractPdfText(pdf).length).toBeGreaterThan(100);
  });

  it('includes close-short reject reason on the main procurement timeline', async () => {
    const jere = SEED_USERS.find((user) => user.email === 'ed.finance@nfc.local')!.name;
    const paid = await payToDelivery(`M9 close-short reject ${randomUUID()}`);
    const cert = await evidence(paid.id, 'cert-reject');
    await delivery.recordReceipt(officer, paid.id, {
      receivedDate: '2026-10-03',
      location: 'YFZ mill stores',
      quantityReceived: 800,
      quantityAccepted: 800,
      secondBatchDueOn: '2026-12-15',
      idempotencyKey: `reject-800-${paid.id}`,
      documents: [{ documentId: cert.id, kind: 'completion_certificate' }],
    });
    const requested = await delivery.requestCloseShort(officer, paid.id, 'Remainder unlikely to arrive.');
    const instanceId = requested.closeShort?.workflowInstanceId;
    expect(instanceId).toBeTruthy();
    await workflows.act(halima, {
      instanceId: instanceId!,
      action: 'APPROVE',
      rowVersion: (await workflows.get(halima, instanceId!)).rowVersion,
    });
    const rejectReason = 'Vendor confirmed the balance will not be supplied.';
    await workflows.act(emeka, {
      instanceId: instanceId!,
      action: 'REJECT',
      reason: rejectReason,
      rowVersion: (await workflows.get(emeka, instanceId!)).rowVersion,
    });
    const events = await timeline.list(musa, 'PROCUREMENT', paid.id);
    expect(
      events.some(
        (event) => event.actor === jere && event.text.includes(rejectReason) && event.text.includes('rejected'),
      ),
    ).toBe(true);
  });

  it('refuses DMA GM, Administrator, and the wrong status', async () => {
    const paid = await payToDelivery(`M9 refuse ${randomUUID()}`);
    const draft = await openNeedApprovedDraft(flow, { title: `M9 draft ${randomUUID()}` });
    try {
      await delivery.recordReceipt(dmaGm, paid.id, {
        receivedDate: '2026-10-03',
        location: 'DMA',
        quantityReceived: 1,
        quantityAccepted: 1,
        idempotencyKey: `dma-${paid.id}`,
        documents: [],
      });
      throw new Error('DMA GM should not record a YFZ GRN');
    } catch (error) {
      expect(error instanceof ForbiddenError || error instanceof NotFoundError).toBe(true);
    }
    await expect(
      delivery.recordReceipt(admin, paid.id, {
        receivedDate: '2026-10-03',
        location: 'Admin',
        quantityReceived: 1,
        quantityAccepted: 1,
        idempotencyKey: `admin-${paid.id}`,
        documents: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      delivery.recordReceipt(musa, paid.id, {
        receivedDate: '2026-10-03',
        location: 'YFZ',
        quantityReceived: 1,
        quantityAccepted: 1,
        idempotencyKey: `gm-${paid.id}`,
        documents: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      delivery.recordReceipt(officer, draft.id, {
        receivedDate: '2026-10-03',
        location: 'YFZ',
        quantityReceived: 1,
        quantityAccepted: 1,
        idempotencyKey: `draft-${draft.id}`,
        documents: [],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(delivery.reports(admin)).rejects.toBeInstanceOf(ForbiddenError);
    try {
      await delivery.packageZip(admin, paid.id);
      throw new Error('Administrator should not download a procurement package');
    } catch (error) {
      expect(error instanceof ForbiddenError || error instanceof NotFoundError).toBe(true);
    }
  });

  it('completes an equipment GRN when one of the listed document kinds is attached', async () => {
    const paid = await payToDelivery(`M9 equipment one-doc ${randomUUID()}`, 2, 50_000, equipmentId);
    expect(paid.requiredDeliveryDocumentSet).toEqual(
      expect.arrayContaining(['delivery_note', 'installation_certificate']),
    );
    const note = await documents.upload(musa, {
      title: 'Delivery note only',
      category: 'delivery_note',
      context: 'procurement',
      entityId: yfz,
      ownerType: 'procurement_request',
      ownerId: paid.id,
      file: { buffer: PNG, originalname: 'delivery-note.png' },
    });
    const completed = await delivery.recordReceipt(officer, paid.id, {
      receivedDate: '2026-10-03',
      location: 'YFZ mill stores',
      quantityReceived: 2,
      quantityAccepted: 2,
      idempotencyKey: `grn-eq-${paid.id}`,
      documents: [{ documentId: note.id, kind: 'delivery_note' }],
    });
    expect(completed.status).toBe('COMPLETED');
  });
});
