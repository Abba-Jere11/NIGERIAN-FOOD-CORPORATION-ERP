/**
 * M19 end-to-end dual-approval chain: requisition → pay → GRN → inventory signals.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { SEED_USERS, XYZ_VENDOR_ID, YFZ_BANK_ACCOUNT_ID, type PermissionKey } from '@nfc/shared';
import { DEFAULT_ROLE_GRANTS } from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { DocumentsService } from '../../../apps/api/src/documents/documents.service';
import { FileStorageDriver } from '../../../apps/api/src/documents/file-storage';
import { NoopMalwareScanner } from '../../../apps/api/src/documents/malware';
import { FinancialChecksService } from '../../../apps/api/src/procurement/financial-checks.service';
import { ProcurementService } from '../../../apps/api/src/procurement/procurement.service';
import { RequisitionsService } from '../../../apps/api/src/procurement/requisitions.service';
import { PaymentsService } from '../../../apps/api/src/procurement/payments.service';
import { DeliveryService } from '../../../apps/api/src/procurement/delivery.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { VendorValidationService } from '../../../apps/api/src/vendors/vendor-validation.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { searchIndex } from '../src/search';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import { submitNeedApprovedProposal, walkPastOpsAndMd, type DualApprovalDeps } from './procurement-flow';
import { appPool, entityIdFor, ownerPool } from './support';

function actor(email: string, entityIds: string[]): ActorContext {
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

describe('global dual-approval scenario (M19)', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let flow: DualApprovalDeps;
  let musa: ActorContext;
  let officer: ActorContext;
  let abubakar: ActorContext;
  let halima: ActorContext;
  let emeka: ActorContext;
  let grace: ActorContext;
  let procurement: ProcurementService;
  let workflows: WorkflowsService;
  let documents: DocumentsService;
  let payments: PaymentsService;
  let delivery: DeliveryService;

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= 'test-session-secret-not-for-production-use-32';
    process.env.SEAL_SIGNING_KEYS ??= JSON.stringify({
      v1: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });
    process.env.SEAL_ACTIVE_KID ??= 'v1';
    process.env.DOCUMENT_STORAGE ??= 'fs';
    resetApiEnvCache();
    owner = ownerPool('nfc-erp-test-global-owner');
    app = appPool('nfc-erp-test-global-app');
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
    const requisitions = new RequisitionsService(uow, workflows, documents);
    payments = new PaymentsService(uow, workflows, vendorValidation, procurement);
    delivery = new DeliveryService(uow, procurement, workflows, documents);
    musa = actor('gm.yfz@nfc.local', [yfz]);
    officer = actor('inventory@nfc.local', [yfz, dma]);
    abubakar = actor('md@nfc.local', [yfz, dma]);
    halima = actor('ed.operations@nfc.local', [yfz, dma]);
    emeka = actor('ed.finance@nfc.local', [yfz, dma]);
    grace = actor('fh.yfz@nfc.local', [yfz]);
    const dept = await owner.query<{ id: string }>(
      `SELECT id FROM departments WHERE entity_id = $1 AND status = 'ACTIVE' ORDER BY name LIMIT 1`,
      [yfz],
    );
    const cats = await procurement.categories(musa);
    const servicesId = cats.find((row) => row.key === 'services')?.id ?? '';
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
      vendorId: XYZ_VENDOR_ID,
      categoryId: servicesId,
      unitId: units[0]?.id ?? '',
      budgetLineId: lines[0]?.id ?? null,
      fundingId: funding[0]?.id ?? '',
    };
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  it('answers A2-style questions after full chain', async () => {
    const priced = await submitNeedApprovedProposal(flow, {
      title: `Global ${randomUUID()}`,
      invoiceRequired: false,
    });
    expect(priced.originatorName).toBeTruthy();
    const atFinance = await walkPastOpsAndMd(procurement, workflows, halima, abubakar, priced);
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
      bankReference: `GLB-${randomUUID().slice(0, 8)}`,
      paymentDate: '2026-10-03',
      proofDocumentId: proof.id,
      idempotencyKey: `global-pay-${approved.id}`,
    });
    expect(paid.payments.length).toBeGreaterThan(0);
    const png = {
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    };
    const note = await documents.upload(officer, {
      title: `note ${paid.title}`,
      category: 'delivery_note',
      context: 'procurement',
      entityId: yfz,
      ownerType: 'procurement_request',
      ownerId: paid.id,
      file: { ...png, originalname: 'note.png' },
    });
    const received = await delivery.recordReceipt(officer, paid.id, {
      receivedDate: '2026-10-04',
      location: 'YFZ mill stores',
      quantityReceived: paid.lines[0]?.quantity ?? 1,
      quantityAccepted: paid.lines[0]?.quantity ?? 1,
      idempotencyKey: `global-grn-${paid.id}`,
      documents: [{ documentId: note.id, kind: 'delivery_note' }],
    });
    expect(received.receipts.length).toBeGreaterThan(0);
    const wf = await workflows.get(musa, received.workflowInstanceId!);
    expect(wf.seals.every((seal) => seal.verification === 'VALID')).toBe(true);
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      const hits = await searchIndex(client, received.referenceNumber, 5);
      await client.query('ROLLBACK');
      expect(hits.some((hit) => hit.recordType === 'PROCUREMENT')).toBe(true);
    } finally {
      client.release();
    }
    const audit = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log WHERE subject_id = $1::uuid OR subject_reference_number = $2`,
      [received.id, received.referenceNumber],
    );
    expect(Number(audit.rows[0]?.n ?? 0)).toBeGreaterThan(0);
  });
});
