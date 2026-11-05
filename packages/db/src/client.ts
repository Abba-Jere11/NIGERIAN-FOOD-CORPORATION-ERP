import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { schema } from './schema';

export type Database = NodePgDatabase<typeof schema>;
export type { PoolClient };

export interface CreatePoolOptions extends Omit<PoolConfig, 'connectionString'> {
  connectionString: string;
  /** Applied to every connection, before the pool hands it out. */
  applicationName?: string;
}

export function createPool(options: CreatePoolOptions): Pool {
  const { applicationName = 'nfc-erp', ...config } = options;

  return new Pool({
    ...config,
    application_name: applicationName,
    // Every session works in UTC; conversion to Africa/Lagos happens in the
    // presentation layer, never in SQL (A7).
    //
    // This is passed as a startup option rather than run as `SET TIME ZONE` on
    // connect, because the pool does not wait for its own connect listeners: a
    // query issued immediately after checkout could otherwise reach the server
    // before the timezone was applied and read timestamps in the server's zone.
    options: [config.options, '-c timezone=UTC'].filter(Boolean).join(' '),
    max: config.max ?? 10,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 10_000,
  });
}

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

export function createDatabaseFromClient(client: PoolClient): Database {
  return drizzle(client, { schema, casing: 'snake_case' });
}
