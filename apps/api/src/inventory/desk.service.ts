import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type {
  AssetCondition,
  AssetStatus,
  FixedAssetView,
  QcDecisionView,
  QuarantineLineView,
  ScanLookupView,
  StockReturnView,
  StockStatus,
  SupplierReturnableLineView,
} from '@nfc/shared';
import { deskTilesFor, type DeskTile } from '@nfc/shared';
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
import { DocumentsService } from '../documents/documents.service';
import { WorkflowsService } from '../workflows/workflows.service';
import type {
  AssetDisposeInput,
  AssetMoveInput,
  AssetPhotoInput,
  QcDecisionInput,
  RegisterAssetInput,
  StockReturnInput,
} from './inventory.dto';
import { InventoryService } from './inventory.service';

function emptyToNull(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** AST/item identifiers, with optional NFC-AST: / NFC-ITEM: scanner prefixes. */
function normalizeScanCode(code: string): string {
  const trimmed = code.trim();
  return trimmed.replace(/^(NFC-AST:|NFC-ITEM:|NFC-BATCH:)/i, '').trim();
}

/**
 * Operations Desk transactions that sit beside the core stock ledger: GM QC
 * release/reject, desk returns (RET-), and the fixed-asset register (AST-).
 * QC decisions are recorded in the inventory audit trail only. They never add
 * a stamp to the procurement memo.
 */
@Injectable()
export class InventoryDeskService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly inventory: InventoryService,
    @Optional() private readonly documents?: DocumentsService,
    @Optional() @Inject(forwardRef(() => WorkflowsService)) private readonly workflows?: WorkflowsService,
  ) {}

  tiles(actor: ActorContext): { tiles: DeskTile[] } {
    return { tiles: deskTilesFor(actor.permissions) };
  }

  // ---------------------------------------------------------------- QC ----

  async quarantine(actor: ActorContext, entityId?: string): Promise<QuarantineLineView[]> {
    const scoped = this.inventory.assertListScope(actor, entityId);
    return this.unitOfWork.read(actor, async (tx) => this.inventory.quarantineLinesInTx(tx, scoped));
  }

  async qcDecisions(actor: ActorContext, entityId?: string): Promise<QcDecisionView[]> {
    const scoped = this.inventory.assertListScope(actor, entityId);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        entity_id: string;
        item_code: string;
        item_name: string;
        warehouse_name: string;
        batch_code: string | null;
        decision: 'RELEASE' | 'REJECT';
        quantity: string;
        reason: string;
        grn_reference: string | null;
        procurement_reference: string | null;
        production_reference: string | null;
        created_by: string;
        created_at: string;
      }>(
        `SELECT d.id, d.entity_id, i.code AS item_code, i.name AS item_name, w.name AS warehouse_name,
                b.batch_code, d.decision, d.quantity::text, d.reason,
                g.reference_number AS grn_reference, pr.reference_number AS procurement_reference,
                po.reference_number AS production_reference, d.created_by, d.created_at::text
           FROM stock_qc_decisions d
           JOIN inventory_items i ON i.id = d.item_id
           JOIN warehouses w ON w.id = d.warehouse_id
           LEFT JOIN stock_batches b ON b.id = d.batch_id
           LEFT JOIN procurement_goods_receipts g ON g.id = d.grn_id
           LEFT JOIN procurement_requests pr ON pr.id = d.procurement_request_id
           LEFT JOIN production_orders po ON po.id = d.production_order_id
          WHERE ($1::uuid IS NULL OR d.entity_id = $1)
          ORDER BY d.created_at DESC
          LIMIT 200`,
        [scoped],
      );
      return result.rows.map((row) => ({
        id: row.id,
        entityId: row.entity_id,
        itemCode: row.item_code,
        itemName: row.item_name,
        warehouseName: row.warehouse_name,
        batchCode: row.batch_code,
        decision: row.decision,
        quantity: Number(row.quantity),
        reason: row.reason,
        grnReference: row.grn_reference,
        procurementReference: row.procurement_reference,
        productionReference: row.production_reference,
        createdBy: row.created_by,
        createdAt: row.created_at,
      }));
    });
  }

  /** GM releases quarantined stock to Available, or rejects it to the Rejected bucket. No GL. */
  async qcDecide(actor: ActorContext, input: QcDecisionInput): Promise<QcDecisionView> {
    assertCan(actor, 'inventory.qc.release', input.entityId);
    const decisionId = await this.unitOfWork.write(actor, async (tx) => {
      const lines = await this.inventory.quarantineLinesInTx(tx, input.entityId);
      const match = lines.find(
        (line) =>
          line.itemId === input.itemId &&
          line.warehouseId === input.warehouseId &&
          (line.batchId ?? null) === (input.batchId ?? null) &&
          (line.serialId ?? null) === (input.serialId ?? null) &&
          (line.grnId ?? null) === (input.grnId ?? null) &&
          (line.productionOrderId ?? null) === (input.productionOrderId ?? null) &&
          (line.returnId ?? null) === (input.returnId ?? null),
      );
      if (!match) throw new NotFoundError('No quarantined stock matches that selection.');
      if (match.quantity + 1e-9 < input.quantity) {
        throw new ValidationFailedError(`Only ${match.quantity} ${match.uomCode} is quarantined on that line.`);
      }
      const id = randomUUID();
      const cost = await this.inventory.averageCost(tx, input.itemId, input.warehouseId);
      const target: StockStatus = input.decision === 'RELEASE' ? 'AVAILABLE' : 'REJECTED';
      const common = {
        entityId: input.entityId,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        batchId: input.batchId ?? null,
        serialId: input.serialId ?? null,
        unitCostKobo: cost,
        source: 'QC' as const,
        sourceId: id,
        procurementRequestId: match.procurementId,
        grnId: match.grnId,
        occurredOn: input.occurredOn,
        notes: input.reason,
      };
      const outId = await this.inventory.insertMovement(tx, actor, {
        ...common,
        quantityIn: 0,
        quantityOut: input.quantity,
        stockStatus: 'QUARANTINED',
      });
      const inId = await this.inventory.insertMovement(tx, actor, {
        ...common,
        quantityIn: input.quantity,
        quantityOut: 0,
        stockStatus: target,
      });
      await tx.client.query(
        `INSERT INTO stock_qc_decisions (
           id, entity_id, item_id, warehouse_id, batch_id, serial_id, grn_id, procurement_request_id,
           production_order_id, return_id, decision, quantity, reason, document_id,
           out_movement_id, in_movement_id, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          id,
          input.entityId,
          input.itemId,
          input.warehouseId,
          input.batchId ?? null,
          input.serialId ?? null,
          match.grnId,
          match.procurementId,
          match.productionOrderId,
          match.returnId,
          input.decision,
          input.quantity,
          input.reason.trim(),
          input.documentId ?? null,
          outId,
          inId,
          actor.ref,
        ],
      );
      const origin = match.grnReference ?? match.productionReference ?? match.returnReference ?? null;
      await tx.audit({
        action: input.decision === 'RELEASE' ? 'approve' : 'reject',
        subjectType: 'stock_qc_decision',
        subjectId: id,
        subjectLabel: `${match.itemCode} QC ${input.decision.toLowerCase()}`,
        subjectReferenceNumber: origin,
        entityId: input.entityId,
        reason: input.reason.trim(),
        newValue: {
          decision: input.decision,
          quantity: input.quantity,
          itemCode: match.itemCode,
          grnReference: match.grnReference,
          procurementReference: match.procurementReference,
          productionReference: match.productionReference,
        },
      });
      await tx.appendTimeline({
        subjectType: 'INVENTORY',
        subjectId: input.itemId,
        text: `QC ${input.decision === 'RELEASE' ? 'released' : 'rejected'} ${input.quantity} ${match.uomCode}${
          origin ? ` from ${origin}` : ''
        }: ${input.reason.trim()}`,
        href: `/inventory/items/${input.itemId}`,
        entityId: input.entityId,
      });
      if (input.decision === 'RELEASE') await this.inventory.maybeLowStock(tx, actor, input.itemId);
      return id;
    });
    const all = await this.qcDecisions(actor, input.entityId);
    const view = all.find((row) => row.id === decisionId);
    if (!view) throw new Error('The QC decision was not readable.');
    return view;
  }

  // ----------------------------------------------------------- Returns ----

  async listReturns(actor: ActorContext, entityId?: string): Promise<StockReturnView[]> {
    const scoped = this.inventory.assertListScope(actor, entityId);
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT id FROM stock_returns WHERE ($1::uuid IS NULL OR entity_id = $1) ORDER BY created_at DESC LIMIT 200`,
        [scoped],
      );
      return Promise.all(ids.rows.map((row) => this.returnView(tx, row.id)));
    });
  }

  /**
   * RECEIVE_RETURN brings issued stock back into Quarantined (QC decides).
   * SUPPLIER_RETURN sends stock back to the vendor and credits the prepayment.
   */
  async createReturn(actor: ActorContext, input: StockReturnInput): Promise<StockReturnView> {
    const supplier = input.kind === 'SUPPLIER_RETURN';
    assertCan(actor, supplier ? 'inventory.return.supplier' : 'inventory.issue', input.entityId);
    const id = await this.unitOfWork.write(actor, async (tx) => {
      const replay = await tx.client.query<{ id: string }>(`SELECT id FROM stock_returns WHERE idempotency_key = $1`, [
        input.idempotencyKey,
      ]);
      if (replay.rows[0]) return replay.rows[0].id;
      let vendorId = input.vendorId ?? null;
      let requestId: string | null = null;
      if (input.grnId) {
        const grn = await tx.client.query<{ request_id: string; vendor_id: string | null; entity_id: string }>(
          `SELECT g.request_id, r.vendor_id, r.entity_id
             FROM procurement_goods_receipts g JOIN procurement_requests r ON r.id = g.request_id
            WHERE g.id = $1`,
          [input.grnId],
        );
        const grnRow = grn.rows[0];
        if (!grnRow || grnRow.entity_id !== input.entityId) {
          throw new ValidationFailedError('That goods received note is not in this subsidiary.');
        }
        requestId = grnRow.request_id;
        vendorId = vendorId ?? grnRow.vendor_id;
      }
      if (supplier && !vendorId) throw new ValidationFailedError('Choose the supplier the stock goes back to.');
      const ref = await this.inventory.nextRef(tx, 'RET');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO stock_returns (
           reference_number, entity_id, warehouse_id, kind, vendor_id, grn_id, procurement_request_id,
           returned_by_name, department_label, reason, occurred_on, idempotency_key, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [
          ref,
          input.entityId,
          input.warehouseId,
          input.kind,
          vendorId,
          input.grnId ?? null,
          requestId,
          emptyToNull(input.returnedByName),
          emptyToNull(input.departmentLabel),
          input.reason.trim(),
          input.occurredOn,
          input.idempotencyKey,
          actor.ref,
        ],
      );
      const returnId = inserted.rows[0]?.id;
      if (!returnId) throw new Error('The return was not recorded.');
      for (const line of input.lines) {
        const item = await this.inventory.loadItemPublic(tx, line.itemId);
        if (item.entity_id !== input.entityId) {
          throw new ValidationFailedError('Every line must be an item of the selected subsidiary.');
        }
        await tx.client.query(`SELECT id FROM inventory_items WHERE id = $1 FOR UPDATE`, [line.itemId]);
        await tx.client.query(`SELECT id FROM warehouses WHERE id = $1 FOR UPDATE`, [input.warehouseId]);
        if (input.grnId) {
          await tx.client.query(`SELECT id FROM procurement_goods_receipts WHERE id = $1 FOR UPDATE`, [input.grnId]);
        }
        const { batchId, serialId } = await this.inventory.resolveTracking(tx, actor, {
          entityId: input.entityId,
          itemId: line.itemId,
          warehouseId: input.warehouseId,
          batchCode: line.batchCode,
          serialCode: line.serialCode,
          outbound: supplier,
        });
        if (supplier) {
          const fromStatus: StockStatus = line.fromStatus ?? 'REJECTED';
          if (fromStatus !== 'QUARANTINED' && fromStatus !== 'REJECTED') {
            throw new ValidationFailedError('Supplier returns may only leave from quarantined or rejected stock.');
          }
          const remaining = await this.inventory.supplierRemainingInTx(tx, {
            itemId: line.itemId,
            warehouseId: input.warehouseId,
            fromStatus,
            batchId,
            serialId,
            grnId: input.grnId ?? null,
          });
          if (line.quantity > remaining + 1e-9) {
            throw new ValidationFailedError(
              remaining <= 0
                ? 'There is no eligible quarantined or rejected stock left to return for that selection.'
                : `Only ${remaining} can still be returned for that goods received line.`,
            );
          }
        } else {
          if (!line.issueLineId) {
            throw new ValidationFailedError('Choose the original issue line this return belongs to.');
          }
          await tx.client.query(`SELECT id FROM stock_issue_lines WHERE id = $1 FOR UPDATE`, [line.issueLineId]);
          const remaining = await this.inventory.receiveReturnRemainingInTx(tx, line.issueLineId);
          if (line.quantity > remaining + 1e-9) {
            throw new ValidationFailedError(
              remaining <= 0
                ? 'That issue line has already been fully returned.'
                : `Only ${remaining} can still be returned against that issue line.`,
            );
          }
        }
        const cost = await this.inventory.averageCost(tx, line.itemId, input.warehouseId);
        const fromStatus: StockStatus | null = supplier ? (line.fromStatus ?? 'REJECTED') : null;
        const movementId = await this.inventory.insertMovement(tx, actor, {
          entityId: input.entityId,
          itemId: line.itemId,
          warehouseId: input.warehouseId,
          batchId,
          serialId,
          quantityIn: supplier ? 0 : line.quantity,
          quantityOut: supplier ? line.quantity : 0,
          unitCostKobo: cost,
          source: supplier ? 'RETURN_SUPPLIER' : 'RETURN_IN',
          sourceId: returnId,
          procurementRequestId: requestId,
          grnId: input.grnId ?? null,
          occurredOn: input.occurredOn,
          notes: input.reason,
          stockStatus: supplier ? fromStatus! : 'QUARANTINED',
        });
        await tx.client.query(
          `INSERT INTO stock_return_lines (
             return_id, entity_id, item_id, quantity, batch_id, serial_id, from_status, movement_id,
             issue_id, issue_line_id, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            returnId,
            input.entityId,
            line.itemId,
            line.quantity,
            batchId,
            serialId,
            fromStatus,
            movementId,
            line.issueId ?? null,
            line.issueLineId ?? null,
            actor.ref,
          ],
        );
        await this.inventory.postMovement(tx, actor, {
          movementId,
          entityId: input.entityId,
          occurredOn: input.occurredOn,
          amountKobo: Math.round(cost * line.quantity),
          ruleKind: supplier ? 'return_supplier' : 'adjustment_increase',
          creditAccountCode: supplier && item.asset ? '1500' : undefined,
          source: 'INVENTORY_RETURN',
          idempotencyKey: `inv-ret:${returnId}:${line.itemId}`,
          procurementRequestId: requestId,
          narration: `${supplier ? 'Return to supplier' : 'Stock returned'} ${ref}`,
        });
        if (serialId) {
          await tx.client.query(`UPDATE stock_serials SET status = $1, updated_by = $2 WHERE id = $3`, [
            supplier ? 'WRITTEN_OFF' : 'ON_HAND',
            actor.ref,
            serialId,
          ]);
        }
      }
      if (!supplier) {
        await tx.publish({
          eventType: 'inventory.qc.pending',
          subjectType: 'INVENTORY',
          subjectId: returnId,
          entityId: input.entityId,
          payload: {
            type: 'inventory.qc.pending',
            reference: ref,
            title: `Returned stock ${ref}`,
            summary: 'Returned stock is quarantined until QC release.',
            href: '/inventory/qc',
          },
        });
      }
      await tx.indexSearch({
        recordType: 'STOCK_RETURN',
        recordId: returnId,
        referenceNumber: ref,
        title: `${supplier ? 'Supplier return' : 'Stock return'} ${ref}`,
        searchableText: `${ref} ${input.reason} ${input.returnedByName ?? ''}`,
        entityId: input.entityId,
        permissionKey: 'inventory.view',
      });
      await tx.audit({
        action: 'create',
        subjectType: 'stock_return',
        subjectId: returnId,
        subjectLabel: ref,
        subjectReferenceNumber: ref,
        entityId: input.entityId,
        reason: input.reason,
      });
      return returnId;
    });
    return this.unitOfWork.read(actor, async (tx) => this.returnView(tx, id));
  }

  private async returnView(tx: TxScope, id: string): Promise<StockReturnView> {
    const header = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      kind: StockReturnView['kind'];
      warehouse_name: string;
      vendor_name: string | null;
      grn_reference: string | null;
      returned_by_name: string | null;
      department_label: string | null;
      reason: string;
      occurred_on: string;
    }>(
      `SELECT r.id, r.reference_number, r.entity_id, r.kind, w.name AS warehouse_name, v.legal_name AS vendor_name,
              g.reference_number AS grn_reference, r.returned_by_name, r.department_label, r.reason,
              r.occurred_on::text
         FROM stock_returns r
         JOIN warehouses w ON w.id = r.warehouse_id
         LEFT JOIN vendors v ON v.id = r.vendor_id
         LEFT JOIN procurement_goods_receipts g ON g.id = r.grn_id
        WHERE r.id = $1`,
      [id],
    );
    const row = header.rows[0];
    if (!row) throw new NotFoundError('That return was not found.');
    const lines = await tx.client.query<{
      item_code: string;
      item_name: string;
      quantity: string;
      from_status: StockStatus | null;
    }>(
      `SELECT i.code AS item_code, i.name AS item_name, l.quantity::text, l.from_status
         FROM stock_return_lines l JOIN inventory_items i ON i.id = l.item_id WHERE l.return_id = $1`,
      [id],
    );
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      entityId: row.entity_id,
      kind: row.kind,
      warehouseName: row.warehouse_name,
      vendorName: row.vendor_name,
      grnReference: row.grn_reference,
      returnedByName: row.returned_by_name,
      departmentLabel: row.department_label,
      reason: row.reason,
      occurredOn: row.occurred_on,
      lines: lines.rows.map((line) => ({
        itemCode: line.item_code,
        itemName: line.item_name,
        quantity: Number(line.quantity),
        fromStatus: line.from_status,
      })),
    };
  }

  // ------------------------------------------------------------ Assets ----

  async listAssets(actor: ActorContext, entityId?: string, q?: string): Promise<FixedAssetView[]> {
    const scoped = this.inventory.assertListScope(actor, entityId);
    const search = emptyToNull(q) ? `%${q!.trim()}%` : null;
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT a.id FROM fixed_assets a
           JOIN inventory_items i ON i.id = a.item_id
          WHERE ($1::uuid IS NULL OR a.entity_id = $1)
            AND ($2::text IS NULL OR a.reference_number ILIKE $2 OR a.serial_code ILIKE $2
                 OR i.code ILIKE $2 OR i.name ILIKE $2 OR a.custodian_name ILIKE $2)
          ORDER BY a.created_at DESC
          LIMIT 300`,
        [scoped, search],
      );
      return Promise.all(ids.rows.map((row) => this.assetView(tx, row.id, false)));
    });
  }

  async getAsset(actor: ActorContext, id: string): Promise<FixedAssetView> {
    return this.unitOfWork.read(actor, async (tx) => {
      const view = await this.assetView(tx, id, true);
      assertCan(actor, 'inventory.view', view.entityId);
      return view;
    });
  }

  /** Registers an individually tracked unit that did not arrive through a GRN (no stock or GL effect). */
  async registerAsset(actor: ActorContext, input: RegisterAssetInput): Promise<FixedAssetView> {
    assertCan(actor, 'inventory.asset.manage', input.entityId);
    const id = await this.unitOfWork.write(actor, async (tx) => {
      const item = await this.inventory.loadItemPublic(tx, input.itemId);
      if (item.entity_id !== input.entityId) {
        throw new ValidationFailedError('The item must belong to the selected subsidiary.');
      }
      if (!item.asset) throw new ValidationFailedError('Only equipment and asset items can be registered as assets.');
      if (input.photoDocumentId) await this.assertPhotoDocument(tx, input.photoDocumentId, input.entityId);
      let serialId: string | null = null;
      if (input.serialCode) {
        const serial = await tx.client.query<{ id: string }>(
          `SELECT id FROM stock_serials WHERE item_id = $1 AND serial_code = $2`,
          [input.itemId, input.serialCode],
        );
        serialId = serial.rows[0]?.id ?? null;
        if (!serialId) {
          const dup = await tx.client.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM fixed_assets WHERE item_id = $1 AND serial_code = $2`,
            [input.itemId, input.serialCode],
          );
          if (Number(dup.rows[0]?.n ?? 0) > 0) throw new ConflictError('That serial number is already registered.');
        }
      }
      const assetId = await this.inventory.registerAssetInTx(tx, actor, {
        entityId: input.entityId,
        itemId: input.itemId,
        serialId,
        warehouseId: input.warehouseId ?? item.default_warehouse_id,
        locationLabel: emptyToNull(input.locationLabel),
        condition: input.condition,
        costKobo: input.costKobo,
        acquiredOn: input.acquiredOn ?? null,
        photoDocumentId: input.photoDocumentId ?? null,
      });
      if (!serialId && input.serialCode) {
        await tx.client.query(`UPDATE fixed_assets SET serial_code = $1, updated_by = $2 WHERE id = $3`, [
          input.serialCode,
          actor.ref,
          assetId,
        ]);
      }
      return assetId;
    });
    return this.getAsset(actor, id);
  }

  async moveAsset(actor: ActorContext, id: string, input: AssetMoveInput): Promise<FixedAssetView> {
    await this.unitOfWork.write(actor, async (tx) => {
      const asset = await this.lockAsset(tx, id);
      assertCan(actor, 'inventory.asset.manage', asset.entity_id);
      if (asset.row_version !== input.rowVersion) throw new StaleRecordError('This asset has changed. Refresh and try again.');
      if (asset.status === 'DISPOSED' || asset.status === 'DISPOSAL_PENDING') {
        throw new ConflictError('A disposed asset, or one awaiting disposal, cannot be moved.');
      }
      let departmentLabel = emptyToNull(input.departmentLabel);
      if (input.departmentId) {
        const dept = await tx.client.query<{ name: string; entity_id: string }>(
          `SELECT name, entity_id FROM departments WHERE id = $1`,
          [input.departmentId],
        );
        const deptRow = dept.rows[0];
        if (!deptRow || deptRow.entity_id !== asset.entity_id) {
          throw new ValidationFailedError('Choose a department of the same subsidiary.');
        }
        departmentLabel = departmentLabel ?? deptRow.name;
      }
      const custodian = emptyToNull(input.custodianName);
      const location = emptyToNull(input.locationLabel);
      const nextStatus: AssetStatus = input.kind === 'ASSIGNED' && (custodian || departmentLabel) ? 'IN_SERVICE' : asset.status as AssetStatus;
      await tx.client.query(
        `UPDATE fixed_assets
            SET department_id = coalesce($1, department_id),
                department_label = coalesce($2, department_label),
                location_label = coalesce($3, location_label),
                custodian_name = coalesce($4, custodian_name),
                condition = coalesce($5, condition),
                status = $6,
                updated_by = $7
          WHERE id = $8`,
        [
          input.departmentId ?? null,
          departmentLabel,
          location,
          custodian,
          input.condition ?? null,
          nextStatus,
          actor.ref,
          id,
        ],
      );
      await tx.client.query(
        `INSERT INTO fixed_asset_events (
           asset_id, entity_id, kind, department_id, department_label, location_label, custodian_name,
           condition, reason, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          asset.entity_id,
          input.kind,
          input.departmentId ?? null,
          departmentLabel,
          location,
          custodian,
          input.condition ?? null,
          input.reason.trim(),
          actor.ref,
        ],
      );
      await tx.audit({
        action: 'edit',
        subjectType: 'fixed_asset',
        subjectId: id,
        subjectLabel: asset.reference_number,
        subjectReferenceNumber: asset.reference_number,
        entityId: asset.entity_id,
        reason: input.reason.trim(),
      });
    });
    return this.getAsset(actor, id);
  }

  /** Links an uploaded image as the asset photo, or clears it when documentId is omitted. */
  async setAssetPhoto(actor: ActorContext, id: string, input: AssetPhotoInput): Promise<FixedAssetView> {
    await this.unitOfWork.write(actor, async (tx) => {
      const asset = await this.lockAsset(tx, id);
      assertCan(actor, 'inventory.asset.manage', asset.entity_id);
      if (asset.row_version !== input.rowVersion) throw new StaleRecordError('This asset has changed. Refresh and try again.');
      const documentId = input.documentId ?? null;
      if (documentId) await this.assertPhotoDocument(tx, documentId, asset.entity_id);
      await tx.client.query(`UPDATE fixed_assets SET photo_document_id = $1, updated_by = $2 WHERE id = $3`, [
        documentId,
        actor.ref,
        id,
      ]);
      await tx.client.query(
        `INSERT INTO fixed_asset_events (asset_id, entity_id, kind, document_id, created_by)
         VALUES ($1, $2, 'PHOTO', $3, $4)`,
        [id, asset.entity_id, documentId, actor.ref],
      );
      await tx.audit({
        action: 'edit',
        subjectType: 'fixed_asset',
        subjectId: id,
        subjectLabel: asset.reference_number,
        subjectReferenceNumber: asset.reference_number,
        entityId: asset.entity_id,
        newValue: { photoDocumentId: documentId },
      });
    });
    return this.getAsset(actor, id);
  }

  /** Streams the asset photo to anyone who can see the asset. */
  async assetPhoto(actor: ActorContext, id: string): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const documentId = await this.unitOfWork.read(actor, async (tx) => {
      const row = await tx.client.query<{ entity_id: string; photo_document_id: string | null }>(
        `SELECT entity_id, photo_document_id FROM fixed_assets WHERE id = $1`,
        [id],
      );
      const asset = row.rows[0];
      if (!asset) throw new NotFoundError('That asset was not found.');
      assertCan(actor, 'inventory.view', asset.entity_id);
      if (!asset.photo_document_id) throw new NotFoundError('This asset has no photo.');
      return asset.photo_document_id;
    });
    if (!this.documents) throw new NotFoundError('The document service is unavailable.');
    return this.documents.streamLinked(actor, documentId);
  }

  /** Lane B: disposal of an individually tracked asset. Needs the confirmed threshold. */
  async requestAssetDisposal(actor: ActorContext, id: string, input: AssetDisposeInput): Promise<FixedAssetView> {
    await this.unitOfWork.write(actor, async (tx) => {
      const asset = await this.lockAsset(tx, id);
      assertCan(actor, 'inventory.dispose.request', asset.entity_id);
      if (asset.row_version !== input.rowVersion) throw new StaleRecordError('This asset has changed. Refresh and try again.');
      if (asset.status === 'DISPOSED' || asset.status === 'DISPOSAL_PENDING') {
        throw new ConflictError('This asset is already disposed or awaiting disposal.');
      }
      if (!asset.warehouse_id) throw new ValidationFailedError('The asset has no store on record.');
      const threshold = await this.inventory.requireSetting(
        tx,
        'lane_b_value_threshold_kobo',
        'Asset disposals need the confirmed approval threshold',
      );
      const onBooks = asset.serial_id
        ? Number(
            (
              await tx.client.query<{ n: string }>(
                `SELECT coalesce(sum(quantity_in - quantity_out), 0)::text AS n FROM stock_movements WHERE serial_id = $1`,
                [asset.serial_id],
              )
            ).rows[0]?.n ?? 0,
          )
        : 0;
      const value = Number(asset.cost_kobo);
      const ref = await this.inventory.nextRef(tx, 'ADJ');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO stock_adjustments (
           reference_number, entity_id, warehouse_id, kind, reason, evidence_document_id, occurred_on,
           asset_id, value_kobo, requires_finance, created_by, updated_by
         ) VALUES ($1, $2, $3, 'asset_disposal', $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`,
        [
          ref,
          asset.entity_id,
          asset.warehouse_id,
          input.reason.trim(),
          input.evidenceDocumentId ?? null,
          input.occurredOn,
          id,
          value,
          value >= threshold,
          actor.ref,
        ],
      );
      const adjustmentId = inserted.rows[0]?.id;
      if (!adjustmentId) throw new Error('The disposal was not created.');
      if (onBooks > 0) {
        const status = (
          await tx.client.query<{ stock_status: StockStatus }>(
            `SELECT stock_status FROM stock_movements WHERE serial_id = $1
              GROUP BY stock_status HAVING sum(quantity_in - quantity_out) > 0 LIMIT 1`,
            [asset.serial_id],
          )
        ).rows[0]?.stock_status ?? 'AVAILABLE';
        await tx.client.query(
          `INSERT INTO stock_adjustment_lines (
             adjustment_id, entity_id, item_id, quantity, serial_id, stock_status, created_by, updated_by
           ) VALUES ($1, $2, $3, -1, $4, $5, $6, $6)`,
          [adjustmentId, asset.entity_id, asset.item_id, asset.serial_id, status, actor.ref],
        );
      }
      await tx.client.query(`UPDATE fixed_assets SET status = 'DISPOSAL_PENDING', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        id,
      ]);
      await tx.client.query(
        `INSERT INTO fixed_asset_events (asset_id, entity_id, kind, adjustment_id, reason, document_id, created_by)
         VALUES ($1, $2, 'DISPOSAL_REQUESTED', $3, $4, $5, $6)`,
        [id, asset.entity_id, adjustmentId, input.reason.trim(), input.evidenceDocumentId ?? null, actor.ref],
      );
      await this.workflows?.startInventoryAdjustmentInTx(tx, actor, { adjustmentId });
      await tx.audit({
        action: 'inventory_adjustment',
        subjectType: 'stock_adjustment',
        subjectId: adjustmentId,
        subjectLabel: ref,
        subjectReferenceNumber: ref,
        entityId: asset.entity_id,
        reason: input.reason.trim(),
      });
    });
    return this.getAsset(actor, id);
  }

  // -------------------------------------------------------------- Scan ----

  /** Resolves a scanned or typed code: AST- asset, serial, item code or batch. */
  async listSupplierReturnable(actor: ActorContext, entityId?: string): Promise<SupplierReturnableLineView[]> {
    assertCan(actor, 'inventory.return.supplier', entityId);
    const scoped = this.inventory.assertListScope(actor, entityId);
    return this.unitOfWork.read(actor, async (tx) => this.inventory.supplierReturnableInTx(tx, scoped));
  }

  async scan(actor: ActorContext, code: string): Promise<ScanLookupView> {
    if (!can(actor, 'inventory.view')) {
      throw new ForbiddenError('Your role does not permit this action.', { permission: 'inventory.view' });
    }
    const query = normalizeScanCode(code);
    return this.unitOfWork.read(actor, async (tx) => {
      const asset = await tx.client.query<{ id: string; entity_id: string }>(
        `SELECT id, entity_id FROM fixed_assets
          WHERE upper(reference_number) = upper($1) OR upper(coalesce(serial_code, '')) = upper($1)
          ORDER BY (status = 'DISPOSED'), created_at DESC
          LIMIT 1`,
        [query],
      );
      const assetRow = asset.rows[0];
      const assetView =
        assetRow && can(actor, 'inventory.view', assetRow.entity_id) ? await this.assetView(tx, assetRow.id, true) : null;
      const items = await tx.client.query<{
        id: string;
        entity_id: string;
        entity_code: string | null;
        code: string;
        name: string;
        uom_code: string;
        batch_code: string | null;
        released: string;
        quarantined: string;
        reserved: string;
      }>(
        `SELECT i.id, i.entity_id, e.code AS entity_code, i.code, i.name, u.code AS uom_code, b.batch_code,
                coalesce((SELECT sum(m.quantity_in - m.quantity_out) FROM stock_movements m
                           WHERE m.item_id = i.id AND m.stock_status = 'AVAILABLE'
                             AND (b.id IS NULL OR m.batch_id = b.id)), 0)::text AS released,
                coalesce((SELECT sum(m.quantity_in - m.quantity_out) FROM stock_movements m
                           WHERE m.item_id = i.id AND m.stock_status = 'QUARANTINED'
                             AND (b.id IS NULL OR m.batch_id = b.id)), 0)::text AS quarantined,
                coalesce((SELECT sum(r.quantity) FROM stock_reservations r
                           WHERE r.item_id = i.id AND r.status = 'OPEN'), 0)::text AS reserved
           FROM inventory_items i
           JOIN entities e ON e.id = i.entity_id
           JOIN units_of_measure u ON u.id = i.uom_id
           LEFT JOIN stock_batches b ON b.item_id = i.id AND upper(b.batch_code) = upper($1)
          WHERE upper(i.code) = upper($1) OR b.id IS NOT NULL
          ORDER BY e.code, i.code
          LIMIT 20`,
        [query],
      );
      return {
        query,
        asset: assetView,
        items: items.rows
          .filter((row) => can(actor, 'inventory.view', row.entity_id))
          .map((row) => ({
            id: row.id,
            entityCode: row.entity_code,
            code: row.code,
            name: row.name,
            availableQty: Number(row.released) - (row.batch_code ? 0 : Number(row.reserved)),
            quarantinedQty: Number(row.quarantined),
            uomCode: row.uom_code,
            batchCode: row.batch_code,
          })),
      };
    });
  }

  // ----------------------------------------------------------- Helpers ----

  private async assertPhotoDocument(tx: TxScope, documentId: string, entityId: string): Promise<void> {
    const doc = await tx.client.query<{ entity_id: string; mime_type: string | null }>(
      `SELECT d.entity_id, v.mime_type
         FROM documents d LEFT JOIN document_versions v ON v.id = d.current_version_id
        WHERE d.id = $1`,
      [documentId],
    );
    const row = doc.rows[0];
    if (!row) throw new NotFoundError('That photo was not found.');
    if (row.entity_id !== entityId) throw new ValidationFailedError('The photo must be stored in the same subsidiary.');
    if (!row.mime_type || !row.mime_type.startsWith('image/')) {
      throw new ValidationFailedError('The asset photo must be a JPEG or PNG image.');
    }
  }

  private async lockAsset(
    tx: TxScope,
    id: string,
  ): Promise<{
    id: string;
    entity_id: string;
    item_id: string;
    serial_id: string | null;
    warehouse_id: string | null;
    reference_number: string;
    status: string;
    cost_kobo: string;
    row_version: number;
  }> {
    const result = await tx.client.query<{
      id: string;
      entity_id: string;
      item_id: string;
      serial_id: string | null;
      warehouse_id: string | null;
      reference_number: string;
      status: string;
      cost_kobo: string;
      row_version: number;
    }>(
      `SELECT id, entity_id, item_id, serial_id, warehouse_id, reference_number, status, cost_kobo::text, row_version
         FROM fixed_assets WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That asset was not found.');
    return row;
  }

  private async assetView(tx: TxScope, id: string, withHistory: boolean): Promise<FixedAssetView> {
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      entity_code: string | null;
      item_id: string;
      item_code: string;
      item_name: string;
      serial_code: string | null;
      grn_reference: string | null;
      procurement_reference: string | null;
      procurement_request_id: string | null;
      warehouse_name: string | null;
      location_label: string | null;
      department_label: string | null;
      custodian_name: string | null;
      condition: AssetCondition;
      status: AssetStatus;
      cost_kobo: string;
      acquired_on: string | null;
      photo_document_id: string | null;
      row_version: number;
    }>(
      `SELECT a.id, a.reference_number, a.entity_id, e.code AS entity_code, a.item_id, i.code AS item_code,
              i.name AS item_name, a.serial_code, g.reference_number AS grn_reference,
              pr.reference_number AS procurement_reference, a.procurement_request_id, w.name AS warehouse_name,
              a.location_label, a.department_label, a.custodian_name, a.condition, a.status, a.cost_kobo::text,
              a.acquired_on::text, a.photo_document_id, a.row_version
         FROM fixed_assets a
         JOIN entities e ON e.id = a.entity_id
         JOIN inventory_items i ON i.id = a.item_id
         LEFT JOIN procurement_goods_receipts g ON g.id = a.grn_id
         LEFT JOIN procurement_requests pr ON pr.id = a.procurement_request_id
         LEFT JOIN warehouses w ON w.id = a.warehouse_id
        WHERE a.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That asset was not found.');
    const history = withHistory
      ? (
          await tx.client.query<{
            kind: string;
            department_label: string | null;
            location_label: string | null;
            custodian_name: string | null;
            condition: string | null;
            reason: string | null;
            created_by: string;
            created_at: string;
          }>(
            `SELECT kind, department_label, location_label, custodian_name, condition, reason,
                    app.user_public_name(
                      CASE WHEN created_by ~ '^[0-9a-f-]{36}$' THEN created_by::uuid ELSE NULL END
                    ) AS created_by, created_at::text
               FROM fixed_asset_events WHERE asset_id = $1 ORDER BY created_at DESC`,
            [id],
          )
        ).rows
      : [];
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      itemId: row.item_id,
      itemCode: row.item_code,
      itemName: row.item_name,
      serialCode: row.serial_code,
      grnReference: row.grn_reference,
      procurementReference: row.procurement_reference,
      procurementId: row.procurement_request_id,
      warehouseName: row.warehouse_name,
      locationLabel: row.location_label,
      departmentLabel: row.department_label,
      custodianName: row.custodian_name,
      condition: row.condition,
      status: row.status,
      costKobo: Number(row.cost_kobo),
      acquiredOn: row.acquired_on,
      photoDocumentId: row.photo_document_id,
      photoUrl: row.photo_document_id ? `/api/inventory/assets/${row.id}/photo` : null,
      rowVersion: row.row_version,
      history: history.map((event) => ({
        kind: event.kind,
        departmentLabel: event.department_label,
        locationLabel: event.location_label,
        custodianName: event.custodian_name,
        condition: event.condition,
        reason: event.reason,
        createdBy: event.created_by,
        createdAt: event.created_at,
      })),
    };
  }
}
