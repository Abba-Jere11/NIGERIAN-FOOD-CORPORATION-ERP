/**
 * M13 inventory (addendum): Stock Register mapping, forecast-only Expected, one GRN
 * per delivery with accepted / quarantined / rejected, GM QC, Lane A issues and
 * count-only adjustments that stay blocked until the threshold is confirmed.
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
import { IntegrityService } from '../../../apps/api/src/finance/integrity.service';
import { JournalsService } from '../../../apps/api/src/finance/journals.service';
import { LedgerPostingService } from '../../../apps/api/src/finance/ledger-posting.service';
import { InventoryDeskService } from '../../../apps/api/src/inventory/desk.service';
import { InventoryService } from '../../../apps/api/src/inventory/inventory.service';
import { DeliveryService } from '../../../apps/api/src/procurement/delivery.service';
import { FinancialChecksService } from '../../../apps/api/src/procurement/financial-checks.service';
import { PaymentsService } from '../../../apps/api/src/procurement/payments.service';
import { ProcurementService } from '../../../apps/api/src/procurement/procurement.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { VendorValidationService } from '../../../apps/api/src/vendors/vendor-validation.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import { RequisitionsService } from '../../../apps/api/src/procurement/requisitions.service';
import {
  ConfigurationRequiredError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../../apps/api/src/common/errors/domain-error';
import {
  openNeedApprovedDraft,
  pricePreparedDraft,
  submitNeedApprovedProposal,
  walkPastOpsAndMd,
  type DualApprovalDeps,
} from './procurement-flow';
import { appPool, entityIdFor, ownerPool, withConfirmedInventorySetting } from './support';

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

describe('M13 inventory addendum', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let nfc: string;
  let inventory: InventoryService;
  let desk: InventoryDeskService;
  let integrity: IntegrityService;
  let procurement: ProcurementService;
  let requisitions: RequisitionsService;
  let workflows: WorkflowsService;
  let documents: DocumentsService;
  let flow: DualApprovalDeps;
  let delivery: DeliveryService;
  let payments: PaymentsService;
  let hauwa: ActorContext;
  let musa: ActorContext;
  let admin: ActorContext;
  let halima: ActorContext;
  let abubakar: ActorContext;
  let emeka: ActorContext;
  let grace: ActorContext;
  let departmentId: string;
  let goodsId: string;
  let unitId: string;
  let fundingA: string;
  let budgetLineId: string;
  /** The GRN of the main delivery, shared by the QC tests. */
  let received: { requestId: string; grnId: string; itemId: string; workflowInstanceId: string } | null = null;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-m13-owner');
    app = appPool('nfc-erp-test-m13-app');
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
    inventory = new InventoryService(uow, ledger, workflows);
    desk = new InventoryDeskService(uow, inventory, documents, workflows);
    Object.assign(workflows, { inventory });
    Object.assign(procurement, { inventory });
    payments = new PaymentsService(uow, workflows, vendorValidation, procurement, ledger);
    delivery = new DeliveryService(uow, procurement, workflows, documents, ledger, inventory);
    integrity = new IntegrityService(uow);
    hauwa = actorFromSeed('inventory@nfc.local', [yfz, dma, nfc]);
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
    admin = actorFromSeed('administrator@nfc.local', [nfc, yfz]);
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
    goodsId = cats.find((row) => row.key === 'goods')?.id ?? '';
    const units = await procurement.units(musa);
    unitId = units.find((row) => row.code === 'KG')?.id ?? units[0]?.id ?? '';
    const funding = await procurement.fundingSources(musa);
    fundingA = funding.find((row) => row.key === 'subsidiary_operating')?.id ?? '';
    const lines = await procurement.budgetLines(musa, yfz);
    budgetLineId = lines.find((row) => row.code === 'YFZ-CAPEX')?.id ?? lines[0]?.id ?? '';
    flow = {
      requisitions,
      procurement,
      workflows,
      documents,
      gm: musa,
      md: abubakar,
      officer: hauwa,
      entityId: yfz,
      departmentId,
      categoryId: goodsId,
      unitId,
      fundingId: fundingA,
      budgetLineId,
      vendorId: XYZ_VENDOR_ID,
    };
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  async function approveAndPay(title: string, quantity: number, unitPriceKobo: number) {
    const submitted = await submitNeedApprovedProposal(flow, { title, quantity, unitPriceKobo, invoiceRequired: true });
    const atFinance = await walkPastOpsAndMd(procurement, workflows, halima, abubakar, submitted);
    const approved = await procurement.act(emeka, atFinance.id, {
      action: 'APPROVE',
      rowVersion: (await workflows.get(emeka, atFinance.workflowInstanceId!)).rowVersion,
      fundingRoute: 'subsidiary_operating',
      sourceAccountId: YFZ_BANK_ACCOUNT_ID,
      checklistAcknowledged: true,
    });
    const payFile = await documents.upload(grace, {
      title: `pay ${title}`,
      category: 'payment_proof',
      context: 'procurement',
      entityId: yfz,
      ownerType: 'procurement_request',
      ownerId: approved.id,
      file: { buffer: PNG, originalname: 'pay.png' },
    });
    await payments.completePayment(grace, approved.id, {
      payingAccountId: YFZ_BANK_ACCOUNT_ID,
      amountKobo: approved.authorizedAmountKobo ?? quantity * unitPriceKobo,
      method: 'bank_transfer',
      bankReference: `M13-${randomUUID().slice(0, 8)}`,
      paymentDate: '2026-10-02',
      proofDocumentId: payFile.id,
      idempotencyKey: `m13-pay-${approved.id}`,
    });
    return approved;
  }

  async function stockedItem(code: string, quantity: number, unitCostKobo: number) {
    const categories = await inventory.categories(hauwa, yfz);
    const units = await inventory.units(hauwa);
    const warehouses = await inventory.warehouses(hauwa, yfz);
    const created = await inventory.createItem(hauwa, {
      entityId: yfz,
      code: `${code}-${randomUUID().slice(0, 6).toUpperCase()}`,
      name: `${code} test item`,
      categoryId: categories[0]!.id,
      uomId: units[0]!.id,
      defaultWarehouseId: warehouses[0]!.id,
      reorderLevel: 0,
      trackingMode: 'none',
    });
    const opening = await owner.query<{ ref: string }>(`SELECT app.next_reference('INV') AS ref`);
    await owner.query(
      `INSERT INTO stock_movements (
         reference_number, entity_id, item_id, warehouse_id, quantity_in, quantity_out,
         unit_cost_kobo, value_kobo, source, occurred_on, created_by
       ) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, 'ADJUSTMENT', '2026-10-01', $8)`,
      [opening.rows[0]!.ref, yfz, created.id, warehouses[0]!.id, quantity, unitCostKobo, quantity * unitCostKobo, hauwa.ref],
    );
    return { item: created, warehouseId: warehouses[0]!.id };
  }

  it('lets the officer open YFZ stock and hides DMA from the YFZ GM', async () => {
    const yfzItems = await inventory.listItems(hauwa, yfz);
    expect(yfzItems.some((row) => row.code === 'YFZ-UREA')).toBe(true);
    const musaItems = await inventory.listItems(musa, yfz);
    expect(musaItems.length).toBeGreaterThan(0);
    await expect(inventory.listItems(musa, dma)).rejects.toBeInstanceOf(ForbiddenError);
    const dmaItems = await inventory.listItems(hauwa, dma);
    const dmaItem = dmaItems[0];
    if (dmaItem) {
      await expect(inventory.getItem(musa, dmaItem.id)).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(inventory.listItems(admin, yfz)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses to submit a stock line that is not mapped to a Stock Register item', async () => {
    const title = `M13 unmapped ${randomUUID().slice(0, 8)}`;
    const draft = await openNeedApprovedDraft(flow, { title, quantity: 3 });
    const priced = await pricePreparedDraft(flow, draft, { title, quantity: 3, unitPriceKobo: 1_000 });
    expect(priced.lines[0]?.inventoryItemId).toBeTruthy();

    const version = await owner.query<{ id: string }>(
      `SELECT v.id FROM procurement_versions v
         JOIN procurement_requests r ON r.id = v.request_id AND r.current_version = v.version_number
        WHERE r.id = $1`,
      [priced.id],
    );
    await owner.query(`UPDATE procurement_version_lines SET inventory_item_id = NULL WHERE version_id = $1`, [
      version.rows[0]!.id,
    ]);
    await expect(
      procurement.submit(hauwa, priced.id, {
        rowVersion: priced.rowVersion,
        idempotencyKey: `m13-unmapped-${priced.id}`,
      }),
    ).rejects.toThrow(/Stock Register item/);
  });

  it('keeps Expected a forecast and posts stock and GL on one GRN with quarantine', async () => {
    const approved = await approveAndPay(`M13 bags ${randomUUID().slice(0, 8)}`, 1000, 250);
    const forecast = (await inventory.expected(hauwa, yfz)).find((row) => row.procurementId === approved.id);
    expect(forecast?.quantityRemaining).toBe(1000);
    expect(forecast?.itemId).toBeTruthy();
    const before = await inventory.getItem(hauwa, forecast!.itemId!);
    expect(before.onHandQty).toBe(0);
    expect(before.incomingQty).toBe(1000);

    const note = await documents.upload(hauwa, {
      title: `GRN ${approved.title}`,
      category: 'goods_received_note',
      context: 'procurement',
      entityId: yfz,
      ownerType: 'procurement_request',
      ownerId: approved.id,
      file: { buffer: PNG, originalname: 'grn.png' },
    });
    await expect(
      delivery.recordReceipt(musa, approved.id, {
        receivedDate: '2026-10-03',
        location: 'YFZ mill stores',
        quantityReceived: 1,
        quantityAccepted: 1,
        idempotencyKey: `m13-gm-grn-${approved.id}`,
        documents: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const view = await delivery.recordReceipt(hauwa, approved.id, {
      receivedDate: '2026-10-03',
      location: 'YFZ mill stores',
      quantityReceived: 900,
      quantityAccepted: 700,
      quantityQuarantined: 100,
      quarantineReason: 'Moisture check pending',
      quantityRejected: 100,
      rejectReason: 'Damaged bags',
      secondBatchDueOn: '2026-12-15',
      idempotencyKey: `m13-grn-${approved.id}`,
      documents: [{ documentId: note.id, kind: 'goods_received_note' }],
    });
    expect(view.status).toBe('PARTIALLY_RECEIVED');
    const grn = view.receipts[0]!;
    expect(grn.referenceNumber).toMatch(/^GRN-/);
    expect(grn.quantityQuarantined).toBe(100);

    const remaining = (await inventory.expected(hauwa, yfz)).find((row) => row.procurementId === approved.id);
    expect(remaining?.quantityRemaining).toBe(200);
    const item = await inventory.getItem(hauwa, forecast!.itemId!);
    expect(item.availableQty).toBe(700);
    expect(item.quarantinedQty).toBe(100);
    expect(item.onHandQty).toBe(800);
    expect(item.rejectedQty).toBe(0);
    expect(item.incomingQty).toBe(200);

    const journal = await owner.query<{ source: string; debit: string; credit: string; credit_codes: string[] }>(
      `SELECT j.source, sum(l.debit_kobo)::text AS debit, sum(l.credit_kobo)::text AS credit,
              array_agg(DISTINCT a.code) FILTER (WHERE l.credit_kobo > 0) AS credit_codes
         FROM journals j
         JOIN journal_lines l ON l.journal_id = j.id
         JOIN accounts a ON a.id = l.account_id
        WHERE j.idempotency_key = $1
        GROUP BY j.source`,
      [`inv-grn:${grn.id}`],
    );
    expect(journal.rows[0]?.source).toBe('INVENTORY_RECEIPT');
    expect(Number(journal.rows[0]?.debit)).toBeGreaterThan(0);
    expect(Number(journal.rows[0]?.debit)).toBe(Number(journal.rows[0]?.credit));
    expect(journal.rows[0]?.credit_codes).toContain('1300');

    received = {
      requestId: approved.id,
      grnId: grn.id,
      itemId: forecast!.itemId!,
      workflowInstanceId: approved.workflowInstanceId!,
    };
  });

  it('lets only the GM release quarantined GRN stock, without a procurement memo stamp', async () => {
    expect(received).toBeTruthy();
    const lines = await desk.quarantine(musa, yfz);
    const lot = lines.find((row) => row.grnId === received!.grnId && row.itemId === received!.itemId);
    expect(lot?.quantity).toBe(100);
    const sealsBefore = (await workflows.get(musa, received!.workflowInstanceId)).seals.length;
    const decision = {
      entityId: yfz,
      itemId: lot!.itemId,
      warehouseId: lot!.warehouseId,
      batchId: lot!.batchId ?? undefined,
      serialId: lot!.serialId ?? undefined,
      grnId: lot!.grnId ?? undefined,
      decision: 'RELEASE' as const,
      quantity: 60,
      reason: 'Moisture within specification',
      occurredOn: '2026-10-04',
    };
    await expect(desk.qcDecide(hauwa, decision)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(desk.qcDecide(admin, decision)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(desk.qcDecide(musa, { ...decision, quantity: 101 })).rejects.toBeInstanceOf(ValidationFailedError);

    const released = await desk.qcDecide(musa, decision);
    expect(released.decision).toBe('RELEASE');
    expect(released.grnReference).toMatch(/^GRN-/);
    const rejected = await desk.qcDecide(musa, {
      ...decision,
      decision: 'REJECT',
      quantity: 40,
      reason: 'Wet bags',
    });
    expect(rejected.decision).toBe('REJECT');

    const item = await inventory.getItem(hauwa, received!.itemId);
    expect(item.availableQty).toBe(760);
    expect(item.quarantinedQty).toBe(0);
    expect(item.rejectedQty).toBe(40);

    const sealsAfter = (await workflows.get(musa, received!.workflowInstanceId)).seals.length;
    expect(sealsAfter).toBe(sealsBefore);
    const audit = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log WHERE subject_id IN ($1::uuid, $2::uuid)`,
      [released.id, rejected.id],
    );
    expect(Number(audit.rows[0]?.n)).toBe(2);
  });

  it('rejects UPDATE on stock_movements and keeps on-hand equal to the sum', async () => {
    const movements = await inventory.movements(hauwa, yfz);
    expect(movements.length).toBeGreaterThan(0);
    const first = movements[0]!;
    await expect(
      owner.query(`UPDATE stock_movements SET quantity_in = quantity_in + 1 WHERE id = $1`, [first.id]),
    ).rejects.toThrow();
    const item = await inventory.getItem(hauwa, first.itemId);
    const sum = item.movements.reduce((total, row) => total + row.quantityIn - row.quantityOut, 0);
    expect(item.onHandQty).toBe(sum);
  });

  it('posts issues immediately on Lane A while the threshold is unconfirmed', async () => {
    const { item, warehouseId } = await stockedItem('LANEA', 5, 100);
    const issue = await inventory.issue(hauwa, {
      entityId: yfz,
      warehouseId,
      destinationType: 'department',
      recipientName: 'Mill supervisor',
      reason: 'Routine maintenance',
      occurredOn: '2026-10-04',
      idempotencyKey: `m13-lanea-${randomUUID()}`,
      lines: [{ itemId: item.id, quantity: 2 }],
    });
    expect(issue.referenceNumber).toMatch(/^ISS-/);
    expect(issue.status).toBe('POSTED');
    expect(issue.recipientName).toBe('Mill supervisor');
    expect((await inventory.getItem(hauwa, item.id)).availableQty).toBe(3);
  });

  it('sends an issue at or above a confirmed threshold for approval', async () => {
    const { item, warehouseId } = await stockedItem('LANEB', 5, 100);
    await withConfirmedInventorySetting(owner, 'lane_b_value_threshold_kobo', 100, async () => {
      const issue = await inventory.issue(hauwa, {
        entityId: yfz,
        warehouseId,
        destinationType: 'department',
        reason: 'Large draw',
        occurredOn: '2026-10-04',
        idempotencyKey: `m13-laneb-${randomUUID()}`,
        lines: [{ itemId: item.id, quantity: 2 }],
      });
      expect(issue.status).toBe('PENDING_APPROVAL');
      expect(issue.workflowInstanceId).toBeTruthy();
    });
    expect((await inventory.getItem(hauwa, item.id)).onHandQty).toBe(5);
  });

  it('refuses the GM and the Administrator on Procurement Manager desk actions', async () => {
    const { item, warehouseId } = await stockedItem('DESK', 2, 100);
    const issue = {
      entityId: yfz,
      warehouseId,
      destinationType: 'department' as const,
      reason: 'Should fail',
      occurredOn: '2026-10-04',
      idempotencyKey: `m13-refuse-${randomUUID()}`,
      lines: [{ itemId: item.id, quantity: 1 }],
    };
    await expect(inventory.issue(admin, issue)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inventory.issue(musa, issue)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      inventory.prepareAdjustment(musa, {
        entityId: yfz,
        warehouseId,
        kind: 'decrease',
        reason: 'GM cannot prepare',
        occurredOn: '2026-10-04',
        lines: [{ itemId: item.id, quantity: -1 }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('only prepares an adjustment from a completed count, and only with a confirmed threshold', async () => {
    const warehouses = await inventory.warehouses(hauwa, yfz);
    const { item } = await stockedItem('COUNT', 4, 100);
    await expect(
      inventory.prepareAdjustment(hauwa, {
        entityId: yfz,
        warehouseId: warehouses[0]!.id,
        kind: 'decrease',
        reason: 'No count behind this',
        occurredOn: '2026-10-05',
        lines: [{ itemId: item.id, quantity: -1 }],
      }),
    ).rejects.toThrow(/completed count/);

    const count = await inventory.createCount(hauwa, {
      entityId: yfz,
      warehouseId: warehouses[0]!.id,
      mode: 'guided',
      countedOn: '2026-10-06',
    });
    const line = count.lines.find((row) => row.itemId === item.id);
    expect(line).toBeTruthy();
    await inventory.updateCountLine(hauwa, count.id, line!.id, {
      countedQty: line!.systemQty - 1,
      explanation: 'One bag found torn',
    });
    const adjustmentsBefore = (await inventory.listAdjustments(hauwa, yfz)).length;
    const completed = await inventory.submitCount(hauwa, count.id);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.adjustmentId).toBeNull();
    expect((await inventory.listAdjustments(hauwa, yfz)).length).toBe(adjustmentsBefore);

    const fromCount = {
      entityId: yfz,
      warehouseId: warehouses[0]!.id,
      kind: 'count_variance' as const,
      reason: 'Count variance',
      occurredOn: '2026-10-06',
      countId: count.id,
      lines: [{ itemId: item.id, quantity: -1 }],
    };
    await expect(inventory.prepareAdjustment(hauwa, fromCount)).rejects.toBeInstanceOf(ConfigurationRequiredError);

    await withConfirmedInventorySetting(owner, 'lane_b_value_threshold_kobo', 1_000_000_000, async () => {
      await expect(
        inventory.prepareAdjustment(hauwa, { ...fromCount, lines: [{ itemId: item.id, quantity: -2 }] }),
      ).rejects.toBeInstanceOf(ValidationFailedError);
      const prepared = await inventory.prepareAdjustment(hauwa, fromCount);
      expect(prepared.referenceNumber).toMatch(/^ADJ-/);
      expect(prepared.status).toBe('PENDING_APPROVAL');
      expect(prepared.countId).toBe(count.id);
      expect(prepared.requiresFinance).toBe(false);
      await expect(inventory.prepareAdjustment(hauwa, fromCount)).rejects.toBeInstanceOf(ConflictError);

      const instance = await workflows.getBySubject(halima, prepared.id);
      const posted = await workflows.act(halima, {
        instanceId: instance.id,
        action: 'APPROVE',
        rowVersion: instance.rowVersion,
      });
      expect(posted.status).toBe('COMPLETED');
      const after = await inventory.listAdjustments(hauwa, yfz);
      expect(after.find((row) => row.id === prepared.id)?.status).toBe('POSTED');
    });
    expect((await inventory.getItem(hauwa, item.id)).onHandQty).toBe(3);
  });

  it('requires evidence and the confirmed threshold for a disposal', async () => {
    const { item, warehouseId } = await stockedItem('DISP', 3, 100);
    const base = {
      entityId: yfz,
      warehouseId,
      kind: 'disposal' as const,
      reason: 'Expired stock',
      occurredOn: '2026-10-07',
      lines: [{ itemId: item.id, quantity: 1 }],
    };
    await expect(inventory.prepareAdjustment(hauwa, base)).rejects.toThrow(/evidence/);
    const evidence = await documents.upload(hauwa, {
      title: 'Disposal evidence',
      category: 'inventory_disposal',
      context: 'general',
      entityId: yfz,
      file: { buffer: PNG, originalname: 'disposal.png' },
    });
    await expect(
      inventory.prepareAdjustment(hauwa, { ...base, evidenceDocumentId: evidence.id }),
    ).rejects.toBeInstanceOf(ConfigurationRequiredError);
    await withConfirmedInventorySetting(owner, 'lane_b_value_threshold_kobo', 1, async () => {
      const prepared = await inventory.prepareAdjustment(hauwa, { ...base, evidenceDocumentId: evidence.id });
      expect(prepared.status).toBe('PENDING_APPROVAL');
      expect(prepared.requiresFinance).toBe(true);
      expect(prepared.lines[0]?.quantity).toBe(-1);
    });
  });

  it('requires a serial when the item is serial-tracked', async () => {
    const categories = await inventory.categories(hauwa, yfz);
    const units = await inventory.units(hauwa);
    const warehouses = await inventory.warehouses(hauwa, yfz);
    const created = await inventory.createItem(hauwa, {
      entityId: yfz,
      code: `SER-${randomUUID().slice(0, 6).toUpperCase()}`,
      name: 'Serial spare',
      categoryId: categories[0]!.id,
      uomId: units[0]!.id,
      defaultWarehouseId: warehouses[0]!.id,
      reorderLevel: 0,
      trackingMode: 'serial',
    });
    await expect(
      inventory.issue(hauwa, {
        entityId: yfz,
        warehouseId: warehouses[0]!.id,
        destinationType: 'department',
        reason: 'Needs a serial',
        occurredOn: '2026-10-07',
        idempotencyKey: `m13-ser-${randomUUID()}`,
        lines: [{ itemId: created.id, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('registers an asset with a photo and finds it by scan', async () => {
    const categories = await inventory.categories(hauwa, yfz);
    const units = await inventory.units(hauwa);
    const warehouses = await inventory.warehouses(hauwa, yfz);
    const item = await inventory.createItem(hauwa, {
      entityId: yfz,
      code: `AST-${randomUUID().slice(0, 6).toUpperCase()}`,
      name: 'Generator',
      categoryId: categories[0]!.id,
      uomId: units[0]!.id,
      defaultWarehouseId: warehouses[0]!.id,
      reorderLevel: 0,
      trackingMode: 'none',
      asset: true,
    });
    const photo = await documents.upload(hauwa, {
      title: 'Generator photo',
      category: 'asset_photo',
      context: 'general',
      entityId: yfz,
      file: { buffer: PNG, originalname: 'generator.png' },
    });
    await expect(
      desk.registerAsset(musa, { entityId: yfz, itemId: item.id, condition: 'good', costKobo: 0 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const serial = `GEN-${randomUUID().slice(0, 8).toUpperCase()}`;
    const asset = await desk.registerAsset(hauwa, {
      entityId: yfz,
      itemId: item.id,
      serialCode: serial,
      condition: 'good',
      costKobo: 500_000,
      photoDocumentId: photo.id,
    });
    expect(asset.referenceNumber).toMatch(/^AST-/);
    expect(asset.photoDocumentId).toBe(photo.id);
    expect(asset.photoUrl).toBeTruthy();

    const scanned = await desk.scan(musa, serial);
    expect(scanned.asset?.id).toBe(asset.id);
    expect(scanned.asset?.photoUrl).toBeTruthy();
    const streamed = await desk.assetPhoto(musa, asset.id);
    expect(streamed.mimeType).toMatch(/^image\//);
    await expect(desk.scan(admin, serial)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('reports inventory integrity against valued movements', async () => {
    const report = await integrity.report(emeka, { entityId: yfz });
    const check = report.checks.find((row) => row.key === 'inventory');
    expect(check?.status).not.toBe('UNAVAILABLE');
  });

  it('flags low stock and notifies the officer when on-hand hits reorder', async () => {
    const categories = await inventory.categories(hauwa, yfz);
    const units = await inventory.units(hauwa);
    const warehouses = await inventory.warehouses(hauwa, yfz);
    const created = await inventory.createItem(hauwa, {
      entityId: yfz,
      code: `LOW-${randomUUID().slice(0, 6).toUpperCase()}`,
      name: 'Low-stock spare',
      categoryId: categories[0]!.id,
      uomId: units[0]!.id,
      defaultWarehouseId: warehouses[0]!.id,
      reorderLevel: 5,
      trackingMode: 'none',
    });
    expect((await inventory.alerts(hauwa, yfz)).some((row) => row.id === created.id)).toBe(true);
    const opening = await owner.query<{ ref: string }>(`SELECT app.next_reference('INV') AS ref`);
    await owner.query(
      `INSERT INTO stock_movements (
         reference_number, entity_id, item_id, warehouse_id, quantity_in, quantity_out,
         unit_cost_kobo, value_kobo, source, occurred_on, created_by
       ) VALUES ($1, $2, $3, $4, 1, 0, 100, 100, 'ADJUSTMENT', '2026-10-08', $5)`,
      [opening.rows[0]!.ref, yfz, created.id, warehouses[0]!.id, hauwa.ref],
    );
    await inventory.issue(hauwa, {
      entityId: yfz,
      warehouseId: warehouses[0]!.id,
      destinationType: 'department',
      reason: 'Trigger low-stock check',
      occurredOn: '2026-10-08',
      idempotencyKey: `m13-low-${randomUUID()}`,
      lines: [{ itemId: created.id, quantity: 1 }],
    });
    const events = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM domain_events WHERE event_type = 'inventory.low_stock' AND subject_id = $1`,
      [created.id],
    );
    expect(Number(events.rows[0]?.n ?? 0)).toBeGreaterThan(0);
  });

  it('lets the officer read consolidated totals that match subsidiary overviews', async () => {
    const context = await inventory.context(hauwa);
    expect(context.canConsolidate).toBe(true);
    const group = await inventory.overview(hauwa);
    expect(group.consolidated).toBe(true);
    let itemCount = 0;
    let value = 0;
    for (const entity of context.entities) {
      const one = await inventory.overview(hauwa, entity.id);
      expect(one.consolidated).toBe(false);
      itemCount += one.itemCount;
      value += one.onHandValueKobo;
    }
    expect(group.itemCount).toBe(itemCount);
    expect(group.onHandValueKobo).toBe(value);
    const gmContext = await inventory.context(musa);
    expect(gmContext.canConsolidate).toBe(false);
    await expect(inventory.overview(musa)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
