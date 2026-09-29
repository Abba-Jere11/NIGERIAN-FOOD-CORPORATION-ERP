import {
  DEFAULT_DEPARTMENTS,
  HOLDING_ENTITY,
  ORGANIZATION_CODE,
  SUBSIDIARY_ENTITIES,
} from '@nfc/shared';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedOrganizationStructure } from '../src/seed';
import { captureError, entityIdFor, ownerPool } from './support';

/**
 * A4: Nigeria Food Corporation is the holding company, and all four
 * subsidiaries are its direct children. Nguru Oil Mills is a sibling of Yobe
 * Fertilizer, never a child of it.
 */
describe('the seeded organisation structure', () => {
  let owner: Pool;

  beforeAll(() => {
    owner = ownerPool('nfc-erp-test-org');
  });

  afterAll(async () => {
    await owner.end();
  });

  it('has exactly one organisation', async () => {
    const result = await owner.query<{ code: string }>('SELECT code FROM organizations');
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]?.code).toBe(ORGANIZATION_CODE);
  });

  it('has one holding company and four subsidiaries', async () => {
    const result = await owner.query<{ type: string; count: string }>(
      'SELECT type, count(*)::text AS count FROM entities GROUP BY type ORDER BY type',
    );
    expect(result.rows).toEqual([
      { type: 'HOLDING', count: '1' },
      { type: 'SUBSIDIARY', count: '4' },
    ]);
  });

  it('attaches every subsidiary directly to the holding company', async () => {
    const holdingId = await entityIdFor(owner, HOLDING_ENTITY.code);
    const result = await owner.query<{ code: string; parent_entity_id: string | null }>(
      "SELECT code, parent_entity_id FROM entities WHERE type = 'SUBSIDIARY' ORDER BY code",
    );

    expect(result.rows.map((row) => row.code)).toEqual(
      [...SUBSIDIARY_ENTITIES].map((entity) => entity.code).sort(),
    );
    for (const row of result.rows) {
      expect(row.parent_entity_id).toBe(holdingId);
    }
  });

  it('leaves the holding company without a parent', async () => {
    const result = await owner.query<{ parent_entity_id: string | null }>(
      'SELECT parent_entity_id FROM entities WHERE code = $1',
      [HOLDING_ENTITY.code],
    );
    expect(result.rows[0]?.parent_entity_id).toBeNull();
  });

  it('gives every entity the seven default departments', async () => {
    const result = await owner.query<{ code: string; departments: string }>(
      `SELECT e.code, count(d.id)::text AS departments
         FROM entities e LEFT JOIN departments d ON d.entity_id = e.id
        GROUP BY e.code ORDER BY e.code`,
    );

    expect(result.rowCount).toBe(5);
    for (const row of result.rows) {
      expect(row.departments).toBe(String(DEFAULT_DEPARTMENTS.length));
    }
  });

  it('records an audit entry for everything it created', async () => {
    const result = await owner.query<{ subject_type: string; count: string }>(
      `SELECT subject_type, count(*)::text AS count
         FROM audit_log
        WHERE actor_system_name = 'system:seed' AND action = 'create'
        GROUP BY subject_type ORDER BY subject_type`,
    );

    const counts = new Map(result.rows.map((row) => [row.subject_type, Number(row.count)]));
    expect(counts.get('organization')).toBe(1);
    expect(counts.get('entity')).toBe(5);
    expect(counts.get('department')).toBe(5 * DEFAULT_DEPARTMENTS.length);
  });

  it('can be seeded again without creating anything twice', async () => {
    const summary = await seedOrganizationStructure(owner);
    expect(summary).toEqual({
      organizationsCreated: 0,
      entitiesCreated: 0,
      departmentsCreated: 0,
      alreadyPresent: true,
    });
  });
});

