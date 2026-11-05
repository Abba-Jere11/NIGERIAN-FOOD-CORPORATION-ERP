import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type {
  ExpectedStockView,
  InventoryAttentionItem,
  InventoryCategoryView,
  InventoryContextView,
  InventoryDashboardBucket,
  InventoryItemDetailView,
  InventoryItemListView,
  InventoryOverviewView,
  PermissionKey,
  StockAdjustmentView,
  StockCountView,
  StockIssueView,
  StockMovementView,
  StockTransferView,
  UnitOfMeasureView,
  WarehouseView,
} from '@nfc/shared';
import { inventoryStockStatus } from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StaleRecordError,
  ValidationFailedError,
} from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import { LedgerPostingService } from '../finance/ledger-posting.service';
import { WorkflowsService } from '../workflows/workflows.service';
import type {
  AdjustmentInput,
  CountLineInput,
  CreateCountInput,
  CreateItemInput,
  CreateWarehouseInput,
  IssueInput,
  ReceiveTransferInput,
  TransferInput,
  UpdateItemInput,
  UpsertCategoryInput,
} from './inventory.dto';

const OFFICER_ID = '00000000-0000-4000-8000-000000000004';

export type InventoryListFilters = {
  q?: string;
  categoryId?: string;
  stockStatus?: 'in_stock' | 'low' | 'out';
  warehouseId?: string;
  source?: string;
  from?: string;
  to?: string;
};

