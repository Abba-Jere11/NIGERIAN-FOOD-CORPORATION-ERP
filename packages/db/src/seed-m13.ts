import { SEED_USERS, YFZ_PROCUREMENT_AWAITING_DELIVERY_ID, YFZ_PROCUREMENT_PARTIAL_RECEIPT_ID } from '@nfc/shared';
import type { Pool, PoolClient } from 'pg';
import { upsertSearchIndex } from './search';

const HAUWA_ID = SEED_USERS.find((user) => user.email === 'inventory@nfc.local')?.id;

const CATEGORY_ITEMS: Record<string, Array<{ code: string; name: string; category: string; uom: string; reorder: number }>> = {
  YFZ: [
    { code: 'YFZ-UREA', name: 'Urea prills', category: 'raw_materials', uom: 'KG', reorder: 50 },
    { code: 'YFZ-BAG', name: 'Fertilizer bags', category: 'packaging', uom: 'BAG', reorder: 20 },
    { code: 'YFZ-SPARE', name: 'Mill spare kit', category: 'spare_parts', uom: 'PCS', reorder: 2 },
  ],
  YFW: [
    { code: 'YFW-WHEAT', name: 'Wheat grain', category: 'wheat', uom: 'KG', reorder: 100 },
    { code: 'YFW-FLOUR', name: 'Flour 50kg', category: 'flour', uom: 'BAG', reorder: 10 },
  ],
  DMA: [
    { code: 'DMA-BEEF', name: 'Beef carcass', category: 'meat', uom: 'KG', reorder: 5 },
    { code: 'DMA-HEAD', name: 'Livestock head', category: 'livestock', uom: 'HEAD', reorder: 2 },
  ],
  NOM: [
    { code: 'NOM-SEED', name: 'Oil seeds', category: 'seeds', uom: 'KG', reorder: 40 },
    { code: 'NOM-OIL', name: 'Refined oil', category: 'oil', uom: 'KG', reorder: 15 },
  ],
};

export async function seedM13(pool: Pool): Promise<{ alreadyPresent: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Categories must be restored even when item fixtures already exist (e.g. after a wipe
    // that cleared categories only, or a wipe followed by a partial seed).
    await seedCategories(client);

    const entities = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM entities WHERE code IN ('YFZ', 'YFW', 'DMA', 'NOM')`,
    );
    const byCode = new Map(entities.rows.map((row) => [row.code, row.id]));
    if (byCode.size < 4) throw new Error('Seed organisations before M13 fixtures.');

    // Warehouses must exist even when item fixtures already present (wipe risk).
    const warehouses: Record<string, string> = {};
    for (const [code, entityId] of byCode) {
      warehouses[code] = await ensureWarehouse(client, entityId, code);
    }

    const existing = await client.query(`SELECT 1 FROM inventory_items WHERE code = 'YFZ-UREA'`);
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return { alreadyPresent: true };
    }
    if (!HAUWA_ID) throw new Error('Seed identities before M13 fixtures.');

    const uoms = await client.query<{ id: string; code: string }>(`SELECT id, code FROM units_of_measure`);
    const uomByCode = new Map(uoms.rows.map((row) => [row.code, row.id]));

    for (const [code, items] of Object.entries(CATEGORY_ITEMS)) {
      const entityId = byCode.get(code);
      const warehouseId = warehouses[code];
      if (!entityId || !warehouseId) continue;
      const categories = await client.query<{ id: string; key: string }>(
        `SELECT id, key FROM inventory_categories WHERE entity_id = $1`,
        [entityId],
      );
      const catByKey = new Map(categories.rows.map((row) => [row.key, row.id]));
      for (const item of items) {
        const categoryId = catByKey.get(item.category);
        const uomId = uomByCode.get(item.uom) ?? uomByCode.get('PCS');
        if (!categoryId || !uomId) {
          throw new Error(`Missing category ${item.category} or UOM for ${item.code}.`);
        }
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO inventory_items (
             entity_id, code, name, category_id, uom_id, default_warehouse_id, reorder_level,
             tracking_mode, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'none', $8, $8)
           ON CONFLICT (entity_id, code) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [entityId, item.code, item.name, categoryId, uomId, warehouseId, item.reorder, HAUWA_ID],
        );
        const itemId = inserted.rows[0]?.id;
        if (!itemId) continue;
        await upsertSearchIndex(client, {
          recordType: 'ITEM',
          recordId: itemId,
          referenceNumber: item.code,
          title: item.name,
          searchableText: `${item.code} ${item.name}`,
          entityId,
          permissionKey: 'inventory.view',
        });
      }
    }

    await backfillExpected(client, byCode.get('YFZ')!);
    await backfillReceipts(client, byCode.get('YFZ')!, warehouses.YFZ!);

    await client.query('COMMIT');
    return { alreadyPresent: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedCategories(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO inventory_categories (entity_id, key, name, created_by, updated_by)
     SELECT e.id, c.key, c.name, 'system:seed', 'system:seed'
       FROM entities e
       JOIN (VALUES
         ('YFZ', 'raw_materials', 'Raw Materials'),
         ('YFZ', 'finished_goods', 'Finished Goods'),
         ('YFZ', 'spare_parts', 'Spare Parts'),
         ('YFZ', 'packaging', 'Packaging'),
         ('YFZ', 'equipment', 'Equipment'),
         ('YFZ', 'consumables', 'Consumables'),
         ('YFW', 'wheat', 'Wheat'),
         ('YFW', 'flour', 'Flour'),
         ('YFW', 'bran', 'Bran'),
         ('YFW', 'packaging', 'Packaging'),
         ('YFW', 'spare_parts', 'Spare Parts'),
         ('YFW', 'equipment', 'Equipment'),
         ('YFW', 'consumables', 'Consumables'),
         ('DMA', 'livestock', 'Livestock'),
         ('DMA', 'meat', 'Meat'),
         ('DMA', 'cold_room', 'Cold-room'),
         ('DMA', 'spare_parts', 'Spare Parts'),
         ('DMA', 'equipment', 'Equipment'),
         ('DMA', 'consumables', 'Consumables'),
         ('NOM', 'seeds', 'Seeds'),
         ('NOM', 'oil', 'Oil'),
         ('NOM', 'by_products', 'By-products'),
         ('NOM', 'packaging', 'Packaging'),
         ('NOM', 'spare_parts', 'Spare Parts'),
         ('NOM', 'equipment', 'Equipment'),
         ('NOM', 'consumables', 'Consumables')
       ) AS c(code, key, name) ON c.code = e.code
     ON CONFLICT (entity_id, key) DO NOTHING`,
  );
}

