import { SEED_USERS, YFZ_CUSTOMER_ID } from '@nfc/shared';
import type { Pool, PoolClient } from 'pg';
import { upsertSearchIndex } from './search';
import {
  FIXTURE_NOTE_PREFIX,
  HIST_NOTE_PREFIX,
  INVENTORY_CATALOGUES,
  OPENING_NOTE_PREFIX,
  type AssetCondition,
  type AssetStatus,
  type ItemDef,
  type StockStatus,
} from './seed-inventory-catalog';

const HAUWA_ID = SEED_USERS.find((user) => user.email === 'inventory@nfc.local')?.id ?? '';
const CUSTODIANS: Record<string, string[]> = {
  NFC: ['Hauwa Goni', 'Amina Bukar', 'Dr. Babagana Adam', 'Umar Tor'],
  YFZ: ['Musa Gwary', 'Ibrahim Staff'],
  YFW: ['Fatima Sani Lawal', 'Maryam Abubakar'],
  DMA: ['Ibrahim Kachalla Modu'],
  NOM: ['Aisha Mohammed Kyari'],
};

export interface InventorySeedSummary {
  dryRun: boolean;
  database: string;
  itemsCreated: number;
  itemsReused: number;
  assetsCreated: number;
  assetsReused: number;
  warehousesCreated: number;
  locationsCreated: number;
  batchesCreated: number;
  movementsCreated: number;
  serialsCreated: number;
  issuesCreated: number;
  transfersCreated: number;
  returnsCreated: number;
  productionCreated: number;
  reservationsCreated: number;
  skippedConflicts: string[];
  byEntity: Array<{
    code: string;
    items: number;
    assets: number;
    warehouses: number;
    locations: number;
    batches: number;
    movements: number;
  }>;
  populated: {
    items: number;
    assets: number;
    warehouses: number;
    locations: number;
    batches: number;
    movements: number;
  };
  totalsByEntityUnit: Array<{ entity: string; uom: string; qty: string }>;
  buckets: {
    lowStock: number;
    quarantinedItems: number;
    reservedItems: number;
    nearExpiryBatches: number;
    expiredBatches: number;
    zeroStock: number;
    negativeAvailable: number;
  };
}

function openingKey(itemCode: string, warehouse: string, status: string, batchOrSerial: string): string {
  return `${OPENING_NOTE_PREFIX} [${itemCode}:${warehouse}:${status}:${batchOrSerial}]`;
}

async function nextRef(client: PoolClient, kind: string): Promise<string> {
  const result = await client.query<{ ref: string }>(`SELECT app.next_reference($1) AS ref`, [kind]);
  const ref = result.rows[0]?.ref;
  if (!ref) throw new Error(`Reference ${kind} was not allocated.`);
  return ref;
}

async function ensureUoms(client: PoolClient): Promise<Map<string, string>> {
  await client.query(
    `INSERT INTO units_of_measure (code, name, created_by, updated_by) VALUES
       ('CTN', 'Cartons', $1, $1),
       ('BAG', 'Bags', $1, $1),
       ('PCS', 'Pieces', $1, $1),
       ('KG', 'Kilograms', $1, $1),
       ('LTR', 'Litres', $1, $1)
     ON CONFLICT (code) DO NOTHING`,
    [HAUWA_ID],
  );
  const rows = await client.query<{ id: string; code: string }>(`SELECT id, code FROM units_of_measure`);
  return new Map(rows.rows.map((row) => [row.code, row.id]));
}

