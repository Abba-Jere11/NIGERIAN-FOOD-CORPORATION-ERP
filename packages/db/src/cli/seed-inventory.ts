import { createPool } from '../client';
import { loadRootEnv, ownerConnection } from '../env';
import { INVENTORY_CATALOGUES } from '../seed-inventory-catalog';
import { formatInventorySeedSummary, seedInventoryDev } from '../seed-inventory-dev';
import { reportFailure } from './shared';

function databaseFromConnection(connectionString: string, fallback: string): string {
  try {
    const url = new URL(connectionString);
    const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return name || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Development-only inventory catalogue seed. Defaults to a dry-run.
 * Pass --apply to commit against the local nfc_erp_dev database.
 */
async function main(): Promise<void> {
  loadRootEnv();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed inventory while NODE_ENV=production.');
  }

  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply') && !argv.includes('--dry-run');
  const force = argv.includes('--force');
  const connection = ownerConnection('development');
  const database = databaseFromConnection(connection.connectionString, connection.database);

  if (database !== 'nfc_erp_dev' && !force) {
    throw new Error(
      `Refusing inventory seed against "${database}". Expected local development database nfc_erp_dev. Pass --force only if you have confirmed this is a local development database.`,
    );
  }

  const plannedItems = INVENTORY_CATALOGUES.reduce((sum, row) => sum + row.items.length, 0);
  const plannedAssets = INVENTORY_CATALOGUES.reduce(
    (sum, row) => sum + row.items.reduce((inner, item) => inner + (item.serialCount ?? 0), 0),
    0,
  );
  const plannedWarehouses = INVENTORY_CATALOGUES.reduce((sum, row) => sum + row.warehouses.length, 0);
  const plannedLocations = INVENTORY_CATALOGUES.reduce(
    (sum, row) => sum + row.warehouses.reduce((inner, warehouse) => inner + warehouse.locations.length, 0),
    0,
  );

  console.log(apply ? '\nApplying inventory development seed' : '\nDry-run inventory development seed (no commit)');
  console.log(`  Database: ${database}`);
  console.log(
    `  Catalogue: ${plannedItems} items, ${plannedAssets} serial assets, ${plannedWarehouses} warehouses, ${plannedLocations} locations`,
  );

  const pool = createPool({
    connectionString: connection.connectionString,
    applicationName: 'nfc-erp-seed-inventory',
    max: 1,
  });

  try {
    const summary = await seedInventoryDev(pool, { dryRun: !apply, database });
    console.log(`\n${formatInventorySeedSummary(summary)}`);
    if (!apply) {
      console.log('\nRe-run with --apply to commit against nfc_erp_dev:');
      console.log('  pnpm --filter @nfc/db seed:inventory -- --apply');
    }
  } finally {
    await pool.end();
  }
}

main().catch(reportFailure);
