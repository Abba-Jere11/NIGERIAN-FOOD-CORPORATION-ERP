import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUDIT_ACTIONS,
  ENTITY_TYPES,
  RECORD_STATUSES,
  ROLE_KEYS,
  SCOPE_TYPES,
  USER_STATUSES,
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
  userStatusEnum,
} from './schema';

/**
 * The same vocabulary is written down three times: in the SQL migration, in the
 * Drizzle schema, and in the shared TypeScript constants. SQL is the source of
 * truth and the other two follow it.
 */
function sqlEnumLabels(typeName: string): string[] {
  const files = loadMigrationFiles();
  const created: string[] = [];
  const added: string[] = [];
  for (const file of files) {
    const create = new RegExp(`CREATE TYPE ${typeName} AS ENUM \\(([^)]*)\\)`, 's').exec(file.sql);
    if (create?.[1]) {
      created.push(...[...create[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1] as string));
    }
    for (const match of file.sql.matchAll(
      new RegExp(`ALTER TYPE ${typeName} ADD VALUE(?: IF NOT EXISTS)? '([^']+)'`, 'g'),
    )) {
      if (match[1]) added.push(match[1]);
    }
  }
  if (created.length === 0) {
    throw new Error(`No CREATE TYPE ${typeName} found in migrations`);
  }
  return [...created, ...added];
}

describe('the Drizzle schema matches the shared constants', () => {
  it.each([
    ['entity_type', entityTypeEnum, ENTITY_TYPES],
    ['record_status', recordStatusEnum, RECORD_STATUSES],
    ['scope_type', scopeTypeEnum, SCOPE_TYPES],
    ['role_key', roleKeyEnum, ROLE_KEYS],
    ['audit_action', auditActionEnum, AUDIT_ACTIONS],
    ['user_status', userStatusEnum, USER_STATUSES],
  ] as const)('%s', (_name, drizzleEnum, constants) => {
    expect([...drizzleEnum.enumValues]).toEqual([...constants]);
  });
});

describe('the SQL enums match the shared constants', () => {
  it('audit_action, in order', () => {
    expect(sqlEnumLabels('audit_action')).toEqual([...AUDIT_ACTIONS]);
  });

  it('role_key holds the nine roles, including staff', () => {
    expect(sqlEnumLabels('role_key')).toEqual([...ROLE_KEYS]);
  });

  it('scope_type', () => {
    expect(sqlEnumLabels('scope_type')).toEqual([...SCOPE_TYPES]);
  });

  it('user_status', () => {
    expect(sqlEnumLabels('user_status')).toEqual([...USER_STATUSES]);
  });
});

describe('the migration set', () => {
  it('is applied in filename order', () => {
    const names = loadMigrationFiles().map((file) => file.fileName);
    expect(names).toEqual([...names].sort());
    expect(names[0]).toBe('0001_conventions.sql');
    expect(names).toContain('0004_role_key_administrator.sql');
    expect(names).toContain('0028_role_key_inventory_officer.sql');
    expect(names).toContain('0029_inventory_officer.sql');
    expect(names).toContain('0030_search_index_upsert.sql');
    expect(names).toContain('0031_payment_timing.sql');
    expect(names).toContain('0032_procurement_lines.sql');
    expect(names).toContain('0033_payment_execution.sql');
    expect(names).toContain('0034_shortage_deadline.sql');
    expect(names).toContain('0035_shortage_override_grant.sql');
    expect(names).toContain('0036_confidential_cases.sql');
    expect(names).toContain('0037_mail_outbox_status.sql');
    expect(names).toContain('0038_confidential_case_acl.sql');
    expect(names).toContain('0039_mail_outbox_sender_update.sql');
    expect(names).toContain('0040_inventory.sql');
    expect(names).toContain('0043_edms.sql');
    expect(names).toContain('0044_org_reports.sql');
    expect(names).toContain('0045_role_key_hr_officer.sql');
    expect(names).toContain('0046_hr.sql');
    expect(names).toContain('0047_hr_disciplinary_visible.sql');
    expect(names).toContain('0048_payroll.sql');
    expect(names).toContain('0051_mfa_policy.sql');
    expect(names).toContain('0052_procurement_quote_comparison.sql');
    expect(names).toContain('0053_procurement_invoice_at_finance.sql');
    expect(names).toContain('0005_identity.sql');
    expect(names).toContain('0010_reference_numbers.sql');
    expect(names).toContain('0014_search_timeline.sql');
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

describe('identity SQL', () => {
  it('does not treat a null audit entity_id as visible to every session', () => {
    const sql = readFileSync(join(migrationsDir(), '0005_identity.sql'), 'utf8');
    expect(sql).toMatch(/WHEN entity_id IS NULL THEN app\.is_corporate_actor\(\)/);
    expect(sql).toMatch(/app\.is_admin_actor\(\)/);
    expect(sql).not.toMatch(/can_access_entity\(NULL\)/);
  });
});