export async function seedInventoryDev(
  pool: Pool,
  opts: { dryRun: boolean; database: string },
): Promise<InventorySeedSummary> {
  if (!HAUWA_ID) throw new Error('Seed identities before the inventory development seed.');
  const client = await pool.connect();
  const summary: InventorySeedSummary = {
    dryRun: opts.dryRun,
    database: opts.database,
    itemsCreated: 0,
    itemsReused: 0,
    assetsCreated: 0,
    assetsReused: 0,
    warehousesCreated: 0,
    locationsCreated: 0,
    batchesCreated: 0,
    movementsCreated: 0,
    serialsCreated: 0,
    issuesCreated: 0,
    transfersCreated: 0,
    returnsCreated: 0,
    productionCreated: 0,
    reservationsCreated: 0,
    skippedConflicts: [],
    byEntity: [],
    populated: { items: 0, assets: 0, warehouses: 0, locations: 0, batches: 0, movements: 0 },
    totalsByEntityUnit: [],
    buckets: {
      lowStock: 0,
      quarantinedItems: 0,
      reservedItems: 0,
      nearExpiryBatches: 0,
      expiredBatches: 0,
      zeroStock: 0,
      negativeAvailable: 0,
    },
  };
  try {
    await client.query('BEGIN');
    const uoms = await ensureUoms(client);
    const entities = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM entities WHERE code = ANY($1::text[])`,
      [INVENTORY_CATALOGUES.map((row) => row.code)],
    );
    const entityByCode = new Map(entities.rows.map((row) => [row.code, row.id]));
    const missing = INVENTORY_CATALOGUES.map((row) => row.code).filter((code) => !entityByCode.has(code));
    if (missing.length > 0) {
      throw new Error(`Entities not seeded: ${missing.join(', ')}. Run pnpm --filter @nfc/db seed -- --dev first.`);
    }

    for (const catalogue of INVENTORY_CATALOGUES) {
      const entityId = entityByCode.get(catalogue.code)!;
      const entityCounts = {
        code: catalogue.code,
        items: 0,
        assets: 0,
        warehouses: 0,
        locations: 0,
        batches: 0,
        movements: 0,
      };
      const warehouseIds = new Map<string, string>();
      const locationIds = new Map<string, string>();

      await client.query(
        `INSERT INTO inventory_categories (entity_id, key, name, created_by, updated_by)
         SELECT $1, c.key, c.name, $2, $2
           FROM jsonb_to_recordset($3::jsonb) AS c(key text, name text)
         ON CONFLICT (entity_id, key) DO NOTHING`,
        [entityId, HAUWA_ID, JSON.stringify(catalogue.categories)],
      );
      const categories = await client.query<{ id: string; key: string }>(
        `SELECT id, key FROM inventory_categories WHERE entity_id = $1`,
        [entityId],
      );
      const catByKey = new Map(categories.rows.map((row) => [row.key, row.id]));

      for (const warehouse of catalogue.warehouses) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM warehouses WHERE entity_id = $1 AND code = $2`,
          [entityId, warehouse.code],
        );
        let warehouseId = existing.rows[0]?.id;
        if (!warehouseId) {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO warehouses (entity_id, code, name, kind, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
            [entityId, warehouse.code, warehouse.name, warehouse.kind, HAUWA_ID],
          );
          warehouseId = inserted.rows[0]?.id;
          summary.warehousesCreated += 1;
          entityCounts.warehouses += 1;
        }
        if (!warehouseId) throw new Error(`Warehouse ${catalogue.code}/${warehouse.code} was not created.`);
        warehouseIds.set(warehouse.code, warehouseId);
        for (const location of warehouse.locations) {
          const locExisting = await client.query<{ id: string }>(
            `SELECT id FROM warehouse_locations WHERE warehouse_id = $1 AND code = $2`,
            [warehouseId, location.code],
          );
          let locationId = locExisting.rows[0]?.id;
          if (!locationId) {
            const inserted = await client.query<{ id: string }>(
              `INSERT INTO warehouse_locations (entity_id, warehouse_id, code, name, created_by, updated_by)
               VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
              [entityId, warehouseId, location.code, location.name, HAUWA_ID],
            );
            locationId = inserted.rows[0]?.id;
            summary.locationsCreated += 1;
            entityCounts.locations += 1;
          }
          if (locationId) locationIds.set(`${warehouse.code}:${location.code}`, locationId);
        }
      }

      const departments = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM departments WHERE entity_id = $1 AND status = 'ACTIVE' ORDER BY name`,
        [entityId],
      );

      for (const item of catalogue.items) {
        const result = await seedItem(client, {
          entityId,
          entityCode: catalogue.code,
          item,
          uoms,
          catByKey,
          warehouseIds,
          locationIds,
          departments: departments.rows,
          summary,
          entityCounts,
        });
        if (result === 'conflict') {
          summary.skippedConflicts.push(`${catalogue.code}/${item.code}`);
        }
      }

      summary.byEntity.push(entityCounts);
    }

    await seedHistoryAndFixtures(client, entityByCode, summary);
    await fillBucketStats(client, summary);

    if (opts.dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }
    return summary;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedItem(
  client: PoolClient,
  ctx: {
    entityId: string;
    entityCode: string;
    item: ItemDef;
    uoms: Map<string, string>;
    catByKey: Map<string, string>;
    warehouseIds: Map<string, string>;
    locationIds: Map<string, string>;
    departments: Array<{ id: string; name: string }>;
    summary: InventorySeedSummary;
    entityCounts: InventorySeedSummary['byEntity'][number];
  },
): Promise<'ok' | 'conflict'> {
  const { item, entityId, entityCode } = ctx;
  const categoryId = ctx.catByKey.get(item.category);
  const uomId = ctx.uoms.get(item.uom) ?? ctx.uoms.get('PCS');
  const warehouseId = ctx.warehouseIds.get(item.warehouse);
  if (!categoryId || !uomId || !warehouseId) {
    return 'conflict';
  }
  const locationId = item.location ? ctx.locationIds.get(`${item.warehouse}:${item.location}`) ?? null : null;
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM inventory_items WHERE entity_id = $1 AND code = $2`,
    [entityId, item.code],
  );
  let itemId = existing.rows[0]?.id;
  if (!itemId) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO inventory_items (
         entity_id, code, name, category_id, uom_id, default_warehouse_id, reorder_level,
         tracking_mode, asset, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       RETURNING id`,
      [
        entityId,
        item.code,
        item.name,
        categoryId,
        uomId,
        warehouseId,
        item.reorder,
        item.tracking,
        item.asset === true,
        HAUWA_ID,
      ],
    );
    itemId = inserted.rows[0]?.id;
    ctx.summary.itemsCreated += 1;
    ctx.entityCounts.items += 1;
  } else {
    ctx.summary.itemsReused += 1;
  }
  if (!itemId) return 'conflict';
  await upsertSearchIndex(client, {
    recordType: 'ITEM',
    recordId: itemId,
    referenceNumber: item.code,
    title: item.name,
    searchableText: `${item.code} ${item.name}`,
    entityId,
    permissionKey: 'inventory.view',
  });

  if (item.zero) return 'ok';

  if (item.batches && item.batches.length > 0) {
    for (const batch of item.batches) {
      const batchId = await ensureBatch(client, entityId, itemId, warehouseId, batch.code, ctx);
      const note = `${openingKey(item.code, item.warehouse, batch.status, batch.code)} mfg=${batch.manufacturedOn} exp=${batch.expiresOn ?? 'none'}`;
      const created = await insertOpening(client, {
        entityId,
        itemId,
        warehouseId,
        locationId,
        batchId,
        serialId: null,
        qty: batch.qty,
        unitCostKobo: item.unitCostKobo,
        status: batch.status,
        note,
        occurredOn: batch.manufacturedOn,
      });
      if (created) {
        ctx.summary.movementsCreated += 1;
        ctx.entityCounts.movements += 1;
      }
    }
    return 'ok';
  }

  if (item.serialCount && item.serialCount > 0) {
    await seedSerialAssets(client, {
      entityId,
      entityCode,
      itemId,
      item,
      warehouseId,
      locationId,
      departments: ctx.departments,
      summary: ctx.summary,
      entityCounts: ctx.entityCounts,
    });
    return 'ok';
  }

  const qty = item.available ?? 0;
  if (qty > 0) {
    const created = await insertOpening(client, {
      entityId,
      itemId,
      warehouseId,
      locationId,
      batchId: null,
      serialId: null,
      qty,
      unitCostKobo: item.unitCostKobo,
      status: 'AVAILABLE',
      note: openingKey(item.code, item.warehouse, 'AVAILABLE', 'NONE'),
      occurredOn: '2026-01-15',
    });
    if (created) {
      ctx.summary.movementsCreated += 1;
      ctx.entityCounts.movements += 1;
    }
  }
  if ((item.quarantined ?? 0) > 0) {
    const created = await insertOpening(client, {
      entityId,
      itemId,
      warehouseId,
      locationId,
      batchId: null,
      serialId: null,
      qty: item.quarantined!,
      unitCostKobo: item.unitCostKobo,
      status: 'QUARANTINED',
      note: openingKey(item.code, item.warehouse, 'QUARANTINED', 'NONE'),
      occurredOn: '2026-06-01',
    });
    if (created) {
      ctx.summary.movementsCreated += 1;
      ctx.entityCounts.movements += 1;
    }
  }
  if ((item.rejected ?? 0) > 0) {
    const created = await insertOpening(client, {
      entityId,
      itemId,
      warehouseId,
      locationId,
      batchId: null,
      serialId: null,
      qty: item.rejected!,
      unitCostKobo: item.unitCostKobo,
      status: 'REJECTED',
      note: openingKey(item.code, item.warehouse, 'REJECTED', 'NONE'),
      occurredOn: '2026-07-01',
    });
    if (created) {
      ctx.summary.movementsCreated += 1;
      ctx.entityCounts.movements += 1;
    }
  }
  return 'ok';
}

