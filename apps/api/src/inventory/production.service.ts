import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { ProductionOrderStatus, ProductionOrderView } from '@nfc/shared';
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
import { WorkflowsService } from '../workflows/workflows.service';
import type {
  CancelProductionInput,
  CompleteProductionInput,
  CreateProductionInput,
  StartProductionInput,
} from './inventory.dto';
import { InventoryService } from './inventory.service';

@Injectable()
export class ProductionService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly inventory: InventoryService,
    @Optional() @Inject(forwardRef(() => WorkflowsService)) private readonly workflows?: WorkflowsService,
  ) {}

  async list(actor: ActorContext, entityId?: string): Promise<ProductionOrderView[]> {
    const scoped = this.inventory.assertListScope(actor, entityId, 'sales.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT id FROM production_orders WHERE ($1::uuid IS NULL OR entity_id = $1) ORDER BY created_at DESC`,
        [scoped],
      );
      return Promise.all(ids.rows.map((row) => this.view(tx, row.id)));
    });
  }

  async get(actor: ActorContext, id: string): Promise<ProductionOrderView> {
    return this.unitOfWork.read(actor, async (tx) => {
      const view = await this.view(tx, id);
      assertCan(actor, 'sales.view', view.entityId);
      return view;
    });
  }

  async create(actor: ActorContext, input: CreateProductionInput): Promise<ProductionOrderView> {
    assertCan(actor, 'production.create', input.entityId);
    const id = await this.unitOfWork.write(actor, async (tx) => {
      const finished = await this.requireItem(tx, input.finishedItemId, input.entityId);
      const ref = await this.inventory.nextRef(tx, 'PRD');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO production_orders (
           reference_number, entity_id, warehouse_id, finished_item_id, planned_output_qty,
           created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING id`,
        [ref, input.entityId, input.warehouseId, input.finishedItemId, input.plannedOutputQty, actor.ref],
      );
      const orderId = inserted.rows[0]?.id;
      if (!orderId) throw new Error('The production order was not created.');
      await tx.client.query(
        `INSERT INTO production_order_outputs (
           order_id, entity_id, item_id, warehouse_id, planned_qty, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [orderId, input.entityId, input.finishedItemId, input.warehouseId, input.plannedOutputQty, actor.ref],
      );
      for (const line of input.inputs) {
        await this.requireItem(tx, line.itemId, input.entityId);
        const warehouseId = line.warehouseId ?? input.warehouseId;
        let batchId: string | null = null;
        if (line.batchCode) {
          batchId = await this.inventory.ensureBatch(tx, actor, {
            entityId: input.entityId,
            itemId: line.itemId,
            warehouseId,
            batchCode: line.batchCode,
          });
        }
        await tx.client.query(
          `INSERT INTO production_order_inputs (
             order_id, entity_id, item_id, warehouse_id, batch_id, planned_qty, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
          [orderId, input.entityId, line.itemId, warehouseId, batchId, line.plannedQty, actor.ref],
        );
      }
      await tx.indexSearch({
        recordType: 'PRODUCTION_ORDER',
        recordId: orderId,
        referenceNumber: ref,
        title: `Production ${ref} ${finished.code}`,
        searchableText: `${ref} ${finished.code} ${finished.name}`,
        entityId: input.entityId,
        permissionKey: 'sales.view',
      });
      await tx.audit({
        action: 'create',
        subjectType: 'production_order',
        subjectId: orderId,
        subjectLabel: ref,
        subjectReferenceNumber: ref,
        entityId: input.entityId,
      });
      return orderId;
    });
    return this.get(actor, id);
  }

  async start(actor: ActorContext, id: string, input: StartProductionInput): Promise<ProductionOrderView> {
    await this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lock(tx, id);
      assertCan(actor, 'production.create', current.entity_id);
      this.assertVersion(current.row_version, input.rowVersion);
      if (current.status !== 'PLANNED') {
        throw new ConflictError('Only a planned production order can be started.');
      }
      const occurredOn = input.occurredOn ?? new Date().toISOString().slice(0, 10);
      const lines = await tx.client.query<{
        id: string;
        item_id: string;
        warehouse_id: string;
        planned_qty: string;
        batch_id: string | null;
      }>(
        `SELECT id, item_id, warehouse_id, planned_qty::text, batch_id FROM production_order_inputs WHERE order_id = $1`,
        [id],
      );
      let rmValue = 0;
      let firstMovementId: string | null = null;
      for (const line of lines.rows) {
        const override = input.inputs?.find((row) => row.id === line.id || row.itemId === line.item_id);
        const actualQty = override?.actualQty ?? Number(line.planned_qty);
        const tracking = await this.inventory.resolveTracking(tx, actor, {
          entityId: current.entity_id,
          itemId: line.item_id,
          warehouseId: line.warehouse_id,
          batchCode: override?.batchCode,
          outbound: true,
        });
        const batchId =
          tracking.batchId ??
          (override?.batchCode
            ? await this.inventory.ensureBatch(tx, actor, {
                entityId: current.entity_id,
                itemId: line.item_id,
                warehouseId: line.warehouse_id,
                batchCode: override.batchCode,
              })
            : line.batch_id);
        const cost = await this.inventory.averageCost(tx, line.item_id, line.warehouse_id);
        const available = await this.inventory.available(tx, line.item_id, line.warehouse_id);
        if (available + 1e-9 < actualQty) {
          throw new ValidationFailedError('There is not enough available stock to start this order.');
        }
        const movementId = await this.inventory.insertMovement(tx, actor, {
          entityId: current.entity_id,
          itemId: line.item_id,
          warehouseId: line.warehouse_id,
          batchId,
          serialId: tracking.serialId,
          quantityIn: 0,
          quantityOut: actualQty,
          unitCostKobo: cost,
          source: 'PRODUCTION',
          sourceId: id,
          occurredOn,
          notes: `Consume ${current.reference_number}`,
        });
        await tx.client.query(
          `UPDATE production_order_inputs
              SET actual_qty = $1, unit_cost_kobo = $2, batch_id = $3, movement_id = $4, updated_by = $5
            WHERE id = $6`,
          [actualQty, cost, batchId, movementId, actor.ref, line.id],
        );
        rmValue += Math.round(cost * actualQty);
        firstMovementId ??= movementId;
        await this.inventory.maybeLowStock(tx, actor, line.item_id);
      }
      await this.inventory.postMovement(tx, actor, {
        movementId: firstMovementId,
        entityId: current.entity_id,
        occurredOn,
        amountKobo: rmValue,
        ruleKind: 'production_wip',
        source: 'PRODUCTION_WIP',
        idempotencyKey: `prd-wip:${id}`,
        narration: `WIP ${current.reference_number}`,
      });
      await tx.client.query(
        `UPDATE production_orders SET status = 'IN_PROGRESS', updated_by = $1 WHERE id = $2`,
        [actor.ref, id],
      );
    });
    return this.get(actor, id);
  }

  async submitComplete(
    actor: ActorContext,
    id: string,
    input: CompleteProductionInput,
  ): Promise<ProductionOrderView> {
    await this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lock(tx, id);
      assertCan(actor, 'production.complete', current.entity_id);
      this.assertVersion(current.row_version, input.rowVersion);
      if (current.status !== 'IN_PROGRESS') {
        throw new ConflictError('Complete a production order after it has started.');
      }
      if (input.wasteQty > 0 && !input.wasteReason?.trim()) {
        throw new ValidationFailedError('A reason is required when recording waste.');
      }
      const instance = await this.workflows?.startProductionCompleteInTx(tx, actor, { orderId: id });
      await tx.client.query(
        `UPDATE production_orders
            SET actual_output_qty = $1,
                waste_qty = $2,
                waste_reason = $3,
                produced_on = $4,
                status = 'AWAITING_APPROVAL',
                workflow_instance_id = $5,
                updated_by = $6
          WHERE id = $7`,
        [
          input.actualOutputQty,
          input.wasteQty,
          input.wasteReason?.trim() || null,
          input.producedOn,
          instance?.id ?? null,
          actor.ref,
          id,
        ],
      );
      await tx.client.query(
        `UPDATE production_order_outputs
            SET actual_qty = $1, updated_by = $2
          WHERE order_id = $3`,
        [input.actualOutputQty, actor.ref, id],
      );
      const tracking = await this.inventory.resolveTracking(tx, actor, {
        entityId: current.entity_id,
        itemId: current.finished_item_id,
        warehouseId: current.warehouse_id,
        batchCode: input.finishedBatchCode,
        outbound: false,
      });
      const batchId =
        tracking.batchId ??
        (await this.inventory.ensureBatch(tx, actor, {
          entityId: current.entity_id,
          itemId: current.finished_item_id,
          warehouseId: current.warehouse_id,
          batchCode: input.finishedBatchCode,
        }));
      await tx.client.query(
        `UPDATE production_orders SET finished_batch_id = $1, updated_by = $2 WHERE id = $3`,
        [batchId, actor.ref, id],
      );
      await tx.client.query(
        `UPDATE production_order_outputs SET batch_id = $1, updated_by = $2 WHERE order_id = $3`,
        [batchId, actor.ref, id],
      );
    });
    return this.get(actor, id);
  }

  async cancel(actor: ActorContext, id: string, input: CancelProductionInput): Promise<ProductionOrderView> {
    await this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lock(tx, id);
      assertCan(actor, 'production.create', current.entity_id);
      this.assertVersion(current.row_version, input.rowVersion);
      if (current.status !== 'PLANNED' && current.status !== 'IN_PROGRESS') {
        throw new ConflictError('A completed production order cannot be cancelled.');
      }
      if (current.status === 'IN_PROGRESS') {
        await this.reverseConsume(tx, actor, current);
      }
      await tx.client.query(
        `UPDATE production_orders
            SET status = 'CANCELLED', cancel_reason = $1, updated_by = $2
          WHERE id = $3`,
        [input.reason.trim(), actor.ref, id],
      );
    });
    return this.get(actor, id);
  }

  async completeOnApproveInTx(tx: TxScope, actor: ActorContext, orderId: string): Promise<void> {
    const current = await this.lock(tx, orderId);
    if (current.status === 'COMPLETED') return;
    if (current.status !== 'AWAITING_APPROVAL') {
      throw new ConflictError('This production order is not awaiting approval.');
    }
    if (current.created_by === actor.ref) {
      throw new ForbiddenError('The preparer cannot approve this production order.');
    }
    if (!can(actor, 'production.approve', current.entity_id)) {
      throw new ForbiddenError('You cannot approve this production order.');
    }
    const inputs = await tx.client.query<{
      item_id: string;
      warehouse_id: string;
      batch_id: string | null;
      actual_qty: string;
      unit_cost_kobo: string;
    }>(
      `SELECT item_id, warehouse_id, batch_id, coalesce(actual_qty, 0)::text AS actual_qty,
              coalesce(unit_cost_kobo, 0)::text AS unit_cost_kobo
         FROM production_order_inputs WHERE order_id = $1`,
      [orderId],
    );
    const rmValue = inputs.rows.reduce(
      (sum, row) => sum + Math.round(Number(row.unit_cost_kobo) * Number(row.actual_qty)),
      0,
    );
    const actualOutput = Number(current.actual_output_qty ?? 0);
    const wasteQty = Number(current.waste_qty ?? 0);
    if (actualOutput <= 0) throw new ValidationFailedError('Actual output is required to complete production.');
    const totalUnits = actualOutput + wasteQty;
    const wasteValue = totalUnits > 0 ? Math.round((rmValue * wasteQty) / totalUnits) : 0;
    const occurredOn = current.produced_on ?? new Date().toISOString().slice(0, 10);
    if (wasteValue > 0) {
      await this.inventory.postMovement(tx, actor, {
        movementId: null,
        entityId: current.entity_id,
        occurredOn,
        amountKobo: wasteValue,
        ruleKind: 'production_waste',
        source: 'PRODUCTION_WASTE',
        idempotencyKey: `prd-waste:${orderId}`,
        narration: `Waste ${current.reference_number}`,
      });
    }
    const overhead = await this.overheadKobo(tx, current.entity_id, current.finished_item_id, actualOutput, rmValue);
    if (overhead > 0) {
      await this.inventory.postMovement(tx, actor, {
        movementId: null,
        entityId: current.entity_id,
        occurredOn,
        amountKobo: overhead,
        ruleKind: 'production_overhead',
        source: 'PRODUCTION_OVERHEAD',
        idempotencyKey: `prd-oh:${orderId}`,
        narration: `Overhead ${current.reference_number}`,
      });
    }
    const fgValue = rmValue - wasteValue + overhead;
    const unitCost = Math.round(fgValue / actualOutput);
    const batchId = current.finished_batch_id;
    const movementId = await this.inventory.insertMovement(tx, actor, {
      entityId: current.entity_id,
      itemId: current.finished_item_id,
      warehouseId: current.warehouse_id,
      batchId,
      serialId: null,
      quantityIn: actualOutput,
      quantityOut: 0,
      unitCostKobo: unitCost,
      source: 'PRODUCTION',
      sourceId: orderId,
      occurredOn,
      notes: `Output ${current.reference_number}`,
    });
    await this.inventory.postMovement(tx, actor, {
      movementId,
      entityId: current.entity_id,
      occurredOn,
      amountKobo: fgValue,
      ruleKind: 'production_fg',
      source: 'PRODUCTION_OUTPUT',
      idempotencyKey: `prd-fg:${orderId}`,
      narration: `Finished goods ${current.reference_number}`,
    });
    await tx.client.query(
      `UPDATE production_order_outputs
          SET actual_qty = $1, unit_cost_kobo = $2, batch_id = $3, movement_id = $4, updated_by = $5
        WHERE order_id = $6`,
      [actualOutput, unitCost, batchId, movementId, actor.ref, orderId],
    );
    if (batchId) {
      for (const row of inputs.rows) {
        if (!row.batch_id || Number(row.actual_qty) <= 0) continue;
        await tx.client.query(
          `INSERT INTO production_batch_links (
             entity_id, order_id, finished_batch_id, raw_batch_id, quantity, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [current.entity_id, orderId, batchId, row.batch_id, Number(row.actual_qty), actor.ref],
        );
      }
    }
    const yieldPct = Number(current.planned_output_qty) > 0 ? actualOutput / Number(current.planned_output_qty) : null;
    await tx.client.query(
      `UPDATE production_orders
          SET status = 'COMPLETED', yield_pct = $1, updated_by = $2
        WHERE id = $3`,
      [yieldPct, actor.ref, orderId],
    );
  }

  async rejectInTx(tx: TxScope, actor: ActorContext, orderId: string): Promise<void> {
    const current = await this.lock(tx, orderId);
    if (current.status !== 'AWAITING_APPROVAL') return;
    await tx.client.query(
      `UPDATE production_orders SET status = 'IN_PROGRESS', updated_by = $1 WHERE id = $2`,
      [actor.ref, orderId],
    );
  }

  private async reverseConsume(
    tx: TxScope,
    actor: ActorContext,
    current: {
      id: string;
      entity_id: string;
      reference_number: string;
      produced_on: string | null;
    },
  ): Promise<void> {
    const lines = await tx.client.query<{
      item_id: string;
      warehouse_id: string;
      batch_id: string | null;
      actual_qty: string;
      unit_cost_kobo: string;
      movement_id: string | null;
    }>(
      `SELECT item_id, warehouse_id, batch_id, coalesce(actual_qty, 0)::text AS actual_qty,
              coalesce(unit_cost_kobo, 0)::text AS unit_cost_kobo, movement_id
         FROM production_order_inputs WHERE order_id = $1 AND movement_id IS NOT NULL`,
      [current.id],
    );
    const occurredOn = current.produced_on ?? new Date().toISOString().slice(0, 10);
    let rmValue = 0;
    for (const line of lines.rows) {
      const qty = Number(line.actual_qty);
      const cost = Number(line.unit_cost_kobo);
      if (qty <= 0) continue;
      await this.inventory.insertMovement(tx, actor, {
        entityId: current.entity_id,
        itemId: line.item_id,
        warehouseId: line.warehouse_id,
        batchId: line.batch_id,
        serialId: null,
        quantityIn: qty,
        quantityOut: 0,
        unitCostKobo: cost,
        source: 'PRODUCTION',
        sourceId: current.id,
        reversesId: line.movement_id,
        occurredOn,
        notes: `Reverse consume ${current.reference_number}`,
      });
      rmValue += Math.round(cost * qty);
    }
    if (rmValue > 0) {
      await this.inventory.postMovement(tx, actor, {
        movementId: null,
        entityId: current.entity_id,
        occurredOn,
        amountKobo: rmValue,
        ruleKind: 'production_fg',
        source: 'PRODUCTION_WIP',
        idempotencyKey: `prd-wip-rev:${current.id}`,
        narration: `Reverse WIP ${current.reference_number}`,
      });
    }
  }

  private async overheadKobo(
    tx: TxScope,
    entityId: string,
    finishedItemId: string,
    actualOutput: number,
    rmValue: number,
  ): Promise<number> {
    const item = await tx.client.query<{ category_id: string }>(
      `SELECT category_id FROM inventory_items WHERE id = $1`,
      [finishedItemId],
    );
    const rule = await tx.client.query<{ method: string; rate: string }>(
      `SELECT method, rate::text
         FROM production_overhead_rules
        WHERE entity_id = $1 AND status = 'ACTIVE'
          AND (finished_item_id = $2 OR category_id = $3)
        ORDER BY CASE WHEN finished_item_id = $2 THEN 0 ELSE 1 END
        LIMIT 1`,
      [entityId, finishedItemId, item.rows[0]?.category_id ?? null],
    );
    const row = rule.rows[0];
    if (!row) return 0;
    const rate = Number(row.rate);
    if (row.method === 'per_output_kobo') return Math.round(rate * actualOutput);
    return Math.round((rmValue * rate) / 100);
  }

  private async view(tx: TxScope, id: string): Promise<ProductionOrderView> {
    const header = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      entity_code: string | null;
      warehouse_id: string;
      warehouse_name: string;
      finished_item_id: string;
      finished_item_code: string;
      finished_item_name: string;
      planned_output_qty: string;
      actual_output_qty: string | null;
      waste_qty: string;
      waste_reason: string | null;
      yield_pct: string | null;
      finished_batch_id: string | null;
      finished_batch_code: string | null;
      produced_on: string | null;
      status: ProductionOrderStatus;
      cancel_reason: string | null;
      workflow_instance_id: string | null;
      created_by: string;
      row_version: number;
    }>(
      `SELECT o.id, o.reference_number, o.entity_id, e.code AS entity_code, o.warehouse_id, w.name AS warehouse_name,
              o.finished_item_id, i.code AS finished_item_code, i.name AS finished_item_name,
              o.planned_output_qty::text, o.actual_output_qty::text, o.waste_qty::text, o.waste_reason,
              o.yield_pct::text, o.finished_batch_id, b.batch_code AS finished_batch_code,
              o.produced_on::text, o.status, o.cancel_reason, o.workflow_instance_id, o.created_by, o.row_version
         FROM production_orders o
         JOIN entities e ON e.id = o.entity_id
         JOIN warehouses w ON w.id = o.warehouse_id
         JOIN inventory_items i ON i.id = o.finished_item_id
         LEFT JOIN stock_batches b ON b.id = o.finished_batch_id
        WHERE o.id = $1`,
      [id],
    );
    const row = header.rows[0];
    if (!row) throw new NotFoundError('That production order was not found.');
    const inputs = await this.lines(tx, id, 'production_order_inputs');
    const outputs = await this.lines(tx, id, 'production_order_outputs');
    const links = await tx.client.query<{
      finished_batch_code: string;
      raw_batch_code: string;
      quantity: string;
    }>(
      `SELECT fb.batch_code AS finished_batch_code, rb.batch_code AS raw_batch_code, l.quantity::text
         FROM production_batch_links l
         JOIN stock_batches fb ON fb.id = l.finished_batch_id
         JOIN stock_batches rb ON rb.id = l.raw_batch_id
        WHERE l.order_id = $1`,
      [id],
    );
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      warehouseId: row.warehouse_id,
      warehouseName: row.warehouse_name,
      finishedItemId: row.finished_item_id,
      finishedItemCode: row.finished_item_code,
      finishedItemName: row.finished_item_name,
      plannedOutputQty: Number(row.planned_output_qty),
      actualOutputQty: row.actual_output_qty == null ? null : Number(row.actual_output_qty),
      wasteQty: Number(row.waste_qty),
      wasteReason: row.waste_reason,
      yieldPct: row.yield_pct == null ? null : Number(row.yield_pct),
      finishedBatchId: row.finished_batch_id,
      finishedBatchCode: row.finished_batch_code,
      producedOn: row.produced_on,
      status: row.status,
      cancelReason: row.cancel_reason,
      workflowInstanceId: row.workflow_instance_id,
      createdBy: row.created_by,
      rowVersion: row.row_version,
      inputs,
      outputs,
      batchLinks: links.rows.map((link) => ({
        finishedBatchCode: link.finished_batch_code,
        rawBatchCode: link.raw_batch_code,
        quantity: Number(link.quantity),
      })),
    };
  }

  private async lines(tx: TxScope, orderId: string, table: string) {
    const result = await tx.client.query<{
      id: string;
      item_id: string;
      item_code: string;
      item_name: string;
      warehouse_id: string;
      warehouse_name: string;
      batch_id: string | null;
      batch_code: string | null;
      planned_qty: string;
      actual_qty: string | null;
      unit_cost_kobo: string | null;
    }>(
      `SELECT l.id, l.item_id, i.code AS item_code, i.name AS item_name, l.warehouse_id, w.name AS warehouse_name,
              l.batch_id, b.batch_code, l.planned_qty::text, l.actual_qty::text, l.unit_cost_kobo::text
         FROM ${table} l
         JOIN inventory_items i ON i.id = l.item_id
         JOIN warehouses w ON w.id = l.warehouse_id
         LEFT JOIN stock_batches b ON b.id = l.batch_id
        WHERE l.order_id = $1
        ORDER BY l.created_at`,
      [orderId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      itemCode: row.item_code,
      itemName: row.item_name,
      warehouseId: row.warehouse_id,
      warehouseName: row.warehouse_name,
      batchId: row.batch_id,
      batchCode: row.batch_code,
      plannedQty: Number(row.planned_qty),
      actualQty: row.actual_qty == null ? null : Number(row.actual_qty),
      unitCostKobo: row.unit_cost_kobo == null ? null : Number(row.unit_cost_kobo),
    }));
  }

  private async lock(tx: TxScope, id: string) {
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      warehouse_id: string;
      finished_item_id: string;
      planned_output_qty: string;
      actual_output_qty: string | null;
      waste_qty: string;
      produced_on: string | null;
      finished_batch_id: string | null;
      status: string;
      created_by: string;
      row_version: number;
    }>(
      `SELECT id, reference_number, entity_id, warehouse_id, finished_item_id, planned_output_qty::text,
              actual_output_qty::text, waste_qty::text, produced_on::text, finished_batch_id, status,
              created_by, row_version
         FROM production_orders WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That production order was not found.');
    return row;
  }

  private async requireItem(tx: TxScope, itemId: string, entityId: string) {
    const result = await tx.client.query<{ code: string; name: string; entity_id: string }>(
      `SELECT code, name, entity_id FROM inventory_items WHERE id = $1`,
      [itemId],
    );
    const row = result.rows[0];
    if (!row || row.entity_id !== entityId) {
      throw new ValidationFailedError('Every line must use an item on this entity.');
    }
    return row;
  }

  private assertVersion(current: number, expected: number): void {
    if (current !== expected) {
      throw new StaleRecordError('This production order has changed. Refresh and try again.');
    }
  }
}
