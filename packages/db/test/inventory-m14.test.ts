/**
 * M14 inventory 2: production (WIP/FG/waste), sales reservations, dispatch, ARI, isolation.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  DEFAULT_ROLE_GRANTS,
  SEED_USERS,
  YFZ_BANK_ACCOUNT_ID,
  YFZ_CUSTOMER_ID,
  type PermissionKey,
} from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { CustomersService } from '../../../apps/api/src/finance/customers.service';
import { IntegrityService } from '../../../apps/api/src/finance/integrity.service';
import { JournalsService } from '../../../apps/api/src/finance/journals.service';
import { LedgerPostingService } from '../../../apps/api/src/finance/ledger-posting.service';
import { ReceivablesService } from '../../../apps/api/src/finance/receivables.service';
import { InventoryService } from '../../../apps/api/src/inventory/inventory.service';
import { ProductionService } from '../../../apps/api/src/inventory/production.service';
import { SalesService } from '../../../apps/api/src/inventory/sales.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import { ForbiddenError, NotFoundError, ValidationFailedError } from '../../../apps/api/src/common/errors/domain-error';
import { appPool, entityIdFor, ownerPool } from './support';

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

describe('M14 inventory 2 production and sales', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let nfc: string;
  let inventory: InventoryService;
  let production: ProductionService;
  let sales: SalesService;
  let workflows: WorkflowsService;
  let integrity: IntegrityService;
  let receivables: ReceivablesService;
  let hauwa: ActorContext;
  let musa: ActorContext;
  let admin: ActorContext;
  let halima: ActorContext;
  let grace: ActorContext;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-m14-owner');
    app = appPool('nfc-erp-test-m14-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
    nfc = await entityIdFor(owner, 'NFC');
    const uow = new UnitOfWork(app);
    workflows = new WorkflowsService(uow, new SealsService());
    const journals = new JournalsService(uow, workflows);
    const ledger = new LedgerPostingService(journals);
    inventory = new InventoryService(uow, ledger, workflows);
    production = new ProductionService(uow, inventory, workflows);
    sales = new SalesService(uow, inventory, ledger, workflows);
    Object.assign(workflows, { inventory, production, sales });
    integrity = new IntegrityService(uow);
    receivables = new ReceivablesService(uow, ledger, new CustomersService(uow));
    hauwa = actorFromSeed('inventory@nfc.local', [yfz, dma, nfc]);
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
    admin = actorFromSeed('administrator@nfc.local', [nfc, yfz]);
    halima = actorFromSeed('ed.operations@nfc.local', [yfz, dma, nfc]);
    grace = actorFromSeed('fh.yfz@nfc.local', [yfz]);
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  it('consumes RM to FG with waste, yield, batch trace and cleared WIP', async () => {
    const fixture = await stockedPair(100, 50);
    const planned = await production.create(hauwa, {
      entityId: yfz,
      warehouseId: fixture.warehouseId,
      finishedItemId: fixture.fg.id,
      plannedOutputQty: 80,
      inputs: [{ itemId: fixture.rm.id, warehouseId: fixture.warehouseId, plannedQty: 100, batchCode: 'RM-A' }],
    });
    const started = await production.start(hauwa, planned.id, {
      rowVersion: planned.rowVersion,
      occurredOn: '2026-06-15',
      inputs: [{ itemId: fixture.rm.id, actualQty: 100, batchCode: 'RM-A' }],
    });
    expect(started.status).toBe('IN_PROGRESS');
    const submitted = await production.submitComplete(hauwa, started.id, {
      rowVersion: started.rowVersion,
      actualOutputQty: 80,
      wasteQty: 10,
      wasteReason: 'Screenings',
      finishedBatchCode: 'FG-A',
      producedOn: '2026-06-15',
    });
    expect(submitted.status).toBe('AWAITING_APPROVAL');
    await expect(
      workflows.act(hauwa, {
        instanceId: submitted.workflowInstanceId!,
        action: 'APPROVE',
        rowVersion: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const workflow = await workflows.get(halima, submitted.workflowInstanceId!);
    const posted = await workflows.act(halima, {
      instanceId: workflow.id,
      action: 'APPROVE',
      rowVersion: workflow.rowVersion,
    });
    expect(posted.status).toBe('COMPLETED');
    const done = await production.get(hauwa, planned.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.yieldPct).toBeCloseTo(80 / 80, 5);
    expect(done.batchLinks.some((row) => row.rawBatchCode === 'RM-A' && row.finishedBatchCode === 'FG-A')).toBe(
      true,
    );
    const wip = await owner.query<{ n: string }>(
      `SELECT coalesce(sum(l.debit_kobo - l.credit_kobo), 0)::text AS n
         FROM journal_lines l
         JOIN journals j ON j.id = l.journal_id
         JOIN accounts a ON a.id = l.account_id
        WHERE a.code = '1410' AND j.idempotency_key IN ($1, $2, $3, $4)`,
      [`prd-wip:${planned.id}`, `prd-waste:${planned.id}`, `prd-oh:${planned.id}`, `prd-fg:${planned.id}`],
    );
    expect(Number(wip.rows[0]?.n ?? 0)).toBe(0);
    const fg = await inventory.getItem(hauwa, fixture.fg.id);
    expect(fg.producedFrom.some((row) => row.orderId === planned.id && row.rawBatchCode === 'RM-A')).toBe(true);
    const raw = await inventory.getItem(hauwa, fixture.rm.id);
    expect(raw.consumedIn.some((row) => row.orderId === planned.id && row.finishedBatchCode === 'FG-A')).toBe(true);
    const report = await integrity.report(grace, { entityId: yfz });
    expect(report.checks.find((row) => row.key === 'inventory')?.status).not.toBe('UNAVAILABLE');
  });

  it('reserves stock so a second order cannot oversell, then dispatch and invoice with M11 receipt', async () => {
    const fixture = await stockedPair(20, 100);
    const first = await sales.create(hauwa, {
      entityId: yfz,
      customerId: YFZ_CUSTOMER_ID,
      occurredOn: '2026-06-16',
      lines: [
        {
          itemId: fixture.fg.id,
          warehouseId: fixture.warehouseId,
          quantity: 20,
          unitPriceKobo: 800,
        },
      ],
    });
    const submitted = await sales.submit(hauwa, first.id, { rowVersion: first.rowVersion });
    const workflow = await workflows.get(halima, submitted.workflowInstanceId!);
    await workflows.act(halima, {
      instanceId: workflow.id,
      action: 'APPROVE',
      rowVersion: workflow.rowVersion,
    });
    const reserved = await sales.get(hauwa, first.id);
    expect(reserved.status).toBe('RESERVED');
    const second = await sales.create(hauwa, {
      entityId: yfz,
      customerId: YFZ_CUSTOMER_ID,
      occurredOn: '2026-06-16',
      lines: [
        {
          itemId: fixture.fg.id,
          warehouseId: fixture.warehouseId,
          quantity: 1,
          unitPriceKobo: 800,
        },
      ],
    });
    const secondSub = await sales.submit(hauwa, second.id, { rowVersion: second.rowVersion });
    const secondWf = await workflows.get(halima, secondSub.workflowInstanceId!);
    await expect(
      workflows.act(halima, {
        instanceId: secondWf.id,
        action: 'APPROVE',
        rowVersion: secondWf.rowVersion,
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
    await expect(
      inventory.issue(hauwa, {
        entityId: yfz,
        warehouseId: fixture.warehouseId,
        destinationType: 'department',
        destinationLabel: 'Mill',
        reason: 'Would oversell reserved stock',
        occurredOn: '2026-06-16',
        idempotencyKey: `m14-ist-${randomUUID()}`,
        lines: [{ itemId: fixture.fg.id, quantity: 1, batchCode: 'FG-OPEN' }],
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);

    const dispatched = await sales.dispatch(hauwa, first.id, {
      destination: 'Yola depot',
      occurredOn: '2026-06-17',
      lines: [{ orderLineId: reserved.lines[0]!.id, quantity: 20, batchCode: 'FG-OPEN' }],
    });
    expect(dispatched.status).toBe('DISPATCHED');
    expect(dispatched.lines[0]?.reservedQty).toBe(0);
    const onHand = await inventory.getItem(hauwa, fixture.fg.id);
    expect(onHand.onHandQty).toBe(0);

    const invoiced = await sales.invoice(hauwa, first.id, { occurredOn: '2026-06-17' });
    expect(invoiced.status).toBe('INVOICED');
    expect(invoiced.receivableInvoiceId).toBeTruthy();
    const receipt = await receivables.recordReceipt(grace, {
      entityId: yfz,
      customerId: YFZ_CUSTOMER_ID,
      bankAccountId: YFZ_BANK_ACCOUNT_ID,
      receivedOn: '2026-06-18',
      amountKobo: 20 * 800,
      allocations: [{ invoiceId: invoiced.receivableInvoiceId!, amountKobo: 20 * 800 }],
      idempotencyKey: `m14-rct-${invoiced.id}`,
    });
    expect(receipt.amountKobo).toBe(16_000);
    const sources = await owner.query<{ source: string }>(
      `SELECT source FROM journals WHERE idempotency_key IN ($1, $2)`,
      [`so-rev:${first.id}`, `so-cogs:${first.id}`],
    );
    expect(sources.rows.map((row) => row.source).sort()).toEqual(['SALES_COGS', 'SALES_REVENUE']);
  });

  it('keeps originals on cancel and return, and isolates DMA from the YFZ GM', async () => {
    const fixture = await stockedPair(10, 80);
    const draft = await sales.create(hauwa, {
      entityId: yfz,
      customerId: YFZ_CUSTOMER_ID,
      occurredOn: '2026-06-19',
      lines: [
        { itemId: fixture.fg.id, warehouseId: fixture.warehouseId, quantity: 4, unitPriceKobo: 500 },
      ],
    });
    const submitted = await sales.submit(hauwa, draft.id, { rowVersion: draft.rowVersion });
    const wf = await workflows.get(halima, submitted.workflowInstanceId!);
    await workflows.act(halima, { instanceId: wf.id, action: 'APPROVE', rowVersion: wf.rowVersion });
    const reserved = await sales.get(hauwa, draft.id);
    const cancelled = await sales.cancel(hauwa, draft.id, {
      rowVersion: reserved.rowVersion,
      reason: 'Customer withdrew',
    });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.referenceNumber).toBe(draft.referenceNumber);

    const sold = await sales.create(hauwa, {
      entityId: yfz,
      customerId: YFZ_CUSTOMER_ID,
      occurredOn: '2026-06-20',
      lines: [
        { itemId: fixture.fg.id, warehouseId: fixture.warehouseId, quantity: 3, unitPriceKobo: 500 },
      ],
    });
    const soldSub = await sales.submit(hauwa, sold.id, { rowVersion: sold.rowVersion });
    const soldWf = await workflows.get(halima, soldSub.workflowInstanceId!);
    await workflows.act(halima, { instanceId: soldWf.id, action: 'APPROVE', rowVersion: soldWf.rowVersion });
    const ready = await sales.get(hauwa, sold.id);
    await sales.dispatch(hauwa, sold.id, {
      destination: 'Maiduguri',
      occurredOn: '2026-06-21',
      lines: [{ orderLineId: ready.lines[0]!.id, quantity: 3, batchCode: 'FG-OPEN' }],
    });
    const invoiced = await sales.invoice(hauwa, sold.id, { occurredOn: '2026-06-21' });
    const originalInv = invoiced.referenceNumber;
    const returned = await sales.returnOrder(hauwa, sold.id, {
      reason: 'Rejected at gate',
      occurredOn: '2026-06-22',
    });
    expect(returned.status).toBe('RETURNED');
    expect(returned.referenceNumber).toBe(originalInv);
    expect(returned.dispatches[0]?.status).toBe('REVERSED');
    const reversing = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM stock_movements WHERE source = 'SALES_RETURN' AND source_id IN (
         SELECT id FROM sales_returns WHERE sales_order_id = $1
       )`,
      [sold.id],
    );
    expect(Number(reversing.rows[0]?.n ?? 0)).toBeGreaterThan(0);

    await expect(sales.list(musa, dma)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(production.list(musa, dma)).rejects.toBeInstanceOf(ForbiddenError);
    const dmaOrders = await production.list(hauwa, dma);
    if (dmaOrders[0]) {
      await expect(production.get(musa, dmaOrders[0].id)).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it('blocks admin and GM from creating production or dispatching, and blocks self-approval', async () => {
    const fixture = await stockedPair(8, 40);
    await expect(
      production.create(musa, {
        entityId: yfz,
        warehouseId: fixture.warehouseId,
        finishedItemId: fixture.fg.id,
        plannedOutputQty: 4,
        inputs: [{ itemId: fixture.rm.id, plannedQty: 8 }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      production.create(admin, {
        entityId: yfz,
        warehouseId: fixture.warehouseId,
        finishedItemId: fixture.fg.id,
        plannedOutputQty: 4,
        inputs: [{ itemId: fixture.rm.id, plannedQty: 8 }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const order = await sales.create(hauwa, {
      entityId: yfz,
      customerId: YFZ_CUSTOMER_ID,
      occurredOn: '2026-06-23',
      lines: [
        { itemId: fixture.fg.id, warehouseId: fixture.warehouseId, quantity: 2, unitPriceKobo: 300 },
      ],
    });
    const submitted = await sales.submit(hauwa, order.id, { rowVersion: order.rowVersion });
    await expect(
      workflows.act(hauwa, {
        instanceId: submitted.workflowInstanceId!,
        action: 'APPROVE',
        rowVersion: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const wf = await workflows.get(halima, submitted.workflowInstanceId!);
    await workflows.act(halima, { instanceId: wf.id, action: 'APPROVE', rowVersion: wf.rowVersion });
    const reserved = await sales.get(hauwa, order.id);
    await expect(
      sales.dispatch(musa, order.id, {
        destination: 'Unauthorised',
        occurredOn: '2026-06-23',
        lines: [{ orderLineId: reserved.lines[0]!.id, quantity: 2 }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  async function stockedPair(rmQty: number, unitCost: number) {
    const categories = await inventory.categories(hauwa, yfz);
    const rawCat = categories.find((row) => row.key === 'raw_materials') ?? categories[0];
    const fgCat = categories.find((row) => row.key === 'finished_goods') ?? categories[0];
    const units = await inventory.units(hauwa);
    const kg = units.find((row) => row.code === 'KG') ?? units[0];
    const warehouses = await inventory.warehouses(hauwa, yfz);
    const warehouseId = warehouses[0]?.id;
    if (!rawCat || !fgCat || !kg || !warehouseId) throw new Error('M13 inventory master data is missing.');
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const rm = await inventory.createItem(hauwa, {
      entityId: yfz,
      code: `M14-RM-${suffix}`,
      name: `M14 raw ${suffix}`,
      categoryId: rawCat.id,
      uomId: kg.id,
      defaultWarehouseId: warehouseId,
      trackingMode: 'batch_lot',
      reorderLevel: 0,
    });
    const fg = await inventory.createItem(hauwa, {
      entityId: yfz,
      code: `M14-FG-${suffix}`,
      name: `M14 finished ${suffix}`,
      categoryId: fgCat.id,
      uomId: kg.id,
      defaultWarehouseId: warehouseId,
      trackingMode: 'batch_lot',
      reorderLevel: 0,
    });
    await openingStock({
      itemId: rm.id,
      warehouseId,
      qty: rmQty,
      unitCostKobo: unitCost,
      batchCode: 'RM-A',
    });
    await openingStock({
      itemId: fg.id,
      warehouseId,
      qty: rmQty === 20 || rmQty === 10 || rmQty === 8 ? rmQty : 0,
      unitCostKobo: unitCost,
      batchCode: 'FG-OPEN',
    });
    await owner.query(
      `INSERT INTO production_overhead_rules (
         entity_id, finished_item_id, method, rate, created_by, updated_by
       ) VALUES ($1, $2, 'percent_of_rm', 5, $3, $3)`,
      [yfz, fg.id, hauwa.ref],
    );
    return { rm, fg, warehouseId };
  }

  async function openingStock(input: {
    itemId: string;
    warehouseId: string;
    qty: number;
    unitCostKobo: number;
    batchCode: string;
  }): Promise<void> {
    if (input.qty <= 0) return;
    const existingBatch = await owner.query<{ id: string }>(
      `SELECT id FROM stock_batches WHERE item_id = $1 AND warehouse_id = $2 AND batch_code = $3`,
      [input.itemId, input.warehouseId, input.batchCode],
    );
    const batch =
      existingBatch.rows[0] ??
      (
        await owner.query<{ id: string }>(
          `INSERT INTO stock_batches (entity_id, item_id, warehouse_id, batch_code, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [yfz, input.itemId, input.warehouseId, input.batchCode, hauwa.ref],
        )
      ).rows[0];
    const ref = (await owner.query<{ ref: string }>(`SELECT app.next_reference('INV') AS ref`)).rows[0]?.ref;
    const value = Math.round(input.unitCostKobo * input.qty);
    await owner.query(
      `INSERT INTO stock_movements (
         reference_number, entity_id, item_id, warehouse_id, batch_id, quantity_in, quantity_out,
         unit_cost_kobo, value_kobo, source, notes, occurred_on, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, 'GRN', 'M14 test opening', '2026-06-01', $9)`,
      [
        ref,
        yfz,
        input.itemId,
        input.warehouseId,
        batch?.id ?? null,
        input.qty,
        input.unitCostKobo,
        value,
        hauwa.ref,
      ],
    );
    const period = await owner.query<{ id: string }>(
      `SELECT id FROM fiscal_periods
        WHERE entity_id = $1 AND status = 'OPEN' AND '2026-06-01'::date BETWEEN starts_on AND ends_on
        LIMIT 1`,
      [yfz],
    );
    const debit = await owner.query<{ id: string }>(
      `SELECT id FROM accounts WHERE entity_id = $1 AND code = '1400'`,
      [yfz],
    );
    const credit = await owner.query<{ id: string }>(
      `SELECT id FROM accounts WHERE entity_id = $1 AND code = '1300'`,
      [yfz],
    );
    if (!period.rows[0] || !debit.rows[0] || !credit.rows[0] || !ref) return;
    const jref = (await owner.query<{ ref: string }>(`SELECT app.next_reference('JNL') AS ref`)).rows[0]?.ref;
    const journal = await owner.query<{ id: string }>(
      `INSERT INTO journals (
         reference_number, entity_id, fiscal_period_id, narration, idempotency_key, source,
         status, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, 'INVENTORY_RECEIPT', 'DRAFT', $6, $6)
       RETURNING id`,
      [jref, yfz, period.rows[0].id, `Open ${ref}`, `m14-open:${ref}`, hauwa.ref],
    );
    await owner.query(
      `INSERT INTO journal_lines (
         journal_id, entity_id, line_number, account_id, debit_kobo, credit_kobo, created_by, updated_by
       ) VALUES
         ($1, $2, 1, $3, $4, 0, $5, $5),
         ($1, $2, 2, $6, 0, $4, $5, $5)`,
      [journal.rows[0]?.id, yfz, debit.rows[0].id, value, hauwa.ref, credit.rows[0].id],
    );
    await owner.query(
      `UPDATE journals SET status = 'POSTED', posted_at = now(), posted_by = $1, updated_by = $1 WHERE id = $2`,
      [hauwa.ref, journal.rows[0]?.id],
    );
  }
});