async function ensureBatch(
  client: PoolClient,
  entityId: string,
  itemId: string,
  warehouseId: string,
  batchCode: string,
  ctx: { summary: InventorySeedSummary; entityCounts: InventorySeedSummary['byEntity'][number] },
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM stock_batches WHERE item_id = $1 AND warehouse_id = $2 AND batch_code = $3`,
    [itemId, warehouseId, batchCode],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO stock_batches (entity_id, item_id, warehouse_id, batch_code, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [entityId, itemId, warehouseId, batchCode, HAUWA_ID],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error(`Batch ${batchCode} was not created.`);
  ctx.summary.batchesCreated += 1;
  ctx.entityCounts.batches += 1;
  return id;
}

async function insertOpening(
  client: PoolClient,
  input: {
    entityId: string;
    itemId: string;
    warehouseId: string;
    locationId: string | null;
    batchId: string | null;
    serialId: string | null;
    qty: number;
    unitCostKobo: number;
    status: StockStatus;
    note: string;
    occurredOn: string;
  },
): Promise<boolean> {
  if (input.qty <= 0) return false;
  const exists = await client.query(`SELECT 1 FROM stock_movements WHERE notes = $1 LIMIT 1`, [input.note]);
  if (exists.rows[0]) return false;
  const ref = await nextRef(client, 'INV');
  const value = Math.round(input.unitCostKobo * input.qty);
  await client.query(
    `INSERT INTO stock_movements (
       reference_number, entity_id, item_id, warehouse_id, location_id, batch_id, serial_id,
       quantity_in, quantity_out, unit_cost_kobo, value_kobo, source, notes, occurred_on, created_by, stock_status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, 'ADJUSTMENT', $11, $12, $13, $14)`,
    [
      ref,
      input.entityId,
      input.itemId,
      input.warehouseId,
      input.locationId,
      input.batchId,
      input.serialId,
      input.qty,
      input.unitCostKobo,
      value,
      input.note,
      input.occurredOn,
      HAUWA_ID,
      input.status,
    ],
  );
  return true;
}

function assetMix(index: number): { condition: AssetCondition; status: AssetStatus; assign: boolean } {
  if (index % 23 === 0) return { condition: 'damaged', status: 'DISPOSAL_PENDING', assign: false };
  if (index % 29 === 0) return { condition: 'poor', status: 'DISPOSED', assign: false };
  if (index % 5 === 0) return { condition: 'fair', status: 'IN_SERVICE', assign: true };
  if (index % 3 === 0) return { condition: 'good', status: 'IN_SERVICE', assign: true };
  if (index % 2 === 0) return { condition: 'new', status: 'IN_STORE', assign: false };
  return { condition: 'good', status: 'IN_STORE', assign: false };
}

async function seedSerialAssets(
  client: PoolClient,
  ctx: {
    entityId: string;
    entityCode: string;
    itemId: string;
    item: ItemDef;
    warehouseId: string;
    locationId: string | null;
    departments: Array<{ id: string; name: string }>;
    summary: InventorySeedSummary;
    entityCounts: InventorySeedSummary['byEntity'][number];
  },
): Promise<void> {
  const custodians = CUSTODIANS[ctx.entityCode] ?? ['Hauwa Goni'];
  const count = ctx.item.serialCount ?? 0;
  for (let index = 1; index <= count; index += 1) {
    const serialCode = `${ctx.item.code}-${String(index).padStart(4, '0')}`;
    const mix = assetMix(index);
    let serialId: string | null = null;
    const serialExisting = await client.query<{ id: string }>(
      `SELECT id FROM stock_serials WHERE item_id = $1 AND serial_code = $2`,
      [ctx.itemId, serialCode],
    );
    if (serialExisting.rows[0]) {
      serialId = serialExisting.rows[0].id;
    } else {
      const serialStatus = mix.status === 'DISPOSED' ? 'WRITTEN_OFF' : mix.status === 'IN_SERVICE' ? 'ISSUED' : 'ON_HAND';
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO stock_serials (entity_id, item_id, warehouse_id, serial_code, status, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
        [ctx.entityId, ctx.itemId, ctx.warehouseId, serialCode, serialStatus, HAUWA_ID],
      );
      serialId = inserted.rows[0]?.id ?? null;
      ctx.summary.serialsCreated += 1;
    }
    const note = openingKey(ctx.item.code, ctx.item.warehouse, 'AVAILABLE', serialCode);
    if (mix.status === 'IN_STORE' || mix.status === 'DISPOSAL_PENDING') {
      const created = await insertOpening(client, {
        entityId: ctx.entityId,
        itemId: ctx.itemId,
        warehouseId: ctx.warehouseId,
        locationId: ctx.locationId,
        batchId: null,
        serialId,
        qty: 1,
        unitCostKobo: ctx.item.unitCostKobo,
        status: 'AVAILABLE',
        note,
        occurredOn: '2026-02-01',
      });
      if (created) {
        ctx.summary.movementsCreated += 1;
        ctx.entityCounts.movements += 1;
      }
    }

    const assetExisting = await client.query<{ id: string }>(
      `SELECT id FROM fixed_assets WHERE item_id = $1 AND serial_code = $2`,
      [ctx.itemId, serialCode],
    );
    if (assetExisting.rows[0]) {
      ctx.summary.assetsReused += 1;
      continue;
    }
    const dept = mix.assign ? ctx.departments[index % Math.max(ctx.departments.length, 1)] : undefined;
    const custodian = mix.assign ? custodians[index % custodians.length] : null;
    const ref = await nextRef(client, 'AST');
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO fixed_assets (
         reference_number, entity_id, item_id, serial_id, serial_code, warehouse_id, location_label,
         department_id, department_label, custodian_name, condition, status, cost_kobo, acquired_on,
         created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)
       RETURNING id`,
      [
        ref,
        ctx.entityId,
        ctx.itemId,
        serialId,
        serialCode,
        ctx.warehouseId,
        ctx.item.location ?? ctx.item.warehouse,
        dept?.id ?? null,
        dept?.name ?? null,
        custodian,
        mix.condition,
        mix.status,
        ctx.item.unitCostKobo,
        '2026-02-01',
        HAUWA_ID,
      ],
    );
    const assetId = inserted.rows[0]?.id;
    if (!assetId) continue;
    ctx.summary.assetsCreated += 1;
    ctx.entityCounts.assets += 1;
    await client.query(
      `INSERT INTO fixed_asset_events (asset_id, entity_id, kind, department_id, department_label, location_label, custodian_name, condition, reason, created_by)
       VALUES ($1, $2, 'REGISTERED', $3, $4, $5, $6, $7, $8, $9)`,
      [
        assetId,
        ctx.entityId,
        dept?.id ?? null,
        dept?.name ?? null,
        ctx.item.location ?? ctx.item.warehouse,
        custodian,
        mix.condition,
        `${OPENING_NOTE_PREFIX} serial ${serialCode}`,
        HAUWA_ID,
      ],
    );
    if (mix.assign) {
      await client.query(
        `INSERT INTO fixed_asset_events (asset_id, entity_id, kind, department_id, department_label, custodian_name, reason, created_by)
         VALUES ($1, $2, 'ASSIGNED', $3, $4, $5, $6, $7)`,
        [assetId, ctx.entityId, dept?.id ?? null, dept?.name ?? null, custodian, HIST_NOTE_PREFIX, HAUWA_ID],
      );
    }
    await upsertSearchIndex(client, {
      recordType: 'ASSET',
      recordId: assetId,
      referenceNumber: ref,
      title: `${ctx.item.name} ${serialCode}`,
      searchableText: `${ref} ${serialCode} QR:${serialCode} BARCODE:${serialCode} ${ctx.item.name}`,
      entityId: ctx.entityId,
      permissionKey: 'inventory.view',
    });
  }
}

