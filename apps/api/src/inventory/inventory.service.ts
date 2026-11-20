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
  InventorySettingKey,
  InventorySettingView,
  PermissionKey,
  QuarantineLineView,
  StockAdjustmentView,
  StockCountView,
  StockIssueView,
  StockMovementView,
  StockStatus,
  StockTransferView,
  UnitOfMeasureView,
  StockBatchListView,
  SupplierReturnableLineView,
  WarehouseLocationView,
  WarehouseView,
} from '@nfc/shared';
import { batchExpiryStatus, COUNT_ADJUSTMENT_KINDS, DISPOSAL_KINDS, inventoryStockStatus } from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import {
  ConfigurationRequiredError,
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
  CreateLocationInput,
  CreateWarehouseInput,
  IssueInput,
  ReceiveTransferInput,
  TransferInput,
  UpdateBatchInput,
  UpdateItemInput,
  UpsertCategoryInput,
} from './inventory.dto';

const OFFICER_ID = '00000000-0000-4000-8000-000000000004';

export const INTER_ENTITY_TRANSFER_DISABLED =
  'Stock transfers between subsidiaries are disabled in this phase. Earlier transfers remain visible.';

/** Procurement statuses after ED Finance approval and before completion: approved incoming. */
const INCOMING_STATUSES = ['FUNDING_PENDING', 'AWAITING_PAYMENT', 'PAYMENT_PROCESSING', 'AWAITING_DELIVERY', 'PARTIALLY_RECEIVED'];

/**
 * Approved, not yet received stock/asset procurement lines. A forecast for
 * dashboards and reorder only; it never contributes to a balance.
 */
const FORECAST_SQL = `
  SELECT l.id AS line_id, r.entity_id, r.id AS procurement_request_id,
         r.reference_number AS procurement_reference, l.inventory_item_id AS item_id, r.vendor_id,
         coalesce(l.quantity, 0)::numeric AS quantity_expected,
         GREATEST(coalesce(l.quantity, 0) - coalesce((
           SELECT sum(g.quantity_accepted + g.quantity_quarantined)
             FROM procurement_goods_receipts g
            WHERE g.request_id = r.id AND g.line_id = l.id
              AND NOT EXISTS (SELECT 1 FROM procurement_goods_receipts s WHERE s.supersedes_id = g.id)
         ), 0), 0)::numeric AS quantity_remaining,
         pv.required_date, l.created_at
    FROM procurement_requests r
    JOIN procurement_versions pv ON pv.request_id = r.id AND pv.version_number = r.current_version
    JOIN procurement_version_lines l ON l.version_id = pv.id
    JOIN procurement_categories c ON c.id = l.category_id
   WHERE (c.stock_item OR c.asset)
     AND r.status::text = ANY ('{${INCOMING_STATUSES.join(',')}}'::text[])`;

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

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return (typeof value === 'string' ? value : value.toISOString()).slice(0, 10);
}

