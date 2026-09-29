import { createPool } from '../client';
import { ownerConnection } from '../env';
import { runMigrations } from '../migrator';
import { reportFailure, targetsFromArgv } from './shared';

/**
 * Applies pending SQL migrations. Runs against both the development and test
 * databases by default; pass `--dev` or `--test` to target one.
 */
async function main(): Promise<void> {
  for (const target of targetsFromArgv()) {
    const connection = ownerConnection(target);
    console.log(`\n${target}: ${connection.database}`);

    const pool = createPool({
      connectionString: connection.connectionString,
      applicationName: 'nfc-erp-migrate',
      max: 1,
    });

    try {
      const result = await runMigrations(pool, { log: (message) => console.log(`  ${message}`) });
      if (result.applied.length === 0) {
        console.log(`  Up to date (${result.skipped.length} migrations already applied)`);
      } else {
        console.log(`  Applied ${result.applied.length} migration(s)`);
      }
    } finally {
      await pool.end();
    }
  }
}

main().catch(reportFailure);
