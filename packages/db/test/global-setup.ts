import { Client } from 'pg';
import { createPool } from '../src/client';
import { loadDatabaseEnv, maintenanceConnection, ownerConnection } from '../src/env';
import { runMigrations } from '../src/migrator';
import { seedOrganizationStructure } from '../src/seed';
import { seedEngines } from '../src/seed-engines';
import { seedIdentity } from '../src/seed-identity';
import { seedM4 } from '../src/seed-m4';
import { seedM5 } from '../src/seed-m5';
import { seedM6 } from '../src/seed-m6';
import { seedM7 } from '../src/seed-m7';
import { seedM8 } from '../src/seed-m8';
import { seedM9 } from '../src/seed-m9';
import { seedM10 } from '../src/seed-m10';
import { seedM11 } from '../src/seed-m11';
import { seedM12 } from '../src/seed-m12';
import { seedM13 } from '../src/seed-m13';
import { seedM14 } from '../src/seed-m14';
import { seedM15 } from '../src/seed-m15';
import { quoteIdentifier, quoteLiteral } from '../src/cli/shared';

/**
 * Builds the test database from nothing, once per run.
 *
 * The schemas are dropped and the migrations re-applied rather than the tables
 * being emptied, because emptying them is impossible by design: `audit_log`
 * refuses DELETE and TRUNCATE (rule R2). Rebuilding from the migrations also
 * means every run proves the migrations work on an empty database.
 */
export default async function setup(): Promise<void> {
  process.env.NODE_ENV = 'test';

  let env: ReturnType<typeof loadDatabaseEnv>;
  try {
    env = loadDatabaseEnv();
  } catch (error) {
    throw new Error(
      'The integration tests need a PostgreSQL connection. ' +
        'Copy .env.example to .env at the repository root and fill in PGPASSWORD and APP_DB_PASSWORD.\n' +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  await ensureRoleAndDatabase(env);

  const pool = createPool({
    ...ownerConnection('test', env),
    applicationName: 'nfc-erp-test-setup',
  });

  try {
    await pool.query('DROP SCHEMA IF EXISTS app CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(env.appUser)}`);

    const result = await runMigrations(pool);
    if (result.applied.length === 0) {
      throw new Error('No migrations were applied to the test database.');
    }

    await seedOrganizationStructure(pool);
    const password = process.env.SEED_USER_PASSWORD;
    if (!password) {
      throw new Error('SEED_USER_PASSWORD is required to seed identities for the integration tests.');
    }
    const mfaKey = process.env.MFA_ENCRYPTION_KEY?.trim() || null;
    const skip = ['true', '1', 'yes'].includes(
      (process.env.SEED_E2E_SKIP_MUST_CHANGE ?? '').toLowerCase(),
    );
    await seedIdentity(pool, {
      password,
      e2eReady: skip && Boolean(mfaKey),
      mfaEncryptionKey: mfaKey,
    });
    await seedEngines(pool);
    await seedM4(pool);
    await seedM5(pool);
    await seedM6(pool);
    await seedM7(pool);
    await seedM8(pool);
    await seedM9(pool);
    await seedM10(pool);
    await seedM11(pool);
    await seedM12(pool);
    await seedM13(pool);
    await seedM14(pool);
    await seedM15(pool);
  } finally {
    await pool.end();
  }
}

/**
 * The cluster may not have been bootstrapped yet. Creating the role and database
 * here keeps `pnpm test` runnable on a fresh checkout and in CI, where the
 * PostgreSQL service starts empty.
 */
async function ensureRoleAndDatabase(env: ReturnType<typeof loadDatabaseEnv>): Promise<void> {
  const client = new Client(maintenanceConnection(env));
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Could not connect to PostgreSQL at ${env.host}:${env.port} as "${env.ownerUser}". ` +
        'Check PGHOST, PGPORT, PGUSER and PGPASSWORD in the root .env.\n' +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  try {
    const roleIdent = quoteIdentifier(env.appUser);
    const options = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
    const roleExists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [
      env.appUser,
    ]);
    const statement = roleExists.rowCount === 0 ? 'CREATE ROLE' : 'ALTER ROLE';
    await client.query(
      `${statement} ${roleIdent} ${options} PASSWORD ${quoteLiteral(env.appPassword)}`,
    );

    const dbIdent = quoteIdentifier(env.testDatabase);
    const dbExists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      env.testDatabase,
    ]);
    if (dbExists.rowCount === 0) {
      await client.query(`CREATE DATABASE ${dbIdent} OWNER ${quoteIdentifier(env.ownerUser)}`);
    }
    await client.query(`GRANT CONNECT ON DATABASE ${dbIdent} TO ${roleIdent}`);
  } finally {
    await client.end();
  }
}
