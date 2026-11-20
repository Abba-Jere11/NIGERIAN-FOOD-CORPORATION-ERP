/**
 * Inventory completeness: warehouse-scoped availability, supplier-return remaining,
 * expiry blocking on ordinary outbound, scan prefix normalisation, and photo clear.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { DEFAULT_ROLE_GRANTS, SEED_USERS, XYZ_VENDOR_ID, type PermissionKey } from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { DocumentsService } from '../../../apps/api/src/documents/documents.service';
import { FileStorageDriver } from '../../../apps/api/src/documents/file-storage';
import { NoopMalwareScanner } from '../../../apps/api/src/documents/malware';
import { InventoryDeskService } from '../../../apps/api/src/inventory/desk.service';
import { InventoryService } from '../../../apps/api/src/inventory/inventory.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import {
  ForbiddenError,
  ValidationFailedError,
} from '../../../apps/api/src/common/errors/domain-error';
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

describe('Inventory completeness', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let inventory: InventoryService;
  let desk: InventoryDeskService;
  let documents: DocumentsService;
  let hauwa: ActorContext;
  let musa: ActorContext;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-completeness-owner');
    app = appPool('nfc-erp-test-completeness-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
    const uow = new UnitOfWork(app);
    documents = new DocumentsService(uow, new FileStorageDriver(), new NoopMalwareScanner());
    inventory = new InventoryService(uow);
    desk = new InventoryDeskService(uow, inventory, documents);
    hauwa = actorFromSeed('inventory@nfc.local', [yfz, dma]);
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  async function createTrackedItem(opts: {
    code: string;
    trackingMode?: 'none' | 'batch_lot' | 'serial';
    asset?: boolean;
  }) {
    const categories = await inventory.categories(hauwa, yfz);
    const units = await inventory.units(hauwa);
    const warehouses = await inventory.warehouses(hauwa, yfz);
    const created = await inventory.createItem(hauwa, {
      entityId: yfz,
      code: `${opts.code}-${randomUUID().slice(0, 6).toUpperCase()}`,
      name: `${opts.code} completeness`,
      categoryId: categories[0]!.id,
      uomId: units[0]!.id,
      defaultWarehouseId: warehouses[0]!.id,
      reorderLevel: 0,
      trackingMode: opts.trackingMode ?? 'none',
      asset: opts.asset ?? false,
    });
    return { item: created, warehouseId: warehouses[0]!.id, warehouses };
  }

  async function insertStatusStock(input: {
    itemId: string;
    warehouseId: string;
    qty: number;
    status: 'AVAILABLE' | 'QUARANTINED' | 'REJECTED';
    batchId?: string | null;
    grnId?: string | null;
    unitCostKobo?: number;
  }) {
    const ref = (await owner.query<{ ref: string }>(`SELECT app.next_reference('INV') AS ref`)).rows[0]!.ref;
    await owner.query(
      `INSERT INTO stock_movements (
         reference_number, entity_id, item_id, warehouse_id, batch_id, quantity_in, quantity_out,
         unit_cost_kobo, value_kobo, source, grn_id, occurred_on, created_by, stock_status
       ) VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, 'ADJUSTMENT', $9, CURRENT_DATE, $10, $11)`,
      [
        ref,
        yfz,
        input.itemId,
        input.warehouseId,
        input.batchId ?? null,
        input.qty,
        input.unitCostKobo ?? 100,
        input.qty * (input.unitCostKobo ?? 100),
        input.grnId ?? null,
        hauwa.ref,
        input.status,
      ],
    );
  }

  async function reserveAtWarehouse(input: {
    itemId: string;
    warehouseId: string;
    qty: number;
  }): Promise<void> {
    const customer = await owner.query<{ id: string }>(
      `SELECT id FROM customers WHERE entity_id = $1 LIMIT 1`,
      [yfz],
    );
    if (!customer.rows[0]) throw new Error('YFZ needs a customer for reservation fixtures.');
    const ref = (await owner.query<{ ref: string }>(`SELECT app.next_reference('SO') AS ref`)).rows[0]!.ref;
    const order = await owner.query<{ id: string }>(
      `INSERT INTO sales_orders (
         reference_number, entity_id, customer_id, terms, occurred_on, status, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, CURRENT_DATE, 'RESERVED', $5, $5)
       RETURNING id`,
      [ref, yfz, customer.rows[0].id, `completeness-reserve-${randomUUID()}`, hauwa.ref],
    );
    const line = await owner.query<{ id: string }>(
      `INSERT INTO sales_order_lines (
         order_id, entity_id, item_id, warehouse_id, quantity, unit_price_kobo, reserved_qty, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, 100, $5, $6, $6)
       RETURNING id`,
      [order.rows[0]!.id, yfz, input.itemId, input.warehouseId, input.qty, hauwa.ref],
    );
    await owner.query(
      `INSERT INTO stock_reservations (
         entity_id, sales_order_line_id, item_id, warehouse_id, quantity, status, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $6)`,
      [yfz, line.rows[0]!.id, input.itemId, input.warehouseId, input.qty, hauwa.ref],
    );
  }

  it('returns warehouse-scoped availableQty without subtracting WIP twice', async () => {
    const { item, warehouses } = await createTrackedItem({ code: 'WHQ' });
    const a = warehouses[0]!;
    const b = warehouses.find((row) => row.id !== a.id);
    await insertStatusStock({ itemId: item.id, warehouseId: a.id, qty: 100, status: 'AVAILABLE' });
    await insertStatusStock({ itemId: item.id, warehouseId: a.id, qty: 25, status: 'QUARANTINED' });
    if (b) {
      await insertStatusStock({ itemId: item.id, warehouseId: b.id, qty: 40, status: 'AVAILABLE' });
    }
    await reserveAtWarehouse({ itemId: item.id, warehouseId: a.id, qty: 10 });

    const atA = await inventory.listItems(hauwa, yfz, { warehouseId: a.id });
    const rowA = atA.find((row) => row.id === item.id)!;
    expect(rowA.availableQty).toBe(90);
    expect(rowA.quarantinedQty).toBe(25);
    expect(rowA.onHandQty).toBe(125);
    expect(rowA.wipQty).toBe(0);

    if (b) {
      const atB = await inventory.listItems(hauwa, yfz, { warehouseId: b.id });
      const rowB = atB.find((row) => row.id === item.id)!;
      expect(rowB.availableQty).toBe(40);
      expect(rowB.quarantinedQty).toBe(0);
      expect(rowB.reservedQty).toBe(0);
    }
  });

  it('supports partial supplier returns and blocks excess, available stock, wrong entity, and missing vendor', async () => {
    const { item, warehouseId } = await createTrackedItem({ code: 'SRT' });
    await insertStatusStock({
      itemId: item.id,
      warehouseId,
      qty: 100,
      status: 'REJECTED',
      unitCostKobo: 200,
    });

    await expect(
      desk.createReturn(hauwa, {
        entityId: yfz,
        warehouseId,
        kind: 'SUPPLIER_RETURN',
        reason: 'Missing vendor',
        occurredOn: '2026-11-20',
        idempotencyKey: `srt-novendor-${randomUUID()}`,
        lines: [{ itemId: item.id, quantity: 10, fromStatus: 'REJECTED' }],
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);

    const first = await desk.createReturn(hauwa, {
      entityId: yfz,
      warehouseId,
      kind: 'SUPPLIER_RETURN',
      vendorId: XYZ_VENDOR_ID,
      reason: 'Damaged bags — first partial',
      occurredOn: '2026-11-20',
      idempotencyKey: `srt-partial-1-${randomUUID()}`,
      lines: [{ itemId: item.id, quantity: 40, fromStatus: 'REJECTED' }],
    });
    expect(first.referenceNumber).toMatch(/^RET-/);
    expect(first.kind).toBe('SUPPLIER_RETURN');

    const second = await desk.createReturn(hauwa, {
      entityId: yfz,
      warehouseId,
      kind: 'SUPPLIER_RETURN',
      vendorId: XYZ_VENDOR_ID,
      reason: 'Damaged bags — second partial',
      occurredOn: '2026-11-20',
      idempotencyKey: `srt-partial-2-${randomUUID()}`,
      lines: [{ itemId: item.id, quantity: 20, fromStatus: 'REJECTED' }],
    });
    expect(second.lines[0]?.quantity).toBe(20);

    await expect(
      desk.createReturn(hauwa, {
        entityId: yfz,
        warehouseId,
        kind: 'SUPPLIER_RETURN',
        vendorId: XYZ_VENDOR_ID,
        reason: 'Too much',
        occurredOn: '2026-11-20',
        idempotencyKey: `srt-excess-${randomUUID()}`,
        lines: [{ itemId: item.id, quantity: 50, fromStatus: 'REJECTED' }],
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);

    await insertStatusStock({ itemId: item.id, warehouseId, qty: 30, status: 'AVAILABLE' });
    await expect(
      desk.createReturn(hauwa, {
        entityId: yfz,
        warehouseId,
        kind: 'SUPPLIER_RETURN',
        vendorId: XYZ_VENDOR_ID,
        reason: 'Available is ineligible',
        occurredOn: '2026-11-20',
        idempotencyKey: `srt-available-${randomUUID()}`,
        lines: [{ itemId: item.id, quantity: 5, fromStatus: 'AVAILABLE' as 'REJECTED' }],
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);

    const otherWh = (await inventory.warehouses(hauwa, yfz)).find((row) => row.id !== warehouseId);
    if (otherWh) {
      await expect(
        desk.createReturn(hauwa, {
          entityId: yfz,
          warehouseId: otherWh.id,
          kind: 'SUPPLIER_RETURN',
          vendorId: XYZ_VENDOR_ID,
          reason: 'Wrong warehouse',
          occurredOn: '2026-11-20',
          idempotencyKey: `srt-wrong-wh-${randomUUID()}`,
          lines: [{ itemId: item.id, quantity: 1, fromStatus: 'REJECTED' }],
        }),
      ).rejects.toBeInstanceOf(ValidationFailedError);
    }

    await expect(
      desk.createReturn(musa, {
        entityId: dma,
        warehouseId,
        kind: 'SUPPLIER_RETURN',
        vendorId: XYZ_VENDOR_ID,
        reason: 'Wrong subsidiary',
        occurredOn: '2026-11-20',
        idempotencyKey: `srt-wrong-entity-${randomUUID()}`,
        lines: [{ itemId: item.id, quantity: 1, fromStatus: 'REJECTED' }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const ledger = await owner.query<{ source: string; n: string }>(
      `SELECT source, count(*)::text AS n FROM stock_movements
        WHERE item_id = $1 AND source = 'RETURN_SUPPLIER' GROUP BY source`,
      [item.id],
    );
    expect(Number(ledger.rows[0]?.n ?? 0)).toBe(2);
  });

  it('replays supplier returns by idempotency key and blocks concurrent over-return', async () => {
    const { item, warehouseId } = await createTrackedItem({ code: 'SRC' });
    await insertStatusStock({ itemId: item.id, warehouseId, qty: 50, status: 'QUARANTINED' });
    const key = `srt-idem-${randomUUID()}`;
    const first = await desk.createReturn(hauwa, {
      entityId: yfz,
      warehouseId,
      kind: 'SUPPLIER_RETURN',
      vendorId: XYZ_VENDOR_ID,
      reason: 'Idempotent return',
      occurredOn: '2026-11-20',
      idempotencyKey: key,
      lines: [{ itemId: item.id, quantity: 30, fromStatus: 'QUARANTINED' }],
    });
    const replay = await desk.createReturn(hauwa, {
      entityId: yfz,
      warehouseId,
      kind: 'SUPPLIER_RETURN',
      vendorId: XYZ_VENDOR_ID,
      reason: 'Idempotent return',
      occurredOn: '2026-11-20',
      idempotencyKey: key,
      lines: [{ itemId: item.id, quantity: 30, fromStatus: 'QUARANTINED' }],
    });
    expect(replay.id).toBe(first.id);

    const results = await Promise.allSettled([
      desk.createReturn(hauwa, {
        entityId: yfz,
        warehouseId,
        kind: 'SUPPLIER_RETURN',
        vendorId: XYZ_VENDOR_ID,
        reason: 'Concurrent A',
        occurredOn: '2026-11-20',
        idempotencyKey: `srt-c1-${randomUUID()}`,
        lines: [{ itemId: item.id, quantity: 20, fromStatus: 'QUARANTINED' }],
      }),
      desk.createReturn(hauwa, {
        entityId: yfz,
        warehouseId,
        kind: 'SUPPLIER_RETURN',
        vendorId: XYZ_VENDOR_ID,
        reason: 'Concurrent B',
        occurredOn: '2026-11-20',
        idempotencyKey: `srt-c2-${randomUUID()}`,
        lines: [{ itemId: item.id, quantity: 20, fromStatus: 'QUARANTINED' }],
      }),
    ]);
    const ok = results.filter((row) => row.status === 'fulfilled');
    const failed = results.filter((row) => row.status === 'rejected');
    expect(ok.length).toBe(1);
    expect(failed.length).toBe(1);
  });

  it('blocks expired AVAILABLE batches on issue and still allows supplier return from Q/R', async () => {
    const { item, warehouseId } = await createTrackedItem({ code: 'EXP', trackingMode: 'batch_lot' });
    const batchId = await owner.query<{ id: string }>(
      `INSERT INTO stock_batches (
         entity_id, item_id, warehouse_id, batch_code, manufactured_on, expires_on, created_by
       ) VALUES ($1, $2, $3, $4, CURRENT_DATE - 40, CURRENT_DATE - 1, $5)
       RETURNING id`,
      [yfz, item.id, warehouseId, `EXP-${randomUUID().slice(0, 6).toUpperCase()}`, hauwa.ref],
    );
    await insertStatusStock({
      itemId: item.id,
      warehouseId,
      qty: 12,
      status: 'AVAILABLE',
      batchId: batchId.rows[0]!.id,
    });
    await insertStatusStock({
      itemId: item.id,
      warehouseId,
      qty: 8,
      status: 'REJECTED',
      batchId: batchId.rows[0]!.id,
    });

    const batchCode = (
      await owner.query<{ batch_code: string }>(`SELECT batch_code FROM stock_batches WHERE id = $1`, [
        batchId.rows[0]!.id,
      ])
    ).rows[0]!.batch_code;

    await expect(
      inventory.issue(hauwa, {
        entityId: yfz,
        warehouseId,
        destinationType: 'department',
        reason: 'Should refuse expired batch',
        occurredOn: '2026-11-20',
        idempotencyKey: `exp-issue-${randomUUID()}`,
        lines: [{ itemId: item.id, quantity: 1, batchCode }],
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);

    const returned = await desk.createReturn(hauwa, {
      entityId: yfz,
      warehouseId,
      kind: 'SUPPLIER_RETURN',
      vendorId: XYZ_VENDOR_ID,
      reason: 'Expired rejected stock returned',
      occurredOn: '2026-11-20',
      idempotencyKey: `exp-ret-${randomUUID()}`,
      lines: [{ itemId: item.id, quantity: 3, fromStatus: 'REJECTED', batchCode }],
    });
    expect(returned.kind).toBe('SUPPLIER_RETURN');
  });

  it('normalises NFC-AST scan prefixes and clears asset photos', async () => {
    const { item } = await createTrackedItem({ code: 'PHO', asset: true });
    const photo = await documents.upload(hauwa, {
      title: 'Asset photo',
      category: 'asset_photo',
      context: 'general',
      entityId: yfz,
      file: { buffer: PNG, originalname: 'a.png' },
    });
    const asset = await desk.registerAsset(hauwa, {
      entityId: yfz,
      itemId: item.id,
      serialCode: `SN-${randomUUID().slice(0, 6).toUpperCase()}`,
      condition: 'good',
      costKobo: 1000,
      photoDocumentId: photo.id,
    });
    const scanned = await desk.scan(hauwa, `NFC-AST:${asset.referenceNumber}`);
    expect(scanned.asset?.id).toBe(asset.id);
    expect(scanned.asset?.photoUrl).toBeTruthy();

    const cleared = await desk.setAssetPhoto(hauwa, asset.id, {
      rowVersion: asset.rowVersion,
      documentId: null,
    });
    expect(cleared.photoDocumentId).toBeNull();
    expect(cleared.photoUrl).toBeNull();
  });
});
