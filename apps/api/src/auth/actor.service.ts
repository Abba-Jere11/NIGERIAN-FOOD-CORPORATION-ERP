import { Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import {
  effectiveMfaRequired,
  isPermissionKey,
  SESSION_COOKIE,
  type RoleKey,
  type ScopeType,
} from '@nfc/shared';
import type { Request } from 'express';
import type { Pool } from 'pg';
import { UnauthenticatedError } from '../common/errors/domain-error';
import { getRequestContext } from '../common/request-context/request-context';
import { APP_POOL } from '../database/tokens';
import { loadApiEnv } from '../config/env';
import { EntityDirectory } from './entity-directory.service';
import { hashSecret } from './tokens';

interface SessionRow {
  id: string;
  user_id: string;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  revoked_at: Date | null;
}

interface UserAuthRow {
  id: string;
  name: string;
  email: string;
  status: string;
  password_hash: string;
  must_change_password: boolean;
  mfa_required: boolean;
  mfa_secret_encrypted: string | null;
  mfa_enrolled_at: Date | null;
  failed_login_count: number;
  locked_until: Date | null;
  primary_entity_id: string;
  position: string;
  row_version: number;
}

interface AssignmentRow {
  role_key: RoleKey;
  scope_type: ScopeType;
  entity_id: string | null;
  home_path: string;
}

/**
 * Resolves the acting identity from the session cookie.
 */
@Injectable()
export class ActorService {
  constructor(
    @Inject(APP_POOL) private readonly pool: Pool,
    private readonly directory: EntityDirectory,
  ) {}

  async resolveFromRequest(req: Request): Promise<ActorContext> {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) {
      throw new UnauthenticatedError('Sign in to continue.');
    }

    const hash = hashSecret(token);
    const sessionResult = await this.pool.query<SessionRow>(
      'SELECT id, user_id, idle_expires_at, absolute_expires_at, revoked_at FROM app.session_by_token_hash($1)',
      [hash],
    );
    const session = sessionResult.rows[0];
    const now = Date.now();
    if (
      !session ||
      session.revoked_at ||
      session.idle_expires_at.getTime() <= now ||
      session.absolute_expires_at.getTime() <= now
    ) {
      throw new UnauthenticatedError('Your session has ended. Sign in again.');
    }

    const userResult = await this.pool.query<UserAuthRow>(
      `SELECT id, name, email, status, password_hash, must_change_password, mfa_required,
              mfa_secret_encrypted, mfa_enrolled_at, failed_login_count, locked_until,
              primary_entity_id, position, row_version
         FROM app.user_auth_row_by_id($1)`,
      [session.user_id],
    );
    const user = userResult.rows[0];
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthenticatedError('This account is not active.');
    }
    if (user.locked_until && user.locked_until.getTime() > now) {
      throw new UnauthenticatedError('This account is locked. Ask an Administrator to unlock it.');
    }

    const actor = await this.buildActorContext(user, session.id);

    const idleMs = loadApiEnv().SESSION_IDLE_MINUTES * 60 * 1000;
    await this.pool.query('SELECT app.touch_session($1, $2)', [
      session.id,
      new Date(now + idleMs),
    ]);

    return actor;
  }

  async roleKeysForUser(userId: string): Promise<RoleKey[]> {
    const result = await this.pool.query<{ role_key: RoleKey }>(
      'SELECT role_key FROM app.assignments_for_user($1)',
      [userId],
    );
    return result.rows.map((row) => row.role_key);
  }

  async loadByUserId(userId: string): Promise<ActorContext> {
    const userResult = await this.pool.query<UserAuthRow>(
      `SELECT id, name, email, status, password_hash, must_change_password, mfa_required,
              mfa_secret_encrypted, mfa_enrolled_at, failed_login_count, locked_until,
              primary_entity_id, position, row_version
         FROM app.user_auth_row_by_id($1)`,
      [userId],
    );
    const user = userResult.rows[0];
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthenticatedError('This account is not active.');
    }
    return this.buildActorContext(user, 'download-token');
  }

  async buildActorContext(user: UserAuthRow, sessionRowId: string): Promise<ActorContext> {
    const assignmentResult = await this.pool.query<AssignmentRow>(
      'SELECT role_key, scope_type, entity_id, home_path FROM app.assignments_for_user($1)',
      [user.id],
    );
    const grantResult = await this.pool.query<{ entity_id: string }>(
      'SELECT entity_id FROM app.scope_grants_for_user($1)',
      [user.id],
    );
    const permissionResult = await this.pool.query<{ permission_key: string }>(
      'SELECT permission_key FROM app.permissions_for_user($1)',
      [user.id],
    );

    const permissions = permissionResult.rows
      .map((row) => row.permission_key)
      .filter(isPermissionKey);

    const isAdmin = permissions.some((permission) => permission.startsWith('admin.'));
    const businessCorporate = assignmentResult.rows.some(
      (row) => row.scope_type === 'CORPORATE' && row.role_key !== 'administrator',
    );

    const entityIds = new Set<string>();
    for (const row of assignmentResult.rows) {
      if (row.entity_id) entityIds.add(row.entity_id);
    }
    for (const row of grantResult.rows) entityIds.add(row.entity_id);

    if (businessCorporate) {
      for (const id of await this.directory.allIds()) entityIds.add(id);
    }

    const primary = assignmentResult.rows[0];
    const homePath =
      assignmentResult.rows.find((row) => row.role_key === 'administrator')?.home_path ??
      primary?.home_path ??
      '/';

    const recordedRole = recordedRoleFromAssignments(assignmentResult.rows);
    const roleKeys = assignmentResult.rows.map((row) => row.role_key);
    const mfaPolicyRequired = effectiveMfaRequired(user.mfa_required, roleKeys);
    const mfaEnrolled = Boolean(user.mfa_enrolled_at && user.mfa_secret_encrypted);

    const context = getRequestContext();

    return {
      ref: user.id,
      name: user.name,
      email: user.email,
      position: user.position,
      role: recordedRole,
      scopeType: businessCorporate || isAdmin ? 'CORPORATE' : (primary?.scope_type ?? 'ENTITY'),
      entityIds: [...entityIds],
      isCorporate: businessCorporate,
      isAdmin,
      permissions,
      homePath,
      mustChangePassword: user.must_change_password,
      mfaPolicyRequired,
      mfaEnrolled,
      sessionRowId,
      requestId: context?.requestId,
      sessionId: sessionRowId,
      ipAddress: context?.ipAddress ?? undefined,
      userAgent: context?.userAgent ?? undefined,
    };
  }
}

function recordedRoleFromAssignments(rows: AssignmentRow[]): RoleKey | null {
  if (rows.length === 0) return null;
  const admin = rows.find((row) => row.role_key === 'administrator');
  if (admin) return 'administrator';
  return rows[0]?.role_key ?? null;
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === name) return decodeURIComponent(rest.join('='));
  }
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[name];
}

export function cookieOptions(maxAgeSeconds: number): {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: loadApiEnv().NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  };
}
