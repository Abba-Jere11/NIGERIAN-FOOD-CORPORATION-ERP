import { SEED_USERS, YFZ_CUSTOMER_ID } from '@nfc/shared';
import type { Pool, PoolClient } from 'pg';
import { upsertSearchIndex } from './search';

const HAUWA_ID = SEED_USERS.find((user) => user.email === 'inventory@nfc.local')?.id;

export async function seedM14(pool: Pool): Promise<{ alreadyPresent: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(`SELECT 1 FROM production_overhead_rules LIMIT 1`);
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return { alreadyPresent: true };
    }
    if (!HAUWA_ID) throw new Error('Seed identities before M14 fixtures.');

    const entities = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM entities WHERE code IN ('YFZ', 'YFW', 'NOM')`,
    );
    const byCode = new Map(entities.rows.map((row) => [row.code, row.id]));
    const yfw = byCode.get('YFW');
    const yfz = byCode.get('YFZ');
    const nom = byCode.get('NOM');
    if (!yfw || !yfz || !nom) throw new Error('Seed organisations before M14 fixtures.');

    await seedOverhead(client, { yfw, yfz, nom });
    await seedYfwProduction(client, yfw);
    await seedYfzSales(client, yfz);

    const nomSeed = await client.query<{ id: string }>(
      `SELECT i.id FROM inventory_items i WHERE i.entity_id = $1 AND i.code = 'NOM-SEED'`,
      [nom],
    );
    const nomStock = await client.query<{ n: string }>(
      `SELECT coalesce(sum(quantity_in - quantity_out), 0)::text AS n
         FROM stock_movements WHERE item_id = $1`,
      [nomSeed.rows[0]?.id],
    );
    if (nomSeed.rows[0] && Number(nomStock.rows[0]?.n ?? 0) > 0) {
      await seedNomProduction(client, nom);
    }

    await client.query('COMMIT');
    return { alreadyPresent: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedOverhead(
  client: PoolClient,
  ids: { yfw: string; yfz: string; nom: string },
): Promise<void> {
  await client.query(
    `INSERT INTO production_overhead_rules (
       entity_id, category_id, method, rate, created_by, updated_by
     )
     SELECT e.id, c.id, r.method, r.rate, $1, $1
       FROM entities e
       JOIN (VALUES
         ('YFW', 'flour', 'percent_of_rm', 5),
         ('YFZ', 'finished_goods', 'per_output_kobo', 10),
         ('NOM', 'oil', 'percent_of_rm', 4)
       ) AS r(code, category, method, rate) ON r.code = e.code
       JOIN inventory_categories c ON c.entity_id = e.id AND c.key = r.category
      WHERE e.id = ANY($2::uuid[])`,
    [HAUWA_ID, [ids.yfw, ids.yfz, ids.nom]],
  );
}

async function seedYfwProduction(client: PoolClient, yfw: string): Promise<void> {
  const wheat = await itemRow(client, yfw, 'YFW-WHEAT');
  const flour = await itemRow(client, yfw, 'YFW-FLOUR');
  const warehouse = await warehouseId(client, yfw);
  if (!wheat || !flour || !warehouse) return;
  await openingStock(client, {
    entityId: yfw,
    itemId: wheat.id,
    warehouseId: warehouse,
    qty: 500,
    unitCostKobo: 40,
    occurredOn: '2026-01-15',
  });
  const ref = await nextRef(client, 'PRD');
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO production_orders (
       reference_number, entity_id, warehouse_id, finished_item_id, planned_output_qty,
       status, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, 80, 'PLANNED', $5, $5)
     RETURNING id`,
    [ref, yfw, warehouse, flour.id, HAUWA_ID],
  );
  const orderId = inserted.rows[0]?.id;
  if (!orderId) return;
  await client.query(
    `INSERT INTO production_order_inputs (
       order_id, entity_id, item_id, warehouse_id, planned_qty, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, 100, $5, $5)`,
    [orderId, yfw, wheat.id, warehouse, HAUWA_ID],
  );
  await client.query(
    `INSERT INTO production_order_outputs (
       order_id, entity_id, item_id, warehouse_id, planned_qty, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, 80, $5, $5)`,
    [orderId, yfw, flour.id, warehouse, HAUWA_ID],
  );
  await upsertSearchIndex(client, {
    recordType: 'PRODUCTION_ORDER',
    recordId: orderId,
    referenceNumber: ref,
    title: `Production ${ref} ${flour.code}`,
    searchableText: `${ref} ${flour.code} ${wheat.code}`,
    entityId: yfw,
    permissionKey: 'sales.view',
  });
}

