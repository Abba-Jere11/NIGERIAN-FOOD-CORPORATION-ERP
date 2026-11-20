import { createPool } from '../client';
import { ownerConnection } from '../env';

async function main(): Promise<void> {
  const connection = ownerConnection('development');
  const pool = createPool({
    connectionString: connection.connectionString,
    applicationName: 'nfc-inventory-count',
    max: 1,
  });
  try {
    const result = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM inventory_items) AS items,
        (SELECT count(*)::int FROM fixed_assets) AS assets,
        (SELECT count(*)::int FROM fixed_assets WHERE reference_number LIKE 'AST-%') AS ast_refs,
        (SELECT count(DISTINCT reference_number)::int FROM fixed_assets) AS ast_distinct,
        (SELECT count(*)::int FROM stock_batches) AS batches,
        (SELECT count(*)::int FROM stock_batches WHERE manufactured_on IS NOT NULL) AS batches_with_mfg,
        (SELECT count(*)::int FROM stock_batches WHERE expires_on IS NOT NULL) AS batches_with_exp,
        (SELECT count(*)::int FROM stock_movements) AS movements,
        (SELECT count(*)::int FROM warehouses) AS warehouses,
        (SELECT count(*)::int FROM warehouse_locations) AS locations
    `);
    console.log(JSON.stringify(result.rows[0], null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
