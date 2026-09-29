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
  const pool = new Pool({
    ...config,
    application_name: applicationName,
    max: config.max ?? 10,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 10_000,
  });

  // Every session works in UTC. Display conversion to Africa/Lagos happens in
  // the presentation layer, never in SQL (A7).
  pool.on('connect', (client) => {
    void client.query("SET TIME ZONE 'UTC'");
  });

  return pool;
}

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

export function createDatabaseFromClient(client: PoolClient): Database {
  return drizzle(client, { schema, casing: 'snake_case' });
}
