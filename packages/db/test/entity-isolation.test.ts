import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertAuditEntry } from '../src/audit';
import { readActorSession } from '../src/session';
import {
  appPool,
  entityIdFor,
  inCommittedTransaction,
  inRolledBackTransaction,
  ownerPool,
  systemActor,
  userActor,
} from './support';

/**
 * Rule R5: entity isolation.
 *
 * A Yobe Fertilizer user must never see Damaturu data. The test connects as
 * `nfc_app` - the role the API actually uses, created NOBYPASSRLS and not the
 * table owner - so what it can see is exactly what the running system can see.
 * Isolation is enforced by Row-Level Security in the database, not by a WHERE
 * clause somebody has to remember to write.
 */
describe('Row-Level Security isolates one subsidiary from another (R5)', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;

  beforeAll(async () => {
    owner = ownerPool('nfc-erp-test-rls-owner');
    app = appPool('nfc-erp-test-rls-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  it('applies Row-Level Security to the application role', async () => {
    const result = await owner.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      'SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1',
      ['nfc_app'],
    );
    expect(result.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it('enables Row-Level Security on every entity-scoped table', async () => {
    const result = await owner.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
        WHERE relname IN ('entities', 'departments', 'audit_log') ORDER BY relname`,
    );
    expect(result.rows).toEqual([
      { relname: 'audit_log', relrowsecurity: true },
      { relname: 'departments', relrowsecurity: true },
      { relname: 'entities', relrowsecurity: true },
    ]);
  });

  it('publishes the actor into the session so the policies can read it', async () => {
    const actor = userActor({
      ref: '00000000-0000-4000-8000-0000000000b1',
      role: 'gm',
      scopeType: 'ENTITY',
      entityIds: [yfz],
      isCorporate: false,
      requestId: 'req-session',
    });

    const session = await inRolledBackTransaction(app, actor, (client) => readActorSession(client));

    expect(session).toEqual({
      actorRef: actor.ref,
      actorRole: 'gm',
      entityIds: [yfz],
      isCorporate: false,
      isAdmin: false,
      userId: actor.ref,
      requestId: 'req-session',
    });
  });

  it('shows a subsidiary-scoped actor only their own entity', async () => {
    const actor = entityScopedActor(yfz);
    const codes = await inRolledBackTransaction(app, actor, async (client) => {
      const result = await client.query<{ code: string }>(
        'SELECT code FROM entities ORDER BY code',
      );
      return result.rows.map((row) => row.code);
    });

    expect(codes).toEqual(['YFZ']);
  });

  it('shows a subsidiary-scoped actor only their own departments', async () => {
    const actor = entityScopedActor(yfz);
    const entityIds = await inRolledBackTransaction(app, actor, async (client) => {
      const result = await client.query<{ entity_id: string }>(
        'SELECT DISTINCT entity_id FROM departments',
      );
      return result.rows.map((row) => row.entity_id);
    });

    expect(entityIds).toEqual([yfz]);
  });

  it('returns nothing when a subsidiary-scoped actor names another subsidiary directly', async () => {
    const actor = entityScopedActor(yfz);
    const found = await inRolledBackTransaction(app, actor, async (client) => {
      const result = await client.query('SELECT id FROM entities WHERE id = $1', [dma]);
      return result.rowCount;
    });

    // Refused by returning nothing, not by raising an error: a record outside
    // your access is indistinguishable from one that does not exist.
    expect(found).toBe(0);
  });

  it('shows a corporate actor the whole group', async () => {
    const actor = userActor({ isCorporate: true, entityIds: [], scopeType: 'CORPORATE' });
    const count = await inRolledBackTransaction(app, actor, async (client) => {
      const result = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM entities',
      );
      return result.rows[0]?.count;
    });

    expect(count).toBe('5');
  });

  it('shows nothing at all when the session variables were never set', async () => {
    // Fail closed: a forgotten SET LOCAL must deny rows, never leak them.
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      const entities = await client.query('SELECT id FROM entities');
      const departments = await client.query('SELECT id FROM departments');
      expect(entities.rowCount).toBe(0);
      expect(departments.rowCount).toBe(0);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('hides audit entries belonging to another subsidiary', async () => {
    const seeded = systemActor();
    const label = `isolation-${Date.now()}`;
    await inCommittedTransaction(owner, seeded, (client) =>
      insertAuditEntry(client, seeded, {
        action: 'create',
        subjectType: 'test_fixture',
        subjectLabel: label,
        entityId: dma,
      }),
    );

    const visible = await inRolledBackTransaction(app, entityScopedActor(yfz), async (client) => {
      const result = await client.query('SELECT id FROM audit_log WHERE subject_label = $1', [
        label,
      ]);
      return result.rowCount;
    });

    expect(visible).toBe(0);
  });

  it('refuses to write a row into another subsidiary', async () => {
    const actor = entityScopedActor(yfz);

    await expect(
      inRolledBackTransaction(app, actor, (client) =>
        client.query(
          `INSERT INTO departments (entity_id, name, created_by, updated_by)
           VALUES ($1, 'Smuggled', $2, $2)`,
          [dma, actor.ref],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

function entityScopedActor(entityId: string) {
  return userActor({
    ref: '00000000-0000-4000-8000-0000000000c1',
    name: 'Ibrahim Danjuma',
    role: 'gm',
    scopeType: 'ENTITY',
    entityIds: [entityId],
    isCorporate: false,
  });
}