async function seedHistoryAndFixtures(
  client: PoolClient,
  entityByCode: Map<string, string>,
  summary: InventorySeedSummary,
): Promise<void> {
  const yfz = entityByCode.get('YFZ');
  const yfw = entityByCode.get('YFW');
  const nom = entityByCode.get('NOM');
  if (yfz) {
    await seedIssueHistory(client, yfz, 'YFZ-UREA-50', 40, 'Production issue of urea for blending', summary);
    await seedWipOrder(client, yfz, 'YFZ-NPK-RM', 'YFZ-NPK-FG', 200, 150, summary);
    await seedPlannedOrder(client, yfz, 'YFZ-UREA-50', 'YFZ-UREA-FG', 100, 80, summary);
    await seedReservation(client, yfz, 'YFZ-NPK-FG', 20, summary);
  }
  if (yfw) {
    await seedTransferHistory(client, yfw, 'YFW-BAG-FL', 'MAIN', 'FG', 80, summary);
    await seedReturnHistory(client, yfw, 'YFW-WHT-50', 25, summary);
    await seedPlannedOrder(client, yfw, 'YFW-WHT-50', 'YFW-FLR-50', 120, 90, summary);
  }
  if (nom) {
    await seedPlannedOrder(client, nom, 'NOM-GNT-50', 'NOM-OIL-RF', 80, 400, summary);
  }
}