/** Idempotent category restore for wipe / ops scripts (same SQL as seedCategories). */
export async function ensureInventoryCategories(client: PoolClient): Promise<void> {
  await seedCategories(client);
}

async function ensureWarehouse(client: PoolClient, entityId: string, code: string): Promise<string> {
  const kind = code === 'DMA' ? 'cold_room' : 'store';
  const name =
    code === 'YFZ'
      ? 'YFZ mill stores'
      : code === 'DMA'
        ? 'DMA cold room'
        : `${code} mill store`;
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM warehouses WHERE entity_id = $1 AND code = 'MAIN'`,
    [entityId],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO warehouses (entity_id, code, name, kind, created_by, updated_by)
     VALUES ($1, 'MAIN', $2, $3, $4, $4)
     RETURNING id`,
    [entityId, name, kind, HAUWA_ID],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error(`Warehouse for ${code} was not created.`);
  return id;
}

async function backfillExpected(client: PoolClient, yfz: string): Promise<void> {
  const lines = await client.query<{
    request_id: string;
    line_id: string;
    vendor_id: string | null;
    quantity: string;
    required_date: string | null;
    description: string;
    unit_id: string | null;
    asset: boolean;
  }>(
    `SELECT r.id AS request_id, l.id AS line_id, r.vendor_id, l.quantity::text,
            v.required_date::text AS required_date, l.description, l.unit_id, coalesce(c.asset, false) AS asset
       FROM procurement_requests r
       JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
       JOIN procurement_version_lines l ON l.version_id = v.id
       LEFT JOIN procurement_categories c ON c.id = l.category_id
      WHERE r.entity_id = $1
        AND r.status IN ('AWAITING_DELIVERY', 'PARTIALLY_RECEIVED', 'AWAITING_PAYMENT')
        AND (c.stock_item = true OR c.asset = true)`,
    [yfz],
  );
  for (const line of lines.rows) {
    const itemId = await ensureItem(client, yfz, line.description, line.unit_id, line.asset);
    await client.query(
      `INSERT INTO expected_stock (
         entity_id, procurement_request_id, procurement_line_id, item_id, vendor_id,
         quantity_expected, quantity_remaining, required_date, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $8)
       ON CONFLICT (procurement_line_id) DO NOTHING`,
      [
        yfz,
        line.request_id,
        line.line_id,
        itemId,
        line.vendor_id,
        Number(line.quantity),
        line.required_date,
        HAUWA_ID,
      ],
    );
  }
}

