import { createHash, randomBytes } from 'node:crypto';
import {
  APPROVAL_OR_PAYMENT_KEYS,
  DEFAULT_ROLE_GRANTS,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_KEYS,
  ROLES,
  SEED_USERS,
  TOTP_FIXTURE_SECRET,
  type PermissionKey,
  type RoleKey,
} from '@nfc/shared';
import argon2 from 'argon2';
import type { Pool, PoolClient } from 'pg';
import { insertAuditEntry } from './audit';
import { encryptSecret } from './secret-box';
import { type ActorContext } from './session';

const SEED_ACTOR: ActorContext = {
  ref: 'system:seed',
  name: 'Seed process',
  role: null,
  scopeType: null,
  entityIds: [],
  isCorporate: true,
  isAdmin: false,
  permissions: [],
  homePath: null,
  requestId: 'seed',
};

export interface IdentitySeedSummary {
  rolesCreated: number;
  permissionsCreated: number;
  usersCreated: number;
  alreadyPresent: boolean;
}

function hashToken(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export interface IdentitySeedOptions {
  password: string;
  /** Test database only: skip forced password change and pre-enrol TOTP. */
  e2eReady: boolean;
  mfaEncryptionKey: string | null;
}

export async function seedIdentity(pool: Pool, options: IdentitySeedOptions): Promise<IdentitySeedSummary> {
  const summary: IdentitySeedSummary = {
    rolesCreated: 0,
    permissionsCreated: 0,
    usersCreated: 0,
    alreadyPresent: false,
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    summary.permissionsCreated = await seedPermissions(client);
    summary.rolesCreated = await seedRoles(client);
    await seedRoleGrants(client);
    await seedRoleConflicts(client);
    await seedSensitiveFields(client);
    summary.usersCreated = await seedUsers(client, options);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  summary.alreadyPresent =
    summary.rolesCreated === 0 && summary.permissionsCreated === 0 && summary.usersCreated === 0;
  return summary;
}

async function seedPermissions(client: PoolClient): Promise<number> {
  let created = 0;
  for (const key of PERMISSION_KEYS) {
    const result = await client.query(
      `INSERT INTO permissions (key, description, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO NOTHING`,
      [key, PERMISSION_DESCRIPTIONS[key], SEED_ACTOR.ref],
    );
    created += result.rowCount ?? 0;
  }
  return created;
}

async function seedRoles(client: PoolClient): Promise<number> {
  let created = 0;
  for (const role of Object.values(ROLES)) {
    const existing = await client.query('SELECT id FROM roles WHERE key = $1', [role.key]);
    if (existing.rows[0]) {
      await client.query(
        `UPDATE roles
            SET name = $2, short_name = $3, scope_type = $4, home_path = $5,
                description = $6, updated_by = $7
          WHERE key = $1`,
        [
          role.key,
          role.name,
          role.shortName,
          role.scopeType,
          role.homePath,
          role.responsibility,
          SEED_ACTOR.ref,
        ],
      );
      continue;
    }
    await client.query(
      `INSERT INTO roles (key, name, short_name, scope_type, home_path, description, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [
        role.key,
        role.name,
        role.shortName,
        role.scopeType,
        role.homePath,
        role.responsibility,
        SEED_ACTOR.ref,
      ],
    );
    created += 1;
  }
  return created;
}

async function seedRoleGrants(client: PoolClient): Promise<void> {
  for (const [roleKey, grants] of Object.entries(DEFAULT_ROLE_GRANTS) as Array<
    [RoleKey, readonly PermissionKey[]]
  >) {
    const role = await client.query<{ id: string }>('SELECT id FROM roles WHERE key = $1', [roleKey]);
    const roleId = role.rows[0]?.id;
    if (!roleId) throw new Error(`Role ${roleKey} was not seeded`);
    for (const permission of grants) {
      if (roleKey === 'administrator' && (APPROVAL_OR_PAYMENT_KEYS as readonly string[]).includes(permission)) {
        throw new Error(`Administrator default grants must not include ${permission}`);
      }
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_key, created_by)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [roleId, permission, SEED_ACTOR.ref],
      );
    }
  }
}

async function seedRoleConflicts(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO role_conflicts (role_key_a, role_key_b, same_entity, reason, created_by)
     VALUES ('gm', 'finance_head', true, 'A person cannot originate procurement and execute payment for the same subsidiary.', $1)
     ON CONFLICT DO NOTHING`,
    [SEED_ACTOR.ref],
  );
}

async function seedSensitiveFields(client: PoolClient): Promise<void> {
  const fields: Array<[string, PermissionKey, string]> = [
    ['hr.salary', 'hr.view_sensitive', 'Employee salary, bank and personal contact fields.'],
    ['vendor.bank', 'vendor.view_bank_details', 'Vendor bank account details.'],
  ];
  for (const [fieldKey, permissionKey, description] of fields) {
    await client.query(
      `INSERT INTO sensitive_fields (field_key, permission_key, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (field_key) DO NOTHING`,
      [fieldKey, permissionKey, description],
    );
  }
}

async function seedUsers(client: PoolClient, options: IdentitySeedOptions): Promise<number> {
  const passwordHash = await hashPassword(options.password);
  let created = 0;

  const entities = await client.query<{ id: string; code: string }>('SELECT id, code FROM entities');
  const byCode = new Map(entities.rows.map((row) => [row.code, row.id]));
  const holdingId = byCode.get('NFC');
  if (!holdingId) throw new Error('Seed the organisation structure before seeding users.');

  const adminId = SEED_USERS.find((user) => user.role === 'administrator')?.id;
  if (!adminId) throw new Error('The Administrator is missing from SEED_USERS.');

  for (const user of SEED_USERS) {
    const existing = await client.query('SELECT id FROM users WHERE id = $1', [user.id]);
    if (existing.rows[0]) {
      await client.query(
        `UPDATE users SET name = $2, "position" = $3, updated_by = $4 WHERE id = $1`,
        [user.id, user.name, user.position, SEED_ACTOR.ref],
      );
    } else {
      const primaryEntityId =
        user.entityCode === null ? holdingId : (byCode.get(user.entityCode) ?? holdingId);
      const mustChange = options.e2eReady ? false : true;
      const mfaRequiredFlag = options.e2eReady;

      let mfaEncrypted: string | null = null;
      let mfaEnrolledAt: Date | null = null;
      if (options.e2eReady) {
        if (!options.mfaEncryptionKey) {
          throw new Error('MFA_ENCRYPTION_KEY is required to seed an e2e-ready test database.');
        }
        mfaEncrypted = encryptSecret(TOTP_FIXTURE_SECRET, options.mfaEncryptionKey);
        mfaEnrolledAt = new Date();
      }

      await client.query(
        `INSERT INTO users (
           id, name, email, status, primary_entity_id, "position", password_hash,
           must_change_password, mfa_required, mfa_secret_encrypted, mfa_enrolled_at,
           created_by, updated_by
         ) VALUES ($1, $2, $3, 'ACTIVE', $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
        [
          user.id,
          user.name,
          user.email,
          primaryEntityId,
          user.position,
          passwordHash,
          mustChange,
          mfaRequiredFlag,
          mfaEncrypted,
          mfaEnrolledAt,
          user.role === 'administrator' ? 'system:seed' : adminId,
        ],
      );

      const role = await client.query<{ id: string }>('SELECT id FROM roles WHERE key = $1', [user.role]);
      const roleId = role.rows[0]?.id;
      if (!roleId) throw new Error(`Role ${user.role} missing while seeding ${user.email}`);

      const entityId = user.scopeType === 'ENTITY' ? (byCode.get(user.entityCode ?? '') ?? null) : null;
      if (user.scopeType === 'ENTITY' && !entityId) {
        throw new Error(`Entity ${user.entityCode} missing for ${user.email}`);
      }

      await client.query(
        `INSERT INTO user_role_assignments (
           user_id, role_id, scope_type, entity_id, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $5)`,
        [user.id, roleId, user.scopeType, entityId, SEED_ACTOR.ref],
      );

      if (options.e2eReady) {
        const codes = Array.from({ length: 10 }, () => randomBytes(5).toString('hex'));
        const hashes = codes.map(hashToken);
        await client.query('SELECT app.replace_mfa_backup_codes($1, $2::text[])', [user.id, hashes]);
      } else if (user.role === 'administrator') {
        const uri = `otpauth://totp/NFC:${encodeURIComponent(user.email)}?secret=ENROL_AT_FIRST_LOGIN&issuer=NFC`;
        await client.query(
          `INSERT INTO mail_outbox (kind, recipient, subject, body, payload, created_by)
           VALUES ('mfa-enrol', $1, $2, $3, $4::jsonb, $5)`,
          [
            user.email,
            'Enrol authenticator at first sign-in',
            `Sign in as ${user.email} and complete authenticator enrolment. ${uri}`,
            JSON.stringify({ email: user.email, note: 'Administrator accounts always require MFA' }),
            SEED_ACTOR.ref,
          ],
        );
      }

      await insertAuditEntry(client, SEED_ACTOR, {
        action: 'account_change',
        subjectType: 'user',
        subjectId: user.id,
        subjectLabel: user.email,
        entityId: primaryEntityId,
        newValue: { email: user.email, role: user.role, status: 'ACTIVE' },
        reason: 'Seeded identity',
      });

      created += 1;
    }

    await linkStaffEmployee(client, user, byCode);
  }

  return created;
}

/**
 * A staff login named with a department is linked to one employee in that
 * department, so My workspace has a record to open. Existing links are left
 * as they are.
 */
async function linkStaffEmployee(
  client: PoolClient,
  user: (typeof SEED_USERS)[number],
  byCode: Map<string, string>,
): Promise<void> {
  if (!user.departmentName || !user.entityCode) return;
  const entityId = byCode.get(user.entityCode);
  if (!entityId) throw new Error(`Entity ${user.entityCode} missing for ${user.email}`);
  const department = await client.query<{ id: string }>(
    `SELECT id FROM departments WHERE entity_id = $1 AND lower(name) = lower($2)`,
    [entityId, user.departmentName],
  );
  const departmentId = department.rows[0]?.id;
  if (!departmentId) {
    throw new Error(`Department ${user.departmentName} is missing for ${user.email}`);
  }
  await client.query(`UPDATE users SET department_id = $2, updated_by = $3 WHERE id = $1`, [
    user.id,
    departmentId,
    SEED_ACTOR.ref,
  ]);
  const linked = await client.query(`SELECT id FROM hr_employees WHERE user_id = $1`, [user.id]);
  if (linked.rows[0]) return;
  const reference = await client.query<{ ref: string }>(`SELECT app.next_reference('EMP') AS ref`);
  const ref = reference.rows[0]?.ref;
  if (!ref) throw new Error(`An employee reference was not allocated for ${user.email}`);
  const parts = user.name.split(' ').filter((part) => part.length > 0);
  const firstName = parts[0] ?? 'Staff';
  const lastName = parts.slice(1).join(' ') || firstName;
  await client.query(
    `INSERT INTO hr_employees (
       reference_number, entity_id, department_id, first_name, last_name,
       employment_type, date_employed, status, work_email, user_id,
       idempotency_key, created_by, updated_by
     ) VALUES (
       $1, $2, $3, $4, $5, 'PERMANENT', '2026-01-12', 'ACTIVE', $6, $7, $8, $9, $9
     )`,
    [ref, entityId, departmentId, firstName, lastName, user.email, user.id, `seed-staff-${user.id}`, SEED_ACTOR.ref],
  );
}