async function firstBatchId(
  client: PoolClient,
  itemId: string,
  warehouseId: string,
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM stock_batches WHERE item_id = $1 AND warehouse_id = $2 ORDER BY batch_code LIMIT 1`,
    [itemId, warehouseId],
  );
  return result.rows[0]?.id ?? null;
}

async function itemInEntity(
  client: PoolClient,
  entityId: string,
  code: string,
): Promise<{ id: string; warehouse_id: string; unit_cost: number } | null> {
  const result = await client.query<{ id: string; warehouse_id: string | null }>(
    `SELECT id, default_warehouse_id AS warehouse_id FROM inventory_items WHERE entity_id = $1 AND code = $2`,
    [entityId, code],
  );
  const row = result.rows[0];
  if (!row) return null;
  const cost = await client.query<{ n: string }>(
    `SELECT coalesce(max(unit_cost_kobo), 0)::text AS n FROM stock_movements WHERE item_id = $1 AND quantity_in > 0`,
    [row.id],
  );
  const warehouseId =
    row.warehouse_id ??
    (await client.query<{ id: string }>(`SELECT id FROM warehouses WHERE entity_id = $1 ORDER BY code LIMIT 1`, [entityId]))
      .rows[0]?.id;
  if (!warehouseId) return null;
  return { id: row.id, warehouse_id: warehouseId, unit_cost: Number(cost.rows[0]?.n ?? 0) };
}

async function seedIssueHistory(
  client: PoolClient,
  entityId: string,
  itemCode: string,
  qty: number,
  reason: string,
  summary: InventorySeedSummary,
): Promise<void> {
  const key = `devtest:issue:${itemCode}`;
  const exists = await client.query(`SELECT 1 FROM stock_issues WHERE idempotency_key = $1`, [key]);
  if (exists.rows[0]) return;
  const item = await itemInEntity(client, entityId, itemCode);
  if (!item) return;
  const batchId = await firstBatchId(client, item.id, item.warehouse_id);
  const issueRef = await nextRef(client, 'ISS');
  const issued = await client.query<{ id: string }>(
    `INSERT INTO stock_issues (
       reference_number, entity_id, warehouse_id, destination_type, destination_label, reason,
       status, occurred_on, value_kobo, recipient_name, idempotency_key, created_by, updated_by
     ) VALUES ($1, $2, $3, 'production', 'Blending plant', $4, 'POSTED', '2026-09-15', $5, 'Musa Gwary', $6, $7, $7)
     RETURNING id`,
    [issueRef, entityId, item.warehouse_id, `${HIST_NOTE_PREFIX}: ${reason}`, qty * item.unit_cost, key, HAUWA_ID],
  );
  const issueId = issued.rows[0]?.id;
  if (!issueId) return;
  const movementNote = `${HIST_NOTE_PREFIX} [${key}]`;
  const movRef = await nextRef(client, 'INV');
  const movement = await client.query<{ id: string }>(
    `INSERT INTO stock_movements (
       reference_number, entity_id, item_id, warehouse_id, batch_id, quantity_in, quantity_out,
       unit_cost_kobo, value_kobo, source, source_id, notes, occurred_on, created_by, stock_status
     ) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, 'ISSUE', $9, $10, '2026-09-15', $11, 'AVAILABLE')
     RETURNING id`,
    [
      movRef,
      entityId,
      item.id,
      item.warehouse_id,
      batchId,
      qty,
      item.unit_cost,
      -Math.round(item.unit_cost * qty),
      issueId,
      movementNote,
      HAUWA_ID,
    ],
  );
  await client.query(
    `INSERT INTO stock_issue_lines (issue_id, entity_id, item_id, quantity, batch_id, movement_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [issueId, entityId, item.id, qty, batchId, movement.rows[0]?.id, HAUWA_ID],
  );
  summary.issuesCreated += 1;
  summary.movementsCreated += 1;
}

