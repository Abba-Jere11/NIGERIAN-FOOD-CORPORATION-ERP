import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { migrationsDir } from './env';

/**
 * A deliberately small SQL migration runner.
 *
 * The migrations are hand-written SQL because M1 depends on triggers,
 * Row-Level Security policies and privilege grants that no schema-generation
 * tool expresses. Each file is applied once, in filename order, inside a
 * transaction, and its checksum is recorded. Editing an applied migration is
 * refused: history is corrected by adding a new migration, never by rewriting
 * one that has already run.
 */

export interface MigrationFile {
  fileName: string;
  sql: string;
  checksum: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/** Line endings are normalised so a CRLF checkout does not change checksums. */
function checksumOf(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export function loadMigrationFiles(dir: string = migrationsDir()): MigrationFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((fileName) => {
      const sql = readFileSync(join(dir, fileName), 'utf8');
      return { fileName, sql, checksum: checksumOf(sql) };
    });
}

const MIGRATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    file_name  text PRIMARY KEY,
    checksum   text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    applied_by text NOT NULL
  )
`;

// Arbitrary but fixed: serialises concurrent migration runs against one database.
const MIGRATION_LOCK_KEY = 8_531_204;

export async function runMigrations(
  pool: Pool,
  options: { dir?: string; log?: (message: string) => void } = {},
): Promise<MigrationResult> {
  const log = options.log ?? (() => {});
  const files = loadMigrationFiles(options.dir);
  const applied: string[] = [];
  const skipped: string[] = [];

  const client = await pool.connect();
  try {
    await client.query(MIGRATION_TABLE_SQL);
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    const recorded = await client.query<{ file_name: string; checksum: string }>(
      'SELECT file_name, checksum FROM schema_migrations',
    );
    const recordedByName = new Map(recorded.rows.map((row) => [row.file_name, row.checksum]));

    for (const file of files) {
      const existing = recordedByName.get(file.fileName);

      if (existing !== undefined) {
        if (existing !== file.checksum) {
          throw new Error(
            `Migration ${file.fileName} has changed since it was applied ` +
              `(recorded ${existing.slice(0, 12)}, found ${file.checksum.slice(0, 12)}). ` +
              'Applied migrations are immutable; add a new migration instead.',
          );
        }
        skipped.push(file.fileName);
        continue;
      }

      log(`Applying ${file.fileName}`);
      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query(
          'INSERT INTO schema_migrations (file_name, checksum, applied_by) VALUES ($1, $2, $3)',
          [file.fileName, file.checksum, 'system:seed'],
        );
        await client.query('COMMIT');
        applied.push(file.fileName);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration ${file.fileName} failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }

  return { applied, skipped };
}
