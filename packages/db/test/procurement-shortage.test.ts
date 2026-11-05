/**
 * M6 shortage deadline, auto close-short, and prepaid recovery.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { systemActorContext } from '../src/session';
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
import { CustomersService } from '../../../apps/api/src/finance/customers.service';
import { JournalsService } from '../../../apps/api/src/finance/journals.service';
import { LedgerPostingService } from '../../../apps/api/src/finance/ledger-posting.service';
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
import { ForbiddenError, ValidationFailedError } from '../../../apps/api/src/common/errors/domain-error';
import { submitNeedApprovedProposal, walkPastOpsAndMd, type DualApprovalDeps } from './procurement-flow';
import { appPool, entityIdFor, ownerPool } from './support';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const DUE = '2026-12-15';
const UNIT = 400;
const QTY = 1000;
const ACCEPTED = 800;
const RECOVERY = (QTY - ACCEPTED) * UNIT;

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

describe('M6 shortage deadline and recovery', () => {
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
  let receivables: ReceivablesService;
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
    owner = ownerPool('nfc-erp-test-m6-shortage-owner');
    app = appPool('nfc-erp-test-m6-shortage-app');
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
    const journals = new JournalsService(uow, workflows);
    const ledger = new LedgerPostingService(journals);
    Object.assign(workflows, { ledger });
    payments = new PaymentsService(uow, workflows, vendorValidation, procurement, ledger);
    delivery = new DeliveryService(uow, procurement, workflows, documents, ledger);
    receivables = new ReceivablesService(uow, ledger, new CustomersService(uow));
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

  async function payToDelivery(title: string) {
    const submitted = await submitNeedApprovedProposal(flow, {
      title,
      quantity: QTY,
      unitPriceKobo: UNIT,
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
      amountKobo: approved.authorizedAmountKobo ?? QTY * UNIT,
      method: 'bank_transfer',
      bankReference: `M6-${randomUUID().slice(0, 8)}`,
      paymentDate: '2026-10-03',
      proofDocumentId: file.id,
      idempotencyKey: `m6-pay-${approved.id}`,
    });
  }

  async function shortGrn(requestId: string, dueOn = DUE) {
    const cert = await evidence(requestId, `cert-${randomUUID().slice(0, 8)}`);
    return delivery.recordReceipt(officer, requestId, {
      receivedDate: '2026-10-03',
      location: 'YFZ mill stores',
      quantityReceived: ACCEPTED,
      quantityAccepted: ACCEPTED,
      secondBatchDueOn: dueOn,
      idempotencyKey: `m6-grn-${requestId}`,
      documents: [{ documentId: cert.id, kind: 'completion_certificate' }],
    });
  }

  it('requires and then locks the second-batch date on a short GRN', async () => {
    const paid = await payToDelivery(`M6 lock ${randomUUID()}`);
    await expect(
      delivery.recordReceipt(officer, paid.id, {
        receivedDate: '2026-10-03',
        location: 'YFZ mill stores',
        quantityReceived: ACCEPTED,
        quantityAccepted: ACCEPTED,
        idempotencyKey: `m6-nodate-${paid.id}`,
        documents: [],
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);

    const partial = await shortGrn(paid.id);
    expect(partial.status).toBe('PARTIALLY_RECEIVED');
    expect(partial.lines[0]?.secondBatchDueOn).toBe(DUE);
    expect(partial.outstandingQuantity).toBe(QTY - ACCEPTED);

    const listed = await procurement.list(officer);
    const item = listed.items.find((row) => row.id === paid.id);
    expect(item?.secondBatchDueOn).toBe(DUE);
    expect(item?.shortageOverdue).toBe(false);

    await expect(
      delivery.overrideShortageDeadline(officer, paid.id, {
        lineId: partial.lines[0]!.id,
        dueOn: '2026-12-20',
        reason: 'Officer cannot move a locked date.',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const corrected = await delivery.overrideShortageDeadline(abubakar, paid.id, {
      lineId: partial.lines[0]!.id,
      dueOn: '2026-12-20',
      reason: 'Vendor confirmed a later shipment.',
    });
    expect(corrected.lines[0]?.secondBatchDueOn).toBe('2026-12-20');

    await expect(
      delivery.overrideShortageDeadline(abubakar, paid.id, {
        lineId: partial.lines[0]!.id,
        dueOn: '2020-01-01',
        reason: 'Past date.',
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('auto-starts close-short only when every outstanding line is past due', async () => {
    const paid = await payToDelivery(`M6 job ${randomUUID()}`);
    await shortGrn(paid.id);
    const job = systemActorContext('system:escalation', 'Shortage deadline');
    expect(await delivery.startCloseShortForMissedDeadlines(job, new Date('2026-12-10T12:00:00+01:00'))).toBe(0);
    expect((await procurement.get(officer, paid.id)).closeShort).toBeNull();

    expect(await delivery.startCloseShortForMissedDeadlines(job, new Date('2026-12-16T12:00:00+01:00'))).toBe(1);
    const started = await procurement.get(officer, paid.id);
    expect(started.closeShort?.status).toBe('PENDING');
    expect(started.closeShort?.reason).toContain('Second-batch deadline missed');

    expect(await delivery.startCloseShortForMissedDeadlines(job, new Date('2026-12-17T12:00:00+01:00'))).toBe(0);
  });

  it('links vendor claim and receivable on close-short approve, then settles both', async () => {
    const paid = await payToDelivery(`M6 recovery ${randomUUID()}`);
    const partial = await shortGrn(paid.id);
    const requested = await delivery.requestCloseShort(officer, paid.id, 'Vendor will not ship the remainder.');
    const instanceId = requested.closeShort?.workflowInstanceId;
    expect(instanceId).toBeTruthy();
    await workflows.act(halima, {
      instanceId: instanceId!,
      action: 'APPROVE',
      rowVersion: (await workflows.get(halima, instanceId!)).rowVersion,
    });
    await workflows.act(emeka, {
      instanceId: instanceId!,
      action: 'APPROVE',
      rowVersion: (await workflows.get(emeka, instanceId!)).rowVersion,
    });
    const approved = await procurement.get(officer, paid.id);
    const recoveryId = approved.closeShort?.vendorOpenClaim?.recoveryId;
    expect(recoveryId).toBeTruthy();
    expect(approved.closeShort?.vendorOpenClaim?.quantity).toBe(QTY - ACCEPTED);

    const recovery = await owner.query<{ status: string; amount_kobo: string }>(
      `SELECT status, amount_kobo::text FROM procurement_recoveries WHERE id = $1`,
      [recoveryId],
    );
    expect(recovery.rows[0]?.status).toBe('OPEN');
    expect(Number(recovery.rows[0]?.amount_kobo)).toBe(RECOVERY);

    const journal = await owner.query<{ source: string; debit_code: string; credit_code: string; debit: string }>(
      `SELECT j.source,
              max(CASE WHEN l.debit_kobo > 0 THEN a.code END) AS debit_code,
              max(CASE WHEN l.credit_kobo > 0 THEN a.code END) AS credit_code,
              sum(l.debit_kobo)::text AS debit
         FROM journals j
         JOIN journal_lines l ON l.journal_id = j.id
         JOIN accounts a ON a.id = l.account_id
        WHERE j.idempotency_key = $1
        GROUP BY j.id, j.source`,
      [`recovery:${recoveryId}`],
    );
    expect(journal.rows[0]?.source).toBe('PROCUREMENT_RECOVERY');
    expect(journal.rows[0]?.debit_code).toBe('1220');
    expect(journal.rows[0]?.credit_code).toBe('1300');
    expect(Number(journal.rows[0]?.debit)).toBe(RECOVERY);

    const invoices = await receivables.listInvoices(emeka, yfz);
    const invoice = invoices.find((row) => row.recoveryId === recoveryId);
    expect(invoice?.customerId).toBeNull();
    expect(invoice?.vendorId).toBe(XYZ_VENDOR_ID);
    expect(invoice?.outstandingKobo).toBe(RECOVERY);

    const receipt = await receivables.recordReceipt(emeka, {
      entityId: yfz,
      vendorId: XYZ_VENDOR_ID,
      bankAccountId: YFZ_BANK_ACCOUNT_ID,
      receivedOn: '2026-10-14',
      amountKobo: RECOVERY,
      allocations: [{ invoiceId: invoice!.id, amountKobo: RECOVERY }],
      idempotencyKey: `m6-rct-${paid.id}`,
    });
    expect(receipt.customerId).toBeNull();
    expect(receipt.amountKobo).toBe(RECOVERY);

    const settled = await owner.query<{ status: string }>(
      `SELECT status FROM procurement_recoveries WHERE id = $1`,
      [recoveryId],
    );
    expect(settled.rows[0]?.status).toBe('SETTLED');
    const paidInvoice = (await receivables.listInvoices(emeka, yfz)).find((row) => row.id === invoice!.id);
    expect(paidInvoice?.status).toBe('PAID');
    expect(partial.acceptedQuantityTotal).toBe(ACCEPTED);
  });
});
