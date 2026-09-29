import { Client } from 'pg';
import { createPool } from '../client';
import { loadDatabaseEnv, maintenanceConnection, ownerConnection } from '../env';
import { runMigrations } from '../migrator';
import { seedOrganizationStructure } from '../seed';
import { quoteIdentifier, reportFailure, targetsFromArgv } from './shared';

/**
 * Drops and rebuilds a database from scratch, then migrates and seeds it.
 *
 * This is a development convenience for proving that migrations and seeds run
 * from nothing. It refuses to run when NODE_ENV is production.
 */
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to reset a database while NODE_ENV=production');
  }

  const env = loadDatabaseEnv();
  const targets = targetsFromArgv();

  const admin = new Client(maintenanceConnection(env));
  await admin.connect();
  try {
    for (const target of targets) {
      const database = target === 'test' ? env.testDatabase : env.database;
      const ident = quoteIdentifier(database);
      console.log(`\nResetting ${database}`);

      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [database],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${ident}`);
      await admin.query(`CREATE DATABASE ${ident} OWNER ${quoteIdentifier(env.ownerUser)}`);
      await admin.query(`GRANT CONNECT ON DATABASE ${ident} TO ${quoteIdentifier(env.appUser)}`);
      console.log('  Recreated');
    }
  } finally {
    await admin.end();
  }

  for (const target of targets) {
    const pool = createPool({
      connectionString: ownerConnection(target).connectionString,
      applicationName: 'nfc-erp-reset',
      max: 1,
    });
    try {
      const result = await runMigrations(pool, { log: (message) => console.log(`  ${message}`) });
      console.log(`  Applied ${result.applied.length} migration(s)`);
      const summary = await seedOrganizationStructure(pool);
      console.log(
        `  Seeded ${summary.entitiesCreated} entities and ${summary.departmentsCreated} departments`,
      );
    } finally {
      await pool.end();
    }
  }
}

main().catch(reportFailure);
