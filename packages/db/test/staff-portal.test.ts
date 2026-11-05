/**
 * Staff portal: invite single-use, own-row RLS, named leave stages,
 * anonymous complaint masking, and conversation membership.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { DEFAULT_ROLE_GRANTS, SEED_USERS, type PermissionKey } from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { HrService } from '../../../apps/api/src/hr/hr.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import { appPool, captureError, entityIdFor, inRolledBackTransaction, ownerPool, userActor } from './support';

function ensureApiEnv(): void {
  process.env.SESSION_SECRET ??= 'test-session-secret-not-for-production-use-32';
  process.env.MFA_ENCRYPTION_KEY ??=
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.DOCUMENT_ENCRYPTION_KEY ??=
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.SEAL_SIGNING_KEYS ??= JSON.stringify({
    v1: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  });
  process.env.SEAL_ACTIVE_KID ??= 'v1';
  process.env.DOCUMENT_STORAGE ??= 'fs';
  resetApiEnvCache();
}

function actorFromSeed(email: string, entityIds: string[]): ActorContext {
  const user = SEED_USERS.find((row) => row.email === email);
  if (!user) throw new Error(`Unknown seed user ${email}`);
  return {
    ref: user.id,
    name: user.name,
    role: user.role,
    scopeType: user.scopeType,
    entityIds,
    isCorporate: user.scopeType === 'CORPORATE' && user.role !== 'administrator',
    isAdmin: user.role === 'administrator',
    permissions: [...DEFAULT_ROLE_GRANTS[user.role]],
    homePath: '/',
  };
}

describe('staff portal', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let yfzHr: string;
  let hr: HrService;
  let amina: ActorContext;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-staff-owner');
    app = appPool('nfc-erp-test-staff-app');
    yfz = await entityIdFor(owner, 'YFZ');
    const department = await owner.query<{ id: string }>(
      `SELECT id FROM departments WHERE entity_id = $1 AND name = 'HR'`,
      [yfz],
    );
    const departmentId = department.rows[0]?.id;
    if (!departmentId) throw new Error('YFZ HR department is missing.');
    yfzHr = departmentId;
    const uow = new UnitOfWork(app);
    const workflows = new WorkflowsService(uow, new SealsService());
    hr = new HrService(uow, workflows);
    workflows.attachHr(hr);
    amina = actorFromSeed('hr@nfc.local', [yfz]);
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  async function hire() {
    const tag = randomUUID().slice(0, 8);
    return hr.createEmployee(amina, {
      entityId: yfz,
      departmentId: yfzHr,
      firstName: 'Portal',
      lastName: `User${tag}`,
      employmentType: 'PERMANENT',
      dateEmployed: '2026-01-12',
      workEmail: `portal.${tag}@nfc.local`,
      personalEmail: `portal.${tag}@example.com`,
      salaryKobo: 100_000_00,
      idempotencyKey: `hire-${randomUUID()}`,
    });
  }

  it('uses an invite once and refuses an expired link', async () => {
    const employee = await hire();
    const email = `invite.${randomUUID().slice(0, 8)}@example.com`;
    const token = `tok-${randomUUID()}`;
    await owner.query(
      `INSERT INTO hr_invites (employee_id, entity_id, email, token_hash, expires_at, created_by, updated_by)
       VALUES ($1, $2, $3, $4, now() + interval '72 hours', 'test', 'test')`,
      [employee.id, yfz, email, token],
    );
    const registered = await owner.query<{ user_id: string }>(
      `SELECT app.register_staff_invite($1, 'hash', '{}'::jsonb)::text AS user_id`,
      [token],
    );
    const status = await owner.query<{ status: string }>(
      `SELECT status FROM hr_invites WHERE token_hash = $1`,
      [token],
    );
    expect(status.rows[0]?.status).toBe('REGISTERED');
    const userId = registered.rows[0]?.user_id;
    expect(userId).toBeTruthy();
    const tokenRow = await owner.query<{ token_hash: string }>(
      `SELECT token_hash FROM hr_invites WHERE user_id = $1`,
      [userId],
    );
    const reused = await captureError(() =>
      owner.query(`SELECT app.register_staff_invite($1, 'hash', '{}'::jsonb)`, [tokenRow.rows[0]?.token_hash]),
    );
    expect(reused.code).toBe('23514');

    const expired = await owner.query<{ preview: { ok: boolean } }>(
      `WITH issued AS (
         INSERT INTO hr_invites (employee_id, entity_id, email, token_hash, expires_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4, now() - interval '1 minute', 'test', 'test')
         RETURNING token_hash
       )
       SELECT app.preview_staff_invite(token_hash) AS preview FROM issued`,
      [employee.id, yfz, `late.${randomUUID().slice(0, 8)}@example.com`, `exp-${randomUUID()}`],
    );
    expect(expired.rows[0]?.preview.ok).toBe(false);
  });

  it('lets a linked staff user see and edit only their own employee row', async () => {
    const own = await hire();
    const other = await hire();
    const email = `self.${randomUUID().slice(0, 8)}@example.com`;
    const token = `self-${randomUUID()}`;
    const registered = await owner.query<{ user_id: string }>(
      `WITH issued AS (
         INSERT INTO hr_invites (employee_id, entity_id, email, token_hash, expires_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4, now() + interval '72 hours', 'test', 'test')
         RETURNING token_hash
       )
       SELECT app.register_staff_invite(token_hash, 'hash', '{}'::jsonb)::text AS user_id FROM issued`,
      [own.id, yfz, email, token],
    );
    const userId = registered.rows[0]?.user_id;
    if (!userId) throw new Error('Invite registration did not return a user.');
    const actor = userActor({
      ref: userId,
      role: 'staff',
      scopeType: 'ENTITY',
      entityIds: [yfz],
      isCorporate: false,
      permissions: ['self.workspace'] as PermissionKey[],
    });
    const seen = await inRolledBackTransaction(app, actor, async (client) => {
      await client.query(`UPDATE hr_employees SET other_names = 'Ada' WHERE id = $1`, [own.id]);
      const rows = await client.query<{ id: string }>(`SELECT id FROM hr_employees`);
      const hidden = await client.query(`SELECT id FROM hr_employees WHERE id = $1`, [other.id]);
      await client.query('SAVEPOINT salary');
      let blocked = false;
      try {
        await client.query(`UPDATE hr_employees SET salary_kobo = 1 WHERE id = $1`, [own.id]);
      } catch {
        blocked = true;
        await client.query('ROLLBACK TO SAVEPOINT salary');
      }
      return { count: rows.rows.length, hidden: hidden.rows.length, blocked };
    });
    expect(seen.count).toBe(1);
    expect(seen.hidden).toBe(0);
    expect(seen.blocked).toBe(true);
  });

  it('skips unnamed relief and department-head stages onto HR review', async () => {
    const stages = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM workflow_stages s
         JOIN workflow_definitions d ON d.id = s.definition_id
        WHERE d.key = 'hr-leave-v2' AND s.scope_resolver = 'NAMED_ASSIGNEE'`,
    );
    expect(Number(stages.rows[0]?.n)).toBe(2);
    const employee = await hire();
    const request = await hr.createLeave(amina, {
      employeeId: employee.id,
      typeKey: 'annual',
      startsOn: '2026-11-02',
      endsOn: '2026-11-03',
      reason: 'Named stages are empty.',
      idempotencyKey: `leave-${randomUUID()}`,
    });
    const stage = await owner.query<{ key: string }>(
      `SELECT s.key
         FROM workflow_instances i
         JOIN workflow_stages s ON s.id = i.current_stage_id
        WHERE i.id = $1`,
      [request.workflowInstanceId],
    );
    expect(stage.rows[0]?.key).toBe('hr-review');
  });

  it('hides the sender of an anonymous complaint from HR', async () => {
    const submitter = SEED_USERS.find((user) => user.email === 'md@nfc.local');
    if (!submitter) throw new Error('MD seed user is missing.');
    const inserted = await owner.query<{ id: string }>(
      `INSERT INTO hr_complaints (
         reference_number, entity_id, category, subject, body, is_anonymous, submitted_by_user_id,
         created_by, updated_by
       ) VALUES ($1, $2, 'Conduct', 'Anonymous note', 'Details', true, $3, 'test', 'test')
       RETURNING id`,
      [`CMP-TEST-${randomUUID().slice(0, 8)}`, yfz, submitter.id],
    );
    const id = inserted.rows[0]?.id;
    const hrView = await inRolledBackTransaction(app, amina, async (client) => {
      const row = await client.query<{ submitted_by_user_id: string | null }>(
        `SELECT submitted_by_user_id FROM app.complaints_for_actor() WHERE id = $1`,
        [id],
      );
      return row.rows[0]?.submitted_by_user_id ?? null;
    });
    expect(hrView).toBeNull();
    const ownView = await inRolledBackTransaction(
      app,
      userActor({
        ref: submitter.id,
        role: 'md',
        scopeType: 'CORPORATE',
        isCorporate: true,
        permissions: ['complaint.submit'] as PermissionKey[],
      }),
      async (client) => {
        const row = await client.query<{ submitted_by_user_id: string | null }>(
          `SELECT submitted_by_user_id FROM app.complaints_for_actor() WHERE id = $1`,
          [id],
        );
        return row.rows[0]?.submitted_by_user_id;
      },
    );
    expect(ownView).toBe(submitter.id);
    const leaked = await captureError(() =>
      inRolledBackTransaction(app, amina, (client) =>
        client.query(`SELECT submitted_by_user_id FROM hr_complaints WHERE id = $1`, [id]),
      ),
    );
    expect(leaked.code).toBe('42501');
  });

  it('shows a conversation only to its members', async () => {
    const aminaUser = SEED_USERS.find((user) => user.email === 'hr@nfc.local');
    const musa = SEED_USERS.find((user) => user.email === 'gm.yfz@nfc.local');
    if (!aminaUser || !musa) throw new Error('Seed users are missing.');
    const conversation = await owner.query<{ id: string }>(
      `INSERT INTO conversations (kind, title, created_by, updated_by)
       VALUES ('GROUP', 'Portal test', $1, $1) RETURNING id`,
      [aminaUser.id],
    );
    const id = conversation.rows[0]?.id;
    await owner.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role, created_by)
       VALUES ($1, $2::uuid, 'OWNER', $3)`,
      [id, aminaUser.id, aminaUser.id],
    );
    await owner.query(
      `INSERT INTO messages (conversation_id, sender_user_id, body, created_by)
       VALUES ($1, $2::uuid, 'Hello', $3)`,
      [id, aminaUser.id, aminaUser.id],
    );
    const member = await inRolledBackTransaction(app, amina, async (client) => {
      const rows = await client.query(`SELECT id FROM messages WHERE conversation_id = $1`, [id]);
      return rows.rows.length;
    });
    const outsider = await inRolledBackTransaction(
      app,
      userActor({
        ref: musa.id,
        role: 'gm',
        scopeType: 'ENTITY',
        entityIds: [yfz],
        isCorporate: false,
        permissions: ['message.use'] as PermissionKey[],
      }),
      async (client) => {
        const rows = await client.query(`SELECT id FROM messages WHERE conversation_id = $1`, [id]);
        return rows.rows.length;
      },
    );
    expect(member).toBe(1);
    expect(outsider).toBe(0);
  });
});
