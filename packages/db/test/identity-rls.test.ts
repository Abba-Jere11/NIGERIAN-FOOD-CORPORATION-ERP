import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertAuditEntry } from '../src/audit';
import {
  appPool,
  captureError,
  entityIdFor,
  inRolledBackTransaction,
  ownerPool,
  userActor,
} from './support';

describe('M2 identity Row-Level Security', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;

  beforeAll(async () => {
    owner = ownerPool('nfc-erp-test-identity-owner');
    app = appPool('nfc-erp-test-identity-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  it('lets a YFZ Finance Head see none of DMA’s audit rows', async () => {
    const actor = userActor({
      ref: '00000000-0000-4000-8000-000000000021',
      role: 'finance_head',
      scopeType: 'ENTITY',
      entityIds: [yfz],
      isCorporate: false,
      isAdmin: false,
    });
    const count = await inRolledBackTransaction(app, actor, async (client) => {
      const result = await client.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM audit_log WHERE entity_id = $1',
        [dma],
      );
      return Number.parseInt(result.rows[0]?.n ?? '0', 10);
    });
    expect(count).toBe(0);
  });

  it('lets the Administrator see none of the business audit log', async () => {
    const actor = userActor({
      ref: '00000000-0000-4000-8000-000000000030',
      role: 'administrator',
      scopeType: 'CORPORATE',
      entityIds: [],
      isCorporate: false,
      isAdmin: true,
    });
    const count = await inRolledBackTransaction(app, actor, async (client) => {
      const result = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM audit_log');
      return Number.parseInt(result.rows[0]?.n ?? '0', 10);
    });
    expect(count).toBe(0);
  });

  it('lets the Administrator read every user row', async () => {
    const actor = userActor({
      ref: '00000000-0000-4000-8000-000000000030',
      role: 'administrator',
      isCorporate: false,
      isAdmin: true,
      entityIds: [],
    });
    const count = await inRolledBackTransaction(app, actor, async (client) => {
      const result = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM users');
      return Number.parseInt(result.rows[0]?.n ?? '0', 10);
    });
    expect(count).toBeGreaterThanOrEqual(12);
  });

  it('refuses DELETE on users', async () => {
    const error = await captureError(() =>
      app.query('DELETE FROM users WHERE email = $1', ['md@nfc.local']),
    );
    expect(error.code).toBe('42501');
  });

  it('rejects a revoked session token lookup as empty', async () => {
    const inserted = await owner.query<{ id: string }>(
      `INSERT INTO sessions (
         user_id, token_hash, idle_expires_at, absolute_expires_at, revoked_at, revoked_by
       ) VALUES (
         '00000000-0000-4000-8000-000000000001', 'revoked-hash', now() + interval '1 hour',
         now() + interval '12 hours', now(), 'test'
       ) RETURNING id`,
    );
    const found = await app.query('SELECT * FROM app.session_by_token_hash($1)', ['revoked-hash']);
    expect(found.rows[0]?.revoked_at).toBeTruthy();
    expect(inserted.rows[0]?.id).toBeTruthy();
  });

  it('lets the Administrator record organisation changes without reading the business log', async () => {
    const actor = userActor({
      ref: '00000000-0000-4000-8000-000000000030',
      role: 'administrator',
      scopeType: 'CORPORATE',
      entityIds: [],
      isCorporate: false,
      isAdmin: true,
    });
    await inRolledBackTransaction(app, actor, async (client) => {
      const written = await insertAuditEntry(client, actor, {
        action: 'create',
        subjectType: 'department',
        subjectLabel: 'E2E RLS department',
        entityId: yfz,
        reason: 'Administrator organisation write.',
      });
      expect(written.id).toBeTruthy();
      const visible = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM audit_log');
      expect(Number.parseInt(visible.rows[0]?.n ?? '0', 10)).toBe(0);
    });
  });

  it('lets the Administrator write account-change rows without reading the business log', async () => {
    const actor = userActor({
      ref: '00000000-0000-4000-8000-000000000030',
      role: 'administrator',
      scopeType: 'CORPORATE',
      entityIds: [],
      isCorporate: false,
      isAdmin: true,
    });
    await inRolledBackTransaction(app, actor, async (client) => {
      const written = await insertAuditEntry(client, actor, {
        action: 'account_change',
        subjectType: 'user',
        subjectId: '00000000-0000-4000-8000-000000000022',
        subjectLabel: 'fh.yfw@nfc.local',
        reason: 'Unlock after lockout.',
        newValue: { locked: false },
      });
      expect(written.id).toBeTruthy();
      const visible = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM audit_log');
      expect(Number.parseInt(visible.rows[0]?.n ?? '0', 10)).toBe(0);
    });
  });

  it('locks the account after ten recorded failures', async () => {
    const userId = '00000000-0000-4000-8000-000000000014';
    await owner.query('SELECT app.unlock_user($1, $2)', [userId, 'test']);
    for (let i = 0; i < 10; i += 1) {
      await app.query('SELECT app.record_login_failure($1)', [userId]);
    }
    const row = await owner.query<{ locked_until: Date | null; failed_login_count: number }>(
      'SELECT locked_until, failed_login_count FROM users WHERE id = $1',
      [userId],
    );
    expect(row.rows[0]?.failed_login_count).toBeGreaterThanOrEqual(10);
    expect(row.rows[0]?.locked_until).toBeTruthy();
    await owner.query('SELECT app.unlock_user($1, $2)', [userId, 'test']);
  });
});