describe('the hierarchy cannot be made deeper than one level (A4)', () => {
  let owner: Pool;

  beforeAll(() => {
    owner = ownerPool('nfc-erp-test-hierarchy');
  });

  afterAll(async () => {
    await owner.end();
  });

  it('refuses a subsidiary whose parent is another subsidiary', async () => {
    const organizationId = (
      await owner.query<{ id: string }>('SELECT id FROM organizations LIMIT 1')
    ).rows[0]?.id;
    const siblingId = await entityIdFor(owner, 'YFZ');

    const error = await captureError(() =>
      owner.query(
        `INSERT INTO entities
           (organization_id, parent_entity_id, code, name, legal_name, type, created_by, updated_by)
         VALUES ($1, $2, 'BAD1', 'Nested', 'Nested Limited', 'SUBSIDIARY', 'test', 'test')`,
        [organizationId, siblingId],
      ),
    );

    expect(error.message).toContain('direct child of the holding company');
    expect(error.hint).toContain('A4');
  });

  it('refuses a subsidiary with no parent at all', async () => {
    const organizationId = (
      await owner.query<{ id: string }>('SELECT id FROM organizations LIMIT 1')
    ).rows[0]?.id;

    const error = await captureError(() =>
      owner.query(
        `INSERT INTO entities
           (organization_id, code, name, legal_name, type, created_by, updated_by)
         VALUES ($1, 'BAD2', 'Orphan', 'Orphan Limited', 'SUBSIDIARY', 'test', 'test')`,
        [organizationId],
      ),
    );

    expect(error.code).toBe('23514');
    expect(error.message).toContain('entities_parent_matches_type');
  });

  it('refuses a holding company with a parent', async () => {
    const organizationId = (
      await owner.query<{ id: string }>('SELECT id FROM organizations LIMIT 1')
    ).rows[0]?.id;
    const holdingId = await entityIdFor(owner, HOLDING_ENTITY.code);

    const error = await captureError(() =>
      owner.query(
        `INSERT INTO entities
           (organization_id, parent_entity_id, code, name, legal_name, type, created_by, updated_by)
         VALUES ($1, $2, 'BAD3', 'Second holding', 'Second Holding Limited', 'HOLDING', 'test', 'test')`,
        [organizationId, holdingId],
      ),
    );

    expect(error.message).toContain('entities_parent_matches_type');
  });
});

describe('department naming', () => {
  let owner: Pool;

  beforeAll(() => {
    owner = ownerPool('nfc-erp-test-departments');
  });

  afterAll(async () => {
    await owner.end();
  });

  it('refuses a duplicate name in the same entity regardless of capitalisation', async () => {
    const entityId = await entityIdFor(owner, 'NOM');
    const error = await captureError(() =>
      owner.query(
        `INSERT INTO departments (entity_id, name, created_by, updated_by)
         VALUES ($1, 'finance', 'test', 'test')`,
        [entityId],
      ),
    );

    expect(error.code).toBe('23505');
    expect(error.message).toContain('departments_entity_name_key');
  });

  it('allows the same department name in a different entity', async () => {
    const result = await owner.query<{ entities: string }>(
      `SELECT count(DISTINCT entity_id)::text AS entities
         FROM departments WHERE lower(name) = 'finance'`,
    );
    expect(result.rows[0]?.entities).toBe('5');
  });
});

describe('optimistic locking (A7, R10)', () => {
  let owner: Pool;

  beforeAll(() => {
    owner = ownerPool('nfc-erp-test-locking');
  });

  afterAll(async () => {
    await owner.end();
  });

  it('increments row_version and stamps updated_at on every update', async () => {
    const entityId = await entityIdFor(owner, 'YFW');
    const before = await owner.query<{ row_version: number; updated_at: Date }>(
      'SELECT row_version, updated_at FROM entities WHERE id = $1',
      [entityId],
    );
    const version = before.rows[0]?.row_version ?? 0;

    await owner.query(`UPDATE entities SET name = name WHERE id = $1`, [entityId]);

    const after = await owner.query<{ row_version: number; updated_at: Date }>(
      'SELECT row_version, updated_at FROM entities WHERE id = $1',
      [entityId],
    );

    expect(after.rows[0]?.row_version).toBe(version + 1);
    expect(after.rows[0]?.updated_at.getTime()).toBeGreaterThanOrEqual(
      before.rows[0]?.updated_at.getTime() ?? 0,
    );
  });

  it('affects no rows when the expected version is stale', async () => {
    const entityId = await entityIdFor(owner, 'YFW');
    const current = await owner.query<{ row_version: number }>(
      'SELECT row_version FROM entities WHERE id = $1',
      [entityId],
    );
    const stale = (current.rows[0]?.row_version ?? 1) - 1;

    const result = await owner.query(
      `UPDATE entities SET name = 'Should not apply' WHERE id = $1 AND row_version = $2`,
      [entityId, stale],
    );

    // Zero rows is how the application detects a concurrent edit instead of
    // silently overwriting it.
    expect(result.rowCount).toBe(0);
  });

  it('ignores a row_version supplied by the caller', async () => {
    const entityId = await entityIdFor(owner, 'YFW');
    const before = await owner.query<{ row_version: number }>(
      'SELECT row_version FROM entities WHERE id = $1',
      [entityId],
    );
    const version = before.rows[0]?.row_version ?? 0;

    // The trigger recomputes row_version from the previous value, so a caller
    // cannot hold it still or wind it back to make a stale write look current.
    await owner.query('UPDATE entities SET row_version = 1 WHERE id = $1', [entityId]);

    const after = await owner.query<{ row_version: number }>(
      'SELECT row_version FROM entities WHERE id = $1',
      [entityId],
    );
    expect(after.rows[0]?.row_version).toBe(version + 1);
  });
});
