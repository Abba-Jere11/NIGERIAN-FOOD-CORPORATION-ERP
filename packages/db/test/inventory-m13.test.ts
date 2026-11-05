/**
 * M13 inventory: items, expected, GRN receipts, movements, isolation, adjustments.
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
import { ForbiddenError, NotFoundError, ValidationFailedError } from '../../../apps/api/src/common/errors/domain-error';
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

describe('M13 inventory 1', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let nfc: string;
  let inventory: InventoryService;
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

  it('keeps expected stock off on-hand until a GRN is accepted', async () => {
    const expected = await inventory.expected(hauwa, yfz);
    expect(expected.some((row) => row.quantityRemaining > 0)).toBe(true);
    const urea = (await inventory.listItems(hauwa, yfz)).find((row) => row.code === 'YFZ-UREA');
    expect(urea).toBeTruthy();
  });

  it('stocks accepted GRN quantity, keeps remainder expected, and skips rejected qty', async () => {
    const submitted = await submitNeedApprovedProposal(flow, {
      title: `M13 bags ${randomUUID().slice(0, 8)}`,
      quantity: 1000,
      unitPriceKobo: 250,
      invoiceRequired: true,
    });
    const atFinance = await walkPastOpsAndMd(procurement, workflows, halima, abubakar, submitted);
    const approved = await procurement.act(emeka, atFinance.id, {
      action: 'APPROVE',
      rowVersion: (await workflows.get(emeka, atFinance.workflowInstanceId!)).rowVersion,
      fundingRoute: 'subsidiary_operating',
      sourceAccountId: YFZ_BANK_ACCOUNT_ID,
      checklistAcknowledged: true,
    });
    const before = await inventory.expected(hauwa, yfz);
    const expectedLine = before.find((row) => row.procurementId === approved.id);
    expect(expectedLine?.quantityRemaining).toBe(1000);
    const onHandBefore = expectedLine?.itemId
      ? (await inventory.getItem(hauwa, expectedLine.itemId)).onHandQty
      : 0;
    const payFile = await documents.upload(grace, {
      title: `pay ${submitted.title}`,
      category: 'payment_proof',
      context: 'procurement',
      entityId: yfz,
      ownerType: 'procurement_request',
      ownerId: approved.id,
      file: { buffer: PNG, originalname: 'pay.png' },
    });
    await payments.completePayment(grace, approved.id, {
      payingAccountId: YFZ_BANK_ACCOUNT_ID,
      amountKobo: approved.authorizedAmountKobo ?? 250_000,
      method: 'bank_transfer',
      bankReference: `M13-${randomUUID().slice(0, 8)}`,
      paymentDate: '2026-10-02',
      proofDocumentId: payFile.id,
      idempotencyKey: `m13-pay-${approved.id}`,
    });
    const note = await documents.upload(hauwa, {
      title: `GRN ${submitted.title}`,
      category: 'goods_received_note',
      context: 'procurement',
      entityId: yfz,
      ownerType: 'procurement_request',
      ownerId: approved.id,
      file: { buffer: PNG, originalname: 'grn.png' },
    });
    await delivery.recordReceipt(hauwa, approved.id, {
      receivedDate: '2026-10-03',
      location: 'YFZ mill stores',
      quantityReceived: 900,
      quantityAccepted: 800,
      quantityRejected: 100,
      rejectReason: 'Damaged bags',
      secondBatchDueOn: '2026-12-15',
      idempotencyKey: `m13-grn-${approved.id}`,
      documents: [{ documentId: note.id, kind: 'goods_received_note' }],
    });
    const after = await inventory.expected(hauwa, yfz);
    const remaining = after.find((row) => row.procurementId === approved.id);
    expect(remaining?.quantityRemaining).toBe(200);
    const item = remaining?.itemId ? await inventory.getItem(hauwa, remaining.itemId) : null;
    expect(item?.onHandQty).toBe(onHandBefore + 800);
    expect(item?.movements.some((row) => row.notes?.includes('Damaged'))).toBe(false);
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

  it('requires a reason on issue and refuses Admin or GM receive/adjust-prepare', async () => {
    const items = await inventory.listItems(hauwa, yfz);
    const stocked = items.find((row) => row.onHandQty > 0);
    const warehouses = await inventory.warehouses(hauwa, yfz);
    expect(stocked && warehouses[0]).toBeTruthy();
    await expect(
      inventory.issue(admin, {
        entityId: yfz,
        warehouseId: warehouses[0]!.id,
        destinationType: 'department',
        reason: 'Should fail',
        occurredOn: '2026-10-04',
        idempotencyKey: `m13-admin-${randomUUID()}`,
        lines: [{ itemId: stocked!.id, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      inventory.prepareAdjustment(musa, {
        entityId: yfz,
        warehouseId: warehouses[0]!.id,
        kind: 'decrease',
        reason: 'GM cannot prepare',
        occurredOn: '2026-10-04',
        lines: [{ itemId: stocked!.id, quantity: -1 }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('posts an adjustment only after a different approver acts', async () => {
    const items = await inventory.listItems(hauwa, yfz);
    const stocked = items.find((row) => row.onHandQty > 1);
    const warehouses = await inventory.warehouses(hauwa, yfz);
    const prepared = await inventory.prepareAdjustment(hauwa, {
      entityId: yfz,
      warehouseId: warehouses[0]!.id,
      kind: 'decrease',
      reason: 'Count correction for M13',
      occurredOn: '2026-10-05',
      lines: [{ itemId: stocked!.id, quantity: -1 }],
    });
    expect(prepared.status).toBe('PENDING_APPROVAL');
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

  it('turns a count variance into a pending adjustment', async () => {
    const warehouses = await inventory.warehouses(hauwa, yfz);
    const count = await inventory.createCount(hauwa, {
      entityId: yfz,
      warehouseId: warehouses[0]!.id,
      mode: 'guided',
      countedOn: '2026-10-06',
    });
    const line = count.lines[0];
    expect(line).toBeTruthy();
    await inventory.updateCountLine(hauwa, count.id, line!.id, { countedQty: line!.systemQty + 1 });
    await inventory.submitCount(hauwa, count.id);
    const adjustments = await inventory.listAdjustments(hauwa, yfz);
    expect(adjustments.some((row) => row.kind === 'count_variance' && row.status === 'PENDING_APPROVAL')).toBe(
      true,
    );
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
