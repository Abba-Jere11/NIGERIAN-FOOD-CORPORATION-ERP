import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertAuditEntry } from '../src/audit';
import {
  appPool,
  captureError,
  entityIdFor,
  inCommittedTransaction,
  ownerPool,
  systemActor,
  userActor,
} from './support';

/**
 * Rule R2: the audit log is append-only.
 *
 * These assertions are made with raw SQL, not through the application, because
 * the guarantee has to hold against anything that can reach the database -
 * including a future service, a migration written in haste, or someone at a psql
 * prompt. If it only held in TypeScript it would not be a guarantee.
 */
describe('audit_log is append-only at the database level (R2)', () => {
  let owner: Pool;
  let app: Pool;
  let entityId: string;
  let entryId: string;

  beforeAll(async () => {
    owner = ownerPool();
    app = appPool();
    entityId = await entityIdFor(owner, 'YFZ');

    const written = await inCommittedTransaction(owner, systemActor(), (client) =>
      insertAuditEntry(client, systemActor(), {
        action: 'create',
        subjectType: 'test_fixture',
        subjectLabel: 'Append-only fixture',
        entityId,
        newValue: { fixture: true },
      }),
    );
    entryId = written.id;
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  it('refuses a direct UPDATE, even from the table owner', async () => {
    const error = await captureError(() =>
      owner.query('UPDATE audit_log SET reason = $1 WHERE id = $2', ['rewritten', entryId]),
    );

    expect(error.message).toContain('append-only');
    expect(error.message).toContain('UPDATE');
    expect(error.hint).toContain('R2');
  });

  it('refuses a direct DELETE, even from the table owner', async () => {
    const error = await captureError(() =>
      owner.query('DELETE FROM audit_log WHERE id = $1', [entryId]),
    );

    expect(error.message).toContain('append-only');
    expect(error.message).toContain('DELETE');
  });

  it('refuses TRUNCATE', async () => {
    const error = await captureError(() => owner.query('TRUNCATE audit_log'));
    expect(error.message).toContain('append-only');
    expect(error.message).toContain('TRUNCATE');
  });

  it('refuses an UPDATE that matches no rows', async () => {
    // Statement-level, not row-level, on purpose: an edit attempt must be
    // refused whether or not it would have changed anything, so no code path can
    // conclude that editing history is permitted.
    const error = await captureError(() =>
      owner.query("UPDATE audit_log SET reason = 'x' WHERE id = gen_random_uuid()"),
    );
    expect(error.message).toContain('append-only');
  });

  it('does not grant the application role UPDATE or DELETE on audit_log', async () => {
    const privileges = await owner.query<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(
      `SELECT has_table_privilege('nfc_app', 'audit_log', 'SELECT') AS can_select,
              has_table_privilege('nfc_app', 'audit_log', 'INSERT') AS can_insert,
              has_table_privilege('nfc_app', 'audit_log', 'UPDATE') AS can_update,
              has_table_privilege('nfc_app', 'audit_log', 'DELETE') AS can_delete`,
    );

    expect(privileges.rows[0]).toEqual({
      can_select: true,
      can_insert: true,
      can_update: false,
      can_delete: false,
    });
  });

  it('still accepts new entries, which is how corrections are made', async () => {
    const written = await inCommittedTransaction(
      app,
      userActor({ entityIds: [entityId], isCorporate: true }),
      (client) =>
        insertAuditEntry(client, userActor({ entityIds: [entityId], isCorporate: true }), {
          action: 'edit',
          subjectType: 'test_fixture',
          subjectLabel: 'Correcting entry',
          entityId,
          oldValue: { fixture: true },
          newValue: { fixture: false },
        }),
    );

    expect(written.id).not.toEqual(entryId);
    expect(written.occurredAt).toBeInstanceOf(Date);
  });
});

/**
 * Rule R3: business records are deactivated, never removed. Unlike the audit
 * log, these tables accept UPDATE - a record must be able to change status - but
 * the row itself can never leave.
 */
describe('business tables refuse deletion (R3)', () => {
  let owner: Pool;

  beforeAll(() => {
    owner = ownerPool('nfc-erp-test-r3');
  });

  afterAll(async () => {
    await owner.end();
  });

  it.each(['organizations', 'entities', 'departments'])('refuses DELETE on %s', async (table) => {
    const error = await captureError(() => owner.query(`DELETE FROM ${table} WHERE false`));
    expect(error.message).toContain('never deleted');
    expect(error.hint).toContain('R3');
  });

  it.each(['organizations', 'entities', 'departments'])('refuses TRUNCATE on %s', async (table) => {
    const error = await captureError(() => owner.query(`TRUNCATE ${table} CASCADE`));
    expect(error.message).toContain('never deleted');
  });

  it.each(['organizations', 'entities', 'departments'])(
    'withholds DELETE privilege on %s from the application role',
    async (table) => {
      const result = await owner.query<{ can_delete: boolean; can_update: boolean }>(
        `SELECT has_table_privilege('nfc_app', $1, 'DELETE') AS can_delete,
                has_table_privilege('nfc_app', $1, 'UPDATE') AS can_update`,
        [table],
      );
      expect(result.rows[0]?.can_delete).toBe(false);
      expect(result.rows[0]?.can_update).toBe(true);
    },
  );

  it('keeps departments and their audit history when an entity is deactivated', async () => {
    const entityId = await entityIdFor(owner, 'DMA');

    const before = await owner.query<{ departments: string; entries: string }>(
      `SELECT (SELECT count(*) FROM departments WHERE entity_id = $1)::text AS departments,
              (SELECT count(*) FROM audit_log WHERE entity_id = $1)::text AS entries`,
      [entityId],
    );

    await inCommittedTransaction(owner, systemActor(), async (client) => {
      await client.query(`UPDATE entities SET status = 'INACTIVE', updated_by = $2 WHERE id = $1`, [
        entityId,
        'system:seed',
      ]);
      await insertAuditEntry(client, systemActor(), {
        action: 'edit',
        subjectType: 'entity',
        subjectId: entityId,
        entityId,
        oldValue: { status: 'ACTIVE' },
        newValue: { status: 'INACTIVE' },
        reason: 'Proving that deactivation preserves history.',
      });
    });

    const after = await owner.query<{ status: string; departments: string; entries: string }>(
      `SELECT e.status,
              (SELECT count(*) FROM departments WHERE entity_id = e.id)::text AS departments,
              (SELECT count(*) FROM audit_log WHERE entity_id = e.id)::text AS entries
         FROM entities e WHERE e.id = $1`,
      [entityId],
    );

    expect(after.rows[0]?.status).toBe('INACTIVE');
    expect(after.rows[0]?.departments).toBe(before.rows[0]?.departments);
    expect(Number(after.rows[0]?.entries)).toBeGreaterThan(Number(before.rows[0]?.entries));

    // Leave the fixture as it was found.
    await owner.query(`UPDATE entities SET status = 'ACTIVE' WHERE id = $1`, [entityId]);
  });
});