async function backfillReceipts(client: PoolClient, yfz: string, warehouseId: string): Promise<void> {
  const receipts = await client.query<{
    id: string;
    request_id: string;
    line_id: string | null;
    quantity_accepted: string;
    received_date: string;
    reference_number: string;
    unit_price_kobo: string;
    description: string;
    unit_id: string | null;
    asset: boolean;
  }>(
    `SELECT g.id, g.request_id, g.line_id, g.quantity_accepted::text, g.received_date::text, g.reference_number,
            coalesce(l.unit_price_kobo, 0)::text AS unit_price_kobo, coalesce(l.description, 'Stock item') AS description,
            l.unit_id, coalesce(c.asset, false) AS asset
       FROM procurement_goods_receipts g
       JOIN procurement_requests r ON r.id = g.request_id
       LEFT JOIN procurement_version_lines l ON l.id = coalesce(g.line_id, (
         SELECT l2.id FROM procurement_version_lines l2
           JOIN procurement_versions v ON v.id = l2.version_id
          WHERE v.request_id = r.id AND v.version_number = r.current_version
          ORDER BY l2.line_number LIMIT 1
       ))
       LEFT JOIN procurement_categories c ON c.id = l.category_id
      WHERE g.entity_id = $1 AND g.quantity_accepted > 0
        AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.grn_id = g.id)`,
    [yfz],
  );
  for (const row of receipts.rows) {
    const accepted = Number(row.quantity_accepted);
    if (accepted <= 0) continue;
    const itemId = await ensureItem(client, yfz, row.description, row.unit_id, row.asset);
    const allocated = await client.query<{ ref: string }>(`SELECT app.next_reference('INV') AS ref`);
    const ref = allocated.rows[0]?.ref;
    if (!ref) throw new Error('INV reference was not allocated.');
    const unitCost = Number(row.unit_price_kobo);
    const movement = await client.query<{ id: string }>(
      `INSERT INTO stock_movements (
         reference_number, entity_id, item_id, warehouse_id, quantity_in, quantity_out,
         unit_cost_kobo, value_kobo, source, source_id, procurement_request_id, grn_id,
         notes, occurred_on, created_by
       ) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, 'GRN', $8, $9, $8, $10, $11, $12)
       RETURNING id`,
      [
        ref,
        yfz,
        itemId,
        warehouseId,
        accepted,
        unitCost,
        Math.round(unitCost * accepted),
        row.id,
        row.request_id,
        `Seeded from ${row.reference_number}`,
        row.received_date,
        HAUWA_ID,
      ],
    );
    const movementId = movement.rows[0]?.id;
    if (row.line_id) {
      await client.query(
        `UPDATE expected_stock
            SET quantity_remaining = GREATEST(quantity_remaining - $1, 0),
                status = CASE WHEN quantity_remaining - $1 <= 0 THEN 'CLOSED' ELSE status END,
                item_id = coalesce(item_id, $2),
                updated_by = $3
          WHERE procurement_line_id = $4`,
        [accepted, itemId, HAUWA_ID, row.line_id],
      );
    }
    if (movementId) {
      await upsertSearchIndex(client, {
        recordType: 'STOCK_MOVEMENT',
        recordId: movementId,
        referenceNumber: ref,
        title: `GRN ${ref}`,
        searchableText: `${ref} ${row.reference_number}`,
        entityId: yfz,
        permissionKey: 'inventory.view',
      });
    }
  }
  void YFZ_PROCUREMENT_AWAITING_DELIVERY_ID;
  void YFZ_PROCUREMENT_PARTIAL_RECEIPT_ID;
}

async function ensureItem(
  client: PoolClient,
  entityId: string,
  description: string,
  unitId: string | null,
  asset: boolean,
): Promise<string> {
  const name = description.trim() || 'Unnamed item';
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM inventory_items WHERE entity_id = $1 AND lower(name) = lower($2) LIMIT 1`,
    [entityId, name],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const category = await client.query<{ id: string }>(
    asset
      ? `SELECT id FROM inventory_categories WHERE entity_id = $1 AND key = 'equipment' LIMIT 1`
      : `SELECT id FROM inventory_categories WHERE entity_id = $1 AND key <> 'equipment' ORDER BY name LIMIT 1`,
    [entityId],
  );
  const categoryId = category.rows[0]?.id;
  if (!categoryId) throw new Error('Inventory categories are missing.');
  const uomId =
    unitId ??
    (await client.query<{ id: string }>(`SELECT id FROM units_of_measure WHERE code = 'PCS' LIMIT 1`)).rows[0]?.id;
  if (!uomId) throw new Error('A unit of measure is required.');
  const warehouse = await client.query<{ id: string }>(
    `SELECT id FROM warehouses WHERE entity_id = $1 AND status = 'ACTIVE' ORDER BY code LIMIT 1`,
    [entityId],
  );
  const code = `AUTO-${Date.now().toString(36).slice(-6).toUpperCase()}`;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO inventory_items (
       entity_id, code, name, category_id, uom_id, default_warehouse_id, tracking_mode, asset, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, 'none', $7, $8, $8)
     RETURNING id`,
    [entityId, code, name, categoryId, uomId, warehouse.rows[0]?.id ?? null, asset, HAUWA_ID],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error('The inventory item was not created.');
  return id;
}