async function seedTransferHistory(
  client: PoolClient,
  entityId: string,
  itemCode: string,
  fromCode: string,
  toCode: string,
  qty: number,
  summary: InventorySeedSummary,
): Promise<void> {
  const key = `devtest:str:${itemCode}:${fromCode}:${toCode}`;
  const exists = await client.query(`SELECT 1 FROM stock_transfers WHERE idempotency_key = $1`, [key]);
  if (exists.rows[0]) return;
  const item = await itemInEntity(client, entityId, itemCode);
  const from = await client.query<{ id: string }>(
    `SELECT id FROM warehouses WHERE entity_id = $1 AND code = $2`,
    [entityId, fromCode],
  );
  const to = await client.query<{ id: string }>(
    `SELECT id FROM warehouses WHERE entity_id = $1 AND code = $2`,
    [entityId, toCode],
  );
  if (!item || !from.rows[0] || !to.rows[0]) return;
  const ref = await nextRef(client, 'STR');
  const transfer = await client.query<{ id: string }>(
    `INSERT INTO stock_transfers (
       reference_number, source_entity_id, destination_entity_id, source_warehouse_id, dest_warehouse_id,
       status, reason, occurred_on, idempotency_key, created_by, updated_by
     ) VALUES ($1, $2, $2, $3, $4, 'RECEIVED', $5, '2026-08-20', $6, $7, $7)
     RETURNING id`,
    [ref, entityId, from.rows[0].id, to.rows[0].id, `${HIST_NOTE_PREFIX} intra-store transfer`, key, HAUWA_ID],
  );
  const transferId = transfer.rows[0]?.id;
  if (!transferId) return;
  const outRef = await nextRef(client, 'INV');
  const inRef = await nextRef(client, 'INV');
  const out = await client.query<{ id: string }>(
    `INSERT INTO stock_movements (
       reference_number, entity_id, item_id, warehouse_id, quantity_in, quantity_out,
       unit_cost_kobo, value_kobo, source, source_id, notes, occurred_on, created_by, stock_status
     ) VALUES ($1, $2, $3, $4, 0, $5, $6, $7, 'TRANSFER', $8, $9, '2026-08-20', $10, 'AVAILABLE') RETURNING id`,
    [
      outRef,
      entityId,
      item.id,
      from.rows[0].id,
      qty,
      item.unit_cost || 2_400_000,
      -Math.round((item.unit_cost || 2_400_000) * qty),
      transferId,
      `${HIST_NOTE_PREFIX} [${key}:out]`,
      HAUWA_ID,
    ],
  );
  const inn = await client.query<{ id: string }>(
    `INSERT INTO stock_movements (
       reference_number, entity_id, item_id, warehouse_id, quantity_in, quantity_out,
       unit_cost_kobo, value_kobo, source, source_id, notes, occurred_on, created_by, stock_status
     ) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, 'TRANSFER', $8, $9, '2026-08-20', $10, 'AVAILABLE') RETURNING id`,
    [
      inRef,
      entityId,
      item.id,
      to.rows[0].id,
      qty,
      item.unit_cost || 2_400_000,
      Math.round((item.unit_cost || 2_400_000) * qty),
      transferId,
      `${HIST_NOTE_PREFIX} [${key}:in]`,
      HAUWA_ID,
    ],
  );
  await client.query(
    `INSERT INTO stock_transfer_lines (
       transfer_id, entity_id, item_id, quantity, out_movement_id, in_movement_id, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [transferId, entityId, item.id, qty, out.rows[0]?.id, inn.rows[0]?.id, HAUWA_ID],
  );
  summary.transfersCreated += 1;
  summary.movementsCreated += 2;
}

async function seedReturnHistory(
  client: PoolClient,
  entityId: string,
  itemCode: string,
  qty: number,
  summary: InventorySeedSummary,
): Promise<void> {
  const key = `devtest:ret:${itemCode}`;
  const already = await client.query(`SELECT 1 FROM stock_returns WHERE idempotency_key = $1`, [key]);
  if (already.rows[0]) return;
  const item = await itemInEntity(client, entityId, itemCode);
  if (!item) return;
  const batchId = await firstBatchId(client, item.id, item.warehouse_id);
  const ref = await nextRef(client, 'RET');
  const ret = await client.query<{ id: string }>(
    `INSERT INTO stock_returns (
       reference_number, entity_id, warehouse_id, kind, returned_by_name, department_label,
       reason, occurred_on, idempotency_key, created_by
     ) VALUES ($1, $2, $3, 'RECEIVE_RETURN', 'Fatima Sani Lawal', 'Production', $4, '2026-10-02', $5, $6)
     RETURNING id`,
    [ref, entityId, item.warehouse_id, `${FIXTURE_NOTE_PREFIX} ${key}`, key, HAUWA_ID],
  );
  const returnId = ret.rows[0]?.id;
  if (!returnId) return;
  const movRef = await nextRef(client, 'INV');
  const movement = await client.query<{ id: string }>(
    `INSERT INTO stock_movements (
       reference_number, entity_id, item_id, warehouse_id, batch_id, quantity_in, quantity_out,
       unit_cost_kobo, value_kobo, source, source_id, notes, occurred_on, created_by, stock_status
     ) VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, 'RETURN_IN', $9, $10, '2026-10-02', $11, 'QUARANTINED') RETURNING id`,
    [
      movRef,
      entityId,
      item.id,
      item.warehouse_id,
      batchId,
      qty,
      item.unit_cost,
      Math.round(item.unit_cost * qty),
      returnId,
      `${HIST_NOTE_PREFIX} [${key}]`,
      HAUWA_ID,
    ],
  );
  await client.query(
    `INSERT INTO stock_return_lines (return_id, entity_id, item_id, quantity, batch_id, from_status, movement_id, created_by)
     VALUES ($1, $2, $3, $4, $5, 'AVAILABLE', $6, $7)`,
    [returnId, entityId, item.id, qty, batchId, movement.rows[0]?.id, HAUWA_ID],
  );
  summary.returnsCreated += 1;
  summary.movementsCreated += 1;
}

async function seedWipOrder(
  client: PoolClient,
  entityId: string,
  rawCode: string,
  fgCode: string,
  rawQty: number,
  fgQty: number,
  summary: InventorySeedSummary,
): Promise<void> {
  const exists = await client.query(
    `SELECT 1 FROM production_orders o
       JOIN inventory_items i ON i.id = o.finished_item_id
      WHERE o.entity_id = $1 AND i.code = $2 AND o.status = 'IN_PROGRESS' AND o.planned_output_qty = $3`,
    [entityId, fgCode, fgQty],
  );
  if (exists.rows[0]) return;
  const raw = await itemInEntity(client, entityId, rawCode);
  const fg = await itemInEntity(client, entityId, fgCode);
  if (!raw || !fg) return;
  const batchId = await firstBatchId(client, raw.id, raw.warehouse_id);
  const ref = await nextRef(client, 'PRD');
  const order = await client.query<{ id: string }>(
    `INSERT INTO production_orders (
       reference_number, entity_id, warehouse_id, finished_item_id, planned_output_qty,
       status, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', $6, $6)
     RETURNING id`,
    [ref, entityId, fg.warehouse_id, fg.id, fgQty, HAUWA_ID],
  );
  const orderId = order.rows[0]?.id;
  if (!orderId) return;
  const movRef = await nextRef(client, 'INV');
  const movement = await client.query<{ id: string }>(
    `INSERT INTO stock_movements (
       reference_number, entity_id, item_id, warehouse_id, batch_id, quantity_in, quantity_out,
       unit_cost_kobo, value_kobo, source, source_id, notes, occurred_on, created_by, stock_status
     ) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, 'PRODUCTION', $9, $10, '2026-10-10', $11, 'AVAILABLE') RETURNING id`,
    [
      movRef,
      entityId,
      raw.id,
      raw.warehouse_id,
      batchId,
      rawQty,
      raw.unit_cost,
      -Math.round(raw.unit_cost * rawQty),
      orderId,
      `${FIXTURE_NOTE_PREFIX} WIP issue ${rawCode}`,
      HAUWA_ID,
    ],
  );
  await client.query(
    `INSERT INTO production_order_inputs (
       order_id, entity_id, item_id, warehouse_id, batch_id, planned_qty, actual_qty, unit_cost_kobo, movement_id, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $9)`,
    [orderId, entityId, raw.id, raw.warehouse_id, batchId, rawQty, raw.unit_cost, movement.rows[0]?.id, HAUWA_ID],
  );
  await client.query(
    `INSERT INTO production_order_outputs (
       order_id, entity_id, item_id, warehouse_id, planned_qty, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [orderId, entityId, fg.id, fg.warehouse_id, fgQty, HAUWA_ID],
  );
  summary.productionCreated += 1;
  summary.movementsCreated += 1;
}