const ORDINARY_OUTBOUND_SOURCES = new Set(['ISSUE', 'SALE', 'PRODUCTION']);

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

  async locations(actor: ActorContext, entityId?: string): Promise<WarehouseLocationView[]> {
    const scoped = this.assertListScope(actor, entityId);
    return this.unitOfWork.read(actor, async (tx) => this.locationsInTx(tx, scoped));
  }

  async createLocation(actor: ActorContext, input: CreateLocationInput): Promise<WarehouseLocationView> {
    assertCan(actor, 'inventory.config', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const warehouse = await tx.client.query<{ id: string; entity_id: string }>(
        `SELECT id, entity_id FROM warehouses WHERE id = $1`,
        [input.warehouseId],
      );
      const row = warehouse.rows[0];
      if (!row || row.entity_id !== input.entityId) {
        throw new ValidationFailedError('That warehouse does not belong to this subsidiary.');
      }
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO warehouse_locations (entity_id, warehouse_id, code, name, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
        [input.entityId, input.warehouseId, input.code.trim().toUpperCase(), input.name.trim(), actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The location was not created.');
      await tx.audit({
        action: 'create',
        subjectType: 'warehouse_location',
        subjectId: id,
        subjectLabel: input.name.trim(),
        entityId: input.entityId,
        newValue: { warehouseId: input.warehouseId, code: input.code },
      });
      const rows = await this.locationsInTx(tx, input.entityId);
      const created = rows.find((item) => item.id === id);
      if (!created) throw new Error('The location was not loaded.');
      return created;
    });
  }

  async listBatches(actor: ActorContext, entityId?: string): Promise<StockBatchListView[]> {
    const scoped = this.assertListScope(actor, entityId);
    return this.unitOfWork.read(actor, async (tx) => {
      const warningDays = await this.settingValue(tx, 'expiry_warning_days');
      const today = await this.todayIso(tx);
      const result = await tx.client.query<{
        id: string;
        entity_id: string;
        entity_code: string;
        item_id: string;
        item_code: string;
        item_name: string;
        warehouse_id: string;
        warehouse_name: string;
        batch_code: string;
        qty: string;
        manufactured_on: string | null;
        expires_on: string | null;
      }>(
        `SELECT b.id, b.entity_id, e.code AS entity_code, b.item_id, i.code AS item_code, i.name AS item_name,
                b.warehouse_id, w.name AS warehouse_name, b.batch_code,
                coalesce((
                  SELECT sum(m.quantity_in - m.quantity_out) FROM stock_movements m WHERE m.batch_id = b.id
                ), 0)::text AS qty,
                b.manufactured_on::text, b.expires_on::text
           FROM stock_batches b
           JOIN entities e ON e.id = b.entity_id
           JOIN inventory_items i ON i.id = b.item_id
           JOIN warehouses w ON w.id = b.warehouse_id
          WHERE ($1::uuid IS NULL OR b.entity_id = $1)
          ORDER BY b.expires_on ASC NULLS LAST, e.code, i.code, b.batch_code`,
        [scoped],
      );
      return result.rows.map((row) => ({
        id: row.id,
        entityId: row.entity_id,
        entityCode: row.entity_code,
        itemId: row.item_id,
        itemCode: row.item_code,
        itemName: row.item_name,
        warehouseId: row.warehouse_id,
        warehouseName: row.warehouse_name,
        batchCode: row.batch_code,
        qty: Number(row.qty),
        manufacturedOn: isoDate(row.manufactured_on),
        expiresOn: isoDate(row.expires_on),
        expiryStatus: batchExpiryStatus(isoDate(row.expires_on), warningDays, today),
      }));
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
      const warningDays = await this.settingValue(tx, 'expiry_warning_days');
      const today = await this.todayIso(tx);
      const batches = await tx.client.query<{
        id: string;
        batch_code: string;
        warehouse_name: string;
        qty: string;
        manufactured_on: string | null;
        expires_on: string | null;
      }>(
        `SELECT b.id, b.batch_code, w.name AS warehouse_name,
                coalesce((
                  SELECT sum(m.quantity_in - m.quantity_out) FROM stock_movements m WHERE m.batch_id = b.id
                ), 0)::text AS qty,
                b.manufactured_on::text, b.expires_on::text
           FROM stock_batches b
           JOIN warehouses w ON w.id = b.warehouse_id
          WHERE b.item_id = $1
          ORDER BY b.expires_on ASC NULLS LAST, b.batch_code`,
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
          manufacturedOn: isoDate(row.manufactured_on),
          expiresOn: isoDate(row.expires_on),
          expiryStatus: batchExpiryStatus(isoDate(row.expires_on), warningDays, today),
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
        `SELECT f.line_id AS id, f.entity_id, f.procurement_request_id, f.procurement_reference,
                f.line_id AS procurement_line_id, f.item_id, i.code AS item_code, i.name AS item_name,
                v.legal_name AS vendor_name, f.quantity_expected::text, f.quantity_remaining::text,
                f.required_date::text,
                CASE WHEN f.quantity_remaining > 0 THEN 'OPEN' ELSE 'CLOSED' END AS status
           FROM (${FORECAST_SQL}) f
           LEFT JOIN inventory_items i ON i.id = f.item_id
           LEFT JOIN vendors v ON v.id = f.vendor_id
          WHERE ($1::uuid IS NULL OR f.entity_id = $1)
          ORDER BY f.created_at DESC`,
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
    return items.filter((item) => item.availableQty + item.incomingQty <= item.reorderLevel);
  }

  async settings(actor: ActorContext): Promise<InventorySettingView[]> {
    if (!can(actor, 'inventory.view') && !can(actor, 'inventory.dispose.approve')) {
      throw new ForbiddenError('You cannot view inventory settings.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        key: InventorySettingKey;
        description: string;
        unit: string;
        status: 'UNCONFIRMED' | 'CONFIRMED';
        value_numeric: string | null;
        confirmed_by: string | null;
        confirmed_at: Date | null;
      }>(
        `SELECT key, description, unit, status, value_numeric::text, confirmed_by, confirmed_at
           FROM inventory_settings ORDER BY key`,
      );
      return result.rows.map((row) => ({
        key: row.key,
        description: row.description,
        unit: row.unit,
        status: row.status,
        value: row.value_numeric == null ? null : Number(row.value_numeric),
        confirmedBy: row.confirmed_by,
        confirmedAt: row.confirmed_at ? row.confirmed_at.toISOString() : null,
      }));
    });
  }

  /** The confirmed value, or null while the client has not confirmed it. Never a default. */
  async settingValue(tx: TxScope, key: InventorySettingKey): Promise<number | null> {
    const result = await tx.client.query<{ status: string; value_numeric: string | null }>(
      `SELECT status, value_numeric::text FROM inventory_settings WHERE key = $1`,
      [key],
    );
    const row = result.rows[0];
    if (!row || row.status !== 'CONFIRMED' || row.value_numeric == null) return null;
    return Number(row.value_numeric);
  }

  async requireSetting(tx: TxScope, key: InventorySettingKey, purpose: string): Promise<number> {
    const value = await this.settingValue(tx, key);
    if (value == null) {
      throw new ConfigurationRequiredError(
        `${purpose} is blocked until the ${key === 'lane_b_value_threshold_kobo' ? 'Lane B value threshold' : 'production variance tolerance'} is confirmed in inventory settings.`,
        { setting: key },
      );
    }
    return value;
  }

  /**
   * Map a stock/asset procurement line to a Stock Register item: the chosen item, or
   * one created from the line ("create if absent"). Used at the PM proposal stage.
   */
  async mapLineItemInTx(
    tx: TxScope,
    actor: ActorContext,
    input: {
      entityId: string;
      description: string;
      unitId: string | null;
      asset: boolean;
      categoryKey: string | null;
      vendorId: string | null;
      itemId?: string | null;
    },
  ): Promise<string> {
    if (input.itemId) {
      const item = await this.loadItem(tx, input.itemId);
      if (item.entity_id !== input.entityId) {
        throw new ValidationFailedError('Map each line to a Stock Register item of the same subsidiary.');
      }
      return item.id;
    }
    return this.ensureItemFromLine(tx, actor, input);
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
      quantity_quarantined: string;
      quantity_rejected: string;
      received_date: string;
      location: string;
      reference_number: string;
      warehouse_id: string | null;
      location_id: string | null;
      batch_code: string | null;
    }>(
      `SELECT id, entity_id, request_id, line_id, quantity_accepted::text, quantity_quarantined::text,
              quantity_rejected::text, received_date::text, location, reference_number,
              warehouse_id, location_id, batch_code
         FROM procurement_goods_receipts WHERE id = $1`,
      [input.grnId],
    );
    const row = grn.rows[0];
    if (!row) return;
    const accepted = Number(row.quantity_accepted);
    const quarantined = Number(row.quantity_quarantined);
    const received = accepted + quarantined;
    if (received <= 0) return;
    const line = await tx.client.query<{
      id: string;
      description: string;
      unit_id: string | null;
      unit_price_kobo: string | null;
      category_key: string | null;
      stock_item: boolean;
      asset: boolean;
      vendor_id: string | null;
      inventory_item_id: string | null;
      budget_line_id: string | null;
    }>(
      `SELECT l.id, l.description, l.unit_id, l.unit_price_kobo::text, c.key AS category_key,
              coalesce(c.stock_item, false) AS stock_item, coalesce(c.asset, false) AS asset,
              r.vendor_id, l.inventory_item_id, coalesce(l.budget_line_id, v.budget_line_id) AS budget_line_id
         FROM procurement_version_lines l
         JOIN procurement_requests r ON r.id = $2
         JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
         LEFT JOIN procurement_categories c ON c.id = l.category_id
        WHERE l.id = coalesce($1::uuid, (
          SELECT l2.id FROM procurement_version_lines l2
           WHERE l2.version_id = v.id
          ORDER BY l2.line_number LIMIT 1
        ))`,
      [row.line_id, row.request_id],
    );
    const stock = line.rows[0];
    if (!stock || (!stock.stock_item && !stock.asset)) return;
    const itemId =
      stock.inventory_item_id ??
      (await this.ensureItemFromLine(tx, actor, {
        entityId: row.entity_id,
        description: stock.description,
        unitId: stock.unit_id,
        asset: stock.asset,
        categoryKey: stock.category_key,
        vendorId: stock.vendor_id,
      }));
    const item = await this.loadItem(tx, itemId);
    const warehouseId =
      input.warehouseId ??
      row.warehouse_id ??
      item.default_warehouse_id ??
      (await this.firstWarehouse(tx, row.entity_id, row.location));
    if (!warehouseId) throw new ValidationFailedError('A warehouse is required before stock can be received.');
    if (item.tracking_mode === 'serial') {
      const serials = input.serialCodes ?? [];
      if (serials.length !== received) {
        throw new ValidationFailedError('Each received unit of a serial-tracked item needs a serial number.');
      }
    }
    const unitCost = Number(stock.unit_price_kobo ?? 0);
    const batchId =
      item.tracking_mode === 'batch_lot'
        ? await this.ensureBatch(tx, actor, {
            entityId: row.entity_id,
            itemId,
            warehouseId,
            batchCode: input.batchCode?.trim() || row.batch_code?.trim() || row.reference_number,
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
    // Accepted quantity lands available; quarantined lands in the same ledger with QUARANTINED status.
    const targets: Array<{ serialId: string | null; qty: number; status: StockStatus }> =
      serialIds.length > 0
        ? serialIds.map((serialId, index) => ({
            serialId,
            qty: 1,
            status: index < accepted ? 'AVAILABLE' : 'QUARANTINED',
          }))
        : [
            ...(accepted > 0 ? [{ serialId: null, qty: accepted, status: 'AVAILABLE' as const }] : []),
            ...(quarantined > 0 ? [{ serialId: null, qty: quarantined, status: 'QUARANTINED' as const }] : []),
          ];
    let firstMovementId: string | null = null;
    for (const target of targets) {
      const movementId = await this.insertMovement(tx, actor, {
        entityId: row.entity_id,
        itemId,
        warehouseId,
        locationId: row.location_id,
        batchId,
        serialId: target.serialId,
        quantityIn: target.qty,
        quantityOut: 0,
        unitCostKobo: unitCost,
        source: 'GRN',
        sourceId: row.id,
        procurementRequestId: row.request_id,
        grnId: row.id,
        occurredOn: row.received_date,
        stockStatus: target.status,
        notes: `${target.status === 'AVAILABLE' ? 'Accepted' : 'Quarantined'} on ${row.reference_number}`,
      });
      firstMovementId ??= movementId;
    }
    const assetItem = item.asset || stock.asset;
    if (this.ledger) {
      const rule = await tx.client.query<{ debit_account_code: string }>(
        `SELECT debit_account_code FROM inventory_posting_rules WHERE movement_kind = $1`,
        [assetItem ? 'receipt_equipment' : 'receipt_goods'],
      );
      await this.ledger.postInventoryReceipt(tx, actor, {
        grnId: row.id,
        entityId: row.entity_id,
        requestId: row.request_id,
        vendorId: stock.vendor_id,
        debitAccountCode: rule.rows[0]?.debit_account_code ?? (assetItem ? '1500' : '1400'),
        amountKobo: Math.round(unitCost * received),
        occurredOn: row.received_date,
        narration: `Inventory receipt ${row.reference_number}`,
        movementId: firstMovementId,
        budgetLineId: stock.budget_line_id,
      });
    }
    if (assetItem) {
      const units = serialIds.length > 0 ? serialIds : Array.from({ length: received }, () => null);
      for (const serialId of units) {
        await this.registerAssetInTx(tx, actor, {
          entityId: row.entity_id,
          itemId,
          serialId,
          grnId: row.id,
          procurementRequestId: row.request_id,
          warehouseId,
          locationLabel: row.location,
          costKobo: unitCost,
          acquiredOn: row.received_date,
        });
      }
    }
    if (quarantined > 0) {
      await tx.publish({
        eventType: 'inventory.qc.pending',
        subjectType: 'inventory_item',
        subjectId: itemId,
        entityId: row.entity_id,
        payload: {
          type: 'inventory.qc.pending',
          reference: row.reference_number,
          title: item.name,
          summary: `${quarantined} quarantined on ${row.reference_number}.`,
          href: '/inventory/desk?tile=qc',
        },
      });
    }
    await this.maybeLowStock(tx, actor, itemId);
  }

  /** One AST- record per individually tracked unit. History rows are append-only. */
  async registerAssetInTx(
    tx: TxScope,
    actor: ActorContext,
    input: {
      entityId: string;
      itemId: string;
      serialId: string | null;
      grnId?: string | null;
      procurementRequestId?: string | null;
      warehouseId: string | null;
      locationLabel?: string | null;
      departmentId?: string | null;
      departmentLabel?: string | null;
      custodianName?: string | null;
      condition?: string;
      costKobo: number;
      acquiredOn: string | null;
      photoDocumentId?: string | null;
    },
  ): Promise<string> {
    if (input.serialId) {
      const existing = await tx.client.query<{ id: string; status: string }>(
        `SELECT id, status FROM fixed_assets WHERE serial_id = $1`,
        [input.serialId],
      );
      const found = existing.rows[0];
      if (found) {
        if (found.status === 'DISPOSED' && input.grnId) {
          // The same serial re-received on a superseding GRN.
          await tx.client.query(
            `UPDATE fixed_assets SET status = 'IN_STORE', grn_id = $1, warehouse_id = $2, updated_by = $3 WHERE id = $4`,
            [input.grnId, input.warehouseId, actor.ref, found.id],
          );
          await tx.client.query(
            `INSERT INTO fixed_asset_events (asset_id, entity_id, kind, reason, created_by)
             VALUES ($1, $2, 'REGISTERED', 'Re-received on a superseding goods received note.', $3)`,
            [found.id, input.entityId, actor.ref],
          );
        }
        return found.id;
      }
    }
    const ref = await this.nextRef(tx, 'AST');
    const serialCode = input.serialId
      ? ((
          await tx.client.query<{ serial_code: string }>(`SELECT serial_code FROM stock_serials WHERE id = $1`, [
            input.serialId,
          ])
        ).rows[0]?.serial_code ?? null)
      : null;
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO fixed_assets (
         reference_number, entity_id, item_id, serial_id, serial_code, grn_id, procurement_request_id,
         warehouse_id, location_label, department_id, department_label, custodian_name, condition,
         status, cost_kobo, acquired_on, photo_document_id, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18)
       RETURNING id`,
      [
        ref,
        input.entityId,
        input.itemId,
        input.serialId,
        serialCode,
        input.grnId ?? null,
        input.procurementRequestId ?? null,
        input.warehouseId,
        input.locationLabel ?? null,
        input.departmentId ?? null,
        input.departmentLabel ?? null,
        input.custodianName ?? null,
        input.condition ?? 'new',
        input.custodianName ? 'IN_SERVICE' : 'IN_STORE',
        input.costKobo,
        input.acquiredOn,
        input.photoDocumentId ?? null,
        actor.ref,
      ],
    );
    const assetId = inserted.rows[0]?.id;
    if (!assetId) throw new Error('The asset was not registered.');
    await tx.client.query(
      `INSERT INTO fixed_asset_events (
         asset_id, entity_id, kind, department_id, department_label, location_label, custodian_name,
         condition, document_id, created_by
       ) VALUES ($1, $2, 'REGISTERED', $3, $4, $5, $6, $7, $8, $9)`,
      [
        assetId,
        input.entityId,
        input.departmentId ?? null,
        input.departmentLabel ?? null,
        input.locationLabel ?? null,
        input.custodianName ?? null,
        input.condition ?? 'new',
        input.photoDocumentId ?? null,
        actor.ref,
      ],
    );
    await tx.indexSearch({
      recordType: 'ASSET',
      recordId: assetId,
      referenceNumber: ref,
      title: `Asset ${ref}`,
      searchableText: `${ref} ${serialCode ?? ''}`,
      entityId: input.entityId,
      permissionKey: 'inventory.view',
    });
    await tx.audit({
      action: 'create',
      subjectType: 'fixed_asset',
      subjectId: assetId,
      subjectLabel: ref,
      subjectReferenceNumber: ref,
      entityId: input.entityId,
    });
    return assetId;
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
      stock_status: StockStatus;
    }>(
      `SELECT id, entity_id, item_id, warehouse_id, batch_id, serial_id, quantity_in::text,
              unit_cost_kobo::text, procurement_request_id, occurred_on::text, stock_status
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
        stockStatus: row.stock_status,
        notes: 'Superseded GRN',
      });
    }
    const first = originals.rows[0];
    if (first && this.ledger && first.procurement_request_id) {
      const budget = await tx.client.query<{ budget_line_id: string | null }>(
        `SELECT coalesce(l.budget_line_id, v.budget_line_id) AS budget_line_id
           FROM procurement_goods_receipts g
           JOIN procurement_requests r ON r.id = g.request_id
           JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
           LEFT JOIN procurement_version_lines l ON l.id = g.line_id
          WHERE g.id = $1`,
        [grnId],
      );
      await this.ledger.reverseInventoryReceipt(tx, actor, {
        grnId,
        entityId: first.entity_id,
        requestId: first.procurement_request_id,
        budgetLineId: budget.rows[0]?.budget_line_id ?? null,
        reason: 'Goods received note superseded.',
      });
    }
    const assets = await tx.client.query<{ id: string; entity_id: string }>(
      `SELECT id, entity_id FROM fixed_assets WHERE grn_id = $1 AND status = 'IN_STORE'`,
      [grnId],
    );
    for (const asset of assets.rows) {
      await tx.client.query(
        `INSERT INTO fixed_asset_events (asset_id, entity_id, kind, reason, created_by)
         VALUES ($1, $2, 'DISPOSED', 'Goods received note superseded; the unit is re-registered on the new note.', $3)`,
        [asset.id, asset.entity_id, actor.ref],
      );
      await tx.client.query(`UPDATE fixed_assets SET status = 'DISPOSED', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        asset.id,
      ]);
    }
  }

  async issue(actor: ActorContext, input: IssueInput): Promise<StockIssueView> {
    assertCan(actor, 'inventory.issue', input.entityId);
    const id = await this.unitOfWork.write(actor, async (tx) => {
      const replay = await tx.client.query<{ id: string }>(`SELECT id FROM stock_issues WHERE idempotency_key = $1`, [
        input.idempotencyKey,
      ]);
      if (replay.rows[0]) return replay.rows[0].id;
      const lines: Array<{
        itemId: string;
        quantity: number;
        cost: number;
        batchId: string | null;
        serialId: string | null;
      }> = [];
      let value = 0;
      for (const line of input.lines) {
        const item = await this.loadItem(tx, line.itemId);
        if (item.entity_id !== input.entityId) {
          throw new ValidationFailedError('Every line must be an item of the selected subsidiary.');
        }
        const cost = await this.averageCost(tx, line.itemId, input.warehouseId);
        const { batchId, serialId } = await this.resolveTracking(tx, actor, {
          entityId: input.entityId,
          itemId: line.itemId,
          warehouseId: input.warehouseId,
          batchCode: line.batchCode,
          serialCode: line.serialCode,
          outbound: true,
        });
        const available = await this.available(tx, line.itemId, input.warehouseId);
        if (available + 1e-9 < line.quantity) {
          throw new ValidationFailedError(`There is not enough available stock of ${item.code} for this issue.`);
        }
        lines.push({ itemId: line.itemId, quantity: line.quantity, cost, batchId, serialId });
        value += Math.round(cost * line.quantity);
      }
      // Lane A while the client has not confirmed a threshold; Lane B once a confirmed figure is exceeded.
      const threshold = await this.settingValue(tx, 'lane_b_value_threshold_kobo');
      const needsApproval = threshold !== null && value >= threshold;
      const ref = await this.nextRef(tx, 'ISS');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO stock_issues (
           reference_number, entity_id, warehouse_id, destination_type, destination_id, destination_label,
           reason, occurred_on, status, value_kobo, recipient_name, idempotency_key, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) RETURNING id`,
        [
          ref,
          input.entityId,
          input.warehouseId,
          input.destinationType,
          input.destinationId ?? null,
          input.destinationLabel ?? null,
          input.reason.trim(),
          input.occurredOn,
          needsApproval ? 'PENDING_APPROVAL' : 'POSTED',
          value,
          emptyToNull(input.recipientName),
          input.idempotencyKey,
          actor.ref,
        ],
      );
      const issueId = inserted.rows[0]?.id;
      if (!issueId) throw new Error('The issue was not recorded.');
      for (const line of lines) {
        const movementId = needsApproval
          ? null
          : await this.postIssueLineInTx(tx, actor, {
              issueId,
              reference: ref,
              entityId: input.entityId,
              warehouseId: input.warehouseId,
              occurredOn: input.occurredOn,
              reason: input.reason,
              ...line,
            });
        await tx.client.query(
          `INSERT INTO stock_issue_lines (
             issue_id, entity_id, item_id, quantity, batch_id, serial_id, movement_id, unit_cost_kobo, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            issueId,
            input.entityId,
            line.itemId,
            line.quantity,
            line.batchId,
            line.serialId,
            movementId,
            Math.round(line.cost),
            actor.ref,
          ],
        );
      }
      if (needsApproval) {
        const instanceId = await this.workflows?.startInventoryIssueInTx(tx, actor, { issueId });
        if (instanceId) {
          await tx.client.query(`UPDATE stock_issues SET workflow_instance_id = $1, updated_by = $2 WHERE id = $3`, [
            instanceId,
            actor.ref,
            issueId,
          ]);
        }
      }
      await tx.indexSearch({
        recordType: 'STOCK_ISSUE',
        recordId: issueId,
        referenceNumber: ref,
        title: `Stock issue ${ref}`,
        searchableText: `${ref} ${input.reason} ${input.recipientName ?? ''} ${input.destinationLabel ?? ''}`,
        entityId: input.entityId,
        permissionKey: 'inventory.view',
      });
      await tx.audit({
        action: 'create',
        subjectType: 'stock_issue',
        subjectId: issueId,
        subjectLabel: ref,
        subjectReferenceNumber: ref,
        entityId: input.entityId,
        reason: input.reason,
        newValue: { status: needsApproval ? 'PENDING_APPROVAL' : 'POSTED', valueKobo: value },
      });
      return issueId;
    });
    return this.getIssue(actor, id);
  }

  /** Workflow hook: the over-threshold issue was approved, so the stock leaves now. */
  async postIssueInTx(tx: TxScope, actor: ActorContext, issueId: string): Promise<void> {
    const header = await tx.client.query<{
      id: string;
      entity_id: string;
      warehouse_id: string;
      status: string;
      reference_number: string;
      reason: string;
      occurred_on: string;
    }>(
      `SELECT id, entity_id, warehouse_id, status, reference_number, reason, occurred_on::text
         FROM stock_issues WHERE id = $1 FOR UPDATE`,
      [issueId],
    );
    const row = header.rows[0];
    if (!row || row.status !== 'PENDING_APPROVAL') return;
    const lines = await tx.client.query<{
      item_id: string;
      quantity: string;
      batch_id: string | null;
      serial_id: string | null;
    }>(`SELECT item_id, quantity::text, batch_id, serial_id FROM stock_issue_lines WHERE issue_id = $1`, [issueId]);
    for (const line of lines.rows) {
      const cost = await this.averageCost(tx, line.item_id, row.warehouse_id);
      await this.postIssueLineInTx(tx, actor, {
        issueId,
        reference: row.reference_number,
        entityId: row.entity_id,
        warehouseId: row.warehouse_id,
        occurredOn: row.occurred_on,
        reason: row.reason,
        itemId: line.item_id,
        quantity: Number(line.quantity),
        cost,
        batchId: line.batch_id,
        serialId: line.serial_id,
      });
    }
    await tx.client.query(`UPDATE stock_issues SET status = 'POSTED', updated_by = $1 WHERE id = $2`, [
      actor.ref,
      issueId,
    ]);
  }

  async rejectIssueInTx(tx: TxScope, actor: ActorContext, issueId: string): Promise<void> {
    await tx.client.query(
      `UPDATE stock_issues SET status = 'REJECTED', updated_by = $1 WHERE id = $2 AND status = 'PENDING_APPROVAL'`,
      [actor.ref, issueId],
    );
  }

  private async postIssueLineInTx(
    tx: TxScope,
    actor: ActorContext,
    input: {
      issueId: string;
      reference: string;
      entityId: string;
      warehouseId: string;
      occurredOn: string;
      reason: string;
      itemId: string;
      quantity: number;
      cost: number;
      batchId: string | null;
      serialId: string | null;
    },
  ): Promise<string> {
    const movementId = await this.insertMovement(tx, actor, {
      entityId: input.entityId,
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      batchId: input.batchId,
      serialId: input.serialId,
      quantityIn: 0,
      quantityOut: input.quantity,
      unitCostKobo: input.cost,
      source: 'ISSUE',
      sourceId: input.issueId,
      occurredOn: input.occurredOn,
      notes: input.reason,
    });
    await this.postMovement(tx, actor, {
      movementId,
      entityId: input.entityId,
      occurredOn: input.occurredOn,
      amountKobo: Math.round(input.cost * input.quantity),
      ruleKind: 'issue',
      source: 'INVENTORY_ISSUE',
      idempotencyKey: `inv-issue:${input.issueId}:${input.itemId}`,
      narration: `Stock issue ${input.reference}`,
    });
    if (input.serialId) {
      await tx.client.query(`UPDATE stock_serials SET status = 'ISSUED', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        input.serialId,
      ]);
    }
    await this.maybeLowStock(tx, actor, input.itemId);
    return movementId;
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
    if (!intra) throw new ForbiddenError(INTER_ENTITY_TRANSFER_DISABLED);
    if (!input.destWarehouseId) {
      throw new ValidationFailedError('The destination warehouse is required.');
    }
    if (input.destWarehouseId === input.sourceWarehouseId) {
      throw new ValidationFailedError('Choose a different destination warehouse.');
    }
    const id = await this.unitOfWork.write(actor, async (tx) => {
      const replay = await tx.client.query<{ id: string }>(
        `SELECT id FROM stock_transfers WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (replay.rows[0]) return replay.rows[0].id;
      const warehouses = await tx.client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM warehouses WHERE entity_id = $1 AND id IN ($2, $3)`,
        [input.sourceEntityId, input.sourceWarehouseId, input.destWarehouseId],
      );
      if (Number(warehouses.rows[0]?.n ?? 0) !== 2) {
        throw new ValidationFailedError('Both warehouses must belong to the selected subsidiary.');
      }
      const ref = await this.nextRef(tx, 'STR');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO stock_transfers (
           reference_number, source_entity_id, destination_entity_id, source_warehouse_id, dest_warehouse_id,
           status, reason, occurred_on, idempotency_key, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, 'RECEIVED', $6, $7, $8, $9, $9) RETURNING id`,
        [
          ref,
          input.sourceEntityId,
          input.destinationEntityId,
          input.sourceWarehouseId,
          input.destWarehouseId,
          input.reason.trim(),
          input.occurredOn,
          input.idempotencyKey,
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
        const inId = await this.insertMovement(tx, actor, {
          entityId: input.destinationEntityId,
          itemId: line.itemId,
          warehouseId: input.destWarehouseId!,
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
        if (serialId) {
          await tx.client.query(`UPDATE stock_serials SET warehouse_id = $1, updated_by = $2 WHERE id = $3`, [
            input.destWarehouseId,
            actor.ref,
            serialId,
          ]);
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

  /** Inter-subsidiary transfers are frozen this phase; history stays readable. */
  async receiveTransfer(_actor: ActorContext, _id: string, _input: ReceiveTransferInput): Promise<StockTransferView> {
    throw new ForbiddenError(INTER_ENTITY_TRANSFER_DISABLED);
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
    const disposal = (DISPOSAL_KINDS as readonly string[]).includes(input.kind);
    const countKind = (COUNT_ADJUSTMENT_KINDS as readonly string[]).includes(input.kind);
    assertCan(actor, disposal ? 'inventory.dispose.request' : 'inventory.adjust.prepare', input.entityId);
    if (disposal && !input.evidenceDocumentId) {
      throw new ValidationFailedError('A write-off or disposal needs supporting evidence.');
    }
    if (countKind && !input.countId) {
      throw new ValidationFailedError('A stock adjustment can only be prepared from a completed count.');
    }
    const id = await this.unitOfWork.write(actor, async (tx) => {
      if (input.idempotencyKey) {
        const replay = await tx.client.query<{ id: string }>(
          `SELECT id FROM stock_adjustments WHERE idempotency_key = $1`,
          [input.idempotencyKey],
        );
        if (replay.rows[0]) return replay.rows[0].id;
      }
      const threshold = await this.requireSetting(
        tx,
        'lane_b_value_threshold_kobo',
        'Disposals and stock adjustments need the confirmed approval threshold',
      );
      const lines: Array<{ itemId: string; quantity: number; stockStatus: StockStatus }> = [];
      if (countKind) {
        const count = await tx.client.query<{
          entity_id: string;
          warehouse_id: string;
          status: string;
        }>(`SELECT entity_id, warehouse_id, status FROM stock_counts WHERE id = $1 FOR UPDATE`, [input.countId]);
        const countRow = count.rows[0];
        if (!countRow) throw new NotFoundError('That count was not found.');
        if (countRow.status !== 'COMPLETED') {
          throw new ConflictError('A stock adjustment can only be prepared from a completed count.');
        }
        if (countRow.entity_id !== input.entityId || countRow.warehouse_id !== input.warehouseId) {
          throw new ValidationFailedError('The adjustment must use the same subsidiary and warehouse as the count.');
        }
        const open = await tx.client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM stock_adjustments WHERE count_id = $1 AND status <> 'REJECTED'`,
          [input.countId],
        );
        if (Number(open.rows[0]?.n ?? 0) > 0) {
          throw new ConflictError('An adjustment has already been prepared from this count.');
        }
        const variances = await tx.client.query<{ item_id: string; variance_qty: string }>(
          `SELECT item_id, variance_qty::text FROM stock_count_lines
            WHERE count_id = $1 AND coalesce(variance_qty, 0) <> 0`,
          [input.countId],
        );
        const byItem = new Map(variances.rows.map((row) => [row.item_id, Number(row.variance_qty)]));
        for (const line of input.lines) {
          const variance = byItem.get(line.itemId);
          if (variance === undefined || Math.abs(variance - line.quantity) > 1e-9) {
            throw new ValidationFailedError('Every adjustment line must match a variance recorded on the count.');
          }
          lines.push({ itemId: line.itemId, quantity: line.quantity, stockStatus: 'AVAILABLE' });
        }
      } else {
        for (const line of input.lines) {
          if (line.quantity === 0) throw new ValidationFailedError('An adjustment quantity cannot be zero.');
          // A disposal always takes stock out, whatever sign was typed.
          lines.push({
            itemId: line.itemId,
            quantity: -Math.abs(line.quantity),
            stockStatus: line.stockStatus ?? 'AVAILABLE',
          });
        }
      }
      let value = 0;
      for (const line of lines) {
        const item = await this.loadItem(tx, line.itemId);
        if (item.entity_id !== input.entityId) {
          throw new ValidationFailedError('Every line must be an item of the selected subsidiary.');
        }
        if (line.quantity < 0) {
          const usable =
            line.stockStatus === 'AVAILABLE'
              ? await this.available(tx, line.itemId, input.warehouseId)
              : await this.statusQty(tx, line.itemId, input.warehouseId, line.stockStatus);
          if (usable + 1e-9 < Math.abs(line.quantity)) {
            throw new ValidationFailedError(`There is not enough stock of ${item.code} for this adjustment.`);
          }
        }
        value += Math.round((await this.averageCost(tx, line.itemId, input.warehouseId)) * Math.abs(line.quantity));
      }
      const requiresFinance = value >= threshold;
      const ref = await this.nextRef(tx, 'ADJ');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO stock_adjustments (
           reference_number, entity_id, warehouse_id, kind, reason, evidence_document_id, occurred_on,
           count_id, value_kobo, requires_finance, idempotency_key, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING id`,
        [
          ref,
          input.entityId,
          input.warehouseId,
          input.kind,
          input.reason.trim(),
          input.evidenceDocumentId ?? null,
          input.occurredOn,
          input.countId ?? null,
          value,
          requiresFinance,
          input.idempotencyKey ?? null,
          actor.ref,
        ],
      );
      const adjustmentId = inserted.rows[0]?.id;
      if (!adjustmentId) throw new Error('The adjustment was not created.');
      for (const line of lines) {
        await tx.client.query(
          `INSERT INTO stock_adjustment_lines (
             adjustment_id, entity_id, item_id, quantity, stock_status, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
          [adjustmentId, input.entityId, line.itemId, line.quantity, line.stockStatus, actor.ref],
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
      asset_id: string | null;
    }>(
      `SELECT id, entity_id, warehouse_id, kind, occurred_on::text, reference_number, created_by, status, asset_id
         FROM stock_adjustments WHERE id = $1 FOR UPDATE`,
      [adjustmentId],
    );
    const row = header.rows[0];
    if (!row) return;
    if (row.created_by === actor.ref) {
      throw new ForbiddenError('The person who prepared this adjustment cannot approve it.');
    }
    if (row.status !== 'PENDING_APPROVAL') return;
    const lines = await tx.client.query<{
      id: string;
      item_id: string;
      quantity: string;
      stock_status: StockStatus;
      batch_id: string | null;
      serial_id: string | null;
    }>(
      `SELECT id, item_id, quantity::text, stock_status, batch_id, serial_id
         FROM stock_adjustment_lines WHERE adjustment_id = $1`,
      [adjustmentId],
    );
    const writeOffKind = ['damaged', 'expired', 'disposal', 'asset_disposal'].includes(row.kind);
    for (const line of lines.rows) {
      const qty = Number(line.quantity);
      const inbound = qty > 0;
      const abs = Math.abs(qty);
      const cost = await this.averageCost(tx, line.item_id, row.warehouse_id);
      const movementId = await this.insertMovement(tx, actor, {
        entityId: row.entity_id,
        itemId: line.item_id,
        warehouseId: row.warehouse_id,
        batchId: line.batch_id,
        serialId: line.serial_id,
        quantityIn: inbound ? abs : 0,
        quantityOut: inbound ? 0 : abs,
        unitCostKobo: cost,
        source:
          row.kind === 'disposal' || row.kind === 'asset_disposal'
            ? 'DISPOSAL'
            : row.kind === 'damaged' || row.kind === 'expired'
              ? 'WRITE_OFF'
              : 'ADJUSTMENT',
        sourceId: adjustmentId,
        occurredOn: row.occurred_on,
        notes: row.reference_number,
        stockStatus: line.stock_status,
      });
      await tx.client.query(
        `UPDATE stock_adjustment_lines SET movement_id = $1, updated_by = $2 WHERE id = $3`,
        [movementId, actor.ref, line.id],
      );
      const writeOff = writeOffKind || !inbound;
      await this.postMovement(tx, actor, {
        movementId,
        entityId: row.entity_id,
        occurredOn: row.occurred_on,
        amountKobo: Math.round(cost * abs),
        ruleKind: inbound
          ? 'adjustment_increase'
          : row.kind === 'asset_disposal'
            ? 'write_off_equipment'
            : 'write_off',
        source: writeOff ? 'INVENTORY_WRITE_OFF' : 'INVENTORY_ADJUSTMENT',
        idempotencyKey: `inv-adj:${adjustmentId}:${line.item_id}`,
        narration: `Stock adjustment ${row.reference_number}`,
      });
      if (line.serial_id && !inbound) {
        await tx.client.query(`UPDATE stock_serials SET status = 'WRITTEN_OFF', updated_by = $1 WHERE id = $2`, [
          actor.ref,
          line.serial_id,
        ]);
      }
      await this.maybeLowStock(tx, actor, line.item_id);
    }
    if (row.kind === 'asset_disposal' && row.asset_id) {
      await tx.client.query(`UPDATE fixed_assets SET status = 'DISPOSED', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        row.asset_id,
      ]);
      await tx.client.query(
        `INSERT INTO fixed_asset_events (asset_id, entity_id, kind, adjustment_id, reason, created_by)
         VALUES ($1, $2, 'DISPOSED', $3, $4, $5)`,
        [row.asset_id, row.entity_id, adjustmentId, `Disposal ${row.reference_number} approved.`, actor.ref],
      );
    }
    await tx.client.query(`UPDATE stock_adjustments SET status = 'POSTED', updated_by = $1 WHERE id = $2`, [
      actor.ref,
      adjustmentId,
    ]);
  }

  async rejectAdjustmentInTx(tx: TxScope, actor: ActorContext, adjustmentId: string): Promise<void> {
    const updated = await tx.client.query<{ asset_id: string | null; entity_id: string; reference_number: string }>(
      `UPDATE stock_adjustments SET status = 'REJECTED', updated_by = $1
        WHERE id = $2 AND status = 'PENDING_APPROVAL'
        RETURNING asset_id, entity_id, reference_number`,
      [actor.ref, adjustmentId],
    );
    const row = updated.rows[0];
    if (row?.asset_id) {
      await tx.client.query(
        `UPDATE fixed_assets
            SET status = CASE WHEN department_label IS NOT NULL OR custodian_name IS NOT NULL
                              THEN 'IN_SERVICE' ELSE 'IN_STORE' END,
                updated_by = $1
          WHERE id = $2 AND status = 'DISPOSAL_PENDING'`,
        [actor.ref, row.asset_id],
      );
      await tx.client.query(
        `INSERT INTO fixed_asset_events (asset_id, entity_id, kind, adjustment_id, reason, created_by)
         VALUES ($1, $2, 'DISPOSAL_REJECTED', $3, $4, $5)`,
        [row.asset_id, row.entity_id, adjustmentId, `Disposal ${row.reference_number} rejected.`, actor.ref],
      );
    }
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
    if (row.source_entity_id !== row.destination_entity_id) {
      throw new ForbiddenError(INTER_ENTITY_TRANSFER_DISABLED);
    }
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
      const ref = await this.nextRef(tx, 'VER');
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
           LEFT JOIN stock_movements m
             ON m.item_id = i.id AND m.warehouse_id = $2 AND m.stock_status = 'AVAILABLE'
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
            SET counted_qty = $1, variance_qty = $1 - system_qty, explanation = $5, updated_by = $2
          WHERE id = $3 AND count_id = $4`,
        [input.countedQty, actor.ref, lineId, countId, emptyToNull(input.explanation)],
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
      if (row.status !== 'OPEN') throw new ConflictError('This count has already been completed.');
      // Completion is the evidence. Any variance adjustment is prepared separately from it and approved.
      await tx.client.query(
        `UPDATE stock_counts SET status = 'COMPLETED', completed_at = now(), completed_by = $1, updated_by = $1
          WHERE id = $2`,
        [actor.ref, countId],
      );
      await tx.audit({
        action: 'edit',
        subjectType: 'stock_count',
        subjectId: countId,
        subjectLabel: row.reference_number,
        subjectReferenceNumber: row.reference_number,
        entityId: row.entity_id,
        reason: 'Count completed.',
      });
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
      warehouse_id: string;
      warehouse_name: string;
      destination_type: StockIssueView['destinationType'];
      destination_label: string | null;
      reason: string;
      status: string;
      occurred_on: string;
      recipient_name: string | null;
      value_kobo: string | null;
      workflow_instance_id: string | null;
    }>(
      `SELECT i.id, i.reference_number, i.warehouse_id, w.name AS warehouse_name, i.destination_type, i.destination_label,
              i.reason, i.status, i.occurred_on::text, i.recipient_name, i.value_kobo::text, i.workflow_instance_id
         FROM stock_issues i JOIN warehouses w ON w.id = i.warehouse_id WHERE i.id = $1`,
      [id],
    );
    const row = header.rows[0];
    if (!row) throw new NotFoundError('That issue was not found.');
    const lines = await tx.client.query<{
      id: string;
      item_id: string;
      item_code: string;
      item_name: string;
      quantity: string;
      remaining: string;
    }>(
      `SELECT l.id, l.item_id, it.code AS item_code, it.name AS item_name, l.quantity::text,
              (l.quantity - coalesce((
                 SELECT sum(rl.quantity) FROM stock_return_lines rl
                  JOIN stock_returns r ON r.id = rl.return_id
                 WHERE rl.issue_line_id = l.id AND r.kind = 'RECEIVE_RETURN'
               ), 0))::text AS remaining
         FROM stock_issue_lines l JOIN inventory_items it ON it.id = l.item_id WHERE l.issue_id = $1`,
      [id],
    );
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      warehouseId: row.warehouse_id,
      warehouseName: row.warehouse_name,
      destinationType: row.destination_type,
      destinationLabel: row.destination_label,
      reason: row.reason,
      status: row.status,
      occurredOn: row.occurred_on,
      recipientName: row.recipient_name,
      valueKobo: row.value_kobo == null ? null : Number(row.value_kobo),
      workflowInstanceId: row.workflow_instance_id,
      lines: lines.rows.map((line) => ({
        id: line.id,
        itemId: line.item_id,
        itemCode: line.item_code,
        itemName: line.item_name,
        quantity: Number(line.quantity),
        remainingQty: Number(line.remaining),
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
      count_id: string | null;
      count_reference: string | null;
      asset_id: string | null;
      value_kobo: string | null;
      requires_finance: boolean;
    }>(
      `SELECT a.id, a.reference_number, w.name AS warehouse_name, a.kind, a.reason, a.status,
              a.occurred_on::text, a.created_by, a.count_id, c.reference_number AS count_reference,
              a.asset_id, a.value_kobo::text, a.requires_finance
         FROM stock_adjustments a
         JOIN warehouses w ON w.id = a.warehouse_id
         LEFT JOIN stock_counts c ON c.id = a.count_id
        WHERE a.id = $1`,
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
      countId: row.count_id,
      countReference: row.count_reference,
      assetId: row.asset_id,
      valueKobo: row.value_kobo == null ? null : Number(row.value_kobo),
      requiresFinance: row.requires_finance,
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
      entity_id: string;
      warehouse_id: string;
      completed_at: string | null;
      adjustment_id: string | null;
      adjustment_reference: string | null;
    }>(
      `SELECT c.id, c.reference_number, w.name AS warehouse_name, c.mode, c.status, c.counted_on::text,
              c.entity_id, c.warehouse_id, c.completed_at::text,
              adj.id AS adjustment_id, adj.reference_number AS adjustment_reference
         FROM stock_counts c
         JOIN warehouses w ON w.id = c.warehouse_id
         LEFT JOIN LATERAL (
           SELECT a.id, a.reference_number FROM stock_adjustments a
            WHERE a.count_id = c.id AND a.status <> 'REJECTED'
            ORDER BY a.created_at DESC LIMIT 1
         ) adj ON true
        WHERE c.id = $1`,
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
      explanation: string | null;
    }>(
      `SELECT l.id, l.item_id, it.code AS item_code, it.name AS item_name, l.system_qty::text,
              l.counted_qty::text, l.variance_qty::text, l.explanation
         FROM stock_count_lines l JOIN inventory_items it ON it.id = l.item_id
        WHERE l.count_id = $1 ORDER BY it.code`,
      [id],
    );
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      entityId: row.entity_id,
      warehouseId: row.warehouse_id,
      warehouseName: row.warehouse_name,
      mode: row.mode,
      status: row.status,
      countedOn: row.counted_on,
      completedAt: row.completed_at,
      adjustmentId: row.adjustment_id,
      adjustmentReference: row.adjustment_reference,
      lines: lines.rows.map((line) => ({
        id: line.id,
        itemId: line.item_id,
        itemCode: line.item_code,
        itemName: line.item_name,
        systemQty: Number(line.system_qty),
        countedQty: line.counted_qty == null ? null : Number(line.counted_qty),
        varianceQty: line.variance_qty == null ? null : Number(line.variance_qty),
        explanation: line.explanation,
      })),
    };
  }

  private async overviewInTx(tx: TxScope, entityId: string | null): Promise<InventoryOverviewView> {
    const rows = await this.listItemsInTx(tx, entityId);
    const expected = await tx.client.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM (${FORECAST_SQL}) f
        WHERE f.quantity_remaining > 0
          AND ($1::uuid IS NULL OR f.entity_id = $1)`,
      [entityId],
    );
    const quarantined = await this.quarantineLinesInTx(tx, entityId);
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
      `SELECT f.line_id AS id, f.procurement_reference, f.required_date::text, f.quantity_remaining::text
         FROM (${FORECAST_SQL}) f
        WHERE f.quantity_remaining > 0
          AND f.required_date IS NOT NULL AND f.required_date < CURRENT_DATE
          AND ($1::uuid IS NULL OR f.entity_id = $1)
        ORDER BY f.required_date
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
    const expiry = await this.expiryCountsInTx(tx, entityId);
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
        detail: `Available ${row.availableQty} ${row.uomCode}; reorder ${row.reorderLevel}`,
      })),
      ...quarantined.slice(0, 8).map((line) => ({
        kind: 'pending_qc' as const,
        label: `${line.itemCode} — ${line.itemName}`,
        href: '/inventory/qc',
        detail: `${line.quantity} ${line.uomCode} quarantined · ${
          line.grnReference ?? line.productionReference ?? line.returnReference ?? line.warehouseName
        }`,
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
      ...expiry.attention,
    ];
    return {
      consolidated: entityId === null,
      entityId,
      entityCode,
      itemCount: rows.length,
      onHandValueKobo: rows.reduce((sum, row) => sum + row.onHandValueKobo, 0),
      expectedLines: Number(expected.rows[0]?.n ?? 0),
      quarantinedLines: quarantined.length,
      lowStockCount: lowRows.length,
      outOfStockCount: outRows.length,
      reservedSalesLines: Number(reserved.rows[0]?.n ?? 0),
      inTransitCount: Number(inTransit.rows[0]?.n ?? 0),
      inTransitValueKobo: Number(inTransit.rows[0]?.val ?? 0),
      pendingAdjustments: Number(pending.rows[0]?.n ?? 0),
      openProductionOrders: Number(openPrd.rows[0]?.n ?? 0),
      damagedOrExpiredPending: Number(pending.rows[0]?.damaged ?? 0),
      expiredBatchCount: expiry.expired,
      nearExpiryBatchCount: expiry.near,
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
      released: string;
      quarantined: string;
      rejected: string;
      on_hand_value: string;
      reserved: string;
      wip: string;
      incoming: string;
      status: InventoryItemListView['status'];
      row_version: number;
    }>(
      `SELECT i.id, i.entity_id, e.code AS entity_code, i.code, i.name, i.category_id, c.name AS category_name,
              u.code AS uom_code, i.tracking_mode, i.asset, i.reorder_level::text,
              coalesce(m.qty, 0)::text AS on_hand,
              coalesce(m.released, 0)::text AS released,
              coalesce(m.quarantined, 0)::text AS quarantined,
              coalesce(m.rejected, 0)::text AS rejected,
              coalesce(m.val, 0)::text AS on_hand_value,
              coalesce(r.reserved, 0)::text AS reserved,
              coalesce(wip.qty, 0)::text AS wip,
              coalesce(fc.qty, 0)::text AS incoming,
              i.status, i.row_version
         FROM inventory_items i
         JOIN entities e ON e.id = i.entity_id
         JOIN inventory_categories c ON c.id = i.category_id
         JOIN units_of_measure u ON u.id = i.uom_id
         LEFT JOIN (
           SELECT item_id,
                  sum(quantity_in - quantity_out) AS qty,
                  sum(quantity_in - quantity_out) FILTER (WHERE stock_status = 'AVAILABLE') AS released,
                  sum(quantity_in - quantity_out) FILTER (WHERE stock_status = 'QUARANTINED') AS quarantined,
                  sum(quantity_in - quantity_out) FILTER (WHERE stock_status = 'REJECTED') AS rejected,
                  sum(value_kobo) AS val
             FROM stock_movements
            WHERE ($4::uuid IS NULL OR warehouse_id = $4)
            GROUP BY item_id
         ) m ON m.item_id = i.id
         LEFT JOIN (
           SELECT item_id, sum(quantity) AS reserved
             FROM stock_reservations
            WHERE status = 'OPEN' AND ($4::uuid IS NULL OR warehouse_id = $4)
            GROUP BY item_id
         ) r ON r.item_id = i.id
         LEFT JOIN (
           SELECT pi.item_id, sum(coalesce(pi.actual_qty, 0)) AS qty
             FROM production_order_inputs pi
             JOIN production_orders po ON po.id = pi.order_id
            WHERE po.status IN ('IN_PROGRESS', 'AWAITING_APPROVAL')
              AND ($4::uuid IS NULL OR po.warehouse_id = $4)
            GROUP BY pi.item_id
         ) wip ON wip.item_id = i.id
         LEFT JOIN (
           SELECT f.item_id, sum(f.quantity_remaining) AS qty
             FROM (${FORECAST_SQL}) f
            WHERE f.item_id IS NOT NULL
            GROUP BY f.item_id
         ) fc ON fc.item_id = i.id
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
        const availableQty = Number(row.released) - reservedQty;
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
          availableQty,
          quarantinedQty: Number(row.quarantined),
          rejectedQty: Number(row.rejected),
          wipQty: Number(row.wip),
          incomingQty: Number(row.incoming),
          onHandValueKobo: Number(row.on_hand_value),
          belowReorder: availableQty > 0 && availableQty <= reorderLevel,
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
      stock_status: StockStatus;
    }>(
      `SELECT m.id, m.reference_number, m.item_id, i.code AS item_code, i.name AS item_name, e.code AS entity_code,
              w.name AS warehouse_name, m.quantity_in::text, m.quantity_out::text, m.unit_cost_kobo::text,
              m.value_kobo::text, m.source, m.procurement_request_id, pr.reference_number AS procurement_reference,
              m.grn_id, g.reference_number AS grn_reference, m.occurred_on::text, m.created_by, m.notes,
              m.stock_status
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
      stockStatus: row.stock_status,
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

  private async locationsInTx(tx: TxScope, entityId: string | null): Promise<WarehouseLocationView[]> {
    const result = await tx.client.query<WarehouseLocationView>(
      `SELECT l.id, l.entity_id AS "entityId", l.warehouse_id AS "warehouseId",
              w.code AS "warehouseCode", w.name AS "warehouseName",
              l.code, l.name, l.status, l.row_version AS "rowVersion"
         FROM warehouse_locations l
         JOIN warehouses w ON w.id = l.warehouse_id
        WHERE ($1::uuid IS NULL OR l.entity_id = $1)
        ORDER BY w.code, l.code`,
      [entityId],
    );
    return result.rows;
  }

  async loadItemPublic(tx: TxScope, id: string): ReturnType<InventoryService['loadItem']> {
    return this.loadItem(tx, id);
  }

  /** Quarantined balances grouped by origin (GRN, production order or desk return). */
  async quarantineLinesInTx(tx: TxScope, entityId: string | null): Promise<QuarantineLineView[]> {
    const result = await tx.client.query<{
      entity_id: string;
      item_id: string;
      item_code: string;
      item_name: string;
      uom_code: string;
      warehouse_id: string;
      warehouse_name: string;
      batch_id: string | null;
      batch_code: string | null;
      serial_id: string | null;
      serial_code: string | null;
      qty: string;
      grn_id: string | null;
      grn_reference: string | null;
      procurement_request_id: string | null;
      procurement_reference: string | null;
      production_order_id: string | null;
      production_reference: string | null;
      return_id: string | null;
      return_reference: string | null;
    }>(
      `WITH q AS (
         SELECT m.entity_id, m.item_id, m.warehouse_id, m.batch_id, m.serial_id,
                coalesce(m.grn_id, d.grn_id) AS grn_id,
                coalesce(m.procurement_request_id, d.procurement_request_id) AS procurement_request_id,
                CASE WHEN m.source = 'PRODUCTION' THEN m.source_id ELSE d.production_order_id END AS production_order_id,
                CASE WHEN m.source = 'RETURN_IN' THEN m.source_id ELSE d.return_id END AS return_id,
                m.quantity_in - m.quantity_out AS qty
           FROM stock_movements m
           LEFT JOIN stock_qc_decisions d ON m.source = 'QC' AND d.id = m.source_id
          WHERE m.stock_status = 'QUARANTINED'
            AND ($1::uuid IS NULL OR m.entity_id = $1)
       )
       SELECT q.entity_id, q.item_id, i.code AS item_code, i.name AS item_name, u.code AS uom_code,
              q.warehouse_id, w.name AS warehouse_name, q.batch_id, b.batch_code, q.serial_id, s.serial_code,
              sum(q.qty)::text AS qty,
              q.grn_id, g.reference_number AS grn_reference,
              q.procurement_request_id, pr.reference_number AS procurement_reference,
              q.production_order_id, po.reference_number AS production_reference,
              q.return_id, rt.reference_number AS return_reference
         FROM q
         JOIN inventory_items i ON i.id = q.item_id
         JOIN units_of_measure u ON u.id = i.uom_id
         JOIN warehouses w ON w.id = q.warehouse_id
         LEFT JOIN stock_batches b ON b.id = q.batch_id
         LEFT JOIN stock_serials s ON s.id = q.serial_id
         LEFT JOIN procurement_goods_receipts g ON g.id = q.grn_id
         LEFT JOIN procurement_requests pr ON pr.id = q.procurement_request_id
         LEFT JOIN production_orders po ON po.id = q.production_order_id
         LEFT JOIN stock_returns rt ON rt.id = q.return_id
        GROUP BY q.entity_id, q.item_id, i.code, i.name, u.code, q.warehouse_id, w.name, q.batch_id, b.batch_code,
                 q.serial_id, s.serial_code, q.grn_id, g.reference_number, q.procurement_request_id,
                 pr.reference_number, q.production_order_id, po.reference_number, q.return_id, rt.reference_number
       HAVING sum(q.qty) > 0
        ORDER BY i.code`,
      [entityId],
    );
    return result.rows.map((row) => ({
      entityId: row.entity_id,
      itemId: row.item_id,
      itemCode: row.item_code,
      itemName: row.item_name,
      uomCode: row.uom_code,
      warehouseId: row.warehouse_id,
      warehouseName: row.warehouse_name,
      batchId: row.batch_id,
      batchCode: row.batch_code,
      serialId: row.serial_id,
      serialCode: row.serial_code,
      quantity: Number(row.qty),
      grnId: row.grn_id,
      grnReference: row.grn_reference,
      procurementId: row.procurement_request_id,
      procurementReference: row.procurement_reference,
      productionOrderId: row.production_order_id,
      productionReference: row.production_reference,
      returnId: row.return_id,
      returnReference: row.return_reference,
    }));
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
      locationId?: string | null;
      stockStatus?: StockStatus;
    },
  ): Promise<string> {
    const stockStatus = input.stockStatus ?? 'AVAILABLE';
    if (input.quantityOut > 0 && input.batchId) {
      await this.assertOrdinaryOutboundBatch(tx, input.source, stockStatus, input.batchId);
    }
    if (input.quantityOut > 0) {
      const usable =
        stockStatus === 'AVAILABLE'
          ? await this.available(tx, input.itemId, input.warehouseId)
          : await this.statusQty(tx, input.itemId, input.warehouseId, stockStatus);
      if (usable + 1e-9 < input.quantityOut) {
        throw new ValidationFailedError(
          stockStatus === 'AVAILABLE'
            ? 'There is not enough available stock for this movement.'
            : `There is not enough ${stockStatus.toLowerCase()} stock for this movement.`,
        );
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
         notes, occurred_on, created_by, location_id, stock_status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
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
        input.locationId ?? null,
        stockStatus,
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
        | 'INVENTORY_RETURN'
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
      /** Equipment leaves 1500 rather than the rule's stock account. */
      creditAccountCode?: string;
    },
  ): Promise<void> {
    if (!this.ledger || input.amountKobo <= 0) return;
    const rule = await tx.client.query<{ debit_account_code: string; credit_account_code: string }>(
      `SELECT debit_account_code, credit_account_code FROM inventory_posting_rules WHERE movement_kind = $1`,
      [input.ruleKind],
    );
    const debitCode = rule.rows[0]?.debit_account_code;
    const creditCode = input.creditAccountCode ?? rule.rows[0]?.credit_account_code;
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

  async statusQty(tx: TxScope, itemId: string, warehouseId: string, status: StockStatus): Promise<number> {
    const result = await tx.client.query<{ n: string }>(
      `SELECT coalesce(sum(quantity_in - quantity_out), 0)::text AS n
         FROM stock_movements WHERE item_id = $1 AND warehouse_id = $2 AND stock_status = $3`,
      [itemId, warehouseId, status],
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  /** Released stock less open reservations. Quarantined and rejected stock is never available. */
  async available(tx: TxScope, itemId: string, warehouseId: string): Promise<number> {
    return (
      (await this.statusQty(tx, itemId, warehouseId, 'AVAILABLE')) - (await this.reservedQty(tx, itemId, warehouseId))
    );
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
    input: {
      entityId: string;
      itemId: string;
      warehouseId: string;
      batchCode: string;
      manufacturedOn?: string | null;
      expiresOn?: string | null;
    },
  ): Promise<string> {
    const existing = await tx.client.query<{ id: string }>(
      `SELECT id FROM stock_batches WHERE item_id = $1 AND warehouse_id = $2 AND batch_code = $3`,
      [input.itemId, input.warehouseId, input.batchCode],
    );
    if (existing.rows[0]) return existing.rows[0].id;
    if (input.manufacturedOn && input.expiresOn && input.expiresOn < input.manufacturedOn) {
      throw new ValidationFailedError('Expiry cannot be earlier than the manufacturing date.');
    }
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO stock_batches (
         entity_id, item_id, warehouse_id, batch_code, manufactured_on, expires_on, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        input.entityId,
        input.itemId,
        input.warehouseId,
        input.batchCode,
        input.manufacturedOn ?? null,
        input.expiresOn ?? null,
        actor.ref,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('The batch was not created.');
    return id;
  }

  async updateBatch(actor: ActorContext, id: string, input: UpdateBatchInput): Promise<StockBatchListView> {
    const updatedId = await this.unitOfWork.write(actor, async (tx) => {
      const row = await tx.client.query<{ id: string; entity_id: string; manufactured_on: string | null; expires_on: string | null }>(
        `SELECT id, entity_id, manufactured_on::text, expires_on::text FROM stock_batches WHERE id = $1`,
        [id],
      );
      const batch = row.rows[0];
      if (!batch) throw new NotFoundError('That batch was not found.');
      assertCan(actor, 'inventory.item.manage', batch.entity_id);
      const manufacturedOn =
        input.manufacturedOn === undefined ? isoDate(batch.manufactured_on) : input.manufacturedOn;
      const expiresOn = input.expiresOn === undefined ? isoDate(batch.expires_on) : input.expiresOn;
      if (manufacturedOn && expiresOn && expiresOn < manufacturedOn) {
        throw new ValidationFailedError('Expiry cannot be earlier than the manufacturing date.');
      }
      await tx.client.query(`UPDATE stock_batches SET manufactured_on = $1, expires_on = $2 WHERE id = $3`, [
        manufacturedOn,
        expiresOn,
        id,
      ]);
      await tx.audit({
        action: 'edit',
        subjectType: 'stock_batch',
        subjectId: id,
        subjectLabel: id,
        entityId: batch.entity_id,
        newValue: { manufacturedOn, expiresOn },
      });
      return id;
    });
    const list = await this.listBatches(actor);
    const view = list.find((row) => row.id === updatedId);
    if (!view) throw new NotFoundError('That batch was not found.');
    return view;
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
              coalesce((SELECT sum(quantity_in - quantity_out) FROM stock_movements
                         WHERE item_id = i.id AND stock_status = 'AVAILABLE'), 0)::text AS qty
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
        summary: `Available ${row.qty}; reorder ${row.reorder_level}.`,
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

  async todayIso(tx: TxScope): Promise<string> {
    const result = await tx.client.query<{ d: string }>(`SELECT CURRENT_DATE::text AS d`);
    return result.rows[0]?.d ?? new Date().toISOString().slice(0, 10);
  }

  private async assertOrdinaryOutboundBatch(
    tx: TxScope,
    source: string,
    stockStatus: StockStatus,
    batchId: string,
  ): Promise<void> {
    if (!ORDINARY_OUTBOUND_SOURCES.has(source) || stockStatus !== 'AVAILABLE') return;
    const expired = await tx.client.query<{ id: string }>(
      `SELECT id FROM stock_batches WHERE id = $1 AND expires_on IS NOT NULL AND expires_on < CURRENT_DATE`,
      [batchId],
    );
    if (expired.rows[0]) {
      throw new ValidationFailedError(
        'That batch has expired and cannot be issued, dispatched or used in production.',
      );
    }
  }

  private async expiryCountsInTx(
    tx: TxScope,
    entityId: string | null,
  ): Promise<{ expired: number; near: number; attention: InventoryAttentionItem[] }> {
    const warningDays = await this.settingValue(tx, 'expiry_warning_days');
    const result = await tx.client.query<{
      item_code: string;
      item_name: string;
      batch_code: string;
      warehouse_name: string;
      qty: string;
      expires_on: string;
      expired: boolean;
    }>(
      `SELECT i.code AS item_code, i.name AS item_name, b.batch_code, w.name AS warehouse_name,
              coalesce((SELECT sum(m.quantity_in - m.quantity_out) FROM stock_movements m WHERE m.batch_id = b.id), 0)::text AS qty,
              b.expires_on::text,
              (b.expires_on < CURRENT_DATE) AS expired
         FROM stock_batches b
         JOIN inventory_items i ON i.id = b.item_id
         JOIN warehouses w ON w.id = b.warehouse_id
        WHERE b.expires_on IS NOT NULL
          AND ($1::uuid IS NULL OR b.entity_id = $1)
          AND (
            b.expires_on < CURRENT_DATE
            OR ($2::int IS NOT NULL AND b.expires_on <= CURRENT_DATE + ($2::int * interval '1 day'))
          )
        ORDER BY b.expires_on, i.code
        LIMIT 40`,
      [entityId, warningDays],
    );
    const expiredRows = result.rows.filter((row) => row.expired);
    const nearRows = result.rows.filter((row) => !row.expired);
    return {
      expired: expiredRows.length,
      near: nearRows.length,
      attention: [
        ...expiredRows.slice(0, 8).map((row) => ({
          kind: 'expired' as const,
          label: `${row.item_code} · ${row.batch_code}`,
          href: '/inventory/batches',
          detail: `Expired ${row.expires_on} · ${row.qty} at ${row.warehouse_name}`,
        })),
        ...nearRows.slice(0, 8).map((row) => ({
          kind: 'near_expiry' as const,
          label: `${row.item_code} · ${row.batch_code}`,
          href: '/inventory/batches',
          detail: `Expires ${row.expires_on} · ${row.qty} at ${row.warehouse_name}`,
        })),
      ],
    };
  }

  /**
   * Remaining supplier-returnable quantity for one GRN/item/batch/warehouse/status.
   * Uses Q/R ledger movements, never the GRN header total.
   */
  async supplierRemainingInTx(
    tx: TxScope,
    input: {
      itemId: string;
      warehouseId: string;
      fromStatus: Extract<StockStatus, 'QUARANTINED' | 'REJECTED'>;
      batchId: string | null;
      serialId: string | null;
      grnId: string | null;
    },
  ): Promise<number> {
    const keyed = await tx.client.query<{ n: string }>(
      `SELECT coalesce(sum(quantity_in - quantity_out), 0)::text AS n
         FROM stock_movements
        WHERE item_id = $1 AND warehouse_id = $2 AND stock_status = $3
          AND batch_id IS NOT DISTINCT FROM $4
          AND serial_id IS NOT DISTINCT FROM $5
          AND ($6::uuid IS NULL OR grn_id IS NOT DISTINCT FROM $6)`,
      [input.itemId, input.warehouseId, input.fromStatus, input.batchId, input.serialId, input.grnId],
    );
    const physical = await tx.client.query<{ n: string }>(
      `SELECT coalesce(sum(quantity_in - quantity_out), 0)::text AS n
         FROM stock_movements
        WHERE item_id = $1 AND warehouse_id = $2 AND stock_status = $3
          AND batch_id IS NOT DISTINCT FROM $4
          AND serial_id IS NOT DISTINCT FROM $5`,
      [input.itemId, input.warehouseId, input.fromStatus, input.batchId, input.serialId],
    );
    return Math.min(Number(keyed.rows[0]?.n ?? 0), Number(physical.rows[0]?.n ?? 0));
  }

  async supplierReturnableInTx(tx: TxScope, entityId: string | null): Promise<SupplierReturnableLineView[]> {
    const result = await tx.client.query<{
      item_id: string;
      item_code: string;
      item_name: string;
      uom_code: string;
      warehouse_id: string;
      warehouse_name: string;
      batch_id: string | null;
      batch_code: string | null;
      serial_id: string | null;
      serial_code: string | null;
      from_status: 'QUARANTINED' | 'REJECTED';
      remaining: string;
      vendor_id: string | null;
      vendor_name: string | null;
      grn_id: string | null;
      grn_reference: string | null;
    }>(
      `SELECT m.item_id, i.code AS item_code, i.name AS item_name, u.code AS uom_code,
              m.warehouse_id, w.name AS warehouse_name, m.batch_id, b.batch_code,
              m.serial_id, s.serial_code, m.stock_status AS from_status,
              sum(m.quantity_in - m.quantity_out)::text AS remaining,
              r.vendor_id, v.legal_name AS vendor_name, m.grn_id, g.reference_number AS grn_reference
         FROM stock_movements m
         JOIN inventory_items i ON i.id = m.item_id
         JOIN units_of_measure u ON u.id = i.uom_id
         JOIN warehouses w ON w.id = m.warehouse_id
         LEFT JOIN stock_batches b ON b.id = m.batch_id
         LEFT JOIN stock_serials s ON s.id = m.serial_id
         LEFT JOIN procurement_goods_receipts g ON g.id = m.grn_id
         LEFT JOIN procurement_requests r ON r.id = coalesce(m.procurement_request_id, g.request_id)
         LEFT JOIN vendors v ON v.id = r.vendor_id
        WHERE m.stock_status IN ('QUARANTINED', 'REJECTED')
          AND ($1::uuid IS NULL OR m.entity_id = $1)
        GROUP BY m.item_id, i.code, i.name, u.code, m.warehouse_id, w.name, m.batch_id, b.batch_code,
                 m.serial_id, s.serial_code, m.stock_status, r.vendor_id, v.legal_name, m.grn_id, g.reference_number
       HAVING sum(m.quantity_in - m.quantity_out) > 0
        ORDER BY i.code, w.name, g.reference_number NULLS LAST`,
      [entityId],
    );
    return result.rows.map((row) => ({
      itemId: row.item_id,
      itemCode: row.item_code,
      itemName: row.item_name,
      uomCode: row.uom_code,
      warehouseId: row.warehouse_id,
      warehouseName: row.warehouse_name,
      batchId: row.batch_id,
      batchCode: row.batch_code,
      serialId: row.serial_id,
      serialCode: row.serial_code,
      fromStatus: row.from_status,
      remainingQty: Number(row.remaining),
      vendorId: row.vendor_id,
      vendorName: row.vendor_name,
      grnId: row.grn_id,
      grnReference: row.grn_reference,
    }));
  }

  async receiveReturnRemainingInTx(tx: TxScope, issueLineId: string): Promise<number> {
    const result = await tx.client.query<{ remaining: string }>(
      `SELECT (l.quantity - coalesce((
          SELECT sum(rl.quantity) FROM stock_return_lines rl
           JOIN stock_returns r ON r.id = rl.return_id
          WHERE rl.issue_line_id = l.id AND r.kind = 'RECEIVE_RETURN'
        ), 0))::text AS remaining
         FROM stock_issue_lines l WHERE l.id = $1`,
      [issueLineId],
    );
    if (!result.rows[0]) throw new NotFoundError('That issue line was not found.');
    return Number(result.rows[0].remaining);
  }
}
