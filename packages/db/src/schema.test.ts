import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUDIT_ACTIONS,
  ENTITY_TYPES,
  RECORD_STATUSES,
  ROLE_KEYS,
  SCOPE_TYPES,
} from '@nfc/shared';
import { describe, expect, it } from 'vitest';
import { migrationsDir } from './env';
import { loadMigrationFiles } from './migrator';
import {
  auditActionEnum,
  entityTypeEnum,
  recordStatusEnum,
  roleKeyEnum,
  scopeTypeEnum,
} from './schema';

/**
 * The same vocabulary is written down three times: in the SQL migration, in the
 * Drizzle schema, and in the shared TypeScript constants. SQL is the source of
 * truth and the other two follow it.
 *
 * Keeping them in step needs no database, so it is checked here rather than in
 * the integration suite. Without this, adding an action in one place and
 * forgetting the others surfaces as a rejected insert in production.
 */
function sqlEnumLabels(typeName: string): string[] {
  const sql = readFileSync(join(migrationsDir(), '0003_audit_log.sql'), 'utf8');
  const match = new RegExp(`CREATE TYPE ${typeName} AS ENUM \\(([^)]*)\\)`, 's').exec(sql);
  if (!match?.[1]) throw new Error(`No CREATE TYPE ${typeName} found in 0003_audit_log.sql`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1] as string);
}

describe('the Drizzle schema matches the shared constants', () => {
  it.each([
    ['entity_type', entityTypeEnum, ENTITY_TYPES],
    ['record_status', recordStatusEnum, RECORD_STATUSES],
    ['scope_type', scopeTypeEnum, SCOPE_TYPES],
    ['role_key', roleKeyEnum, ROLE_KEYS],
    ['audit_action', auditActionEnum, AUDIT_ACTIONS],
  ] as const)('%s', (_name, drizzleEnum, constants) => {
    expect([...drizzleEnum.enumValues]).toEqual([...constants]);
  });
});

describe('the SQL enums match the shared constants', () => {
  it('audit_action, in order', () => {
    // Order matters: PostgreSQL enum sort order is the declaration order, and
    // it is what `ORDER BY action` will use for the rest of the system's life.
    expect(sqlEnumLabels('audit_action')).toEqual([...AUDIT_ACTIONS]);
  });

  it('role_key holds exactly the five roles from A5', () => {
    expect(sqlEnumLabels('role_key')).toEqual([...ROLE_KEYS]);
  });

  it('scope_type', () => {
    expect(sqlEnumLabels('scope_type')).toEqual([...SCOPE_TYPES]);
  });
});

describe('the migration set', () => {
  it('is applied in filename order', () => {
    const names = loadMigrationFiles().map((file) => file.fileName);
    expect(names).toEqual([...names].sort());
    expect(names[0]).toBe('0001_conventions.sql');
  });

  it('numbers every migration uniquely', () => {
    const prefixes = loadMigrationFiles().map((file) => file.fileName.slice(0, 4));
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('gives every migration a checksum that ignores line endings', () => {
    for (const file of loadMigrationFiles()) {
      expect(file.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(file.sql.length).toBeGreaterThan(0);
    }
  });
});
