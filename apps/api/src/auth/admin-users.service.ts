import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import {
  APPROVAL_OR_PAYMENT_KEYS,
  DEFAULT_ROLE_GRANTS,
  ROLES,
  SYSTEM_ADMIN_ROLES,
  effectiveMfaRequired,
  type PermissionChangeView,
  type RoleKey,
  type ScopeType,
  type UserStatus,
  type UserSummaryView,
} from '@nfc/shared';
import argon2 from 'argon2';
import { assertCan } from './can';
import {
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../common/errors/domain-error';
import { UnitOfWork } from '../database/unit-of-work';
import { EntityDirectory } from './entity-directory.service';
import { assertPasswordPolicy } from './password-policy';

export interface CreateUserInput {
  name: string;
  email: string;
  phone?: string | null;
  position: string;
  primaryEntityId: string;
  departmentId?: string | null;
  password: string;
  role: RoleKey;
  scopeType: ScopeType;
  entityId?: string | null;
}

export interface AssignRoleInput {
  role: RoleKey;
  scopeType: ScopeType;
  entityId?: string | null;
}

export interface ScopeGrantInput {
  entityId: string;
  reason: string;
  expiresAt?: string | null;
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly directory: EntityDirectory,
  ) {}

  async list(actor: ActorContext): Promise<UserSummaryView[]> {
    assertCan(actor, 'admin.user.manage');
    return this.unitOfWork.read(actor, async (tx) => {
      const users = await tx.client.query<{
        id: string;
        name: string;
        email: string;
        phone: string | null;
        status: UserStatus;
        position: string;
        primary_entity_id: string;
        primary_entity_code: string;
        department_id: string | null;
        department_name: string | null;
        photograph_path: string | null;
        must_change_password: boolean;
        mfa_required: boolean;
        mfa_enrolled_at: Date | null;
        locked_until: Date | null;
        last_login_at: Date | null;
        row_version: number;
      }>(
        `SELECT u.id, u.name, u.email::text AS email, u.phone, u.status, u."position",
                u.primary_entity_id, e.code AS primary_entity_code,
                u.department_id, d.name AS department_name,
                u.photograph_path, u.must_change_password, u.mfa_required, u.mfa_enrolled_at,
                u.locked_until, u.last_login_at, u.row_version
           FROM users u
           JOIN entities e ON e.id = u.primary_entity_id
           LEFT JOIN departments d ON d.id = u.department_id
          ORDER BY u.name`,
      );
      const assignments = await tx.client.query<{
        id: string;
        user_id: string;
        role_key: RoleKey;
        scope_type: ScopeType;
        entity_id: string | null;
        entity_code: string | null;
      }>(
        `SELECT a.id, a.user_id, r.key AS role_key, a.scope_type, a.entity_id, e.code AS entity_code
           FROM user_role_assignments a
           JOIN roles r ON r.id = a.role_id
           LEFT JOIN entities e ON e.id = a.entity_id
          WHERE a.status = 'ACTIVE'`,
      );
      return users.rows.map((user) => {
        const roles = assignments.rows
          .filter((row) => row.user_id === user.id)
          .map((row) => ({
            assignmentId: row.id,
            role: row.role_key,
            roleName: ROLES[row.role_key].name,
            scopeType: row.scope_type,
            entityId: row.entity_id,
            entityCode: row.entity_code,
          }));
        const roleKeys = roles.map((row) => row.role);
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          status: user.status,
          position: user.position,
          primaryEntityId: user.primary_entity_id,
          primaryEntityCode: user.primary_entity_code,
          departmentId: user.department_id,
          departmentName: user.department_name,
          photographUrl: user.photograph_path ? `/api/admin/users/${user.id}/photograph` : null,
          mustChangePassword: user.must_change_password,
          mfaRequired: user.mfa_required,
          mfaEffectiveRequired: effectiveMfaRequired(user.mfa_required, roleKeys),
          mfaEnrolled: Boolean(user.mfa_enrolled_at),
          lockedUntil: user.locked_until?.toISOString() ?? null,
          lastLoginAt: user.last_login_at?.toISOString() ?? null,
          rowVersion: user.row_version,
          roles,
        };
      });
    });
  }

  async create(actor: ActorContext, input: CreateUserInput): Promise<UserSummaryView> {
    assertCan(actor, 'admin.user.manage');
    await assertPasswordPolicy(input.password);
    if (SYSTEM_ADMIN_ROLES.includes(input.role)) {
      throw new ValidationFailedError('The first Administrator is seed-only. Do not create another from this screen until a later milestone documents it.');
    }
    return this.unitOfWork.write(actor, async (tx) => {
      await this.assertAssignmentAllowed(tx.client, null, input.role, input.scopeType, input.entityId ?? null);

      const hash = await argon2.hash(input.password, { type: argon2.argon2id });
      const id = randomUUID();
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO users (
           id, name, email, phone, status, primary_entity_id, department_id, "position",
           password_hash, must_change_password, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, $7, $8, true, $9, $9)
         RETURNING id`,
        [
          id,
          input.name.trim(),
          input.email.trim().toLowerCase(),
          input.phone ?? null,
          input.primaryEntityId,
          input.departmentId ?? null,
          input.position.trim(),
          hash,
          actor.ref,
        ],
      );
      if (!inserted.rows[0]) throw new Error('Failed to create user');

      const roleId = await this.roleId(tx.client, input.role);
      await tx.client.query(
        `INSERT INTO user_role_assignments (user_id, role_id, scope_type, entity_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [id, roleId, input.scopeType, input.scopeType === 'ENTITY' ? input.entityId : null, actor.ref],
      );

      await tx.audit({
        action: 'account_change',
        subjectType: 'user',
        subjectId: id,
        subjectLabel: input.email,
        entityId: input.primaryEntityId,
        newValue: { email: input.email, role: input.role, status: 'ACTIVE' },
        reason: 'Account created',
      });

      this.directory.invalidate();
      const created = await tx.client.query<{
        id: string;
        name: string;
        email: string;
        phone: string | null;
        status: UserStatus;
        position: string;
        primary_entity_id: string;
        primary_entity_code: string;
        department_id: string | null;
        department_name: string | null;
        photograph_path: string | null;
        must_change_password: boolean;
        mfa_required: boolean;
        mfa_enrolled_at: Date | null;
        locked_until: Date | null;
        last_login_at: Date | null;
        row_version: number;
      }>(
        `SELECT u.id, u.name, u.email::text AS email, u.phone, u.status, u."position",
                u.primary_entity_id, e.code AS primary_entity_code,
                u.department_id, d.name AS department_name,
                u.photograph_path, u.must_change_password, u.mfa_required, u.mfa_enrolled_at,
                u.locked_until, u.last_login_at, u.row_version
           FROM users u
           JOIN entities e ON e.id = u.primary_entity_id
           LEFT JOIN departments d ON d.id = u.department_id
          WHERE u.id = $1`,
        [id],
      );
      const user = created.rows[0];
      if (!user) throw new Error('Failed to read the created user');
      const roles = [
        {
          assignmentId: '',
          role: input.role,
          roleName: ROLES[input.role].name,
          scopeType: input.scopeType,
          entityId: input.scopeType === 'ENTITY' ? (input.entityId ?? null) : null,
          entityCode: null,
        },
      ];
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        status: user.status,
        position: user.position,
        primaryEntityId: user.primary_entity_id,
        primaryEntityCode: user.primary_entity_code,
        departmentId: user.department_id,
        departmentName: user.department_name,
        photographUrl: null,
        mustChangePassword: user.must_change_password,
        mfaRequired: user.mfa_required,
        mfaEffectiveRequired: effectiveMfaRequired(user.mfa_required, [input.role]),
        mfaEnrolled: Boolean(user.mfa_enrolled_at),
        lockedUntil: user.locked_until?.toISOString() ?? null,
        lastLoginAt: user.last_login_at?.toISOString() ?? null,
        rowVersion: user.row_version,
        roles,
      };
    });
  }

  async setStatus(
    actor: ActorContext,
    userId: string,
    status: UserStatus,
    reason: string,
  ): Promise<void> {
    assertCan(actor, 'admin.user.manage');
    if (status === 'ACTIVE' && !reason.trim()) {
      throw new ValidationFailedError('A reason is required.');
    }
    await this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{ email: string; status: UserStatus; primary_entity_id: string }>(
        'SELECT email::text AS email, status, primary_entity_id FROM users WHERE id = $1',
        [userId],
      );
      const row = existing.rows[0];
      if (!row) throw new NotFoundError('That user was not found.');
      await tx.client.query(`UPDATE users SET status = $2, updated_by = $3 WHERE id = $1`, [
        userId,
        status,
        actor.ref,
      ]);
      await tx.audit({
        action: 'account_change',
        subjectType: 'user',
        subjectId: userId,
        subjectLabel: row.email,
        entityId: row.primary_entity_id,
        oldValue: { status: row.status },
        newValue: { status },
        reason,
      });
    });
  }

  async setMfaPolicy(actor: ActorContext, userId: string, required: boolean, reason: string): Promise<void> {
    assertCan(actor, 'admin.user.manage');
    if (reason.trim().length < 3) throw new ValidationFailedError('A reason is required.');
    await this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{
        email: string;
        primary_entity_id: string;
        mfa_required: boolean;
      }>('SELECT email::text AS email, primary_entity_id, mfa_required FROM users WHERE id = $1', [
        userId,
      ]);
      const row = existing.rows[0];
      if (!row) throw new NotFoundError('That user was not found.');

      const assignments = await tx.client.query<{ role_key: RoleKey }>(
        `SELECT r.key AS role_key
           FROM user_role_assignments a
           JOIN roles r ON r.id = a.role_id
          WHERE a.user_id = $1 AND a.status = 'ACTIVE'`,
        [userId],
      );
      const roleKeys = assignments.rows.map((r) => r.role_key);
      if (!required && roleKeys.includes('administrator')) {
        throw new ValidationFailedError(
          'MFA cannot be turned off for an account with the Administrator role.',
        );
      }

      if (required) {
        await tx.client.query('SELECT app.set_mfa_required($1, true, $2)', [userId, actor.ref]);
      } else {
        await tx.client.query('SELECT app.clear_mfa($1, $2)', [userId, actor.ref]);
        await tx.client.query('SELECT app.set_mfa_required($1, false, $2)', [userId, actor.ref]);
      }

      await tx.audit({
        action: 'account_change',
        subjectType: 'user',
        subjectId: userId,
        subjectLabel: row.email,
        entityId: row.primary_entity_id,
        oldValue: { mfaRequired: row.mfa_required },
        newValue: { mfaRequired: required },
        reason,
      });
    });
  }

  async unlock(actor: ActorContext, userId: string, reason: string): Promise<void> {
    assertCan(actor, 'admin.user.manage');
    if (reason.trim().length < 3) throw new ValidationFailedError('A reason is required.');
    await this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{ email: string; primary_entity_id: string }>(
        'SELECT email::text AS email, primary_entity_id FROM users WHERE id = $1',
        [userId],
      );
      const row = existing.rows[0];
      if (!row) throw new NotFoundError('That user was not found.');
      await tx.client.query('SELECT app.unlock_user($1, $2)', [userId, actor.ref]);
      await tx.audit({
        action: 'account_change',
        subjectType: 'user',
        subjectId: userId,
        subjectLabel: row.email,
        entityId: row.primary_entity_id,
        newValue: { locked: false },
        reason,
      });
    });
  }

  async assignRole(actor: ActorContext, userId: string, input: AssignRoleInput): Promise<void> {
    assertCan(actor, 'admin.role.assign');
    await this.unitOfWork.write(actor, async (tx) => {
      await this.assertAssignmentAllowed(tx.client, userId, input.role, input.scopeType, input.entityId ?? null);
      const roleId = await this.roleId(tx.client, input.role);
      await tx.client.query(
        `INSERT INTO user_role_assignments (user_id, role_id, scope_type, entity_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [userId, roleId, input.scopeType, input.scopeType === 'ENTITY' ? input.entityId : null, actor.ref],
      );
      await tx.client.query(`UPDATE users SET updated_by = $2 WHERE id = $1`, [userId, actor.ref]);
      const email = await this.emailOf(tx.client, userId);
      await tx.audit({
        action: 'permission_change',
        subjectType: 'user_role_assignment',
        subjectId: userId,
        subjectLabel: email,
        newValue: { role: input.role, scopeType: input.scopeType, entityId: input.entityId ?? null },
        reason: 'Role assigned',
      });
    });
  }

  async revokeRole(actor: ActorContext, userId: string, assignmentId: string, reason: string): Promise<void> {
    assertCan(actor, 'admin.role.assign');
    await this.unitOfWork.write(actor, async (tx) => {
      await tx.client.query(
        `UPDATE user_role_assignments SET status = 'INACTIVE', updated_by = $3 WHERE id = $1 AND user_id = $2`,
        [assignmentId, userId, actor.ref],
      );
      await tx.client.query(`UPDATE users SET updated_by = $2 WHERE id = $1`, [userId, actor.ref]);
      const email = await this.emailOf(tx.client, userId);
      await tx.audit({
        action: 'permission_change',
        subjectType: 'user_role_assignment',
        subjectId: assignmentId,
        subjectLabel: email,
        oldValue: { assignmentId, status: 'ACTIVE' },
        newValue: { status: 'INACTIVE' },
        reason,
      });
    });
  }

  async grantScope(actor: ActorContext, userId: string, input: ScopeGrantInput): Promise<void> {
    assertCan(actor, 'admin.scope.grant');
    if (input.reason.trim().length < 3) throw new ValidationFailedError('A reason is required.');
    await this.unitOfWork.write(actor, async (tx) => {
      await tx.client.query(
        `INSERT INTO user_scope_grants (user_id, entity_id, reason, granted_by, expires_at, created_by, updated_by)
         VALUES ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::timestamptz, $4::text, $4::text)`,
        [userId, input.entityId, input.reason.trim(), actor.ref, input.expiresAt ? new Date(input.expiresAt) : null],
      );
      const email = await this.emailOf(tx.client, userId);
      await tx.audit({
        action: 'permission_change',
        subjectType: 'user_scope_grant',
        subjectId: userId,
        subjectLabel: email,
        entityId: input.entityId,
        newValue: { entityId: input.entityId, expiresAt: input.expiresAt ?? null },
        reason: input.reason,
      });
    });
  }

  async revokeSessions(actor: ActorContext, userId: string, reason: string): Promise<number> {
    assertCan(actor, 'admin.session.revoke');
    return this.unitOfWork.write(actor, async (tx) => {
      const sessions = await tx.client.query<{ id: string }>(
        `SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      for (const row of sessions.rows) {
        await tx.client.query('SELECT app.revoke_session($1, $2)', [row.id, actor.ref]);
      }
      const email = await this.emailOf(tx.client, userId);
      await tx.audit({
        action: 'account_change',
        subjectType: 'session',
        subjectId: userId,
        subjectLabel: email,
        newValue: { revoked: sessions.rows.length },
        reason,
      });
      return sessions.rows.length;
    });
  }

  async permissionChanges(actor: ActorContext, limit = 50, offset = 0): Promise<PermissionChangeView[]> {
    assertCan(actor, 'admin.permission_log.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        occurred_at: Date;
        actor_name: string | null;
        actor_role: RoleKey | null;
        action: PermissionChangeView['action'];
        subject_type: string;
        subject_id: string | null;
        subject_label: string | null;
        old_value: Record<string, unknown> | null;
        new_value: Record<string, unknown> | null;
        reason: string | null;
      }>('SELECT * FROM app.admin_permission_changes($1, $2)', [limit, offset]);
      return result.rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurred_at.toISOString(),
        actorName: row.actor_name,
        actorRole: row.actor_role,
        action: row.action,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        subjectLabel: row.subject_label,
        oldValue: row.old_value,
        newValue: row.new_value,
        reason: row.reason,
      }));
    });
  }

  async listRoles(actor: ActorContext): Promise<Array<{ key: RoleKey; name: string; homePath: string; grants: string[] }>> {
    assertCan(actor, 'admin.user.manage');
    return Object.values(ROLES).map((role) => ({
      key: role.key,
      name: role.name,
      homePath: role.homePath,
      grants: [...DEFAULT_ROLE_GRANTS[role.key]],
    }));
  }

  /**
   * Refuses GM+Finance Head on the same entity, and refuses giving the
   * Administrator any approval or payment key (directly or via a second role).
   */
  async assertAssignmentAllowed(
    client: import('pg').PoolClient,
    userId: string | null,
    role: RoleKey,
    scopeType: ScopeType,
    entityId: string | null,
  ): Promise<void> {
    if (scopeType === 'ENTITY' && !entityId) {
      throw new ValidationFailedError('An entity is required for an entity-scoped role.');
    }
    if (scopeType === 'CORPORATE' && entityId) {
      throw new ValidationFailedError('A corporate role is not tied to one subsidiary.');
    }

    const incomingKeys = DEFAULT_ROLE_GRANTS[role];
    const incomingHasPayment = incomingKeys.some((key) =>
      (APPROVAL_OR_PAYMENT_KEYS as readonly string[]).includes(key),
    );

    const existing: Array<{ role_key: RoleKey; entity_id: string | null }> = [];
    if (userId) {
      const rows = await client.query<{ role_key: RoleKey; entity_id: string | null }>(
        'SELECT role_key, entity_id FROM app.assignments_for_user($1)',
        [userId],
      );
      existing.push(...rows.rows);
    }

    const existingKeys = new Set(existing.flatMap((row) => DEFAULT_ROLE_GRANTS[row.role_key]));
    const wouldBeAdmin =
      SYSTEM_ADMIN_ROLES.includes(role) ||
      existing.some((row) => SYSTEM_ADMIN_ROLES.includes(row.role_key));
    const wouldHavePayment =
      incomingHasPayment ||
      [...existingKeys].some((key) => (APPROVAL_OR_PAYMENT_KEYS as readonly string[]).includes(key));

    if (wouldBeAdmin && wouldHavePayment) {
      throw new ConflictError('The Administrator cannot hold approval or payment permissions.');
    }

    const conflicts = await client.query<{
      role_key_a: RoleKey;
      role_key_b: RoleKey;
      same_entity: boolean;
    }>('SELECT role_key_a, role_key_b, same_entity FROM app.role_conflicts()');

    for (const current of existing) {
      const conflict = conflicts.rows.find(
        (row) =>
          (row.role_key_a === current.role_key && row.role_key_b === role) ||
          (row.role_key_a === role && row.role_key_b === current.role_key),
      );
      if (!conflict) continue;
      if (conflict.same_entity) {
        const same =
          Boolean(current.entity_id) && Boolean(entityId) && current.entity_id === entityId;
        if (same) {
          throw new ConflictError('Those two roles cannot be held for the same subsidiary.');
        }
      } else {
        throw new ConflictError('Those two roles cannot be held by the same person.');
      }
    }
  }

  private async roleId(client: import('pg').PoolClient, key: RoleKey): Promise<string> {
    const result = await client.query<{ id: string }>('SELECT app.role_id_for_key($1) AS id', [key]);
    const id = result.rows[0]?.id;
    if (!id) throw new NotFoundError('That role does not exist.');
    return id;
  }

  private async emailOf(client: import('pg').PoolClient, userId: string): Promise<string> {
    const result = await client.query<{ email: string }>(
      'SELECT email::text AS email FROM users WHERE id = $1',
      [userId],
    );
    return result.rows[0]?.email ?? userId;
  }
}
