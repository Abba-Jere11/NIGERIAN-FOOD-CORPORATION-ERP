import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

/**
 * The repository keeps a single `.env` at its root. Both the API and the
 * database tooling read it, so connection details are defined once.
 */
let rootDirCache: string | null = null;

export function findRepositoryRoot(startDir: string = __dirname): string {
  if (rootDirCache) return rootDirCache;

  let current = resolve(startDir);
  for (;;) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) {
      rootDirCache = current;
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Could not locate the repository root above ${startDir}`);
    }
    current = parent;
  }
}

let envLoaded = false;

/** Loads the root `.env` into `process.env` exactly once. */
export function loadRootEnv(): void {
  if (envLoaded) return;
  const envPath = join(findRepositoryRoot(), '.env');
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath, quiet: true });
  }
  envLoaded = true;
}

export interface DatabaseConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  connectionString: string;
}

export interface DatabaseEnv {
  host: string;
  port: number;
  /** The owning superuser used for migrations, seeds and test fixtures. */
  ownerUser: string;
  ownerPassword: string;
  /**
   * The least-privileged role the application connects as. It is not the table
   * owner and does not hold BYPASSRLS, so Row-Level Security applies to it.
   */
  appUser: string;
  appPassword: string;
  database: string;
  testDatabase: string;
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `Environment variable ${name} is not set. Copy .env.example to .env at the repository root and fill it in.`,
    );
  }
  return value;
}

export function loadDatabaseEnv(): DatabaseEnv {
  loadRootEnv();

  const port = Number.parseInt(process.env.PGPORT ?? '5432', 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PGPORT must be a positive integer, received "${process.env.PGPORT}"`);
  }

  return {
    host: process.env.PGHOST ?? 'localhost',
    port,
    ownerUser: process.env.PGUSER ?? 'postgres',
    ownerPassword: required('PGPASSWORD', process.env.PGPASSWORD),
    appUser: process.env.APP_DB_USER ?? 'nfc_app',
    appPassword: required('APP_DB_PASSWORD', process.env.APP_DB_PASSWORD),
    database: process.env.PGDATABASE ?? 'nfc_erp_dev',
    testDatabase: process.env.PGDATABASE_TEST ?? 'nfc_erp_test',
  };
}

function buildUrl(
  env: DatabaseEnv,
  user: string,
  password: string,
  database: string,
): DatabaseConnection {
  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);
  return {
    host: env.host,
    port: env.port,
    database,
    user,
    password,
    connectionString: `postgresql://${encodedUser}:${encodedPassword}@${env.host}:${env.port}/${database}`,
  };
}

export type DatabaseTarget = 'development' | 'test';

export function resolveTarget(explicit?: DatabaseTarget): DatabaseTarget {
  if (explicit) return explicit;
  return process.env.NODE_ENV === 'test' ? 'test' : 'development';
}

function databaseFor(env: DatabaseEnv, target: DatabaseTarget): string {
  return target === 'test' ? env.testDatabase : env.database;
}

/** Connection for migrations, seeds and fixtures. Bypasses RLS as table owner. */
export function ownerConnection(
  target?: DatabaseTarget,
  env = loadDatabaseEnv(),
): DatabaseConnection {
  const resolved = resolveTarget(target);
  const override =
    resolved === 'test' ? process.env.DATABASE_URL_TEST_OWNER : process.env.DATABASE_URL_OWNER;
  if (override && override.trim() !== '') {
    return {
      ...buildUrl(env, env.ownerUser, env.ownerPassword, databaseFor(env, resolved)),
      connectionString: override,
    };
  }
  return buildUrl(env, env.ownerUser, env.ownerPassword, databaseFor(env, resolved));
}

/** Connection the application uses. Subject to Row-Level Security. */
export function appConnection(
  target?: DatabaseTarget,
  env = loadDatabaseEnv(),
): DatabaseConnection {
  const resolved = resolveTarget(target);
  const override = resolved === 'test' ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
  if (override && override.trim() !== '') {
    return {
      ...buildUrl(env, env.appUser, env.appPassword, databaseFor(env, resolved)),
      connectionString: override,
    };
  }
  return buildUrl(env, env.appUser, env.appPassword, databaseFor(env, resolved));
}

/** Connection to the `postgres` maintenance database, for CREATE DATABASE. */
export function maintenanceConnection(env = loadDatabaseEnv()): DatabaseConnection {
  return buildUrl(env, env.ownerUser, env.ownerPassword, 'postgres');
}

export function migrationsDir(): string {
  const packaged = resolve(__dirname, '..', 'migrations');
  if (existsSync(packaged)) return packaged;
  return resolve(findRepositoryRoot(), 'packages', 'db', 'migrations');
}

export function readMigrationFile(fileName: string): string {
  return readFileSync(join(migrationsDir(), fileName), 'utf8');
}