async function seedNomProduction(client: PoolClient, nom: string): Promise<void> {
  const seed = await itemRow(client, nom, 'NOM-SEED');
  const oil = await itemRow(client, nom, 'NOM-OIL');
  const warehouse = await warehouseId(client, nom);
  if (!seed || !oil || !warehouse) return;
  const ref = await nextRef(client, 'PRD');
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO production_orders (
       reference_number, entity_id, warehouse_id, finished_item_id, planned_output_qty,
       status, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, 20, 'PLANNED', $5, $5)
     RETURNING id`,
    [ref, nom, warehouse, oil.id, HAUWA_ID],
  );
  const orderId = inserted.rows[0]?.id;
  if (!orderId) return;
  await client.query(
    `INSERT INTO production_order_inputs (
       order_id, entity_id, item_id, warehouse_id, planned_qty, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, 40, $5, $5)`,
    [orderId, nom, seed.id, warehouse, HAUWA_ID],
  );
  await client.query(
    `INSERT INTO production_order_outputs (
       order_id, entity_id, item_id, warehouse_id, planned_qty, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, 20, $5, $5)`,
    [orderId, nom, oil.id, warehouse, HAUWA_ID],
  );
}

async function seedYfzSales(client: PoolClient, yfz: string): Promise<void> {
  const warehouse = await warehouseId(client, yfz);
  if (!warehouse) return;
  const saleItem = await ensureSeedItem(client, yfz, warehouse, 'YFZ-M14-SALE', 'M14 bagged fertiliser');
  await openingStock(client, {
    entityId: yfz,
    itemId: saleItem.id,
    warehouseId: warehouse,
    qty: 50,
    unitCostKobo: 250,
    occurredOn: '2026-01-16',
  });

  const reservedRef = await nextRef(client, 'SO');
  const reserved = await client.query<{ id: string }>(
    `INSERT INTO sales_orders (
       reference_number, entity_id, customer_id, occurred_on, status, created_by, updated_by
     ) VALUES ($1, $2, $3, '2026-03-01', 'RESERVED', $4, $4)
     RETURNING id`,
    [reservedRef, yfz, YFZ_CUSTOMER_ID, HAUWA_ID],
  );
  const reservedId = reserved.rows[0]?.id;
  if (reservedId) {
    const line = await client.query<{ id: string }>(
      `INSERT INTO sales_order_lines (
         order_id, entity_id, item_id, warehouse_id, quantity, unit_price_kobo,
         reserved_qty, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, 5, 400, 5, $5, $5)
       RETURNING id`,
      [reservedId, yfz, saleItem.id, warehouse, HAUWA_ID],
    );
    if (line.rows[0]) {
      await client.query(
        `INSERT INTO stock_reservations (
           entity_id, sales_order_line_id, item_id, warehouse_id, quantity, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, 5, $5, $5)`,
        [yfz, line.rows[0].id, saleItem.id, warehouse, HAUWA_ID],
      );
    }
    await upsertSearchIndex(client, {
      recordType: 'SALES_ORDER',
      recordId: reservedId,
      referenceNumber: reservedRef,
      title: `Sales ${reservedRef}`,
      searchableText: `${reservedRef} reserved`,
      entityId: yfz,
      permissionKey: 'sales.view',
    });
  }

  const invoicedRef = await nextRef(client, 'SO');
  const invoiced = await client.query<{ id: string }>(
    `INSERT INTO sales_orders (
       reference_number, entity_id, customer_id, occurred_on, status, created_by, updated_by
     ) VALUES ($1, $2, $3, '2026-03-02', 'INVOICED', $4, $4)
     RETURNING id`,
    [invoicedRef, yfz, YFZ_CUSTOMER_ID, HAUWA_ID],
  );
  const invoicedId = invoiced.rows[0]?.id;
  if (!invoicedId) return;
  const line = await client.query<{ id: string }>(
    `INSERT INTO sales_order_lines (
       order_id, entity_id, item_id, warehouse_id, quantity, unit_price_kobo,
       reserved_qty, dispatched_qty, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, 2, 400, 0, 2, $5, $5)
     RETURNING id`,
    [invoicedId, yfz, saleItem.id, warehouse, HAUWA_ID],
  );
  const dspRef = await nextRef(client, 'DSP');
  const dispatch = await client.query<{ id: string }>(
    `INSERT INTO sales_dispatches (
       reference_number, entity_id, sales_order_id, destination, occurred_on, created_by, updated_by
     ) VALUES ($1, $2, $3, 'Damaturu depot', '2026-03-03', $4, $4)
     RETURNING id`,
    [dspRef, yfz, invoicedId, HAUWA_ID],
  );
  const movementRef = await nextRef(client, 'INV');
  const movement = await client.query<{ id: string }>(
    `INSERT INTO stock_movements (
       reference_number, entity_id, item_id, warehouse_id, quantity_in, quantity_out,
       unit_cost_kobo, value_kobo, source, source_id, notes, occurred_on, created_by
     ) VALUES ($1, $2, $3, $4, 0, 2, 250, -500, 'SALE', $5, $6, '2026-03-03', $7)
     RETURNING id`,
    [movementRef, yfz, saleItem.id, warehouse, dispatch.rows[0]?.id, `Dispatch ${dspRef}`, HAUWA_ID],
  );
  if (dispatch.rows[0] && line.rows[0]) {
    await client.query(
      `INSERT INTO sales_dispatch_lines (
         dispatch_id, entity_id, order_line_id, item_id, warehouse_id, quantity, unit_cost_kobo,
         movement_id, created_by
       ) VALUES ($1, $2, $3, $4, $5, 2, 250, $6, $7)`,
      [dispatch.rows[0].id, yfz, line.rows[0].id, saleItem.id, warehouse, movement.rows[0]?.id, HAUWA_ID],
    );
  }
  const arRef = await nextRef(client, 'ARI');
  const invoice = await client.query<{ id: string }>(
    `INSERT INTO receivable_invoices (
       reference_number, entity_id, customer_id, sales_order_id, invoice_date, due_date,
       amount_kobo, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, '2026-03-03', '2026-04-02', 800, $5, $5)
     RETURNING id`,
    [arRef, yfz, YFZ_CUSTOMER_ID, invoicedId, HAUWA_ID],
  );
  if (invoice.rows[0]) {
    await client.query(`UPDATE sales_orders SET receivable_invoice_id = $1, updated_by = $2 WHERE id = $3`, [
      invoice.rows[0].id,
      HAUWA_ID,
      invoicedId,
    ]);
  }
  await postTwoSided(client, {
    entityId: yfz,
    occurredOn: '2026-03-03',
    debit: '1220',
    credit: '4100',
    amountKobo: 800,
    source: 'SALES_REVENUE',
    narration: `Sales ${invoicedRef}`,
    key: `seed-so-rev:${invoicedId}`,
  });
  await postTwoSided(client, {
    entityId: yfz,
    occurredOn: '2026-03-03',
    debit: '5100',
    credit: '1400',
    amountKobo: 500,
    source: 'SALES_COGS',
    narration: `COGS ${invoicedRef}`,
    key: `seed-so-cogs:${invoicedId}`,
  });
  await upsertSearchIndex(client, {
    recordType: 'SALES_ORDER',
    recordId: invoicedId,
    referenceNumber: invoicedRef,
    title: `Sales ${invoicedRef}`,
    searchableText: `${invoicedRef} invoiced ${arRef}`,
    entityId: yfz,
    permissionKey: 'sales.view',
  });
}

async function openingStock(
  client: PoolClient,
  input: {
    entityId: string;
    itemId: string;
    warehouseId: string;
    qty: number;
    unitCostKobo: number;
    occurredOn: string;
  },
): Promise<void> {
  const existing = await client.query<{ n: string }>(
    `SELECT coalesce(sum(quantity_in - quantity_out), 0)::text AS n
       FROM stock_movements WHERE item_id = $1 AND warehouse_id = $2`,
    [input.itemId, input.warehouseId],
  );
  if (Number(existing.rows[0]?.n ?? 0) >= input.qty) return;
  const ref = await nextRef(client, 'INV');
  const value = Math.round(input.unitCostKobo * input.qty);
  await client.query(
    `INSERT INTO stock_movements (
       reference_number, entity_id, item_id, warehouse_id, quantity_in, quantity_out,
       unit_cost_kobo, value_kobo, source, notes, occurred_on, created_by
     ) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, 'GRN', 'M14 opening stock', $8, $9)`,
    [
      ref,
      input.entityId,
      input.itemId,
      input.warehouseId,
      input.qty,
      input.unitCostKobo,
      value,
      input.occurredOn,
      HAUWA_ID,
    ],
  );
  await postTwoSided(client, {
    entityId: input.entityId,
    occurredOn: input.occurredOn,
    debit: '1400',
    credit: '1300',
    amountKobo: value,
    source: 'INVENTORY_RECEIPT',
    narration: `Opening ${ref}`,
    key: `seed-open:${input.itemId}:${input.warehouseId}`,
  });
}

async function postTwoSided(
  client: PoolClient,
  input: {
    entityId: string;
    occurredOn: string;
    debit: string;
    credit: string;
    amountKobo: number;
    source: string;
    narration: string;
    key: string;
  },
): Promise<void> {
  const existing = await client.query(`SELECT 1 FROM journals WHERE idempotency_key = $1`, [input.key]);
  if (existing.rows[0] || input.amountKobo <= 0) return;
  const period = await client.query<{ id: string }>(
    `SELECT id FROM fiscal_periods
      WHERE entity_id = $1 AND status = 'OPEN' AND $2::date BETWEEN starts_on AND ends_on
      LIMIT 1`,
    [input.entityId, input.occurredOn],
  );
  const debit = await client.query<{ id: string }>(
    `SELECT id FROM accounts WHERE entity_id = $1 AND code = $2`,
    [input.entityId, input.debit],
  );
  const credit = await client.query<{ id: string }>(
    `SELECT id FROM accounts WHERE entity_id = $1 AND code = $2`,
    [input.entityId, input.credit],
  );
  if (!period.rows[0] || !debit.rows[0] || !credit.rows[0]) return;
  const ref = await nextRef(client, 'JNL');
  const journal = await client.query<{ id: string }>(
    `INSERT INTO journals (
       reference_number, entity_id, fiscal_period_id, narration, idempotency_key, source,
       status, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, 'DRAFT', $7, $7)
     RETURNING id`,
    [ref, input.entityId, period.rows[0].id, input.narration, input.key, input.source, HAUWA_ID],
  );
  const id = journal.rows[0]?.id;
  if (!id) return;
  await client.query(
    `INSERT INTO journal_lines (
       journal_id, entity_id, line_number, account_id, debit_kobo, credit_kobo, created_by, updated_by
     ) VALUES
       ($1, $2, 1, $3, $4, 0, $5, $5),
       ($1, $2, 2, $6, 0, $4, $5, $5)`,
    [id, input.entityId, debit.rows[0].id, input.amountKobo, HAUWA_ID, credit.rows[0].id],
  );
  await client.query(
    `UPDATE journals
        SET status = 'POSTED', posted_at = now(), posted_by = $1, updated_by = $1
      WHERE id = $2`,
    [HAUWA_ID, id],
  );
}

async function ensureSeedItem(
  client: PoolClient,
  entityId: string,
  warehouseId: string,
  code: string,
  name: string,
): Promise<{ id: string; code: string }> {
  const existing = await itemRow(client, entityId, code);
  if (existing) return existing;
  const category = await client.query<{ id: string }>(
    `SELECT id FROM inventory_categories WHERE entity_id = $1 AND key = 'packaging' LIMIT 1`,
    [entityId],
  );
  const uom = await client.query<{ id: string }>(`SELECT id FROM units_of_measure WHERE code = 'BAG' LIMIT 1`);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO inventory_items (
       entity_id, code, name, category_id, uom_id, default_warehouse_id, tracking_mode, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, 'none', $7, $7)
     RETURNING id`,
    [entityId, code, name, category.rows[0]?.id, uom.rows[0]?.id, warehouseId, HAUWA_ID],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error(`Seed item ${code} was not created.`);
  return { id, code };
}

async function itemRow(client: PoolClient, entityId: string, code: string) {
  const result = await client.query<{ id: string; code: string }>(
    `SELECT id, code FROM inventory_items WHERE entity_id = $1 AND code = $2`,
    [entityId, code],
  );
  return result.rows[0] ?? null;
}

async function warehouseId(client: PoolClient, entityId: string): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM warehouses WHERE entity_id = $1 AND status = 'ACTIVE' ORDER BY code LIMIT 1`,
    [entityId],
  );
  return result.rows[0]?.id ?? null;
}

async function nextRef(client: PoolClient, kind: string): Promise<string> {
  const result = await client.query<{ ref: string }>(`SELECT app.next_reference($1) AS ref`, [kind]);
  const ref = result.rows[0]?.ref;
  if (!ref) throw new Error(`Reference ${kind} was not allocated.`);
  return ref;
}