async function seedPlannedOrder(
  client: PoolClient,
  entityId: string,
  rawCode: string,
  fgCode: string,
  rawQty: number,
  fgQty: number,
  summary: InventorySeedSummary,
): Promise<void> {
  const exists = await client.query(
    `SELECT 1 FROM production_orders o
       JOIN inventory_items i ON i.id = o.finished_item_id
      WHERE o.entity_id = $1 AND i.code = $2 AND o.status = 'PLANNED' AND o.planned_output_qty = $3`,
    [entityId, fgCode, fgQty],
  );
  if (exists.rows[0]) return;
  const raw = await itemInEntity(client, entityId, rawCode);
  const fg = await itemInEntity(client, entityId, fgCode);
  if (!raw || !fg) return;
  const ref = await nextRef(client, 'PRD');
  const order = await client.query<{ id: string }>(
    `INSERT INTO production_orders (
       reference_number, entity_id, warehouse_id, finished_item_id, planned_output_qty,
       status, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, 'PLANNED', $6, $6)
     RETURNING id`,
    [ref, entityId, fg.warehouse_id, fg.id, fgQty, HAUWA_ID],
  );
  const orderId = order.rows[0]?.id;
  if (!orderId) return;
  await client.query(
    `INSERT INTO production_order_inputs (
       order_id, entity_id, item_id, warehouse_id, planned_qty, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [orderId, entityId, raw.id, raw.warehouse_id, rawQty, HAUWA_ID],
  );
  await client.query(
    `INSERT INTO production_order_outputs (
       order_id, entity_id, item_id, warehouse_id, planned_qty, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [orderId, entityId, fg.id, fg.warehouse_id, fgQty, HAUWA_ID],
  );
  summary.productionCreated += 1;
}

async function seedReservation(
  client: PoolClient,
  entityId: string,
  itemCode: string,
  qty: number,
  summary: InventorySeedSummary,
): Promise<void> {
  const key = `${FIXTURE_NOTE_PREFIX} RESERVE ${itemCode}`;
  const exists = await client.query(`SELECT 1 FROM sales_orders WHERE terms = $1`, [key]);
  if (exists.rows[0]) return;
  const customer = await client.query(`SELECT 1 FROM customers WHERE id = $1`, [YFZ_CUSTOMER_ID]);
  if (!customer.rows[0]) {
    summary.skippedConflicts.push('sales reservation skipped: YFZ customer missing');
    return;
  }
  const item = await itemInEntity(client, entityId, itemCode);
  if (!item) return;
  const ref = await nextRef(client, 'SO');
  const order = await client.query<{ id: string }>(
    `INSERT INTO sales_orders (
       reference_number, entity_id, customer_id, terms, occurred_on, status, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, '2026-11-10', 'RESERVED', $5, $5)
     RETURNING id`,
    [ref, entityId, YFZ_CUSTOMER_ID, key, HAUWA_ID],
  );
  const orderId = order.rows[0]?.id;
  if (!orderId) return;
  const line = await client.query<{ id: string }>(
    `INSERT INTO sales_order_lines (
       order_id, entity_id, item_id, warehouse_id, quantity, unit_price_kobo, reserved_qty, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $5, $7, $7)
     RETURNING id`,
    [orderId, entityId, item.id, item.warehouse_id, qty, Math.round(item.unit_cost * 1.2), HAUWA_ID],
  );
  if (!line.rows[0]) return;
  await client.query(
    `INSERT INTO stock_reservations (
       entity_id, sales_order_line_id, item_id, warehouse_id, quantity, status, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $6)`,
    [entityId, line.rows[0].id, item.id, item.warehouse_id, qty, HAUWA_ID],
  );
  summary.reservationsCreated += 1;
}

const DEV_ITEM_PREFIX = `(i.code LIKE 'NFC-%' OR i.code LIKE 'YFZ-%' OR i.code LIKE 'YFW-%' OR i.code LIKE 'DMA-%' OR i.code LIKE 'NOM-%')`;

async function fillBucketStats(client: PoolClient, summary: InventorySeedSummary): Promise<void> {
  const low = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM (
       SELECT i.id,
              coalesce(sum(m.quantity_in - m.quantity_out) FILTER (WHERE m.stock_status = 'AVAILABLE'), 0)
                - coalesce((SELECT sum(r.quantity) FROM stock_reservations r WHERE r.item_id = i.id AND r.status = 'OPEN'), 0) AS available,
              i.reorder_level
         FROM inventory_items i
         LEFT JOIN stock_movements m ON m.item_id = i.id
        WHERE ${DEV_ITEM_PREFIX}
        GROUP BY i.id, i.reorder_level
      ) s WHERE s.available > 0 AND s.available <= s.reorder_level`,
  );
  const quarantined = await client.query<{ n: string }>(
    `SELECT count(DISTINCT item_id)::text AS n FROM stock_movements
      WHERE stock_status = 'QUARANTINED'
        AND (notes LIKE $1 OR notes LIKE $2 OR notes LIKE $3)`,
    [`${OPENING_NOTE_PREFIX}%`, `${HIST_NOTE_PREFIX}%`, `${FIXTURE_NOTE_PREFIX}%`],
  );
  const reserved = await client.query<{ n: string }>(
    `SELECT count(DISTINCT item_id)::text AS n FROM stock_reservations WHERE status = 'OPEN'`,
  );
  const near = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM stock_batches
      WHERE batch_code LIKE '%EXP202611%' OR batch_code LIKE '%EXP202612%'
         OR batch_code LIKE '%exp=2026-11%' OR batch_code LIKE '%exp=2026-12%'`,
  );
  const expired = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM stock_batches
      WHERE batch_code LIKE '%EXP2026%' AND batch_code ~ 'EXP2026(0[1-9]|10|11)'
        AND batch_code NOT LIKE '%EXP2026111%'
        AND batch_code NOT LIKE '%EXP2026112%'
        AND batch_code NOT LIKE '%EXP202612%'`,
  );
  const expiredSimple = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM stock_batches WHERE batch_code LIKE '%EXP20261101%'`,
  );
  const zero = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM inventory_items i
      WHERE ${DEV_ITEM_PREFIX}
        AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.item_id = i.id)`,
  );
  const negative = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM (
       SELECT i.id,
              coalesce(sum(m.quantity_in - m.quantity_out) FILTER (WHERE m.stock_status = 'AVAILABLE'), 0)
                - coalesce((SELECT sum(r.quantity) FROM stock_reservations r WHERE r.item_id = i.id AND r.status = 'OPEN'), 0) AS available
         FROM inventory_items i
         LEFT JOIN stock_movements m ON m.item_id = i.id
        WHERE ${DEV_ITEM_PREFIX}
        GROUP BY i.id
      ) s WHERE s.available < 0`,
  );
  const populated = await client.query<{
    items: string;
    assets: string;
    warehouses: string;
    locations: string;
    batches: string;
    movements: string;
  }>(
    `SELECT
       (SELECT count(*) FROM inventory_items i WHERE ${DEV_ITEM_PREFIX})::text AS items,
       (SELECT count(*) FROM fixed_assets a
          JOIN inventory_items i ON i.id = a.item_id WHERE ${DEV_ITEM_PREFIX})::text AS assets,
       (SELECT count(*) FROM warehouses w JOIN entities e ON e.id = w.entity_id
          WHERE e.code IN ('NFC','YFZ','YFW','DMA','NOM'))::text AS warehouses,
       (SELECT count(*) FROM warehouse_locations l JOIN entities e ON e.id = l.entity_id
          WHERE e.code IN ('NFC','YFZ','YFW','DMA','NOM'))::text AS locations,
       (SELECT count(*) FROM stock_batches b JOIN inventory_items i ON i.id = b.item_id
          WHERE ${DEV_ITEM_PREFIX})::text AS batches,
       (SELECT count(*) FROM stock_movements m JOIN inventory_items i ON i.id = m.item_id
          WHERE ${DEV_ITEM_PREFIX})::text AS movements`,
  );
  const totals = await client.query<{ entity: string; uom: string; qty: string }>(
    `SELECT e.code AS entity, u.code AS uom,
            coalesce(sum(m.quantity_in - m.quantity_out), 0)::text AS qty
       FROM stock_movements m
       JOIN inventory_items i ON i.id = m.item_id
       JOIN entities e ON e.id = i.entity_id
       JOIN units_of_measure u ON u.id = i.uom_id
      WHERE ${DEV_ITEM_PREFIX}
      GROUP BY e.code, u.code
      ORDER BY e.code, u.code`,
  );
  summary.buckets.lowStock = Number(low.rows[0]?.n ?? 0);
  summary.buckets.quarantinedItems = Number(quarantined.rows[0]?.n ?? 0);
  summary.buckets.reservedItems = Number(reserved.rows[0]?.n ?? 0);
  summary.buckets.nearExpiryBatches = Number(near.rows[0]?.n ?? 0);
  summary.buckets.expiredBatches = Number(expiredSimple.rows[0]?.n ?? expired.rows[0]?.n ?? 0);
  summary.buckets.zeroStock = Number(zero.rows[0]?.n ?? 0);
  summary.buckets.negativeAvailable = Number(negative.rows[0]?.n ?? 0);
  const pop = populated.rows[0];
  if (pop) {
    summary.populated = {
      items: Number(pop.items),
      assets: Number(pop.assets),
      warehouses: Number(pop.warehouses),
      locations: Number(pop.locations),
      batches: Number(pop.batches),
      movements: Number(pop.movements),
    };
  }
  summary.totalsByEntityUnit = totals.rows;
}

