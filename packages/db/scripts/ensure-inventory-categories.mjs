/**
 * Idempotent restore of inventory categories for YFZ/YFW/DMA/NOM.
 * Safe to run after wipe or when seed early-exits.
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
config({ path: resolve(root, '.env') });

const host = process.env.PGHOST ?? 'localhost';
const port = process.env.PGPORT ?? '5432';
const user = process.env.PGUSER ?? 'postgres';
const dbPassword = process.env.PGPASSWORD ?? '';
const database = process.env.PGDATABASE ?? 'nfc_erp_dev';
const override = process.env.DATABASE_URL_OWNER?.trim();
const connectionString =
  override ||
  `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(dbPassword)}@${host}:${port}/${database}`;

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query(`
    INSERT INTO inventory_categories (entity_id, key, name, created_by, updated_by)
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
    ON CONFLICT (entity_id, key) DO NOTHING
  `);
  const rows = await client.query(`
    SELECT e.code, count(*)::int AS n
      FROM inventory_categories ic
      JOIN entities e ON e.id = ic.entity_id
     GROUP BY e.code
     ORDER BY e.code
  `);
  console.log(JSON.stringify({ ok: true, categories: rows.rows }, null, 2));
} finally {
  await client.end();
}
