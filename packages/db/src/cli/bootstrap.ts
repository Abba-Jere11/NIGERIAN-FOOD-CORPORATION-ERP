import { Client } from 'pg';
import { loadDatabaseEnv, maintenanceConnection } from '../env';
import { quoteIdentifier, quoteLiteral, reportFailure } from './shared';

/**
 * Prepares the PostgreSQL cluster for the NFC Mini ERP.
 *
 * Creates the least-privileged application role and both application
 * databases. Safe to run repeatedly. Requires the `postgres` password from the
 * root `.env`.
 */
async function main(): Promise<void> {
  const env = loadDatabaseEnv();
  const client = new Client(maintenanceConnection(env));
  await client.connect();

  try {
    console.log(`Connected to ${env.host}:${env.port} as ${env.ownerUser}`);

    const roleIdent = quoteIdentifier(env.appUser);
    const passwordLiteral = quoteLiteral(env.appPassword);
    const roleExists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [
      env.appUser,
    ]);

    // NOBYPASSRLS is the point of this role: Row-Level Security must apply to
    // the account the application connects as (rule R5).
    const roleOptions = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
    if (roleExists.rowCount === 0) {
      await client.query(`CREATE ROLE ${roleIdent} ${roleOptions} PASSWORD ${passwordLiteral}`);
      console.log(`Created application role ${env.appUser}`);
    } else {
      await client.query(`ALTER ROLE ${roleIdent} ${roleOptions} PASSWORD ${passwordLiteral}`);
      console.log(`Application role ${env.appUser} already present, options refreshed`);
    }

    for (const database of [env.database, env.testDatabase]) {
      const dbIdent = quoteIdentifier(database);
      const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
      if (exists.rowCount === 0) {
        await client.query(`CREATE DATABASE ${dbIdent} OWNER ${quoteIdentifier(env.ownerUser)}`);
        console.log(`Created database ${database}`);
      } else {
        console.log(`Database ${database} already present`);
      }
      await client.query(`GRANT CONNECT ON DATABASE ${dbIdent} TO ${roleIdent}`);
    }

    console.log('\nBootstrap complete. Next: pnpm db:migrate');
  } finally {
    await client.end();
  }
}

main().catch(reportFailure);