export function formatInventorySeedSummary(summary: InventorySeedSummary): string {
  const lines = [
    summary.dryRun ? 'DRY RUN — no changes committed.' : 'APPLIED — inventory development seed committed.',
    `Database: ${summary.database}`,
    `Items created: ${summary.itemsCreated}  reused: ${summary.itemsReused}`,
    `Assets created: ${summary.assetsCreated}  reused: ${summary.assetsReused}`,
    `Warehouses created: ${summary.warehousesCreated}  locations created: ${summary.locationsCreated}`,
    `Batches created: ${summary.batchesCreated}  serials created: ${summary.serialsCreated}`,
    `Ledger movements created: ${summary.movementsCreated}`,
    `History: issues ${summary.issuesCreated}, transfers ${summary.transfersCreated}, returns ${summary.returnsCreated}`,
    `Fixtures: production orders ${summary.productionCreated}, reservations ${summary.reservationsCreated}`,
    `Populated — items ${summary.populated.items}, assets ${summary.populated.assets}, warehouses ${summary.populated.warehouses}, locations ${summary.populated.locations}, batches ${summary.populated.batches}, movements ${summary.populated.movements}`,
    `Buckets — low-stock: ${summary.buckets.lowStock}, quarantined items: ${summary.buckets.quarantinedItems}, reserved: ${summary.buckets.reservedItems}, near-expiry batches: ${summary.buckets.nearExpiryBatches}, expired batches: ${summary.buckets.expiredBatches}, zero-stock: ${summary.buckets.zeroStock}, negative available: ${summary.buckets.negativeAvailable}`,
  ];
  for (const row of summary.byEntity) {
    lines.push(
      `  ${row.code} created this run: items ${row.items}, assets ${row.assets}, warehouses ${row.warehouses}, locations ${row.locations}, batches ${row.batches}, movements ${row.movements}`,
    );
  }
  for (const row of summary.totalsByEntityUnit) {
    lines.push(`  ${row.entity} ${row.uom}: on-hand ${row.qty}`);
  }
  if (summary.skippedConflicts.length > 0) {
    lines.push(`Conflicts skipped: ${summary.skippedConflicts.join('; ')}`);
  }
  return lines.join('\n');
}
