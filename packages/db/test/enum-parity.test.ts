import {
  AUDIT_ACTIONS,
  ENTITY_TYPES,
  RECORD_STATUSES,
  ROLE_KEYS,
  SCOPE_TYPES,
} from '@nfc/shared';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ownerPool } from './support';

/**
 * The same vocabulary is written down in three places: the SQL enum, the Drizzle
 * schema and the shared TypeScript constants. These tests keep them identical,
 * so adding an action in one place and forgetting the others fails here instead
 * of failing in production when an insert is rejected.
 */
describe('SQL enums match the shared TypeScript constants', () => {
  let owner: Pool;

  beforeAll(() => {
    owner = ownerPool('nfc-erp-test-enums');
  });

  afterAll(async () => {
    await owner.end();
  });

  async function labelsOf(typeName: string): Promise<string[]> {
    const result = await owner.query<{ label: string }>(
      `SELECT e.enumlabel AS label
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = $1
        ORDER BY e.enumsortorder`,
      [typeName],
    );
    return result.rows.map((row) => row.label);
  }

  it('entity_type', async () => {
    expect(await labelsOf('entity_type')).toEqual([...ENTITY_TYPES]);
  });

  it('record_status', async () => {
    expect(await labelsOf('record_status')).toEqual([...RECORD_STATUSES]);
  });

  it('scope_type', async () => {
    expect(await labelsOf('scope_type')).toEqual([...SCOPE_TYPES]);
  });

  it('role_key holds exactly the five roles from A5', async () => {
    const labels = await labelsOf('role_key');
    expect(labels).toEqual([...ROLE_KEYS]);
    expect(labels).toHaveLength(5);
  });

  it('audit_action holds the full action vocabulary, in order', async () => {
    expect(await labelsOf('audit_action')).toEqual([...AUDIT_ACTIONS]);
  });
});
