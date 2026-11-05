import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type {
  SalesCustomerOption,
  SalesDispatchView,
  SalesInvoiceView,
  SalesOrderStatus,
  SalesOrderView,
} from '@nfc/shared';
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
  CancelSalesInput,
  CreateSalesInput,
  DispatchSalesInput,
  InvoiceSalesInput,
  ReturnSalesInput,
  SubmitSalesInput,
} from './inventory.dto';
import { InventoryService } from './inventory.service';

@Injectable()
export class SalesService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly inventory: InventoryService,
    @Optional() private readonly ledger?: LedgerPostingService,
    @Optional() @Inject(forwardRef(() => WorkflowsService)) private readonly workflows?: WorkflowsService,
  ) {}

  async list(actor: ActorContext, entityId?: string): Promise<SalesOrderView[]> {
    const scoped = this.inventory.assertListScope(actor, entityId, 'sales.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT id FROM sales_orders WHERE ($1::uuid IS NULL OR entity_id = $1) ORDER BY created_at DESC`,
        [scoped],
      );
      return Promise.all(ids.rows.map((row) => this.view(tx, row.id)));
    });
  }

  async get(actor: ActorContext, id: string): Promise<SalesOrderView> {
    return this.unitOfWork.read(actor, async (tx) => {
      const view = await this.view(tx, id);
      assertCan(actor, 'sales.view', view.entityId);
      return view;
    });
  }

  async customers(actor: ActorContext, entityId: string): Promise<SalesCustomerOption[]> {
    assertCan(actor, 'sales.view', entityId);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{ id: string; name: string }>(
        `SELECT id, name FROM customers WHERE entity_id = $1 AND status = 'ACTIVE' ORDER BY name`,
        [entityId],
      );
      return result.rows;
    });
  }

  async listDispatches(actor: ActorContext, entityId?: string): Promise<SalesDispatchView[]> {
    const scoped = this.inventory.assertListScope(actor, entityId, 'sales.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT id FROM sales_dispatches WHERE ($1::uuid IS NULL OR entity_id = $1) ORDER BY created_at DESC`,
        [scoped],
      );
      return Promise.all(ids.rows.map((row) => this.dispatchView(tx, row.id)));
    });
  }

  async listInvoices(actor: ActorContext, entityId?: string): Promise<SalesInvoiceView[]> {
    const scoped = this.inventory.assertListScope(actor, entityId, 'sales.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        reference_number: string;
        sales_order_id: string;
        sales_order_reference: string;
        customer_name: string;
        amount_kobo: string;
        allocated_kobo: string;
        status: string;
        invoice_date: string;
      }>(
        `SELECT i.id, i.reference_number, i.sales_order_id, so.reference_number AS sales_order_reference,
                c.name AS customer_name, i.amount_kobo::text, i.allocated_kobo::text, i.status, i.invoice_date::text
           FROM receivable_invoices i
           JOIN sales_orders so ON so.id = i.sales_order_id
           JOIN customers c ON c.id = i.customer_id
          WHERE ($1::uuid IS NULL OR i.entity_id = $1)
          ORDER BY i.created_at DESC`,
        [scoped],
      );
      return result.rows.map((row) => ({
        id: row.id,
        referenceNumber: row.reference_number,
        salesOrderId: row.sales_order_id,
        salesOrderReference: row.sales_order_reference,
        customerName: row.customer_name,
        amountKobo: Number(row.amount_kobo),
        allocatedKobo: Number(row.allocated_kobo),
        status: row.status,
        invoiceDate: row.invoice_date,
      }));
    });
  }

  async create(actor: ActorContext, input: CreateSalesInput): Promise<SalesOrderView> {
    assertCan(actor, 'sales.order.create', input.entityId);
    const id = await this.unitOfWork.write(actor, async (tx) => {
      const customer = await tx.client.query<{ id: string; name: string }>(
        `SELECT id, name FROM customers WHERE id = $1 AND entity_id = $2 AND status = 'ACTIVE'`,
        [input.customerId, input.entityId],
      );
      if (!customer.rows[0]) throw new ValidationFailedError('Choose a customer on this entity.');
      const ref = await this.inventory.nextRef(tx, 'SO');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO sales_orders (
           reference_number, entity_id, customer_id, terms, due_on, occurred_on, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         RETURNING id`,
        [
          ref,
          input.entityId,
          input.customerId,
          input.terms?.trim() || null,
          input.dueOn ?? null,
          input.occurredOn,
          actor.ref,
        ],
      );
      const orderId = inserted.rows[0]?.id;
      if (!orderId) throw new Error('The sales order was not created.');
      for (const line of input.lines) {
        const item = await tx.client.query<{ entity_id: string }>(
          `SELECT entity_id FROM inventory_items WHERE id = $1`,
          [line.itemId],
        );
        if (item.rows[0]?.entity_id !== input.entityId) {
          throw new ValidationFailedError('Every line must use an item on this entity.');
        }
        await tx.client.query(
          `INSERT INTO sales_order_lines (
             order_id, entity_id, item_id, warehouse_id, quantity, unit_price_kobo, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
          [orderId, input.entityId, line.itemId, line.warehouseId, line.quantity, line.unitPriceKobo, actor.ref],
        );
      }
      await tx.indexSearch({
        recordType: 'SALES_ORDER',
        recordId: orderId,
        referenceNumber: ref,
        title: `Sales ${ref} ${customer.rows[0].name}`,
        searchableText: `${ref} ${customer.rows[0].name}`,
        entityId: input.entityId,
        permissionKey: 'sales.view',
      });
      await tx.audit({
        action: 'create',
        subjectType: 'sales_order',
        subjectId: orderId,
        subjectLabel: ref,
        subjectReferenceNumber: ref,
        entityId: input.entityId,
      });
      return orderId;
    });
    return this.get(actor, id);
  }

  async submit(actor: ActorContext, id: string, input: SubmitSalesInput): Promise<SalesOrderView> {
    await this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lock(tx, id);
      assertCan(actor, 'sales.order.create', current.entity_id);
      this.assertVersion(current.row_version, input.rowVersion);
      if (current.status !== 'DRAFT') throw new ConflictError('Only a draft sales order can be submitted.');
      const instance = await this.workflows?.startSalesOrderInTx(tx, actor, { orderId: id });
      await tx.client.query(
        `UPDATE sales_orders
            SET status = 'AWAITING_APPROVAL', workflow_instance_id = $1, updated_by = $2
          WHERE id = $3`,
        [instance?.id ?? null, actor.ref, id],
      );
    });
    return this.get(actor, id);
  }

  async cancel(actor: ActorContext, id: string, input: CancelSalesInput): Promise<SalesOrderView> {
    await this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lock(tx, id);
      assertCan(actor, 'sales.order.create', current.entity_id);
      this.assertVersion(current.row_version, input.rowVersion);
      if (!['DRAFT', 'AWAITING_APPROVAL', 'RESERVED'].includes(current.status)) {
        throw new ConflictError('After dispatch, use a sales return instead of cancelling.');
      }
      await this.releaseReservations(tx, actor, id);
      await tx.client.query(
        `UPDATE sales_orders SET status = 'CANCELLED', cancel_reason = $1, updated_by = $2 WHERE id = $3`,
        [input.reason.trim(), actor.ref, id],
      );
    });
    return this.get(actor, id);
  }

  async dispatch(actor: ActorContext, id: string, input: DispatchSalesInput): Promise<SalesOrderView> {
    await this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lock(tx, id);
      assertCan(actor, 'sales.dispatch', current.entity_id);
      if (!['RESERVED', 'PART_DISPATCHED'].includes(current.status)) {
        throw new ConflictError('Dispatch reserved stock on an approved sales order.');
      }
      const ref = await this.inventory.nextRef(tx, 'DSP');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO sales_dispatches (
           reference_number, entity_id, sales_order_id, vehicle, driver, destination, document_id,
           occurred_on, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         RETURNING id`,
        [
          ref,
          current.entity_id,
          id,
          input.vehicle?.trim() || null,
          input.driver?.trim() || null,
          input.destination.trim(),
          input.documentId ?? null,
          input.occurredOn,
          actor.ref,
        ],
      );
      const dispatchId = inserted.rows[0]?.id;
      if (!dispatchId) throw new Error('The dispatch was not recorded.');
      for (const line of input.lines) {
        const orderLine = await tx.client.query<{
          id: string;
          item_id: string;
          warehouse_id: string;
          quantity: string;
          reserved_qty: string;
          dispatched_qty: string;
        }>(
          `SELECT id, item_id, warehouse_id, quantity::text, reserved_qty::text, dispatched_qty::text
             FROM sales_order_lines WHERE id = $1 AND order_id = $2 FOR UPDATE`,
          [line.orderLineId, id],
        );
        const row = orderLine.rows[0];
        if (!row) throw new ValidationFailedError('Every dispatch line must belong to this order.');
        const remaining = Number(row.quantity) - Number(row.dispatched_qty);
        if (line.quantity - remaining > 1e-9) {
          throw new ValidationFailedError('Cannot dispatch more than the ordered quantity.');
        }
        await this.releaseReservationQty(tx, actor, row.id, line.quantity);
        const cost = await this.inventory.averageCost(tx, row.item_id, row.warehouse_id);
        const tracking = await this.inventory.resolveTracking(tx, actor, {
          entityId: current.entity_id,
          itemId: row.item_id,
          warehouseId: row.warehouse_id,
          batchCode: line.batchCode,
          outbound: true,
        });
        const movementId = await this.inventory.insertMovement(tx, actor, {
          entityId: current.entity_id,
          itemId: row.item_id,
          warehouseId: row.warehouse_id,
          batchId: tracking.batchId,
          serialId: tracking.serialId,
          quantityIn: 0,
          quantityOut: line.quantity,
          unitCostKobo: cost,
          source: 'SALE',
          sourceId: dispatchId,
          occurredOn: input.occurredOn,
          notes: `Dispatch ${ref}`,
        });
        await tx.client.query(
          `INSERT INTO sales_dispatch_lines (
             dispatch_id, entity_id, order_line_id, item_id, warehouse_id, batch_id, quantity,
             unit_cost_kobo, movement_id, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            dispatchId,
            current.entity_id,
            row.id,
            row.item_id,
            row.warehouse_id,
            tracking.batchId,
            line.quantity,
            cost,
            movementId,
            actor.ref,
          ],
        );
        await tx.client.query(
          `UPDATE sales_order_lines
              SET dispatched_qty = dispatched_qty + $1, reserved_qty = GREATEST(reserved_qty - $1, 0), updated_by = $2
            WHERE id = $3`,
          [line.quantity, actor.ref, row.id],
        );
        await this.inventory.maybeLowStock(tx, actor, row.item_id);
      }
      const totals = await tx.client.query<{ quantity: string; dispatched: string }>(
        `SELECT coalesce(sum(quantity), 0)::text AS quantity, coalesce(sum(dispatched_qty), 0)::text AS dispatched
           FROM sales_order_lines WHERE order_id = $1`,
        [id],
      );
      const fully = Number(totals.rows[0]?.dispatched ?? 0) + 1e-9 >= Number(totals.rows[0]?.quantity ?? 0);
      await tx.client.query(`UPDATE sales_orders SET status = $1, updated_by = $2 WHERE id = $3`, [
        fully ? 'DISPATCHED' : 'PART_DISPATCHED',
        actor.ref,
        id,
      ]);
      await tx.indexSearch({
        recordType: 'SALES_DISPATCH',
        recordId: dispatchId,
        referenceNumber: ref,
        title: `Dispatch ${ref}`,
        searchableText: `${ref} ${current.reference_number} ${input.destination}`,
        entityId: current.entity_id,
        permissionKey: 'sales.view',
      });
    });
    return this.get(actor, id);
  }

  async invoice(actor: ActorContext, id: string, input: InvoiceSalesInput): Promise<SalesOrderView> {
    await this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lock(tx, id);
      assertCan(actor, 'sales.invoice', current.entity_id);
      if (!['DISPATCHED', 'PART_DISPATCHED'].includes(current.status)) {
        throw new ConflictError('Invoice after at least one dispatch.');
      }
      if (current.receivable_invoice_id) throw new ConflictError('This sales order is already invoiced.');
      const lines = await tx.client.query<{
        dispatched_qty: string;
        unit_price_kobo: string;
      }>(`SELECT dispatched_qty::text, unit_price_kobo::text FROM sales_order_lines WHERE order_id = $1`, [id]);
      const amountKobo = lines.rows.reduce(
        (sum, row) => sum + Math.round(Number(row.unit_price_kobo) * Number(row.dispatched_qty)),
        0,
      );
      if (amountKobo <= 0) throw new ValidationFailedError('Nothing has been dispatched to invoice.');
      const cogs = await tx.client.query<{ n: string }>(
        `SELECT coalesce(sum(l.unit_cost_kobo * l.quantity), 0)::text AS n
           FROM sales_dispatch_lines l
           JOIN sales_dispatches d ON d.id = l.dispatch_id
          WHERE d.sales_order_id = $1 AND d.status = 'DISPATCHED'`,
        [id],
      );
      const cogsKobo = Number(cogs.rows[0]?.n ?? 0);
      const occurredOn = input.occurredOn ?? current.occurred_on;
      const dueOn = input.dueOn ?? current.due_on ?? occurredOn;
      const arRef = await this.inventory.nextRef(tx, 'ARI');
      const invoice = await tx.client.query<{ id: string }>(
        `INSERT INTO receivable_invoices (
           reference_number, entity_id, customer_id, sales_order_id, invoice_date, due_date,
           amount_kobo, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         RETURNING id`,
        [arRef, current.entity_id, current.customer_id, id, occurredOn, dueOn, amountKobo, actor.ref],
      );
      const receivableId = invoice.rows[0]?.id;
      if (!receivableId) throw new Error('The receivables invoice was not created.');
      if (!this.ledger) throw new Error('Ledger posting is not available.');
      const debit = await this.ledger.accountIdByCode(tx, current.entity_id, '1220');
      const credit = await this.ledger.accountIdByCode(tx, current.entity_id, '4100');
      const revenue = await this.ledger.postTwoSided(tx, actor, {
        entityId: current.entity_id,
        occurredOn,
        narration: `Sales ${current.reference_number}`,
        idempotencyKey: `so-rev:${id}`,
        source: 'SALES_REVENUE',
        debitAccountId: debit,
        creditAccountId: credit,
        amountKobo,
        customerId: current.customer_id,
        receivableInvoiceId: receivableId,
      });
      await tx.client.query(`UPDATE receivable_invoices SET journal_id = $1, updated_by = $2 WHERE id = $3`, [
        revenue.id,
        actor.ref,
        receivableId,
      ]);
      await this.inventory.postMovement(tx, actor, {
        movementId: null,
        entityId: current.entity_id,
        occurredOn,
        amountKobo: cogsKobo,
        ruleKind: 'sales_cogs',
        source: 'SALES_COGS',
        idempotencyKey: `so-cogs:${id}`,
        narration: `COGS ${current.reference_number}`,
      });
      await tx.client.query(
        `UPDATE sales_orders
            SET status = 'INVOICED', receivable_invoice_id = $1, updated_by = $2
          WHERE id = $3`,
        [receivableId, actor.ref, id],
      );
      await tx.indexSearch({
        recordType: 'AR_INVOICE',
        recordId: receivableId,
        referenceNumber: arRef,
        title: `Invoice ${arRef}`,
        searchableText: `${arRef} ${current.reference_number}`,
        entityId: current.entity_id,
        permissionKey: 'finance.view',
      });
    });
    return this.get(actor, id);
  }

  async returnOrder(actor: ActorContext, id: string, input: ReturnSalesInput): Promise<SalesOrderView> {
    await this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lock(tx, id);
      assertCan(actor, 'sales.dispatch', current.entity_id);
      if (!['DISPATCHED', 'PART_DISPATCHED', 'INVOICED'].includes(current.status)) {
        throw new ConflictError('Only a dispatched sales order can be returned.');
      }
      const dispatchFilter = input.dispatchId
        ? await tx.client.query<{ id: string }>(
            `SELECT id FROM sales_dispatches WHERE id = $1 AND sales_order_id = $2 AND status = 'DISPATCHED'`,
            [input.dispatchId, id],
          )
        : await tx.client.query<{ id: string }>(
            `SELECT id FROM sales_dispatches WHERE sales_order_id = $1 AND status = 'DISPATCHED'`,
            [id],
          );
      if (dispatchFilter.rows.length === 0) {
        throw new ConflictError('There is no open dispatch to return.');
      }
      const ref = await this.inventory.nextRef(tx, 'SRN');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO sales_returns (
           reference_number, entity_id, sales_order_id, dispatch_id, reason, occurred_on, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         RETURNING id`,
        [
          ref,
          current.entity_id,
          id,
          input.dispatchId ?? dispatchFilter.rows[0]?.id ?? null,
          input.reason.trim(),
          input.occurredOn,
          actor.ref,
        ],
      );
      const returnId = inserted.rows[0]?.id;
      if (!returnId) throw new Error('The sales return was not recorded.');
      let cogsKobo = 0;
      for (const dispatch of dispatchFilter.rows) {
        const lines = await tx.client.query<{
          id: string;
          item_id: string;
          warehouse_id: string;
          batch_id: string | null;
          quantity: string;
          unit_cost_kobo: string;
          movement_id: string | null;
        }>(
          `SELECT id, item_id, warehouse_id, batch_id, quantity::text, unit_cost_kobo::text, movement_id
             FROM sales_dispatch_lines WHERE dispatch_id = $1`,
          [dispatch.id],
        );
        for (const line of lines.rows) {
          const qty = Number(line.quantity);
          const cost = Number(line.unit_cost_kobo);
          const movementId = await this.inventory.insertMovement(tx, actor, {
            entityId: current.entity_id,
            itemId: line.item_id,
            warehouseId: line.warehouse_id,
            batchId: line.batch_id,
            serialId: null,
            quantityIn: qty,
            quantityOut: 0,
            unitCostKobo: cost,
            source: 'SALES_RETURN',
            sourceId: returnId,
            reversesId: line.movement_id,
            occurredOn: input.occurredOn,
            notes: `Return ${ref}`,
          });
          await tx.client.query(
            `INSERT INTO sales_return_lines (
               return_id, entity_id, dispatch_line_id, item_id, warehouse_id, quantity, unit_cost_kobo,
               movement_id, created_by
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              returnId,
              current.entity_id,
              line.id,
              line.item_id,
              line.warehouse_id,
              qty,
              cost,
              movementId,
              actor.ref,
            ],
          );
          cogsKobo += Math.round(cost * qty);
        }
        await tx.client.query(
          `UPDATE sales_dispatches SET status = 'REVERSED', updated_by = $1 WHERE id = $2`,
          [actor.ref, dispatch.id],
        );
      }
      if (this.ledger) {
        if (cogsKobo > 0) {
          const stock = await this.ledger.accountIdByCode(tx, current.entity_id, '1400');
          const cogs = await this.ledger.accountIdByCode(tx, current.entity_id, '5100');
          await this.ledger.postTwoSided(tx, actor, {
            entityId: current.entity_id,
            occurredOn: input.occurredOn,
            narration: `Return COGS ${current.reference_number}`,
            idempotencyKey: `so-cogs-ret:${id}`,
            source: 'SALES_RETURN',
            debitAccountId: stock,
            creditAccountId: cogs,
            amountKobo: cogsKobo,
          });
        }
        if (current.receivable_invoice_id) {
          const invoice = await tx.client.query<{
            amount_kobo: string;
            allocated_kobo: string;
            reference_number: string;
          }>(
            `SELECT amount_kobo::text, allocated_kobo::text, reference_number
               FROM receivable_invoices WHERE id = $1 FOR UPDATE`,
            [current.receivable_invoice_id],
          );
          const row = invoice.rows[0];
          const amount = Number(row?.amount_kobo ?? 0);
          const allocated = Number(row?.allocated_kobo ?? 0);
          if (amount > 0) {
            const ar = await this.ledger.accountIdByCode(tx, current.entity_id, '1220');
            const income = await this.ledger.accountIdByCode(tx, current.entity_id, '4100');
            await this.ledger.postTwoSided(tx, actor, {
              entityId: current.entity_id,
              occurredOn: input.occurredOn,
              narration: `Credit ${row?.reference_number ?? current.reference_number}`,
              idempotencyKey: `so-rev-ret:${id}`,
              source: 'SALES_RETURN',
              debitAccountId: income,
              creditAccountId: ar,
              amountKobo: amount,
              customerId: current.customer_id,
              receivableInvoiceId: current.receivable_invoice_id,
            });
          }
          if (row && allocated === 0) {
            await tx.client.query(
              `UPDATE receivable_invoices
                  SET allocated_kobo = amount_kobo, status = 'PAID', updated_by = $1
                WHERE id = $2`,
              [actor.ref, current.receivable_invoice_id],
            );
          }
        }
      }
      await tx.client.query(`UPDATE sales_orders SET status = 'RETURNED', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        id,
      ]);
    });
    return this.get(actor, id);
  }

  async approveInTx(tx: TxScope, actor: ActorContext, orderId: string): Promise<void> {
    const current = await this.lock(tx, orderId);
    if (current.status === 'RESERVED') return;
    if (current.status !== 'AWAITING_APPROVAL') {
      throw new ConflictError('This sales order is not awaiting approval.');
    }
    if (current.created_by === actor.ref) {
      throw new ForbiddenError('The preparer cannot approve this sales order.');
    }
    if (!can(actor, 'sales.order.approve', current.entity_id)) {
      throw new ForbiddenError('You cannot approve this sales order.');
    }
    const lines = await tx.client.query<{
      id: string;
      item_id: string;
      warehouse_id: string;
      quantity: string;
    }>(
      `SELECT id, item_id, warehouse_id, quantity::text FROM sales_order_lines WHERE order_id = $1`,
      [orderId],
    );
    for (const line of lines.rows) {
      const qty = Number(line.quantity);
      const available = await this.inventory.available(tx, line.item_id, line.warehouse_id);
      if (available + 1e-9 < qty) {
        throw new ValidationFailedError('There is not enough available stock to reserve this order.');
      }
      await tx.client.query(
        `INSERT INTO stock_reservations (
           entity_id, sales_order_line_id, item_id, warehouse_id, quantity, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [current.entity_id, line.id, line.item_id, line.warehouse_id, qty, actor.ref],
      );
      await tx.client.query(
        `UPDATE sales_order_lines SET reserved_qty = $1, updated_by = $2 WHERE id = $3`,
        [qty, actor.ref, line.id],
      );
    }
    await tx.client.query(`UPDATE sales_orders SET status = 'RESERVED', updated_by = $1 WHERE id = $2`, [
      actor.ref,
      orderId,
    ]);
  }

  async rejectInTx(tx: TxScope, actor: ActorContext, orderId: string): Promise<void> {
    const current = await this.lock(tx, orderId);
    if (current.status !== 'AWAITING_APPROVAL') return;
    await tx.client.query(`UPDATE sales_orders SET status = 'DRAFT', updated_by = $1 WHERE id = $2`, [
      actor.ref,
      orderId,
    ]);
  }

  private async releaseReservations(tx: TxScope, actor: ActorContext, orderId: string): Promise<void> {
    await tx.client.query(
      `UPDATE stock_reservations r
          SET status = 'RELEASED', updated_by = $1
         FROM sales_order_lines l
        WHERE l.id = r.sales_order_line_id AND l.order_id = $2 AND r.status = 'OPEN'`,
      [actor.ref, orderId],
    );
    await tx.client.query(
      `UPDATE sales_order_lines SET reserved_qty = 0, updated_by = $1 WHERE order_id = $2`,
      [actor.ref, orderId],
    );
  }

  private async releaseReservationQty(
    tx: TxScope,
    actor: ActorContext,
    lineId: string,
    quantity: number,
  ): Promise<void> {
    const open = await tx.client.query<{ id: string; quantity: string }>(
      `SELECT id, quantity::text FROM stock_reservations
        WHERE sales_order_line_id = $1 AND status = 'OPEN'
        ORDER BY created_at
        FOR UPDATE`,
      [lineId],
    );
    let remaining = quantity;
    for (const row of open.rows) {
      if (remaining <= 0) break;
      const held = Number(row.quantity);
      if (held <= remaining + 1e-9) {
        await tx.client.query(
          `UPDATE stock_reservations SET status = 'RELEASED', updated_by = $1 WHERE id = $2`,
          [actor.ref, row.id],
        );
        remaining -= held;
      } else {
        await tx.client.query(
          `UPDATE stock_reservations SET quantity = $1, updated_by = $2 WHERE id = $3`,
          [held - remaining, actor.ref, row.id],
        );
        remaining = 0;
      }
    }
  }

  private async view(tx: TxScope, id: string): Promise<SalesOrderView> {
    const header = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      entity_code: string | null;
      customer_id: string;
      customer_name: string;
      terms: string | null;
      due_on: string | null;
      occurred_on: string;
      status: SalesOrderStatus;
      cancel_reason: string | null;
      receivable_invoice_id: string | null;
      receivable_invoice_reference: string | null;
      workflow_instance_id: string | null;
      created_by: string;
      row_version: number;
    }>(
      `SELECT so.id, so.reference_number, so.entity_id, e.code AS entity_code, so.customer_id, c.name AS customer_name,
              so.terms, so.due_on::text, so.occurred_on::text, so.status, so.cancel_reason, so.receivable_invoice_id,
              i.reference_number AS receivable_invoice_reference, so.workflow_instance_id, so.created_by, so.row_version
         FROM sales_orders so
         JOIN entities e ON e.id = so.entity_id
         JOIN customers c ON c.id = so.customer_id
         LEFT JOIN receivable_invoices i ON i.id = so.receivable_invoice_id
        WHERE so.id = $1`,
      [id],
    );
    const row = header.rows[0];
    if (!row) throw new NotFoundError('That sales order was not found.');
    const lines = await tx.client.query<{
      id: string;
      item_id: string;
      item_code: string;
      item_name: string;
      warehouse_id: string;
      warehouse_name: string;
      quantity: string;
      unit_price_kobo: string;
      reserved_qty: string;
      dispatched_qty: string;
    }>(
      `SELECT l.id, l.item_id, i.code AS item_code, i.name AS item_name, l.warehouse_id, w.name AS warehouse_name,
              l.quantity::text, l.unit_price_kobo::text, l.reserved_qty::text, l.dispatched_qty::text
         FROM sales_order_lines l
         JOIN inventory_items i ON i.id = l.item_id
         JOIN warehouses w ON w.id = l.warehouse_id
        WHERE l.order_id = $1
        ORDER BY l.created_at`,
      [id],
    );
    const dispatchIds = await tx.client.query<{ id: string }>(
      `SELECT id FROM sales_dispatches WHERE sales_order_id = $1 ORDER BY created_at`,
      [id],
    );
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      customerId: row.customer_id,
      customerName: row.customer_name,
      terms: row.terms,
      dueOn: row.due_on,
      occurredOn: row.occurred_on,
      status: row.status,
      cancelReason: row.cancel_reason,
      receivableInvoiceId: row.receivable_invoice_id,
      receivableInvoiceReference: row.receivable_invoice_reference,
      workflowInstanceId: row.workflow_instance_id,
      createdBy: row.created_by,
      rowVersion: row.row_version,
      lines: lines.rows.map((line) => ({
        id: line.id,
        itemId: line.item_id,
        itemCode: line.item_code,
        itemName: line.item_name,
        warehouseId: line.warehouse_id,
        warehouseName: line.warehouse_name,
        quantity: Number(line.quantity),
        unitPriceKobo: Number(line.unit_price_kobo),
        reservedQty: Number(line.reserved_qty),
        dispatchedQty: Number(line.dispatched_qty),
      })),
      dispatches: await Promise.all(dispatchIds.rows.map((d) => this.dispatchView(tx, d.id))),
    };
  }

  private async dispatchView(tx: TxScope, id: string): Promise<SalesDispatchView> {
    const header = await tx.client.query<{
      id: string;
      reference_number: string;
      sales_order_id: string;
      sales_order_reference: string;
      vehicle: string | null;
      driver: string | null;
      destination: string;
      document_id: string | null;
      status: string;
      occurred_on: string;
    }>(
      `SELECT d.id, d.reference_number, d.sales_order_id, so.reference_number AS sales_order_reference,
              d.vehicle, d.driver, d.destination, d.document_id, d.status, d.occurred_on::text
         FROM sales_dispatches d
         JOIN sales_orders so ON so.id = d.sales_order_id
        WHERE d.id = $1`,
      [id],
    );
    const row = header.rows[0];
    if (!row) throw new NotFoundError('That dispatch was not found.');
    const lines = await tx.client.query<{
      item_code: string;
      item_name: string;
      quantity: string;
    }>(
      `SELECT i.code AS item_code, i.name AS item_name, l.quantity::text
         FROM sales_dispatch_lines l
         JOIN inventory_items i ON i.id = l.item_id
        WHERE l.dispatch_id = $1`,
      [id],
    );
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      salesOrderId: row.sales_order_id,
      salesOrderReference: row.sales_order_reference,
      vehicle: row.vehicle,
      driver: row.driver,
      destination: row.destination,
      documentId: row.document_id,
      status: row.status,
      occurredOn: row.occurred_on,
      lines: lines.rows.map((line) => ({
        itemCode: line.item_code,
        itemName: line.item_name,
        quantity: Number(line.quantity),
      })),
    };
  }

  private async lock(tx: TxScope, id: string) {
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      customer_id: string;
      occurred_on: string;
      due_on: string | null;
      status: string;
      receivable_invoice_id: string | null;
      created_by: string;
      row_version: number;
    }>(
      `SELECT id, reference_number, entity_id, customer_id, occurred_on::text, due_on::text, status,
              receivable_invoice_id, created_by, row_version
         FROM sales_orders WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That sales order was not found.');
    return row;
  }

  private assertVersion(current: number, expected: number): void {
    if (current !== expected) {
      throw new StaleRecordError('This sales order has changed. Refresh and try again.');
    }
  }
}