function emptyToNull(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    @Optional() private readonly ledger?: LedgerPostingService,
    @Optional() @Inject(forwardRef(() => WorkflowsService)) private readonly workflows?: WorkflowsService,
  ) {}

  assertListScope(
    actor: ActorContext,
    entityId: string | undefined,
    permission: PermissionKey = 'inventory.view',
  ): string | null {
    if (entityId) {
      assertCan(actor, permission, entityId);
      return entityId;
    }
    assertCan(actor, 'inventory.view.consolidated');
    if (permission !== 'inventory.view') assertCan(actor, permission);
    return null;
  }

  async context(actor: ActorContext): Promise<InventoryContextView> {
    if (!can(actor, 'inventory.view')) throw new ForbiddenError('You cannot view inventory.');
    return this.unitOfWork.read(actor, async (tx) => {
      const entities = await tx.client.query<{
        id: string;
        code: string;
        name: string;
        type: string;
      }>(`SELECT id, code, name, type FROM entities WHERE status = 'ACTIVE' AND type = 'SUBSIDIARY' ORDER BY code`);
      return {
        canConsolidate: can(actor, 'inventory.view.consolidated'),
        entities: entities.rows.filter((entity) => can(actor, 'inventory.view', entity.id)),
      };
    });
  }

  async overview(actor: ActorContext, entityId?: string): Promise<InventoryOverviewView> {
    const scoped = this.assertListScope(actor, entityId);
    return this.unitOfWork.read(actor, async (tx) => this.overviewInTx(tx, scoped));
  }

  async kpis(actor: ActorContext): Promise<{
    onHandValueKobo: number;
    expectedLines: number;
    lowStockCount: number;
    openProductionOrders: number;
    reservedSalesLines: number;
  }> {
    if (!can(actor, 'inventory.view')) throw new ForbiddenError('You cannot view inventory.');
    const scoped = can(actor, 'inventory.view.consolidated') ? null : (actor.entityIds[0] ?? null);
    if (scoped === null && !can(actor, 'inventory.view.consolidated')) {
      return {
        onHandValueKobo: 0,
        expectedLines: 0,
        lowStockCount: 0,
        openProductionOrders: 0,
        reservedSalesLines: 0,
      };
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const dash = await this.overviewInTx(tx, scoped);
      return {
        onHandValueKobo: dash.onHandValueKobo,
        expectedLines: dash.expectedLines,
        lowStockCount: dash.lowStockCount + dash.outOfStockCount,
        openProductionOrders: dash.openProductionOrders,
        reservedSalesLines: dash.reservedSalesLines,
      };
    });
  }

  async units(actor: ActorContext): Promise<UnitOfMeasureView[]> {
    if (!can(actor, 'inventory.view')) throw new ForbiddenError('You cannot view inventory.');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<UnitOfMeasureView>(
        `SELECT id, code, name, status FROM units_of_measure ORDER BY code`,
      );
      return result.rows;
    });
  }

  async categories(actor: ActorContext, entityId?: string): Promise<InventoryCategoryView[]> {
    const scoped = this.assertListScope(actor, entityId);
    return this.unitOfWork.read(actor, async (tx) => this.categoriesInTx(tx, scoped));
  }

  async upsertCategory(actor: ActorContext, input: UpsertCategoryInput): Promise<InventoryCategoryView> {
    assertCan(actor, 'inventory.config', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const key = input.key.trim().toLowerCase().replace(/\s+/g, '_');
      const existing = await tx.client.query<{ id: string; row_version: number }>(
        `SELECT id, row_version FROM inventory_categories WHERE entity_id = $1 AND key = $2`,
        [input.entityId, key],
      );
      let id = existing.rows[0]?.id;
      if (id) {
        if (input.rowVersion && input.rowVersion !== existing.rows[0]?.row_version) {
          throw new StaleRecordError('This category has changed. Refresh and try again.');
        }
        await tx.client.query(
          `UPDATE inventory_categories SET name = $1, status = coalesce($2, status), updated_by = $3 WHERE id = $4`,
          [input.name.trim(), input.status ?? null, actor.ref, id],
        );
      } else {
        const inserted = await tx.client.query<{ id: string }>(
          `INSERT INTO inventory_categories (entity_id, key, name, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $4) RETURNING id`,
          [input.entityId, key, input.name.trim(), actor.ref],
        );
        id = inserted.rows[0]?.id;
      }
      if (!id) throw new Error('The category was not saved.');
      await tx.audit({
        action: 'system_configuration_change',
        subjectType: 'inventory_category',
        subjectId: id,
        subjectLabel: input.name.trim(),
        entityId: input.entityId,
        newValue: { key, name: input.name.trim() },
      });
      const rows = await this.categoriesInTx(tx, input.entityId);
      const row = rows.find((item) => item.id === id);
      if (!row) throw new Error('The category was not loaded.');
      return row;
    });
  }

  async warehouses(actor: ActorContext, entityId?: string): Promise<WarehouseView[]> {
    const scoped = this.assertListScope(actor, entityId);
    return this.unitOfWork.read(actor, async (tx) => this.warehousesInTx(tx, scoped));
  }

  async createWarehouse(actor: ActorContext, input: CreateWarehouseInput): Promise<WarehouseView> {
    assertCan(actor, 'inventory.config', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO warehouses (entity_id, code, name, kind, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
        [input.entityId, input.code.trim().toUpperCase(), input.name.trim(), input.kind, actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The warehouse was not created.');
      await tx.audit({
        action: 'create',
        subjectType: 'warehouse',
        subjectId: id,
        subjectLabel: input.name.trim(),
        entityId: input.entityId,
        newValue: { code: input.code, kind: input.kind },
      });
      const rows = await this.warehousesInTx(tx, input.entityId);
      const row = rows.find((item) => item.id === id);
      if (!row) throw new Error('The warehouse was not loaded.');
      return row;
    });
  }

  async listItems(actor: ActorContext, entityId?: string, filters?: InventoryListFilters): Promise<InventoryItemListView[]> {
    const scoped = this.assertListScope(actor, entityId);
    return this.unitOfWork.read(actor, async (tx) => this.listItemsInTx(tx, scoped, filters));
  }

  async getItem(actor: ActorContext, id: string): Promise<InventoryItemDetailView> {
    return this.unitOfWork.read(actor, async (tx) => {
      const item = await this.loadItem(tx, id);
      assertCan(actor, 'inventory.view', item.entity_id);
      const list = await this.listItemsInTx(tx, item.entity_id);
      const summary = list.find((row) => row.id === id);
      if (!summary) throw new NotFoundError('That item was not found.');
      const warehouses = await tx.client.query<{
        warehouse_id: string;
        warehouse_name: string;
        qty: string;
        value: string;
      }>(
        `SELECT w.id AS warehouse_id, w.name AS warehouse_name,
                coalesce(sum(m.quantity_in - m.quantity_out), 0)::text AS qty,
                coalesce(sum(m.value_kobo), 0)::text AS value
           FROM warehouses w
           LEFT JOIN stock_movements m ON m.warehouse_id = w.id AND m.item_id = $1
          WHERE w.entity_id = $2
          GROUP BY w.id, w.name
          ORDER BY w.name`,
        [id, item.entity_id],
      );
      const batches = await tx.client.query<{
        id: string;
        batch_code: string;
        warehouse_name: string;
        qty: string;
      }>(
        `SELECT b.id, b.batch_code, w.name AS warehouse_name,
                coalesce((
                  SELECT sum(m.quantity_in - m.quantity_out) FROM stock_movements m WHERE m.batch_id = b.id
                ), 0)::text AS qty
           FROM stock_batches b
           JOIN warehouses w ON w.id = b.warehouse_id
          WHERE b.item_id = $1
          ORDER BY b.batch_code`,
        [id],
      );
      const serials = await tx.client.query<{
        id: string;
        serial_code: string;
        status: string;
        warehouse_name: string;
      }>(
        `SELECT s.id, s.serial_code, s.status, w.name AS warehouse_name
           FROM stock_serials s JOIN warehouses w ON w.id = s.warehouse_id
          WHERE s.item_id = $1 ORDER BY s.serial_code`,
        [id],
      );
      const suppliers = await tx.client.query<{ vendor_id: string; vendor_name: string }>(
        `SELECT v.id AS vendor_id, v.legal_name AS vendor_name
           FROM inventory_item_vendors iv JOIN vendors v ON v.id = iv.vendor_id
          WHERE iv.item_id = $1`,
        [id],
      );
      const producedFrom = await tx.client.query<{
        order_id: string;
        order_reference: string;
        raw_batch_code: string;
        quantity: string;
      }>(
        `SELECT l.order_id, o.reference_number AS order_reference, b.batch_code AS raw_batch_code, l.quantity::text
           FROM production_batch_links l
           JOIN production_orders o ON o.id = l.order_id
           JOIN stock_batches fb ON fb.id = l.finished_batch_id
           JOIN stock_batches b ON b.id = l.raw_batch_id
          WHERE fb.item_id = $1
          ORDER BY o.reference_number, b.batch_code`,
        [id],
      );
      const consumedIn = await tx.client.query<{
        order_id: string;
        order_reference: string;
        finished_batch_code: string;
        quantity: string;
      }>(
        `SELECT l.order_id, o.reference_number AS order_reference, b.batch_code AS finished_batch_code, l.quantity::text
           FROM production_batch_links l
           JOIN production_orders o ON o.id = l.order_id
           JOIN stock_batches rb ON rb.id = l.raw_batch_id
           JOIN stock_batches b ON b.id = l.finished_batch_id
          WHERE rb.item_id = $1
          ORDER BY o.reference_number, b.batch_code`,
        [id],
      );
      const soldOn = await tx.client.query<{
        order_id: string;
        order_reference: string;
        quantity: string;
        status: string;
      }>(
        `SELECT so.id AS order_id, so.reference_number AS order_reference,
                sol.quantity::text, so.status
           FROM sales_order_lines sol
           JOIN sales_orders so ON so.id = sol.order_id
          WHERE sol.item_id = $1 AND so.status NOT IN ('CANCELLED')
          ORDER BY so.reference_number`,
        [id],
      );
      const movements = await this.movementsInTx(tx, item.entity_id, id);
      const history = await tx.client.query<{
        procurement_id: string;
        procurement_reference: string;
        grn_reference: string | null;
        vendor_name: string | null;
        quantity: string;
        occurred_on: string;
      }>(
        `SELECT pr.id AS procurement_id, pr.reference_number AS procurement_reference,
                g.reference_number AS grn_reference, v.legal_name AS vendor_name,
                m.quantity_in::text AS quantity, m.occurred_on::text
           FROM stock_movements m
           JOIN procurement_requests pr ON pr.id = m.procurement_request_id
           LEFT JOIN procurement_goods_receipts g ON g.id = m.grn_id
           LEFT JOIN vendors v ON v.id = pr.vendor_id
          WHERE m.item_id = $1 AND m.source = 'GRN'
          ORDER BY m.occurred_on DESC, m.created_at DESC`,
        [id],
      );
      return {
        ...summary,
        uomId: item.uom_id,
        defaultWarehouseId: item.default_warehouse_id,
        costMethod: 'weighted_average',
        producedFrom: producedFrom.rows.map((row) => ({
          orderId: row.order_id,
          orderReference: row.order_reference,
          rawBatchCode: row.raw_batch_code,
          quantity: Number(row.quantity),
        })),
        consumedIn: consumedIn.rows.map((row) => ({
          orderId: row.order_id,
          orderReference: row.order_reference,
          finishedBatchCode: row.finished_batch_code,
          quantity: Number(row.quantity),
        })),
        soldOn: soldOn.rows.map((row) => ({
          orderId: row.order_id,
          orderReference: row.order_reference,
          quantity: Number(row.quantity),
          status: row.status,
        })),
        suppliers: suppliers.rows.map((row) => ({ vendorId: row.vendor_id, vendorName: row.vendor_name })),
        onHandByWarehouse: warehouses.rows.map((row) => ({
          warehouseId: row.warehouse_id,
          warehouseName: row.warehouse_name,
          qty: Number(row.qty),
          valueKobo: Number(row.value),
        })),
        batches: batches.rows.map((row) => ({
          id: row.id,
          batchCode: row.batch_code,
          warehouseName: row.warehouse_name,
          qty: Number(row.qty),
        })),
        serials: serials.rows.map((row) => ({
          id: row.id,
          serialCode: row.serial_code,
          status: row.status,
          warehouseName: row.warehouse_name,
        })),
        movements,
        purchaseHistory: history.rows.map((row) => ({
          procurementId: row.procurement_id,
          procurementReference: row.procurement_reference,
          grnReference: row.grn_reference,
          vendorName: row.vendor_name,
          quantity: Number(row.quantity),
          occurredOn: row.occurred_on,
        })),
      };
    });
  }

  async createItem(actor: ActorContext, input: CreateItemInput): Promise<InventoryItemDetailView> {
    assertCan(actor, 'inventory.item.manage', input.entityId);
    const id = await this.unitOfWork.write(actor, async (tx) => {
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO inventory_items (
           entity_id, code, name, category_id, uom_id, default_warehouse_id, reorder_level,
           tracking_mode, asset, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING id`,
        [
          input.entityId,
          input.code.trim().toUpperCase(),
          input.name.trim(),
          input.categoryId,
          input.uomId,
          input.defaultWarehouseId ?? null,
          input.reorderLevel,
          input.trackingMode,
          input.asset ?? false,
          actor.ref,
        ],
      );
      const created = inserted.rows[0]?.id;
      if (!created) throw new Error('The item was not created.');
      for (const vendorId of input.vendorIds ?? []) {
        await tx.client.query(
          `INSERT INTO inventory_item_vendors (item_id, vendor_id, entity_id, created_by)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [created, vendorId, input.entityId, actor.ref],
        );
      }
      await this.indexItem(tx, created);
      await tx.audit({
        action: 'create',
        subjectType: 'inventory_item',
        subjectId: created,
        subjectLabel: input.name.trim(),
        entityId: input.entityId,
        newValue: { code: input.code, tracking: input.trackingMode },
      });
      return created;
    });
    return this.getItem(actor, id);
  }

  async updateItem(actor: ActorContext, id: string, input: UpdateItemInput): Promise<InventoryItemDetailView> {
    await this.unitOfWork.write(actor, async (tx) => {
      const current = await this.loadItem(tx, id);
      assertCan(actor, 'inventory.item.manage', current.entity_id);
      if (current.row_version !== input.rowVersion) {
        throw new StaleRecordError('This item has changed. Refresh and try again.');
      }
      await tx.client.query(
        `UPDATE inventory_items
            SET name = $1, category_id = $2, uom_id = $3, default_warehouse_id = $4,
                reorder_level = $5, tracking_mode = $6, asset = coalesce($7, asset),
                status = coalesce($8, status), updated_by = $9
          WHERE id = $10`,
        [
          input.name.trim(),
          input.categoryId,
          input.uomId,
          input.defaultWarehouseId ?? null,
          input.reorderLevel,
          input.trackingMode,
          input.asset ?? null,
          input.status ?? null,
          actor.ref,
          id,
        ],
      );
      await this.indexItem(tx, id);
      await tx.audit({
        action: 'edit',
        subjectType: 'inventory_item',
        subjectId: id,
        subjectLabel: input.name.trim(),
        entityId: current.entity_id,
      });
    });
    return this.getItem(actor, id);
  }

  async expected(actor: ActorContext, entityId?: string): Promise<ExpectedStockView[]> {
    const scoped = this.assertListScope(actor, entityId);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        entity_id: string;
        procurement_request_id: string;
        procurement_reference: string;
        procurement_line_id: string;
        item_id: string | null;
        item_code: string | null;
        item_name: string | null;
        vendor_name: string | null;
        quantity_expected: string;
        quantity_remaining: string;
        required_date: string | null;
        status: 'OPEN' | 'CLOSED';
      }>(
        `SELECT e.id, e.entity_id, e.procurement_request_id, pr.reference_number AS procurement_reference,
                e.procurement_line_id, e.item_id, i.code AS item_code, i.name AS item_name,
                v.legal_name AS vendor_name, e.quantity_expected::text, e.quantity_remaining::text,
                e.required_date::text, e.status
           FROM expected_stock e
           JOIN procurement_requests pr ON pr.id = e.procurement_request_id
           LEFT JOIN inventory_items i ON i.id = e.item_id
           LEFT JOIN vendors v ON v.id = e.vendor_id
          WHERE ($1::uuid IS NULL OR e.entity_id = $1)
          ORDER BY e.created_at DESC`,
        [scoped],
      );
      return result.rows.map((row) => ({
        id: row.id,
        entityId: row.entity_id,
        procurementId: row.procurement_request_id,
        procurementReference: row.procurement_reference,
        lineId: row.procurement_line_id,
        itemId: row.item_id,
        itemCode: row.item_code,
        itemName: row.item_name,
        vendorName: row.vendor_name,
        quantityExpected: Number(row.quantity_expected),
        quantityRemaining: Number(row.quantity_remaining),
        requiredDate: row.required_date,
        status: row.status,
      }));
    });
  }

  async movements(actor: ActorContext, entityId?: string, filters?: InventoryListFilters): Promise<StockMovementView[]> {
    const scoped = this.assertListScope(actor, entityId);
    return this.unitOfWork.read(actor, async (tx) => this.movementsInTx(tx, scoped, undefined, filters));
  }

  async alerts(actor: ActorContext, entityId?: string): Promise<InventoryItemListView[]> {
    const items = await this.listItems(actor, entityId);
    return items.filter((item) => item.onHandQty <= item.reorderLevel);
  }

  async applyExpectedInTx(
    tx: TxScope,
    actor: ActorContext,
    input: { requestId: string; lineId: string; entityId: string },
  ): Promise<void> {
    const line = await tx.client.query<{
      id: string;
      description: string;
      quantity: number | null;
      unit_id: string | null;
      category_key: string | null;
      stock_item: boolean;
      asset: boolean;
      vendor_id: string | null;
      required_date: string | null;
    }>(
      `SELECT l.id, l.description, l.quantity, l.unit_id, c.key AS category_key,
              coalesce(c.stock_item, false) AS stock_item, coalesce(c.asset, false) AS asset,
              r.vendor_id, v.required_date::text AS required_date
         FROM procurement_version_lines l
         JOIN procurement_requests r ON r.id = $2
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
         LEFT JOIN procurement_categories c ON c.id = l.category_id
        WHERE l.id = $1`,
      [input.lineId, input.requestId],
    );
    const row = line.rows[0];
    if (!row || (!row.stock_item && !row.asset)) return;
    const qty = Number(row.quantity ?? 0);
    if (qty <= 0) return;
    const itemId = await this.ensureItemFromLine(tx, actor, {
      entityId: input.entityId,
      description: row.description,
      unitId: row.unit_id,
      asset: row.asset,
      categoryKey: row.category_key,
      vendorId: row.vendor_id,
    });
    await tx.client.query(
      `INSERT INTO expected_stock (
         entity_id, procurement_request_id, procurement_line_id, item_id, vendor_id,
         quantity_expected, quantity_remaining, required_date, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $8)
       ON CONFLICT (procurement_line_id) DO UPDATE
         SET quantity_expected = excluded.quantity_expected,
             quantity_remaining = GREATEST(excluded.quantity_expected - (
               expected_stock.quantity_expected - expected_stock.quantity_remaining
             ), 0),
             item_id = excluded.item_id,
             status = CASE WHEN GREATEST(excluded.quantity_expected - (
               expected_stock.quantity_expected - expected_stock.quantity_remaining
             ), 0) = 0 THEN 'CLOSED' ELSE 'OPEN' END,
             updated_by = excluded.updated_by`,
      [input.entityId, input.requestId, input.lineId, itemId, row.vendor_id, qty, row.required_date, actor.ref],
    );
  }

  async applyReceiptInTx(
    tx: TxScope,
    actor: ActorContext,
    input: {
      grnId: string;
      warehouseId?: string | null;
      batchCode?: string | null;
      serialCodes?: string[];
    },
  ): Promise<void> {
    const existing = await tx.client.query<{ id: string }>(
      `SELECT id FROM stock_movements WHERE grn_id = $1 AND source = 'GRN' AND reverses_id IS NULL`,
      [input.grnId],
    );
    if (existing.rows[0]) return;
    const grn = await tx.client.query<{
      id: string;
      entity_id: string;
      request_id: string;
      line_id: string | null;
      quantity_accepted: string;
      quantity_rejected: string;
      received_date: string;
      location: string;
      reference_number: string;
    }>(
      `SELECT id, entity_id, request_id, line_id, quantity_accepted::text, quantity_rejected::text,
              received_date::text, location, reference_number
         FROM procurement_goods_receipts WHERE id = $1`,
      [input.grnId],
    );
    const row = grn.rows[0];
    if (!row) return;
    const accepted = Number(row.quantity_accepted);
    if (accepted <= 0) return;
    const line = await tx.client.query<{
      id: string;
      description: string;
      unit_id: string | null;
      unit_price_kobo: string | null;
      category_key: string | null;
      stock_item: boolean;
      asset: boolean;
      vendor_id: string | null;
    }>(
      `SELECT l.id, l.description, l.unit_id, l.unit_price_kobo::text, c.key AS category_key,
              coalesce(c.stock_item, false) AS stock_item, coalesce(c.asset, false) AS asset,
              r.vendor_id
         FROM procurement_version_lines l
         JOIN procurement_requests r ON r.id = $2
         LEFT JOIN procurement_categories c ON c.id = l.category_id
        WHERE l.id = coalesce($1::uuid, (
          SELECT l2.id FROM procurement_version_lines l2
           JOIN procurement_versions v ON v.id = l2.version_id
          WHERE v.request_id = r.id AND v.version_number = r.current_version
          ORDER BY l2.line_number LIMIT 1
        ))`,
      [row.line_id, row.request_id],
    );
    const stock = line.rows[0];
    if (!stock || (!stock.stock_item && !stock.asset)) return;
    const itemId = await this.ensureItemFromLine(tx, actor, {
      entityId: row.entity_id,
      description: stock.description,
      unitId: stock.unit_id,
      asset: stock.asset,
      categoryKey: stock.category_key,
      vendorId: stock.vendor_id,
    });
    const item = await this.loadItem(tx, itemId);
    const warehouseId =
      input.warehouseId ??
      item.default_warehouse_id ??
      (await this.firstWarehouse(tx, row.entity_id, row.location));
    if (!warehouseId) throw new ValidationFailedError('A warehouse is required before stock can be received.');
    if (item.tracking_mode === 'serial') {
      const serials = input.serialCodes ?? [];
      if (serials.length !== accepted) {
        throw new ValidationFailedError('Each accepted unit of a serial-tracked item needs a serial number.');
      }
    }
    const unitCost = Number(stock.unit_price_kobo ?? 0);
    const batchId =
      item.tracking_mode === 'batch_lot'
        ? await this.ensureBatch(tx, actor, {
            entityId: row.entity_id,
            itemId,
            warehouseId,
            batchCode: input.batchCode?.trim() || row.reference_number,
          })
        : null;
    const serialIds: string[] = [];
    if (item.tracking_mode === 'serial') {
      for (const code of input.serialCodes ?? []) {
        serialIds.push(
          await this.ensureSerial(tx, actor, {
            entityId: row.entity_id,
            itemId,
            warehouseId,
            serialCode: code,
          }),
        );
      }
    }
    const qtyPer = serialIds.length > 0 ? 1 : accepted;
    const targets = serialIds.length > 0 ? serialIds : [null];
    for (const serialId of targets) {
      const movementId = await this.insertMovement(tx, actor, {
        entityId: row.entity_id,
        itemId,
        warehouseId,
        batchId,
        serialId,
        quantityIn: qtyPer,
        quantityOut: 0,
        unitCostKobo: unitCost,
        source: 'GRN',
        sourceId: row.id,
        procurementRequestId: row.request_id,
        grnId: row.id,
        occurredOn: row.received_date,
        notes: `Accepted on ${row.reference_number}`,
      });
      const ruleKind = item.asset || stock.asset ? 'receipt_equipment' : 'receipt_goods';
      await this.postMovement(tx, actor, {
        movementId,
        entityId: row.entity_id,
        occurredOn: row.received_date,
        amountKobo: Math.round(unitCost * qtyPer),
        ruleKind,
        source: 'INVENTORY_RECEIPT',
        idempotencyKey: `inv-grn:${row.id}:${serialId ?? 'bulk'}`,
        procurementRequestId: row.request_id,
        narration: `Inventory receipt ${row.reference_number}`,
      });
    }
    await tx.client.query(
      `UPDATE expected_stock
          SET quantity_remaining = GREATEST(quantity_remaining - $1, 0),
              status = CASE WHEN quantity_remaining - $1 <= 0 THEN 'CLOSED' ELSE status END,
              item_id = coalesce(item_id, $2),
              updated_by = $3
        WHERE procurement_line_id = $4`,
      [accepted, itemId, actor.ref, stock.id],
    );
    await this.maybeLowStock(tx, actor, itemId);
  }

  async reverseReceiptInTx(tx: TxScope, actor: ActorContext, grnId: string): Promise<void> {
    const originals = await tx.client.query<{
      id: string;
      entity_id: string;
      item_id: string;
      warehouse_id: string;
      batch_id: string | null;
      serial_id: string | null;
      quantity_in: string;
      unit_cost_kobo: string;
      procurement_request_id: string | null;
      occurred_on: string;
    }>(
      `SELECT id, entity_id, item_id, warehouse_id, batch_id, serial_id, quantity_in::text,
              unit_cost_kobo::text, procurement_request_id, occurred_on::text
         FROM stock_movements
        WHERE grn_id = $1 AND source = 'GRN' AND reverses_id IS NULL`,
      [grnId],
    );
    for (const row of originals.rows) {
      const qty = Number(row.quantity_in);
      await this.insertMovement(tx, actor, {
        entityId: row.entity_id,
        itemId: row.item_id,
        warehouseId: row.warehouse_id,
        batchId: row.batch_id,
        serialId: row.serial_id,
        quantityIn: 0,
        quantityOut: qty,
        unitCostKobo: Number(row.unit_cost_kobo),
        source: 'REVERSE',
        sourceId: row.id,
        procurementRequestId: row.procurement_request_id,
        grnId,
        reversesId: row.id,
        occurredOn: row.occurred_on,
        notes: 'Superseded GRN',
      });
      await tx.client.query(
        `UPDATE expected_stock SET quantity_remaining = quantity_remaining + $1, status = 'OPEN', updated_by = $2
          WHERE item_id = $3 AND entity_id = $4
            AND ($5::uuid IS NULL OR procurement_request_id = $5)
            AND status IN ('OPEN', 'CLOSED')`,
        [qty, actor.ref, row.item_id, row.entity_id, row.procurement_request_id],
      );
    }
  }

  async issue(actor: ActorContext, input: IssueInput): Promise<StockIssueView> {
    assertCan(actor, 'inventory.issue', input.entityId);
    const id = await this.unitOfWork.write(actor, async (tx) => {
      const ref = await this.nextRef(tx, 'IST');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO stock_issues (
           reference_number, entity_id, warehouse_id, destination_type, destination_id, destination_label,
           reason, occurred_on, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
        [
          ref,
          input.entityId,
          input.warehouseId,
          input.destinationType,
          input.destinationId ?? null,
          input.destinationLabel ?? null,
          input.reason.trim(),
          input.occurredOn,
          actor.ref,
        ],
      );
      const issueId = inserted.rows[0]?.id;
      if (!issueId) throw new Error('The issue was not recorded.');
      for (const line of input.lines) {
        const cost = await this.averageCost(tx, line.itemId, input.warehouseId);
        const { batchId, serialId } = await this.resolveTracking(tx, actor, {
          entityId: input.entityId,
          itemId: line.itemId,
          warehouseId: input.warehouseId,
          batchCode: line.batchCode,
          serialCode: line.serialCode,
          outbound: true,
        });
        const movementId = await this.insertMovement(tx, actor, {
          entityId: input.entityId,
          itemId: line.itemId,
          warehouseId: input.warehouseId,
          batchId,
          serialId,
          quantityIn: 0,
          quantityOut: line.quantity,
          unitCostKobo: cost,
          source: 'ISSUE',
          sourceId: issueId,
          occurredOn: input.occurredOn,
          notes: input.reason,
        });
        await tx.client.query(
          `INSERT INTO stock_issue_lines (
             issue_id, entity_id, item_id, quantity, batch_id, serial_id, movement_id, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [issueId, input.entityId, line.itemId, line.quantity, batchId, serialId, movementId, actor.ref],
        );
        await this.postMovement(tx, actor, {
          movementId,
          entityId: input.entityId,
          occurredOn: input.occurredOn,
          amountKobo: Math.round(cost * line.quantity),
          ruleKind: 'issue',
          source: 'INVENTORY_ISSUE',
          idempotencyKey: `inv-issue:${issueId}:${line.itemId}`,
          narration: `Stock issue ${ref}`,
        });
        if (serialId) {
          await tx.client.query(`UPDATE stock_serials SET status = 'ISSUED', updated_by = $1 WHERE id = $2`, [
            actor.ref,
            serialId,
          ]);
        }
        await this.maybeLowStock(tx, actor, line.itemId);
      }
      await tx.audit({
        action: 'create',
        subjectType: 'stock_issue',
        subjectId: issueId,
        subjectLabel: ref,
        subjectReferenceNumber: ref,
        entityId: input.entityId,
        reason: input.reason,
      });
      return issueId;
    });
    return this.getIssue(actor, id);
  }

  async listIssues(actor: ActorContext, entityId?: string): Promise<StockIssueView[]> {
    const scoped = this.assertListScope(actor, entityId);
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT id FROM stock_issues WHERE ($1::uuid IS NULL OR entity_id = $1) ORDER BY created_at DESC`,
        [scoped],
      );
      return Promise.all(ids.rows.map((row) => this.issueView(tx, row.id)));
    });
  }

  async transfer(actor: ActorContext, input: TransferInput): Promise<StockTransferView> {
    assertCan(actor, 'inventory.transfer', input.sourceEntityId);
    const intra = input.sourceEntityId === input.destinationEntityId;
    if (intra && !input.destWarehouseId) {
      throw new ValidationFailedError('The destination warehouse is required.');
    }
    const id = await this.unitOfWork.write(actor, async (tx) => {
      const ref = await this.nextRef(tx, 'ITR');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO stock_transfers (
           reference_number, source_entity_id, destination_entity_id, source_warehouse_id, dest_warehouse_id,
           status, reason, occurred_on, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
        [
          ref,
          input.sourceEntityId,
          input.destinationEntityId,
          input.sourceWarehouseId,
          input.destWarehouseId ?? null,
          intra ? 'RECEIVED' : 'PENDING_APPROVAL',
          input.reason.trim(),
          input.occurredOn,
          actor.ref,
        ],
      );
      const transferId = inserted.rows[0]?.id;
      if (!transferId) throw new Error('The transfer was not created.');
      for (const line of input.lines) {
        const cost = await this.averageCost(tx, line.itemId, input.sourceWarehouseId);
        const { batchId, serialId } = await this.resolveTracking(tx, actor, {
          entityId: input.sourceEntityId,
          itemId: line.itemId,
          warehouseId: input.sourceWarehouseId,
          batchCode: line.batchCode,
          serialCode: line.serialCode,
          outbound: true,
        });
        const outId = await this.insertMovement(tx, actor, {
          entityId: input.sourceEntityId,
          itemId: line.itemId,
          warehouseId: input.sourceWarehouseId,
          batchId,
          serialId,
          quantityIn: 0,
          quantityOut: line.quantity,
          unitCostKobo: cost,
          source: 'TRANSFER',
          sourceId: transferId,
          occurredOn: input.occurredOn,
          notes: input.reason,
        });
        let inId: string | null = null;
        if (intra && input.destWarehouseId) {
          inId = await this.insertMovement(tx, actor, {
            entityId: input.destinationEntityId,
            itemId: line.itemId,
            warehouseId: input.destWarehouseId,
            batchId,
            serialId,
            quantityIn: line.quantity,
            quantityOut: 0,
            unitCostKobo: cost,
            source: 'TRANSFER',
            sourceId: transferId,
            occurredOn: input.occurredOn,
            notes: input.reason,
          });
        }
        await tx.client.query(
          `INSERT INTO stock_transfer_lines (
             transfer_id, entity_id, item_id, quantity, batch_id, serial_id, out_movement_id, in_movement_id, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
          [
            transferId,
            input.sourceEntityId,
            line.itemId,
            line.quantity,
            batchId,
            serialId,
            outId,
            inId,
            actor.ref,
          ],
        );
      }
      if (!intra) {
        await this.workflows?.startInventoryTransferInTx(tx, actor, { transferId });
        await tx.publish({
          eventType: 'inventory.transfer.submitted',
          subjectType: 'INVENTORY_TRANSFER',
          subjectId: transferId,
          entityId: input.sourceEntityId,
          payload: {
            type: 'inventory.transfer.submitted',
            reference: ref,
            title: `Stock transfer ${ref}`,
            href: `/inventory/transfers`,
          },
        });
      }
      await tx.indexSearch({
        recordType: 'STOCK_TRANSFER',
        recordId: transferId,
        referenceNumber: ref,
        title: `Stock transfer ${ref}`,
        searchableText: `${ref} ${input.reason}`,
        entityId: input.sourceEntityId,
        permissionKey: 'inventory.view',
      });
      await tx.audit({
        action: 'transfer',
        subjectType: 'stock_transfer',
        subjectId: transferId,
        subjectLabel: ref,
        subjectReferenceNumber: ref,
        entityId: input.sourceEntityId,
        reason: input.reason,
      });
      return transferId;
    });
    return this.getTransfer(actor, id);
  }

  async receiveTransfer(actor: ActorContext, id: string, input: ReceiveTransferInput): Promise<StockTransferView> {
    await this.unitOfWork.write(actor, async (tx) => {
      const header = await tx.client.query<{
        id: string;
        status: string;
        destination_entity_id: string;
        occurred_on: string;
        reference_number: string;
        intercompany_id: string | null;
      }>(
        `SELECT id, status, destination_entity_id, occurred_on::text, reference_number, intercompany_id
           FROM stock_transfers WHERE id = $1`,
        [id],
      );
      const row = header.rows[0];
      if (!row) throw new NotFoundError('That transfer was not found.');
      assertCan(actor, 'inventory.receive', row.destination_entity_id);
      if (row.status !== 'IN_TRANSIT') throw new ConflictError('Only an in-transit transfer can be received.');
      const lines = await tx.client.query<{
        id: string;
        item_id: string;
        quantity: string;
        batch_id: string | null;
        serial_id: string | null;
        out_movement_id: string | null;
      }>(
        `SELECT id, item_id, quantity::text, batch_id, serial_id, out_movement_id
           FROM stock_transfer_lines WHERE transfer_id = $1`,
        [id],
      );
      const destItemBySource = new Map<string, string>();
      for (const line of lines.rows) {
        const source = await this.loadItem(tx, line.item_id);
        const destItemId = await this.ensureItemFromLine(tx, actor, {
          entityId: row.destination_entity_id,
          description: source.name,
          unitId: source.uom_id,
          asset: source.asset,
          categoryKey: null,
          vendorId: null,
          code: source.code,
        });
        destItemBySource.set(line.item_id, destItemId);
        const outCost = line.out_movement_id
          ? Number(
              (
                await tx.client.query<{ n: string }>(
                  `SELECT unit_cost_kobo::text AS n FROM stock_movements WHERE id = $1`,
                  [line.out_movement_id],
                )
              ).rows[0]?.n ?? 0,
            )
          : 0;
        const inId = await this.insertMovement(tx, actor, {
          entityId: row.destination_entity_id,
          itemId: destItemId,
          warehouseId: input.destWarehouseId,
          batchId: line.batch_id,
          serialId: line.serial_id,
          quantityIn: Number(line.quantity),
          quantityOut: 0,
          unitCostKobo: outCost,
          source: 'TRANSFER',
          sourceId: id,
          occurredOn: row.occurred_on,
          notes: `Received ${row.reference_number}`,
        });
        await tx.client.query(
          `UPDATE stock_transfer_lines SET in_movement_id = $1, dest_item_id = $2, updated_by = $3 WHERE id = $4`,
          [inId, destItemId, actor.ref, line.id],
        );
        await this.postMovement(tx, actor, {
          movementId: inId,
          entityId: row.destination_entity_id,
          occurredOn: row.occurred_on,
          amountKobo: Math.round(outCost * Number(line.quantity)),
          ruleKind: 'transfer_in',
          source: 'INVENTORY_TRANSFER',
          idempotencyKey: `inv-trf-in:${id}:${line.item_id}`,
          intercompanyTransactionId: row.intercompany_id,
          narration: `Stock transfer in ${row.reference_number}`,
        });
        if (row.intercompany_id) {
          const journal = await tx.client.query<{ journal_id: string | null }>(
            `SELECT journal_id FROM stock_movements WHERE id = $1`,
            [inId],
          );
          if (journal.rows[0]?.journal_id) {
            await tx.client.query(
              `UPDATE intercompany_transactions SET destination_journal_id = $1, updated_by = $2 WHERE id = $3`,
              [journal.rows[0].journal_id, actor.ref, row.intercompany_id],
            );
          }
        }
      }
      void destItemBySource;
      await tx.client.query(
        `UPDATE stock_transfers SET status = 'RECEIVED', dest_warehouse_id = $1, updated_by = $2 WHERE id = $3`,
        [input.destWarehouseId, actor.ref, id],
      );
    });
    return this.getTransfer(actor, id);
  }

  async listTransfers(actor: ActorContext, entityId?: string): Promise<StockTransferView[]> {
    const scoped = this.assertListScope(actor, entityId);
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT id FROM stock_transfers
          WHERE $1::uuid IS NULL OR source_entity_id = $1 OR destination_entity_id = $1
          ORDER BY created_at DESC`,
        [scoped],
      );
      return Promise.all(ids.rows.map((row) => this.transferView(tx, row.id)));
    });
  }

  async prepareAdjustment(actor: ActorContext, input: AdjustmentInput): Promise<StockAdjustmentView> {
    assertCan(actor, 'inventory.adjust.prepare', input.entityId);
    if (['damaged', 'expired'].includes(input.kind) && !input.evidenceDocumentId) {
      throw new ValidationFailedError('A write-off needs supporting evidence.');
    }
    const id = await this.unitOfWork.write(actor, async (tx) => {
      const ref = await this.nextRef(tx, 'IAD');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO stock_adjustments (
           reference_number, entity_id, warehouse_id, kind, reason, evidence_document_id, occurred_on,
           created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
        [
          ref,
          input.entityId,
          input.warehouseId,
          input.kind,
          input.reason.trim(),
          input.evidenceDocumentId ?? null,
          input.occurredOn,
          actor.ref,
        ],
      );
      const adjustmentId = inserted.rows[0]?.id;
      if (!adjustmentId) throw new Error('The adjustment was not created.');
      for (const line of input.lines) {
        if (line.quantity === 0) throw new ValidationFailedError('An adjustment quantity cannot be zero.');
        await tx.client.query(
          `INSERT INTO stock_adjustment_lines (adjustment_id, entity_id, item_id, quantity, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $5)`,
          [adjustmentId, input.entityId, line.itemId, line.quantity, actor.ref],
        );
      }
      await this.workflows?.startInventoryAdjustmentInTx(tx, actor, { adjustmentId });
      await tx.publish({
        eventType: 'inventory.adjustment.submitted',
        subjectType: 'INVENTORY_ADJUSTMENT',
        subjectId: adjustmentId,
        entityId: input.entityId,
        payload: {
          type: 'inventory.adjustment.submitted',
          reference: ref,
          title: `Stock adjustment ${ref}`,
          href: `/inventory/adjustments`,
        },
      });
      await tx.audit({
        action: 'inventory_adjustment',
        subjectType: 'stock_adjustment',
        subjectId: adjustmentId,
        subjectLabel: ref,
        subjectReferenceNumber: ref,
        entityId: input.entityId,
        reason: input.reason,
      });
      return adjustmentId;
    });
    return this.getAdjustment(actor, id);
  }

  async listAdjustments(actor: ActorContext, entityId?: string): Promise<StockAdjustmentView[]> {
    const scoped = this.assertListScope(actor, entityId);
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT id FROM stock_adjustments WHERE ($1::uuid IS NULL OR entity_id = $1) ORDER BY created_at DESC`,
        [scoped],
      );
      return Promise.all(ids.rows.map((row) => this.adjustmentView(tx, row.id)));
    });
  }

  async postAdjustmentInTx(tx: TxScope, actor: ActorContext, adjustmentId: string): Promise<void> {
    const header = await tx.client.query<{
      id: string;
      entity_id: string;
      warehouse_id: string;
      kind: string;
      occurred_on: string;
      reference_number: string;
      created_by: string;
      status: string;
    }>(
      `SELECT id, entity_id, warehouse_id, kind, occurred_on::text, reference_number, created_by, status
         FROM stock_adjustments WHERE id = $1 FOR UPDATE`,
      [adjustmentId],
    );
    const row = header.rows[0];
    if (!row) return;
    if (row.created_by === actor.ref) {
      throw new ForbiddenError('The person who prepared this adjustment cannot approve it.');
    }
    if (row.status !== 'PENDING_APPROVAL') return;
    const lines = await tx.client.query<{ id: string; item_id: string; quantity: string }>(
      `SELECT id, item_id, quantity::text FROM stock_adjustment_lines WHERE adjustment_id = $1`,
      [adjustmentId],
    );
    for (const line of lines.rows) {
      const qty = Number(line.quantity);
      const inbound = qty > 0;
      const abs = Math.abs(qty);
      const cost = await this.averageCost(tx, line.item_id, row.warehouse_id);
      const movementId = await this.insertMovement(tx, actor, {
        entityId: row.entity_id,
        itemId: line.item_id,
        warehouseId: row.warehouse_id,
        batchId: null,
        serialId: null,
        quantityIn: inbound ? abs : 0,
        quantityOut: inbound ? 0 : abs,
        unitCostKobo: cost,
        source: row.kind === 'damaged' || row.kind === 'expired' ? 'WRITE_OFF' : 'ADJUSTMENT',
        sourceId: adjustmentId,
        occurredOn: row.occurred_on,
        notes: row.reference_number,
      });
      await tx.client.query(
        `UPDATE stock_adjustment_lines SET movement_id = $1, updated_by = $2 WHERE id = $3`,
        [movementId, actor.ref, line.id],
      );
      const writeOff = row.kind === 'damaged' || row.kind === 'expired' || !inbound;
      await this.postMovement(tx, actor, {
        movementId,
        entityId: row.entity_id,
        occurredOn: row.occurred_on,
        amountKobo: Math.round(cost * abs),
        ruleKind: inbound ? 'adjustment_increase' : writeOff ? 'write_off' : 'issue',
        source: writeOff ? 'INVENTORY_WRITE_OFF' : 'INVENTORY_ADJUSTMENT',
        idempotencyKey: `inv-adj:${adjustmentId}:${line.item_id}`,
        narration: `Stock adjustment ${row.reference_number}`,
      });
      await this.maybeLowStock(tx, actor, line.item_id);
    }
    await tx.client.query(`UPDATE stock_adjustments SET status = 'POSTED', updated_by = $1 WHERE id = $2`, [
      actor.ref,
      adjustmentId,
    ]);
  }

  async rejectAdjustmentInTx(tx: TxScope, actor: ActorContext, adjustmentId: string): Promise<void> {
    await tx.client.query(
      `UPDATE stock_adjustments SET status = 'REJECTED', updated_by = $1 WHERE id = $2 AND status = 'PENDING_APPROVAL'`,
      [actor.ref, adjustmentId],
    );
  }

  async postTransferOutInTx(tx: TxScope, actor: ActorContext, transferId: string): Promise<void> {
    const header = await tx.client.query<{
      id: string;
      status: string;
      source_entity_id: string;
      destination_entity_id: string;
      reference_number: string;
      occurred_on: string;
      created_by: string;
    }>(
      `SELECT id, status, source_entity_id, destination_entity_id, reference_number, occurred_on::text, created_by
         FROM stock_transfers WHERE id = $1 FOR UPDATE`,
      [transferId],
    );
    const row = header.rows[0];
    if (!row || row.status !== 'PENDING_APPROVAL') return;
    const lines = await tx.client.query<{
      item_id: string;
      quantity: string;
      out_movement_id: string | null;
    }>(`SELECT item_id, quantity::text, out_movement_id FROM stock_transfer_lines WHERE transfer_id = $1`, [transferId]);
    let amount = 0;
    const costs = new Map<string, number>();
    for (const line of lines.rows) {
      const cost = line.out_movement_id
        ? Number(
            (
              await tx.client.query<{ n: string }>(`SELECT unit_cost_kobo::text AS n FROM stock_movements WHERE id = $1`, [
                line.out_movement_id,
              ])
            ).rows[0]?.n ?? 0,
          )
        : 0;
      costs.set(line.item_id, cost);
      amount += Math.round(cost * Number(line.quantity));
    }
    let intercompanyId: string | null = null;
    if (amount > 0) {
      const allocated = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('ICT') AS ref`);
      const ictRef = allocated.rows[0]?.ref;
      if (!ictRef) throw new Error('The inter-company reference was not allocated.');
      const ict = await tx.client.query<{ id: string }>(
        `INSERT INTO intercompany_transactions (
           reference_number, type, source_entity_id, destination_entity_id, amount_kobo, occurred_on,
           narration, created_by, updated_by
         ) VALUES ($1, 'transfer', $2, $3, $4, $5, $6, $7, $7)
         RETURNING id`,
        [
          ictRef,
          row.source_entity_id,
          row.destination_entity_id,
          amount,
          row.occurred_on,
          `Stock transfer ${row.reference_number}`,
          actor.ref,
        ],
      );
      intercompanyId = ict.rows[0]?.id ?? null;
    }
    let sourceJournalId: string | null = null;
    for (const line of lines.rows) {
      if (!line.out_movement_id) continue;
      const cost = costs.get(line.item_id) ?? 0;
      await this.postMovement(tx, actor, {
        movementId: line.out_movement_id,
        entityId: row.source_entity_id,
        occurredOn: row.occurred_on,
        amountKobo: Math.round(cost * Number(line.quantity)),
        ruleKind: 'transfer_out',
        source: 'INVENTORY_TRANSFER',
        idempotencyKey: `inv-trf-out:${transferId}:${line.item_id}`,
        intercompanyTransactionId: intercompanyId,
        narration: `Stock transfer out ${row.reference_number}`,
      });
      if (!sourceJournalId) {
        const journal = await tx.client.query<{ journal_id: string | null }>(
          `SELECT journal_id FROM stock_movements WHERE id = $1`,
          [line.out_movement_id],
        );
        sourceJournalId = journal.rows[0]?.journal_id ?? null;
      }
    }
    if (intercompanyId && sourceJournalId) {
      await tx.client.query(
        `UPDATE intercompany_transactions SET source_journal_id = $1, updated_by = $2 WHERE id = $3`,
        [sourceJournalId, actor.ref, intercompanyId],
      );
    }
    await tx.client.query(
      `UPDATE stock_transfers SET intercompany_id = $1, status = 'IN_TRANSIT', updated_by = $2 WHERE id = $3`,
      [intercompanyId, actor.ref, transferId],
    );
  }

  async rejectTransferInTx(tx: TxScope, actor: ActorContext, transferId: string): Promise<void> {
    await tx.client.query(
      `UPDATE stock_transfers SET status = 'REJECTED', updated_by = $1 WHERE id = $2 AND status = 'PENDING_APPROVAL'`,
      [actor.ref, transferId],
    );
  }

  async createCount(actor: ActorContext, input: CreateCountInput): Promise<StockCountView> {
    assertCan(actor, 'inventory.count', input.entityId);
    const id = await this.unitOfWork.write(actor, async (tx) => {
      const ref = await this.nextRef(tx, 'CNT');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO stock_counts (
           reference_number, entity_id, warehouse_id, mode, counted_on, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
        [ref, input.entityId, input.warehouseId, input.mode, input.countedOn, actor.ref],
      );
      const countId = inserted.rows[0]?.id;
      if (!countId) throw new Error('The count was not created.');
      const items = await tx.client.query<{ item_id: string; qty: string }>(
        `SELECT i.id AS item_id, coalesce(sum(m.quantity_in - m.quantity_out), 0)::text AS qty
           FROM inventory_items i
           LEFT JOIN stock_movements m ON m.item_id = i.id AND m.warehouse_id = $2
          WHERE i.entity_id = $1 AND i.status = 'ACTIVE'
          GROUP BY i.id`,
        [input.entityId, input.warehouseId],
      );
      for (const item of items.rows) {
        await tx.client.query(
          `INSERT INTO stock_count_lines (count_id, entity_id, item_id, system_qty, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $5)`,
          [countId, input.entityId, item.item_id, Number(item.qty), actor.ref],
        );
      }
      return countId;
    });
    return this.getCount(actor, id);
  }

  async updateCountLine(
    actor: ActorContext,
    countId: string,
    lineId: string,
    input: CountLineInput,
  ): Promise<StockCountView> {
    await this.unitOfWork.write(actor, async (tx) => {
      const count = await tx.client.query<{ entity_id: string; status: string }>(
        `SELECT entity_id, status FROM stock_counts WHERE id = $1`,
        [countId],
      );
      const row = count.rows[0];
      if (!row) throw new NotFoundError('That count was not found.');
      assertCan(actor, 'inventory.count', row.entity_id);
      if (row.status !== 'OPEN') throw new ConflictError('Only an open count can be updated.');
      await tx.client.query(
        `UPDATE stock_count_lines
            SET counted_qty = $1, variance_qty = $1 - system_qty, updated_by = $2
          WHERE id = $3 AND count_id = $4`,
        [input.countedQty, actor.ref, lineId, countId],
      );
    });
    return this.getCount(actor, countId);
  }

  async submitCount(actor: ActorContext, countId: string): Promise<StockCountView> {
    await this.unitOfWork.write(actor, async (tx) => {
      const count = await tx.client.query<{
        id: string;
        entity_id: string;
        warehouse_id: string;
        status: string;
        counted_on: string;
        reference_number: string;
      }>(
        `SELECT id, entity_id, warehouse_id, status, counted_on::text, reference_number
           FROM stock_counts WHERE id = $1 FOR UPDATE`,
        [countId],
      );
      const row = count.rows[0];
      if (!row) throw new NotFoundError('That count was not found.');
      assertCan(actor, 'inventory.count', row.entity_id);
      if (row.status !== 'OPEN') throw new ConflictError('This count has already been submitted.');
      const lines = await tx.client.query<{ item_id: string; variance_qty: string | null }>(
        `SELECT item_id, variance_qty::text FROM stock_count_lines WHERE count_id = $1 AND coalesce(variance_qty, 0) <> 0`,
        [countId],
      );
      if (lines.rows.length > 0) {
        await this.prepareAdjustmentInTx(tx, actor, {
          entityId: row.entity_id,
          warehouseId: row.warehouse_id,
          kind: 'count_variance',
          reason: `Count ${row.reference_number}`,
          occurredOn: row.counted_on,
          lines: lines.rows.map((line) => ({ itemId: line.item_id, quantity: Number(line.variance_qty) })),
        });
      }
      await tx.client.query(`UPDATE stock_counts SET status = 'SUBMITTED', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        countId,
      ]);
    });
    return this.getCount(actor, countId);
  }

  async listCounts(actor: ActorContext, entityId?: string): Promise<StockCountView[]> {
    const scoped = this.assertListScope(actor, entityId);
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT id FROM stock_counts WHERE ($1::uuid IS NULL OR entity_id = $1) ORDER BY created_at DESC`,
        [scoped],
      );
      return Promise.all(ids.rows.map((row) => this.countView(tx, row.id)));
    });
  }

  async applyExpectedFromEvent(actor: ActorContext, payload: Record<string, unknown>, entityId: string | null): Promise<void> {
    const requestId = String(payload.subjectId ?? '');
    const lineId = typeof payload.lineId === 'string' ? payload.lineId : '';
    if (!entityId || !lineId) return;
    await this.unitOfWork.write(actor, async (tx) => {
      await this.applyExpectedInTx(tx, actor, { requestId, lineId, entityId });
    });
  }

  async applyReceiptFromEvent(actor: ActorContext, payload: Record<string, unknown>): Promise<void> {
    const grnId = typeof payload.grnId === 'string' ? payload.grnId : '';
    if (!grnId) return;
    await this.unitOfWork.write(actor, async (tx) => {
      await this.applyReceiptInTx(tx, actor, {
        grnId,
        warehouseId: typeof payload.warehouseId === 'string' ? payload.warehouseId : null,
        batchCode: typeof payload.batchCode === 'string' ? payload.batchCode : null,
        serialCodes: Array.isArray(payload.serialCodes)
          ? payload.serialCodes.filter((value): value is string => typeof value === 'string')
          : undefined,
      });
    });
  }

  private async prepareAdjustmentInTx(
    tx: TxScope,
    actor: ActorContext,
    input: AdjustmentInput,
  ): Promise<string> {
    const ref = await this.nextRef(tx, 'IAD');
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO stock_adjustments (
         reference_number, entity_id, warehouse_id, kind, reason, occurred_on, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
      [ref, input.entityId, input.warehouseId, input.kind, input.reason, input.occurredOn, actor.ref],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('The adjustment was not created.');
    for (const line of input.lines) {
      await tx.client.query(
        `INSERT INTO stock_adjustment_lines (adjustment_id, entity_id, item_id, quantity, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [id, input.entityId, line.itemId, line.quantity, actor.ref],
      );
    }
    await this.workflows?.startInventoryAdjustmentInTx(tx, actor, { adjustmentId: id });
    return id;
  }

  private async getIssue(actor: ActorContext, id: string): Promise<StockIssueView> {
    return this.unitOfWork.read(actor, async (tx) => this.issueView(tx, id));
  }

  private async getTransfer(actor: ActorContext, id: string): Promise<StockTransferView> {
    return this.unitOfWork.read(actor, async (tx) => this.transferView(tx, id));
  }

  private async getAdjustment(actor: ActorContext, id: string): Promise<StockAdjustmentView> {
    return this.unitOfWork.read(actor, async (tx) => this.adjustmentView(tx, id));
  }

  private async getCount(actor: ActorContext, id: string): Promise<StockCountView> {
    return this.unitOfWork.read(actor, async (tx) => this.countView(tx, id));
  }

  private async issueView(tx: TxScope, id: string): Promise<StockIssueView> {
    const header = await tx.client.query<{
      id: string;
      reference_number: string;
      warehouse_name: string;
      destination_type: StockIssueView['destinationType'];
      destination_label: string | null;
      reason: string;
      status: string;
      occurred_on: string;
    }>(
      `SELECT i.id, i.reference_number, w.name AS warehouse_name, i.destination_type, i.destination_label,
              i.reason, i.status, i.occurred_on::text
         FROM stock_issues i JOIN warehouses w ON w.id = i.warehouse_id WHERE i.id = $1`,
      [id],
    );
    const row = header.rows[0];
    if (!row) throw new NotFoundError('That issue was not found.');
    const lines = await tx.client.query<{ item_code: string; item_name: string; quantity: string }>(
      `SELECT it.code AS item_code, it.name AS item_name, l.quantity::text
         FROM stock_issue_lines l JOIN inventory_items it ON it.id = l.item_id WHERE l.issue_id = $1`,
      [id],
    );
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      warehouseName: row.warehouse_name,
      destinationType: row.destination_type,
      destinationLabel: row.destination_label,
      reason: row.reason,
      status: row.status,
      occurredOn: row.occurred_on,
      lines: lines.rows.map((line) => ({
        itemCode: line.item_code,
        itemName: line.item_name,
        quantity: Number(line.quantity),
      })),
    };
  }

  private async transferView(tx: TxScope, id: string): Promise<StockTransferView> {
    const header = await tx.client.query<{
      id: string;
      reference_number: string;
      source_entity_id: string;
      destination_entity_id: string;
      source_code: string | null;
      dest_code: string | null;
      source_warehouse: string;
      dest_warehouse: string | null;
      status: string;
      reason: string;
      occurred_on: string;
      intercompany_id: string | null;
    }>(
      `SELECT t.id, t.reference_number, t.source_entity_id, t.destination_entity_id,
              se.code AS source_code, de.code AS dest_code, sw.name AS source_warehouse,
              dw.name AS dest_warehouse, t.status, t.reason, t.occurred_on::text, t.intercompany_id
         FROM stock_transfers t
         JOIN entities se ON se.id = t.source_entity_id
         JOIN entities de ON de.id = t.destination_entity_id
         JOIN warehouses sw ON sw.id = t.source_warehouse_id
         LEFT JOIN warehouses dw ON dw.id = t.dest_warehouse_id
        WHERE t.id = $1`,
      [id],
    );
    const row = header.rows[0];
    if (!row) throw new NotFoundError('That transfer was not found.');
    const lines = await tx.client.query<{ item_code: string; item_name: string; quantity: string }>(
      `SELECT it.code AS item_code, it.name AS item_name, l.quantity::text
         FROM stock_transfer_lines l JOIN inventory_items it ON it.id = l.item_id WHERE l.transfer_id = $1`,
      [id],
    );
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      sourceEntityId: row.source_entity_id,
      destinationEntityId: row.destination_entity_id,
      sourceEntityCode: row.source_code,
      destEntityCode: row.dest_code,
      sourceWarehouseName: row.source_warehouse,
      destWarehouseName: row.dest_warehouse,
      status: row.status,
      reason: row.reason,
      occurredOn: row.occurred_on,
      intercompanyId: row.intercompany_id,
      lines: lines.rows.map((line) => ({
        itemCode: line.item_code,
        itemName: line.item_name,
        quantity: Number(line.quantity),
      })),
    };
  }

  private async adjustmentView(tx: TxScope, id: string): Promise<StockAdjustmentView> {
    const header = await tx.client.query<{
      id: string;
      reference_number: string;
      warehouse_name: string;
      kind: StockAdjustmentView['kind'];
      reason: string;
      status: string;
      occurred_on: string;
      created_by: string;
    }>(
      `SELECT a.id, a.reference_number, w.name AS warehouse_name, a.kind, a.reason, a.status,
              a.occurred_on::text, a.created_by
         FROM stock_adjustments a JOIN warehouses w ON w.id = a.warehouse_id WHERE a.id = $1`,
      [id],
    );
    const row = header.rows[0];
    if (!row) throw new NotFoundError('That adjustment was not found.');
    const lines = await tx.client.query<{ item_code: string; item_name: string; quantity: string }>(
      `SELECT it.code AS item_code, it.name AS item_name, l.quantity::text
         FROM stock_adjustment_lines l JOIN inventory_items it ON it.id = l.item_id WHERE l.adjustment_id = $1`,
      [id],
    );
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      warehouseName: row.warehouse_name,
      kind: row.kind,
      reason: row.reason,
      status: row.status,
      occurredOn: row.occurred_on,
      createdBy: row.created_by,
      lines: lines.rows.map((line) => ({
        itemCode: line.item_code,
        itemName: line.item_name,
        quantity: Number(line.quantity),
      })),
    };
  }

  private async countView(tx: TxScope, id: string): Promise<StockCountView> {
    const header = await tx.client.query<{
      id: string;
      reference_number: string;
      warehouse_name: string;
      mode: 'blind' | 'guided';
      status: string;
      counted_on: string;
    }>(
      `SELECT c.id, c.reference_number, w.name AS warehouse_name, c.mode, c.status, c.counted_on::text
         FROM stock_counts c JOIN warehouses w ON w.id = c.warehouse_id WHERE c.id = $1`,
      [id],
    );
    const row = header.rows[0];
    if (!row) throw new NotFoundError('That count was not found.');
    const lines = await tx.client.query<{
      id: string;
      item_id: string;
      item_code: string;
      item_name: string;
      system_qty: string;
      counted_qty: string | null;
      variance_qty: string | null;
    }>(
      `SELECT l.id, l.item_id, it.code AS item_code, it.name AS item_name, l.system_qty::text,
              l.counted_qty::text, l.variance_qty::text
         FROM stock_count_lines l JOIN inventory_items it ON it.id = l.item_id
        WHERE l.count_id = $1 ORDER BY it.code`,
      [id],
    );
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      warehouseName: row.warehouse_name,
      mode: row.mode,
      status: row.status,
      countedOn: row.counted_on,
      lines: lines.rows.map((line) => ({
        id: line.id,
        itemId: line.item_id,
        itemCode: line.item_code,
        itemName: line.item_name,
        systemQty: Number(line.system_qty),
        countedQty: line.counted_qty == null ? null : Number(line.counted_qty),
        varianceQty: line.variance_qty == null ? null : Number(line.variance_qty),
      })),
    };
  }

  private async overviewInTx(tx: TxScope, entityId: string | null): Promise<InventoryOverviewView> {
    const rows = await this.listItemsInTx(tx, entityId);
    const expected = await tx.client.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM expected_stock
        WHERE status = 'OPEN' AND quantity_remaining > 0
          AND ($1::uuid IS NULL OR entity_id = $1)`,
      [entityId],
    );
    const pending = await tx.client.query<{ n: string; damaged: string }>(
      `SELECT count(*)::text AS n,
              count(*) FILTER (WHERE kind IN ('damaged', 'expired'))::text AS damaged
         FROM stock_adjustments
        WHERE status = 'PENDING_APPROVAL' AND ($1::uuid IS NULL OR entity_id = $1)`,
      [entityId],
    );
    const inTransit = await tx.client.query<{ n: string; val: string }>(
      `SELECT count(DISTINCT t.id)::text AS n,
              coalesce(sum(abs(m.value_kobo)), 0)::text AS val
         FROM stock_transfers t
         LEFT JOIN stock_movements m
           ON m.source_id = t.id AND m.source = 'TRANSFER' AND m.quantity_out > 0
        WHERE t.status = 'IN_TRANSIT'
          AND ($1::uuid IS NULL OR t.source_entity_id = $1 OR t.destination_entity_id = $1)`,
      [entityId],
    );
    const openPrd = await tx.client.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM production_orders
        WHERE status IN ('PLANNED', 'IN_PROGRESS', 'AWAITING_APPROVAL')
          AND ($1::uuid IS NULL OR entity_id = $1)`,
      [entityId],
    );
    const reserved = await tx.client.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM sales_order_lines l
         JOIN sales_orders o ON o.id = l.order_id
        WHERE l.reserved_qty > l.dispatched_qty
          AND ($1::uuid IS NULL OR o.entity_id = $1)`,
      [entityId],
    );
    const warehouses = await tx.client.query<{
      entity_code: string;
      warehouse_id: string;
      name: string;
      item_count: string;
      value: string;
    }>(
      `SELECT e.code AS entity_code, w.id AS warehouse_id, w.name,
              count(*) FILTER (WHERE coalesce(x.qty, 0) <> 0)::text AS item_count,
              coalesce(sum(x.val), 0)::text AS value
         FROM warehouses w
         JOIN entities e ON e.id = w.entity_id
         LEFT JOIN (
           SELECT warehouse_id, item_id,
                  sum(quantity_in - quantity_out) AS qty,
                  sum(value_kobo) AS val
             FROM stock_movements GROUP BY warehouse_id, item_id
         ) x ON x.warehouse_id = w.id
        WHERE ($1::uuid IS NULL OR w.entity_id = $1)
        GROUP BY e.code, w.id, w.name
        ORDER BY e.code, w.name`,
      [entityId],
    );
    const overdue = await tx.client.query<{
      id: string;
      procurement_reference: string;
      required_date: string;
      quantity_remaining: string;
    }>(
      `SELECT e.id, pr.reference_number AS procurement_reference, e.required_date::text, e.quantity_remaining::text
         FROM expected_stock e
         JOIN procurement_requests pr ON pr.id = e.procurement_request_id
        WHERE e.status = 'OPEN' AND e.quantity_remaining > 0
          AND e.required_date IS NOT NULL AND e.required_date < CURRENT_DATE
          AND ($1::uuid IS NULL OR e.entity_id = $1)
        ORDER BY e.required_date
        LIMIT 8`,
      [entityId],
    );
    const pendingAdj = await tx.client.query<{
      id: string;
      reference_number: string;
      kind: string;
    }>(
      `SELECT id, reference_number, kind FROM stock_adjustments
        WHERE status = 'PENDING_APPROVAL' AND ($1::uuid IS NULL OR entity_id = $1)
        ORDER BY created_at DESC LIMIT 8`,
      [entityId],
    );
    const transitRows = await tx.client.query<{
      id: string;
      reference_number: string;
      source_code: string | null;
      dest_code: string | null;
    }>(
      `SELECT t.id, t.reference_number, s.code AS source_code, d.code AS dest_code
         FROM stock_transfers t
         LEFT JOIN entities s ON s.id = t.source_entity_id
         LEFT JOIN entities d ON d.id = t.destination_entity_id
        WHERE t.status = 'IN_TRANSIT'
          AND ($1::uuid IS NULL OR t.source_entity_id = $1 OR t.destination_entity_id = $1)
        ORDER BY t.created_at DESC LIMIT 8`,
      [entityId],
    );
    const recentMovements = await this.movementsInTx(tx, entityId, undefined, undefined, 12);
    const entityCode = entityId ? await this.entityCode(tx, entityId) : null;
    const lowRows = rows.filter((row) => inventoryStockStatus(row) === 'low');
    const outRows = rows.filter((row) => inventoryStockStatus(row) === 'out');
    const byEntityMap = new Map<string, InventoryDashboardBucket>();
    for (const row of rows) {
      const code = row.entityCode ?? 'Entity';
      const current = byEntityMap.get(code) ?? {
        key: row.entityId,
        label: code,
        href: `/inventory?scope=${code}`,
        itemCount: 0,
        onHandValueKobo: 0,
        lowStockCount: 0,
      };
      current.itemCount += 1;
      current.onHandValueKobo += row.onHandValueKobo;
      if (inventoryStockStatus(row) === 'low') current.lowStockCount = (current.lowStockCount ?? 0) + 1;
      byEntityMap.set(code, current);
    }
    const byCategoryMap = new Map<string, InventoryDashboardBucket>();
    for (const row of rows) {
      const current = byCategoryMap.get(row.categoryName) ?? {
        key: row.categoryName,
        label: row.categoryName,
        itemCount: 0,
        onHandValueKobo: 0,
      };
      current.itemCount += 1;
      current.onHandValueKobo += row.onHandValueKobo;
      byCategoryMap.set(row.categoryName, current);
    }
    const attention: InventoryAttentionItem[] = [
      ...outRows.slice(0, 8).map((row) => ({
        kind: 'out_of_stock' as const,
        label: `${row.code} — ${row.name}`,
        href: `/inventory/items/${row.id}`,
        detail: `Out of stock · ${row.entityCode ?? ''}`.trim(),
      })),
      ...lowRows.slice(0, 8).map((row) => ({
        kind: 'low_stock' as const,
        label: `${row.code} — ${row.name}`,
        href: `/inventory/items/${row.id}`,
        detail: `On hand ${row.onHandQty} ${row.uomCode}; reorder ${row.reorderLevel}`,
      })),
      ...overdue.rows.map((row) => ({
        kind: 'overdue_expected' as const,
        label: row.procurement_reference,
        href: '/inventory/expected',
        detail: `Due ${row.required_date}; remaining ${row.quantity_remaining}`,
      })),
      ...pendingAdj.rows.map((row) => ({
        kind: 'pending_adjustment' as const,
        label: row.reference_number,
        href: '/inventory/adjustments',
        detail: row.kind.replaceAll('_', ' '),
      })),
      ...transitRows.rows.map((row) => ({
        kind: 'in_transit' as const,
        label: row.reference_number,
        href: '/inventory/transfers',
        detail: `${row.source_code ?? ''} → ${row.dest_code ?? ''}`.trim(),
      })),
    ];
    return {
      consolidated: entityId === null,
      entityId,
      entityCode,
      itemCount: rows.length,
      onHandValueKobo: rows.reduce((sum, row) => sum + row.onHandValueKobo, 0),
      expectedLines: Number(expected.rows[0]?.n ?? 0),
      lowStockCount: lowRows.length,
      outOfStockCount: outRows.length,
      reservedSalesLines: Number(reserved.rows[0]?.n ?? 0),
      inTransitCount: Number(inTransit.rows[0]?.n ?? 0),
      inTransitValueKobo: Number(inTransit.rows[0]?.val ?? 0),
      pendingAdjustments: Number(pending.rows[0]?.n ?? 0),
      openProductionOrders: Number(openPrd.rows[0]?.n ?? 0),
      damagedOrExpiredPending: Number(pending.rows[0]?.damaged ?? 0),
      byEntity: [...byEntityMap.values()],
      byCategory: [...byCategoryMap.values()].sort((a, b) => b.onHandValueKobo - a.onHandValueKobo),
      byWarehouse: warehouses.rows.map((row) => ({
        key: row.warehouse_id,
        label: entityId ? row.name : `${row.entity_code} · ${row.name}`,
        itemCount: Number(row.item_count),
        onHandValueKobo: Number(row.value),
      })),
      attention,
      recentMovements,
      rows,
    };
  }

  private async listItemsInTx(
    tx: TxScope,
    entityId: string | null,
    filters?: InventoryListFilters,
  ): Promise<InventoryItemListView[]> {
    const search = emptyToNull(filters?.q) ? `%${filters!.q!.trim()}%` : null;
    const result = await tx.client.query<{
      id: string;
      entity_id: string;
      entity_code: string | null;
      code: string;
      name: string;
      category_id: string;
      category_name: string;
      uom_code: string;
      tracking_mode: InventoryItemListView['trackingMode'];
      asset: boolean;
      reorder_level: string;
      on_hand: string;
      on_hand_value: string;
      reserved: string;
      status: InventoryItemListView['status'];
      row_version: number;
    }>(
      `SELECT i.id, i.entity_id, e.code AS entity_code, i.code, i.name, i.category_id, c.name AS category_name,
              u.code AS uom_code, i.tracking_mode, i.asset, i.reorder_level::text,
              coalesce(m.qty, 0)::text AS on_hand, coalesce(m.val, 0)::text AS on_hand_value,
              coalesce(r.reserved, 0)::text AS reserved,
              i.status, i.row_version
         FROM inventory_items i
         JOIN entities e ON e.id = i.entity_id
         JOIN inventory_categories c ON c.id = i.category_id
         JOIN units_of_measure u ON u.id = i.uom_id
         LEFT JOIN (
           SELECT item_id, sum(quantity_in - quantity_out) AS qty, sum(value_kobo) AS val
             FROM stock_movements GROUP BY item_id
         ) m ON m.item_id = i.id
         LEFT JOIN (
           SELECT item_id, sum(quantity) AS reserved
             FROM stock_reservations WHERE status = 'OPEN' GROUP BY item_id
         ) r ON r.item_id = i.id
        WHERE ($1::uuid IS NULL OR i.entity_id = $1)
          AND ($2::text IS NULL OR i.code ILIKE $2 OR i.name ILIKE $2)
          AND ($3::uuid IS NULL OR i.category_id = $3)
          AND ($4::uuid IS NULL OR i.default_warehouse_id = $4 OR EXISTS (
            SELECT 1 FROM stock_movements mx WHERE mx.item_id = i.id AND mx.warehouse_id = $4
          ))
        ORDER BY e.code, i.code`,
      [entityId, search, emptyToNull(filters?.categoryId), emptyToNull(filters?.warehouseId)],
    );
    return result.rows
      .map((row) => {
        const onHandQty = Number(row.on_hand);
        const reservedQty = Number(row.reserved);
        const reorderLevel = Number(row.reorder_level);
        return {
          id: row.id,
          entityId: row.entity_id,
          entityCode: row.entity_code,
          code: row.code,
          name: row.name,
          categoryId: row.category_id,
          categoryName: row.category_name,
          uomCode: row.uom_code,
          trackingMode: row.tracking_mode,
          asset: row.asset,
          reorderLevel,
          onHandQty,
          reservedQty,
          availableQty: onHandQty - reservedQty,
          onHandValueKobo: Number(row.on_hand_value),
          belowReorder: onHandQty > 0 && onHandQty <= reorderLevel,
          status: row.status,
          rowVersion: row.row_version,
        };
      })
      .filter((row) => {
        if (!filters?.stockStatus) return true;
        return inventoryStockStatus(row) === filters.stockStatus;
      });
  }

  private async movementsInTx(
    tx: TxScope,
    entityId: string | null,
    itemId?: string,
    filters?: InventoryListFilters,
    limit = 200,
  ): Promise<StockMovementView[]> {
    const search = emptyToNull(filters?.q) ? `%${filters!.q!.trim()}%` : null;
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      item_id: string;
      item_code: string;
      item_name: string;
      entity_code: string | null;
      warehouse_name: string;
      quantity_in: string;
      quantity_out: string;
      unit_cost_kobo: string;
      value_kobo: string;
      source: StockMovementView['source'];
      procurement_request_id: string | null;
      procurement_reference: string | null;
      grn_id: string | null;
      grn_reference: string | null;
      occurred_on: string;
      created_by: string;
      notes: string | null;
    }>(
      `SELECT m.id, m.reference_number, m.item_id, i.code AS item_code, i.name AS item_name, e.code AS entity_code,
              w.name AS warehouse_name, m.quantity_in::text, m.quantity_out::text, m.unit_cost_kobo::text,
              m.value_kobo::text, m.source, m.procurement_request_id, pr.reference_number AS procurement_reference,
              m.grn_id, g.reference_number AS grn_reference, m.occurred_on::text, m.created_by, m.notes
         FROM stock_movements m
         JOIN inventory_items i ON i.id = m.item_id
         JOIN entities e ON e.id = m.entity_id
         JOIN warehouses w ON w.id = m.warehouse_id
         LEFT JOIN procurement_requests pr ON pr.id = m.procurement_request_id
         LEFT JOIN procurement_goods_receipts g ON g.id = m.grn_id
        WHERE ($1::uuid IS NULL OR m.entity_id = $1)
          AND ($2::uuid IS NULL OR m.item_id = $2)
          AND ($3::text IS NULL OR m.source = $3)
          AND ($4::date IS NULL OR m.occurred_on >= $4::date)
          AND ($5::date IS NULL OR m.occurred_on <= $5::date)
          AND ($6::text IS NULL OR i.code ILIKE $6 OR i.name ILIKE $6 OR m.reference_number ILIKE $6)
        ORDER BY m.created_at DESC
        LIMIT $7`,
      [
        entityId,
        itemId ?? null,
        emptyToNull(filters?.source),
        emptyToNull(filters?.from),
        emptyToNull(filters?.to),
        search,
        limit,
      ],
    );
    return result.rows.map((row) => ({
      id: row.id,
      referenceNumber: row.reference_number,
      itemId: row.item_id,
      itemCode: row.item_code,
      itemName: row.item_name,
      entityCode: row.entity_code,
      warehouseName: row.warehouse_name,
      quantityIn: Number(row.quantity_in),
      quantityOut: Number(row.quantity_out),
      unitCostKobo: Number(row.unit_cost_kobo),
      valueKobo: Number(row.value_kobo),
      source: row.source,
      procurementId: row.procurement_request_id,
      procurementReference: row.procurement_reference,
      grnId: row.grn_id,
      grnReference: row.grn_reference,
      occurredOn: row.occurred_on,
      createdBy: row.created_by,
      notes: row.notes,
    }));
  }

  private async categoriesInTx(tx: TxScope, entityId: string | null): Promise<InventoryCategoryView[]> {
    const result = await tx.client.query<InventoryCategoryView>(
      `SELECT c.id, c.entity_id AS "entityId", e.code AS "entityCode", c.key, c.name, c.status,
              c.row_version AS "rowVersion"
         FROM inventory_categories c
         JOIN entities e ON e.id = c.entity_id
        WHERE ($1::uuid IS NULL OR c.entity_id = $1)
        ORDER BY e.code, c.name`,
      [entityId],
    );
    return result.rows;
  }

  private async warehousesInTx(tx: TxScope, entityId: string | null): Promise<WarehouseView[]> {
    const result = await tx.client.query<WarehouseView>(
      `SELECT w.id, w.entity_id AS "entityId", e.code AS "entityCode", w.code, w.name, w.kind, w.status,
              w.row_version AS "rowVersion"
         FROM warehouses w
         JOIN entities e ON e.id = w.entity_id
        WHERE ($1::uuid IS NULL OR w.entity_id = $1)
        ORDER BY e.code, w.name`,
      [entityId],
    );
    return result.rows;
  }

  private async loadItem(tx: TxScope, id: string): Promise<{
    id: string;
    entity_id: string;
    code: string;
    name: string;
    uom_id: string;
    default_warehouse_id: string | null;
    tracking_mode: string;
    asset: boolean;
    row_version: number;
  }> {
    const result = await tx.client.query<{
      id: string;
      entity_id: string;
      code: string;
      name: string;
      uom_id: string;
      default_warehouse_id: string | null;
      tracking_mode: string;
      asset: boolean;
      row_version: number;
    }>(
      `SELECT id, entity_id, code, name, uom_id, default_warehouse_id, tracking_mode, asset, row_version
         FROM inventory_items WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That item was not found.');
    return row;
  }

  private async ensureItemFromLine(
    tx: TxScope,
    actor: ActorContext,
    input: {
      entityId: string;
      description: string;
      unitId: string | null;
      asset: boolean;
      categoryKey: string | null;
      vendorId: string | null;
      code?: string;
    },
  ): Promise<string> {
    const name = input.description.trim() || 'Unnamed item';
    const code = (input.code ?? name).replace(/[^A-Za-z0-9]+/g, '').slice(0, 12).toUpperCase() || 'ITEM';
    const existing = await tx.client.query<{ id: string }>(
      `SELECT id FROM inventory_items WHERE entity_id = $1 AND (code = $2 OR lower(name) = lower($3)) LIMIT 1`,
      [input.entityId, code, name],
    );
    if (existing.rows[0]) return existing.rows[0].id;
    const category = await tx.client.query<{ id: string }>(
      input.asset
        ? `SELECT id FROM inventory_categories WHERE entity_id = $1 AND (key = 'equipment' OR lower(name) LIKE '%equipment%') LIMIT 1`
        : `SELECT id FROM inventory_categories WHERE entity_id = $1 AND key <> 'equipment' ORDER BY name LIMIT 1`,
      [input.entityId],
    );
    const categoryId = category.rows[0]?.id;
    if (!categoryId) throw new ValidationFailedError('Seed inventory categories for this subsidiary first.');
    const uomId =
      input.unitId ??
      (await tx.client.query<{ id: string }>(`SELECT id FROM units_of_measure WHERE code = 'PCS' LIMIT 1`)).rows[0]?.id;
    if (!uomId) throw new ValidationFailedError('A unit of measure is required.');
    const warehouse = await tx.client.query<{ id: string }>(
      `SELECT id FROM warehouses WHERE entity_id = $1 AND status = 'ACTIVE' ORDER BY code LIMIT 1`,
      [input.entityId],
    );
    const uniqueCode = `${code}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO inventory_items (
         entity_id, code, name, category_id, uom_id, default_warehouse_id, tracking_mode, asset, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, 'none', $7, $8, $8)
       RETURNING id`,
      [input.entityId, uniqueCode, name, categoryId, uomId, warehouse.rows[0]?.id ?? null, input.asset, actor.ref],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('The inventory item was not created.');
    if (input.vendorId) {
      await tx.client.query(
        `INSERT INTO inventory_item_vendors (item_id, vendor_id, entity_id, created_by)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [id, input.vendorId, input.entityId, actor.ref],
      );
    }
    await this.indexItem(tx, id);
    return id;
  }

  async insertMovement(
    tx: TxScope,
    actor: ActorContext,
    input: {
      entityId: string;
      itemId: string;
      warehouseId: string;
      batchId: string | null;
      serialId: string | null;
      quantityIn: number;
      quantityOut: number;
      unitCostKobo: number;
      source: string;
      sourceId?: string | null;
      procurementRequestId?: string | null;
      grnId?: string | null;
      reversesId?: string | null;
      occurredOn: string;
      notes?: string | null;
    },
  ): Promise<string> {
    const onHand = await this.onHand(tx, input.itemId, input.warehouseId);
    if (input.quantityOut > 0) {
      const reserved = await this.reservedQty(tx, input.itemId, input.warehouseId);
      const available = onHand - reserved;
      if (available + 1e-9 < input.quantityOut) {
        throw new ValidationFailedError('There is not enough available stock for this movement.');
      }
    }
    const value =
      input.quantityIn > 0
        ? Math.round(input.unitCostKobo * input.quantityIn)
        : -Math.round(input.unitCostKobo * input.quantityOut);
    const ref = await this.nextRef(tx, 'INV');
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO stock_movements (
         reference_number, entity_id, item_id, warehouse_id, batch_id, serial_id, quantity_in, quantity_out,
         unit_cost_kobo, value_kobo, source, source_id, procurement_request_id, grn_id, reverses_id,
         notes, occurred_on, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING id`,
      [
        ref,
        input.entityId,
        input.itemId,
        input.warehouseId,
        input.batchId,
        input.serialId,
        input.quantityIn,
        input.quantityOut,
        input.unitCostKobo,
        value,
        input.source,
        input.sourceId ?? null,
        input.procurementRequestId ?? null,
        input.grnId ?? null,
        input.reversesId ?? null,
        input.notes ?? null,
        input.occurredOn,
        actor.ref,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('The stock movement was not recorded.');
    await tx.indexSearch({
      recordType: 'STOCK_MOVEMENT',
      recordId: id,
      referenceNumber: ref,
      title: `${input.source} ${ref}`,
      searchableText: `${ref} ${input.source}`,
      entityId: input.entityId,
      permissionKey: 'inventory.view',
    });
    return id;
  }

  async postMovement(
    tx: TxScope,
    actor: ActorContext,
    input: {
      movementId: string | null;
      entityId: string;
      occurredOn: string;
      amountKobo: number;
      ruleKind: string;
      source:
        | 'INVENTORY_RECEIPT'
        | 'INVENTORY_ISSUE'
        | 'INVENTORY_WRITE_OFF'
        | 'INVENTORY_ADJUSTMENT'
        | 'INVENTORY_TRANSFER'
        | 'PRODUCTION_WIP'
        | 'PRODUCTION_OUTPUT'
        | 'PRODUCTION_WASTE'
        | 'PRODUCTION_OVERHEAD'
        | 'SALES_COGS'
        | 'SALES_REVENUE'
        | 'SALES_RETURN';
      idempotencyKey: string;
      procurementRequestId?: string | null;
      intercompanyTransactionId?: string | null;
      narration: string;
    },
  ): Promise<void> {
    if (!this.ledger || input.amountKobo <= 0) return;
    const rule = await tx.client.query<{ debit_account_code: string; credit_account_code: string }>(
      `SELECT debit_account_code, credit_account_code FROM inventory_posting_rules WHERE movement_kind = $1`,
      [input.ruleKind],
    );
    const debitCode = rule.rows[0]?.debit_account_code;
    const creditCode = rule.rows[0]?.credit_account_code;
    if (!debitCode || !creditCode) return;
    const debit = await this.ledger.accountIdByCode(tx, input.entityId, debitCode);
    const credit = await this.ledger.accountIdByCode(tx, input.entityId, creditCode);
        await this.ledger.postTwoSided(tx, actor, {
      entityId: input.entityId,
      occurredOn: input.occurredOn,
      narration: input.narration,
      idempotencyKey: input.idempotencyKey,
      source: input.source,
      debitAccountId: debit,
      creditAccountId: credit,
      amountKobo: input.amountKobo,
      procurementRequestId: input.procurementRequestId ?? null,
      intercompanyTransactionId: input.intercompanyTransactionId ?? null,
      inventoryMovementId: input.movementId ?? null,
    });
  }

  async averageCost(tx: TxScope, itemId: string, warehouseId: string): Promise<number> {
    const result = await tx.client.query<{ qty: string; val: string }>(
      `SELECT coalesce(sum(quantity_in - quantity_out), 0)::text AS qty,
              coalesce(sum(value_kobo), 0)::text AS val
         FROM stock_movements WHERE item_id = $1 AND warehouse_id = $2`,
      [itemId, warehouseId],
    );
    const qty = Number(result.rows[0]?.qty ?? 0);
    const val = Number(result.rows[0]?.val ?? 0);
    if (qty <= 0) return 0;
    return Math.round(val / qty);
  }

  async onHand(tx: TxScope, itemId: string, warehouseId: string): Promise<number> {
    const result = await tx.client.query<{ n: string }>(
      `SELECT coalesce(sum(quantity_in - quantity_out), 0)::text AS n
         FROM stock_movements WHERE item_id = $1 AND warehouse_id = $2`,
      [itemId, warehouseId],
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  async reservedQty(tx: TxScope, itemId: string, warehouseId: string): Promise<number> {
    const result = await tx.client.query<{ n: string }>(
      `SELECT coalesce(sum(quantity), 0)::text AS n
         FROM stock_reservations
        WHERE item_id = $1 AND warehouse_id = $2 AND status = 'OPEN'`,
      [itemId, warehouseId],
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  async available(tx: TxScope, itemId: string, warehouseId: string): Promise<number> {
    return (await this.onHand(tx, itemId, warehouseId)) - (await this.reservedQty(tx, itemId, warehouseId));
  }

  async resolveTracking(
    tx: TxScope,
    actor: ActorContext,
    input: {
      entityId: string;
      itemId: string;
      warehouseId: string;
      batchCode?: string;
      serialCode?: string;
      outbound: boolean;
    },
  ): Promise<{ batchId: string | null; serialId: string | null }> {
    const item = await this.loadItem(tx, input.itemId);
    if (item.tracking_mode === 'batch_lot') {
      if (!input.batchCode) throw new ValidationFailedError('A batch is required for this item.');
      const batchId = await this.ensureBatch(tx, actor, {
        entityId: input.entityId,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        batchCode: input.batchCode,
      });
      return { batchId, serialId: null };
    }
    if (item.tracking_mode === 'serial') {
      if (!input.serialCode) throw new ValidationFailedError('A serial number is required for this item.');
      const found = await tx.client.query<{ id: string; status: string }>(
        `SELECT id, status FROM stock_serials WHERE item_id = $1 AND serial_code = $2`,
        [input.itemId, input.serialCode],
      );
      const serial = found.rows[0];
      if (!serial) throw new ValidationFailedError('That serial number is not on hand.');
      if (input.outbound && serial.status !== 'ON_HAND') {
        throw new ValidationFailedError('That serial number is not on hand.');
      }
      return { batchId: null, serialId: serial.id };
    }
    return { batchId: null, serialId: null };
  }

  async ensureBatch(
    tx: TxScope,
    actor: ActorContext,
    input: { entityId: string; itemId: string; warehouseId: string; batchCode: string },
  ): Promise<string> {
    const existing = await tx.client.query<{ id: string }>(
      `SELECT id FROM stock_batches WHERE item_id = $1 AND warehouse_id = $2 AND batch_code = $3`,
      [input.itemId, input.warehouseId, input.batchCode],
    );
    if (existing.rows[0]) return existing.rows[0].id;
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO stock_batches (entity_id, item_id, warehouse_id, batch_code, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.entityId, input.itemId, input.warehouseId, input.batchCode, actor.ref],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('The batch was not created.');
    return id;
  }

  private async ensureSerial(
    tx: TxScope,
    actor: ActorContext,
    input: { entityId: string; itemId: string; warehouseId: string; serialCode: string },
  ): Promise<string> {
    const existing = await tx.client.query<{ id: string }>(
      `SELECT id FROM stock_serials WHERE item_id = $1 AND serial_code = $2`,
      [input.itemId, input.serialCode],
    );
    if (existing.rows[0]) return existing.rows[0].id;
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO stock_serials (entity_id, item_id, warehouse_id, serial_code, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
      [input.entityId, input.itemId, input.warehouseId, input.serialCode.trim(), actor.ref],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('The serial was not created.');
    return id;
  }

  private async firstWarehouse(tx: TxScope, entityId: string, location?: string): Promise<string | null> {
    if (location?.trim()) {
      const named = await tx.client.query<{ id: string }>(
        `SELECT id FROM warehouses WHERE entity_id = $1 AND (lower(name) = lower($2) OR lower(code) = lower($2)) LIMIT 1`,
        [entityId, location.trim()],
      );
      if (named.rows[0]) return named.rows[0].id;
    }
    const first = await tx.client.query<{ id: string }>(
      `SELECT id FROM warehouses WHERE entity_id = $1 AND status = 'ACTIVE' ORDER BY code LIMIT 1`,
      [entityId],
    );
    return first.rows[0]?.id ?? null;
  }

  async maybeLowStock(tx: TxScope, _actor: ActorContext, itemId: string): Promise<void> {
    const item = await tx.client.query<{
      code: string;
      name: string;
      entity_id: string;
      reorder_level: string;
      qty: string;
    }>(
      `SELECT i.code, i.name, i.entity_id, i.reorder_level::text,
              coalesce((SELECT sum(quantity_in - quantity_out) FROM stock_movements WHERE item_id = i.id), 0)::text AS qty
         FROM inventory_items i WHERE i.id = $1`,
      [itemId],
    );
    const row = item.rows[0];
    if (!row) return;
    if (Number(row.qty) > Number(row.reorder_level)) return;
    await tx.publish({
      eventType: 'inventory.low_stock',
      subjectType: 'inventory_item',
      subjectId: itemId,
      entityId: row.entity_id,
      payload: {
        type: 'inventory.low_stock',
        reference: row.code,
        title: row.name,
        summary: `On hand ${row.qty}; reorder ${row.reorder_level}.`,
        recipientUserId: OFFICER_ID,
        href: `/inventory/items/${itemId}`,
      },
    });
  }

  private async indexItem(tx: TxScope, id: string): Promise<void> {
    const item = await tx.client.query<{
      code: string;
      name: string;
      entity_id: string;
      category: string;
    }>(
      `SELECT i.code, i.name, i.entity_id, c.name AS category
         FROM inventory_items i JOIN inventory_categories c ON c.id = i.category_id WHERE i.id = $1`,
      [id],
    );
    const row = item.rows[0];
    if (!row) return;
    await tx.indexSearch({
      recordType: 'ITEM',
      recordId: id,
      referenceNumber: row.code,
      title: row.name,
      searchableText: `${row.code} ${row.name} ${row.category}`,
      entityId: row.entity_id,
      permissionKey: 'inventory.view',
    });
  }

  async nextRef(tx: TxScope, kind: string): Promise<string> {
    const allocated = await tx.client.query<{ ref: string }>(`SELECT app.next_reference($1) AS ref`, [kind]);
    const ref = allocated.rows[0]?.ref;
    if (!ref) throw new Error('A reference number was not allocated.');
    return ref;
  }

  private async entityCode(tx: TxScope, entityId: string): Promise<string> {
    const result = await tx.client.query<{ code: string }>(`SELECT code FROM entities WHERE id = $1`, [entityId]);
    return result.rows[0]?.code ?? '';
  }
}
