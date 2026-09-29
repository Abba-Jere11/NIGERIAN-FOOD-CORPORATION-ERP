import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditValidationError, assertAuditEntryValid, insertAuditEntry } from '../src/audit';
import {
  appPool,
  captureError,
  entityIdFor,
  inCommittedTransaction,
  inRolledBackTransaction,
  ownerPool,
  systemActor,
  userActor,
} from './support';

/**
 * M1 item 5: an audit entry must answer who, what, when, where, why and from
 * where. These tests check every field the milestone lists is actually stored,
 * because an audit trail with a missing column is discovered at the worst
 * possible moment.
 */
describe('an audit entry records everything M1 requires', () => {
  let owner: Pool;
  let app: Pool;
  let entityId: string;

  beforeAll(async () => {
    owner = ownerPool('nfc-erp-test-audit-owner');
    app = appPool('nfc-erp-test-audit-app');
    entityId = await entityIdFor(owner, 'YFZ');
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  it('stores the actor, role, scope, subject, diff, reason and request provenance', async () => {
    const actor = userActor({
      ref: '00000000-0000-4000-8000-0000000000aa',
      name: 'Adebayo Okonkwo',
      role: 'md',
      scopeType: 'CORPORATE',
      entityIds: [entityId],
      isCorporate: true,
      requestId: 'req-audit-fields',
      sessionId: 'sess-audit-fields',
      ipAddress: '198.51.100.24',
      userAgent: 'Mozilla/5.0 (test)',
    });

    const written = await inCommittedTransaction(owner, actor, (client) =>
      insertAuditEntry(client, actor, {
        action: 'edit',
        subjectType: 'entity',
        subjectId: entityId,
        subjectLabel: 'YFZ - Yobe Fertilizer',
        entityId,
        oldValue: { name: 'Yobe Fertilizer' },
        newValue: { name: 'Yobe Fertilizer Company' },
        reason: 'Renamed after the registration was updated.',
      }),
    );

    const stored = await owner.query(`SELECT * FROM audit_log WHERE id = $1`, [written.id]);
    const row = stored.rows[0] as Record<string, unknown>;

    expect(row.occurred_at).toBeInstanceOf(Date);
    expect(row.actor_user_id).toBe(actor.ref);
    expect(row.actor_system_name).toBeNull();
    expect(row.actor_ref).toBe(actor.ref);
    expect(row.actor_name).toBe('Adebayo Okonkwo');
    expect(row.actor_role).toBe('md');
    expect(row.actor_scope_type).toBe('CORPORATE');
    expect(row.actor_scope_entity_ids).toEqual([entityId]);
    expect(row.action).toBe('edit');
    expect(row.subject_type).toBe('entity');
    expect(row.subject_id).toBe(entityId);
    expect(row.subject_label).toBe('YFZ - Yobe Fertilizer');
    // Nullable until M3 builds the Reference-Number Engine.
    expect(row.subject_reference_number).toBeNull();
    expect(row.entity_id).toBe(entityId);
    expect(row.old_value).toEqual({ name: 'Yobe Fertilizer' });
    expect(row.new_value).toEqual({ name: 'Yobe Fertilizer Company' });
    expect(row.reason).toBe('Renamed after the registration was updated.');
    expect(row.ip_address).toBe('198.51.100.24');
    expect(row.user_agent).toBe('Mozilla/5.0 (test)');
    expect(row.session_id).toBe('sess-audit-fields');
    expect(row.request_id).toBe('req-audit-fields');
  });

  it('attributes a background action to a named system actor, never to nobody (R1)', async () => {
    const actor = systemActor('system:seed');
    const written = await inCommittedTransaction(owner, actor, (client) =>
      insertAuditEntry(client, actor, {
        action: 'create',
        subjectType: 'test_fixture',
        entityId,
      }),
    );

    const stored = await owner.query<{
      actor_user_id: string | null;
      actor_system_name: string | null;
      actor_ref: string;
      actor_role: string | null;
    }>('SELECT actor_user_id, actor_system_name, actor_ref, actor_role FROM audit_log WHERE id = $1', [
      written.id,
    ]);

    expect(stored.rows[0]).toEqual({
      actor_user_id: null,
      actor_system_name: 'system:seed',
      actor_ref: 'system:seed',
      actor_role: null,
    });
  });

  it('refuses an entry with no actor at all', async () => {
    const error = await captureError(() =>
      owner.query(
        `INSERT INTO audit_log (action, subject_type) VALUES ('create', 'test_fixture')`,
      ),
    );
    expect(error.message).toContain('audit_log_actor_exactly_one');
  });

  it('refuses an entry claiming to be both a user and a system process', async () => {
    const error = await captureError(() =>
      owner.query(
        `INSERT INTO audit_log (actor_user_id, actor_system_name, actor_role, actor_scope_type, action, subject_type)
         VALUES (gen_random_uuid(), 'system:seed', 'md', 'CORPORATE', 'create', 'test_fixture')`,
      ),
    );
    expect(error.message).toContain('audit_log_actor_exactly_one');
  });

  it('refuses an unregistered system actor name', async () => {
    const error = await captureError(() =>
      owner.query(
        `INSERT INTO audit_log (actor_system_name, action, subject_type)
         VALUES ('system:whoever', 'create', 'test_fixture')`,
      ),
    );
    expect(error.message).toContain('audit_log_system_actor_registered');
  });

  it('refuses a user actor with no role or scope recorded', async () => {
    const error = await captureError(() =>
      owner.query(
        `INSERT INTO audit_log (actor_user_id, action, subject_type)
         VALUES (gen_random_uuid(), 'create', 'test_fixture')`,
      ),
    );
    expect(error.message).toContain('audit_log_user_actor_has_role');
  });
});

/**
 * Rule R11: rejection, return and archiving are meaningless without a stored
 * explanation. It is checked twice - once in code so the user gets a useful
 * message, and once in the database so no other caller can skip it.
 */
describe('a reason is mandatory for reject, return and archive (R11)', () => {
  let owner: Pool;
  let entityId: string;

  beforeAll(async () => {
    owner = ownerPool('nfc-erp-test-reason');
    entityId = await entityIdFor(owner, 'YFZ');
  });

  afterAll(async () => {
    await owner.end();
  });

  it.each(['reject', 'return', 'archive'] as const)(
    'is refused by the database for the %s action',
    async (action) => {
      const error = await captureError(() =>
        owner.query(
          `INSERT INTO audit_log (actor_system_name, action, subject_type)
           VALUES ('system:seed', $1, 'test_fixture')`,
          [action],
        ),
      );
      expect(error.message).toContain('audit_log_reason_required');
    },
  );

  it.each(['reject', 'return', 'archive'] as const)(
    'is refused in code before reaching the database for the %s action',
    (action) => {
      expect(() =>
        assertAuditEntryValid({ action, subjectType: 'test_fixture' }),
      ).toThrow(AuditValidationError);
      expect(() =>
        assertAuditEntryValid({ action, subjectType: 'test_fixture', reason: '   ' }),
      ).toThrow(/R11/);
    },
  );

  it('accepts the same action once a reason is given', async () => {
    const actor = systemActor();
    const written = await inRolledBackTransaction(owner, actor, (client) =>
      insertAuditEntry(client, actor, {
        action: 'reject',
        subjectType: 'test_fixture',
        entityId,
        reason: 'The supporting document was not attached.',
      }),
    );
    expect(written.id).toBeTruthy();
  });

  it('does not require a reason for actions where it would be noise', async () => {
    const actor = systemActor();
    const written = await inRolledBackTransaction(owner, actor, (client) =>
      insertAuditEntry(client, actor, {
        action: 'create',
        subjectType: 'test_fixture',
        entityId,
      }),
    );
    expect(written.id).toBeTruthy();
  });
});

/**
 * The audit entry has to share the mutation's transaction. If it did not, a
 * committed change could exist with no record of who made it.
 */
describe('audit entries share the transaction of the change they describe', () => {
  let owner: Pool;
  let entityId: string;

  beforeAll(async () => {
    owner = ownerPool('nfc-erp-test-atomicity');
    entityId = await entityIdFor(owner, 'NOM');
  });

  afterAll(async () => {
    await owner.end();
  });

  it('rolls the audit entry back when the change rolls back', async () => {
    const actor = systemActor();
    const label = `rollback-${Date.now()}`;

    await expect(
      inCommittedTransaction(owner, actor, async (client) => {
        await client.query(
          `INSERT INTO departments (entity_id, name, created_by, updated_by)
           VALUES ($1, $2, 'system:seed', 'system:seed')`,
          [entityId, label],
        );
        await insertAuditEntry(client, actor, {
          action: 'create',
          subjectType: 'department',
          subjectLabel: label,
          entityId,
        });
        throw new Error('Simulated failure after both writes.');
      }),
    ).rejects.toThrow('Simulated failure');

    const department = await owner.query('SELECT 1 FROM departments WHERE name = $1', [label]);
    const entry = await owner.query('SELECT 1 FROM audit_log WHERE subject_label = $1', [label]);

    expect(department.rowCount).toBe(0);
    expect(entry.rowCount).toBe(0);
  });
});
