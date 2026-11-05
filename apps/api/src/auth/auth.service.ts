import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { applyActorSession, decryptSecret, encryptSecret, type ActorContext } from '@nfc/db';
import {
  CSRF_COOKIE,
  LOGIN_LOCKOUT_THRESHOLD,
  MFA_CHALLENGE_COOKIE,
  SESSION_COOKIE,
  STEP_UP_COOKIE,
  type LoginResultView,
  type MeView,
  type SessionView,
  ROLES,
  effectiveMfaRequired,
} from '@nfc/shared';
import type { Request, Response } from 'express';
import argon2 from 'argon2';
import type { Pool } from 'pg';
import {
  RateLimitedError,
  UnauthenticatedError,
  ValidationFailedError,
} from '../common/errors/domain-error';
import { getRequestContext } from '../common/request-context/request-context';
import { loadApiEnv } from '../config/env';
import { APP_POOL } from '../database/tokens';
import { ActorService, cookieOptions, readCookie } from './actor.service';
import { EntityDirectory } from './entity-directory.service';
import { assertPasswordPolicy } from './password-policy';
import { generateBackupCodes, generateTotpSecret, totpUri, verifyTotp } from './totp';
import { hashBackupCode, hashSecret, randomToken, signPayload, verifyPayload } from './tokens';

const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_RATE_LIMIT = 20;
const MFA_CHALLENGE_SECONDS = 5 * 60;
const STEP_UP_SECONDS = 5 * 60;
const RESET_SECONDS = 30 * 60;
const CSRF_SECONDS = 12 * 60 * 60;

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

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_POOL) private readonly pool: Pool,
    private readonly actors: ActorService,
    private readonly directory: EntityDirectory,
  ) {}

  issueCsrf(res: Response): { csrfToken: string } {
    const token = randomToken(24);
    res.cookie(CSRF_COOKIE, token, { ...cookieOptions(CSRF_SECONDS), httpOnly: false });
    return { csrfToken: token };
  }

  async login(req: Request, res: Response, email: string, password: string): Promise<LoginResultView> {
    const ip = clientIp(req);
    const normalised = email.trim().toLowerCase();

    await this.assertLoginRate(normalised, ip);

    const userResult = await this.pool.query<UserAuthRow>(
      `SELECT id, name, email, status, password_hash, must_change_password, mfa_required,
              mfa_secret_encrypted, mfa_enrolled_at, failed_login_count, locked_until,
              primary_entity_id, position, row_version
         FROM app.user_auth_row($1::citext)`,
      [normalised],
    );
    const user = userResult.rows[0];

    const dummyHash =
      '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const hash = user?.password_hash ?? dummyHash;
    const passwordOk = await argon2.verify(hash, password).catch(() => false);

    if (!user || !passwordOk) {
      if (user) await this.pool.query('SELECT app.record_login_failure($1)', [user.id]);
      await this.recordAttempt(normalised, ip, false, 'invalid');
      throw new UnauthenticatedError('Email or password is incorrect.');
    }

    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      await this.recordAttempt(normalised, ip, false, 'locked');
      throw new UnauthenticatedError(
        `This account is locked after ${LOGIN_LOCKOUT_THRESHOLD} failed attempts. Ask an Administrator to unlock it.`,
      );
    }

    if (user.status === 'PENDING_APPROVAL') {
      await this.recordAttempt(normalised, ip, false, 'inactive');
      throw new UnauthenticatedError('HR has not approved your access yet.');
    }
    if (user.status !== 'ACTIVE') {
      await this.recordAttempt(normalised, ip, false, 'inactive');
      throw new UnauthenticatedError('This account is not active.');
    }

    await this.recordAttempt(normalised, ip, true, 'password');

    const roleKeys = await this.actors.roleKeysForUser(user.id);
    const policyRequired = effectiveMfaRequired(user.mfa_required, roleKeys);
    const enrolled = Boolean(user.mfa_enrolled_at && user.mfa_secret_encrypted);
    if (policyRequired && enrolled) {
      const challenge = signPayload({ sub: user.id, kind: 'mfa' }, MFA_CHALLENGE_SECONDS);
      res.cookie(MFA_CHALLENGE_COOKIE, challenge, cookieOptions(MFA_CHALLENGE_SECONDS));
      return { mfaRequired: true, mustChangePassword: user.must_change_password, mfaEnrolRequired: false, homePath: null };
    }

    const actor = await this.completeLogin(req, res, user);
    return {
      mfaRequired: false,
      mustChangePassword: user.must_change_password,
      mfaEnrolRequired: policyRequired && !enrolled,
      homePath: actor.homePath,
    };
  }

  async verifyMfa(req: Request, res: Response, code: string): Promise<LoginResultView> {
    const challenge = readCookie(req, MFA_CHALLENGE_COOKIE);
    const payload = challenge ? verifyPayload(challenge, 'mfa') : null;
    if (!payload) {
      throw new UnauthenticatedError('The sign-in challenge has expired. Enter your password again.');
    }

    const userResult = await this.pool.query<UserAuthRow>(
      `SELECT id, name, email, status, password_hash, must_change_password, mfa_required,
              mfa_secret_encrypted, mfa_enrolled_at, failed_login_count, locked_until,
              primary_entity_id, position, row_version
         FROM app.user_auth_row_by_id($1)`,
      [payload.sub],
    );
    const user = userResult.rows[0];
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthenticatedError('This account is not active.');
    }

    const ok = await this.checkMfaCode(user, code);
    if (!ok) {
      await this.pool.query('SELECT app.record_login_failure($1)', [user.id]);
      throw new UnauthenticatedError('That code is not valid.');
    }

    const actor = await this.completeLogin(req, res, user);
    res.clearCookie(MFA_CHALLENGE_COOKIE, { path: '/' });
    return {
      mfaRequired: false,
      mustChangePassword: user.must_change_password,
      mfaEnrolRequired: false,
      homePath: actor.homePath,
    };
  }

  async logout(req: Request, res: Response): Promise<void> {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      const session = await this.pool.query<{ id: string }>(
        'SELECT id FROM app.session_by_token_hash($1)',
        [hashSecret(token)],
      );
      const row = session.rows[0];
      if (row) await this.pool.query('SELECT app.revoke_session($1, $2)', [row.id, 'self']);
    }
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(STEP_UP_COOKIE, { path: '/' });
    res.clearCookie(MFA_CHALLENGE_COOKIE, { path: '/' });
  }

  async forgotPassword(email: string): Promise<void> {
    const normalised = email.trim().toLowerCase();
    const userResult = await this.pool.query<UserAuthRow>(
      `SELECT id, name, email, status, password_hash, must_change_password,
              mfa_secret_encrypted, mfa_enrolled_at, failed_login_count, locked_until,
              primary_entity_id, position, row_version
         FROM app.user_auth_row($1::citext)`,
      [normalised],
    );
    const user = userResult.rows[0];
    if (!user || user.status !== 'ACTIVE') return;

    const raw = randomToken();
    const expires = new Date(Date.now() + RESET_SECONDS * 1000);
    await this.pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4)`,
      [user.id, hashSecret(raw), expires, 'system:auth'],
    );

    const origin = loadApiEnv().WEB_ORIGIN.replace(/\/$/, '');
    const resetUrl = `${origin}/login/reset?token=${encodeURIComponent(raw)}`;
    await this.pool.query(
      `INSERT INTO mail_outbox (kind, recipient, subject, body, payload, created_by)
       VALUES ('password-reset', $1, $2, $3, $4::jsonb, $5)`,
      [
        user.email,
        'Reset your NFC password',
        `Use this link within 30 minutes: ${resetUrl}`,
        JSON.stringify({ resetUrl }),
        'system:auth',
      ],
    );
    if (loadApiEnv().NODE_ENV === 'development') {
      console.log(`[mail_outbox] password reset for ${user.email}: ${resetUrl}`);
    }
  }

  async resetPassword(token: string, password: string): Promise<void> {
    await assertPasswordPolicy(password);
    const found = await this.pool.query<{
      user_id: string;
      expires_at: Date;
      used_at: Date | null;
      id: string;
    }>('SELECT user_id, expires_at, used_at, id FROM app.reset_token_user($1)', [hashSecret(token)]);
    const row = found.rows[0];
    if (!row || row.used_at || row.expires_at.getTime() <= Date.now()) {
      throw new ValidationFailedError('That reset link is invalid or has expired.');
    }
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await this.pool.query('SELECT app.update_password($1, $2, false)', [row.user_id, hash]);
    await this.pool.query('SELECT app.mark_reset_token_used($1)', [row.id]);
  }

  async changePassword(userId: string, current: string, next: string): Promise<{ mfaEnrolRequired: boolean }> {
    await assertPasswordPolicy(next);
    const userResult = await this.pool.query<UserAuthRow>(
      `SELECT id, password_hash, mfa_required, mfa_secret_encrypted, mfa_enrolled_at
         FROM app.user_auth_row_by_id($1)`,
      [userId],
    );
    const user = userResult.rows[0];
    if (!user) throw new UnauthenticatedError('Sign in to continue.');
    const ok = await argon2.verify(user.password_hash, current).catch(() => false);
    if (!ok) throw new ValidationFailedError('Current password is incorrect.', { fieldErrors: { currentPassword: ['Current password is incorrect.'] } });
    const hash = await argon2.hash(next, { type: argon2.argon2id });
    await this.pool.query('SELECT app.update_password($1, $2, false)', [userId, hash]);
    const roleKeys = await this.actors.roleKeysForUser(userId);
    const policyRequired = effectiveMfaRequired(user.mfa_required, roleKeys);
    const enrolled = Boolean(user.mfa_enrolled_at && user.mfa_secret_encrypted);
    return { mfaEnrolRequired: policyRequired && !enrolled };
  }

  async beginMfaEnrol(actor: ActorContext): Promise<{ uri: string; secret: string }> {
    if (!actor.mfaPolicyRequired) {
      throw new ValidationFailedError('Authenticator enrolment is not required for this account.');
    }
    const email = actor.email;
    if (!email) throw new ValidationFailedError('This account has no email address.');
    const secret = generateTotpSecret();
    const encrypted = encryptSecret(secret, loadApiEnv().MFA_ENCRYPTION_KEY);
    await this.withActor(actor, async (client) => {
      await client.query(
        `UPDATE users SET mfa_secret_encrypted = $2, mfa_enrolled_at = NULL, updated_by = $3 WHERE id = $1`,
        [actor.ref, encrypted, actor.ref],
      );
    });
    return { secret, uri: totpUri(secret, email) };
  }

  async confirmMfaEnrol(actor: ActorContext, code: string): Promise<{ backupCodes: string[] }> {
    if (!actor.mfaPolicyRequired) {
      throw new ValidationFailedError('Authenticator enrolment is not required for this account.');
    }
    const userId = actor.ref;
    const userResult = await this.pool.query<UserAuthRow>(
      `SELECT id, email, mfa_secret_encrypted FROM app.user_auth_row_by_id($1)`,
      [userId],
    );
    const user = userResult.rows[0];
    if (!user?.mfa_secret_encrypted) {
      throw new ValidationFailedError('Start authenticator enrolment first.');
    }
    const secret = decryptSecret(user.mfa_secret_encrypted, loadApiEnv().MFA_ENCRYPTION_KEY);
    if (!verifyTotp(secret, code)) {
      throw new ValidationFailedError('That code is not valid.');
    }
    await this.pool.query('SELECT app.set_mfa_secret($1, $2)', [userId, user.mfa_secret_encrypted]);
    const codes = generateBackupCodes();
    const hashes = codes.map((codeValue) => hashBackupCode(codeValue));
    await this.pool.query('SELECT app.replace_mfa_backup_codes($1, $2::text[])', [userId, hashes]);
    return { backupCodes: codes };
  }

  async regenerateBackupCodes(userId: string): Promise<{ backupCodes: string[] }> {
    const codes = generateBackupCodes();
    const hashes = codes.map((codeValue) => hashBackupCode(codeValue));
    await this.pool.query('SELECT app.replace_mfa_backup_codes($1, $2::text[])', [userId, hashes]);
    return { backupCodes: codes };
  }

  issueStepUp(res: Response, userId: string): void {
    const token = signPayload({ sub: userId, kind: 'stepup' }, STEP_UP_SECONDS);
    res.cookie(STEP_UP_COOKIE, token, cookieOptions(STEP_UP_SECONDS));
  }

  hasValidStepUp(req: Request, userId: string): boolean {
    const token = readCookie(req, STEP_UP_COOKIE);
    const payload = token ? verifyPayload(token, 'stepup') : null;
    return Boolean(payload && payload.sub === userId);
  }

  async confirmStepUp(_req: Request, res: Response, userId: string, code: string): Promise<void> {
    const userResult = await this.pool.query<UserAuthRow>(
      `SELECT id, mfa_secret_encrypted, mfa_enrolled_at FROM app.user_auth_row_by_id($1)`,
      [userId],
    );
    const user = userResult.rows[0];
    if (!user) throw new UnauthenticatedError('Sign in to continue.');
    const ok = await this.checkMfaCode(user, code);
    if (!ok) throw new ValidationFailedError('That code is not valid.');
    this.issueStepUp(res, userId);
  }

  async listMySessions(actor: ActorContext): Promise<SessionView[]> {
    return this.withActor(actor, async (client) => {
      const result = await client.query<{
        id: string;
        device_label: string | null;
        ip_address: string | null;
        user_agent: string | null;
        created_at: Date;
        last_seen_at: Date;
        idle_expires_at: Date;
        absolute_expires_at: Date;
      }>(
        `SELECT id, device_label, ip_address::text AS ip_address, user_agent, created_at, last_seen_at,
                idle_expires_at, absolute_expires_at
           FROM sessions
          WHERE user_id = $1 AND revoked_at IS NULL
          ORDER BY last_seen_at DESC`,
        [actor.ref],
      );
      return result.rows.map((row) => ({
        id: row.id,
        deviceLabel: row.device_label,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        createdAt: row.created_at.toISOString(),
        lastSeenAt: row.last_seen_at.toISOString(),
        idleExpiresAt: row.idle_expires_at.toISOString(),
        absoluteExpiresAt: row.absolute_expires_at.toISOString(),
        current: row.id === actor.sessionRowId,
      }));
    });
  }

  async revokeMySession(userId: string, sessionId: string): Promise<void> {
    await this.pool.query('SELECT app.revoke_session($1, $2)', [sessionId, userId]);
  }

  async meView(actor: Awaited<ReturnType<ActorService['buildActorContext']>>): Promise<MeView> {
    const entities = await this.directory.all();
    const inScope = actor.isAdmin || actor.isCorporate
      ? entities
      : entities.filter((entity) => actor.entityIds.includes(entity.id));
    const role = actor.role;
    return {
      ref: actor.ref,
      name: actor.name,
      email: actor.email ?? '',
      position: actor.position ?? '',
      role,
      roleName: role ? ROLES[role].name : null,
      roleShortName: role ? ROLES[role].shortName : null,
      scopeType: actor.scopeType,
      isCorporate: actor.isCorporate,
      isAdmin: actor.isAdmin,
      homePath: actor.homePath ?? '/',
      mustChangePassword: Boolean(actor.mustChangePassword),
      mfaRequired: Boolean(actor.mfaPolicyRequired && !actor.mfaEnrolled),
      mfaEnrolled: Boolean(actor.mfaEnrolled),
      permissions: actor.permissions,
      entities: inScope.map((entity) => ({
        id: entity.id,
        code: entity.code,
        name: entity.name,
        type: entity.type,
      })),
    };
  }

  private async withActor<T>(actor: ActorContext, fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await applyActorSession(client, actor);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async checkMfaCode(user: Pick<UserAuthRow, 'id' | 'mfa_secret_encrypted'>, code: string): Promise<boolean> {
    const trimmed = code.trim().replace(/\s/g, '');
    if (user.mfa_secret_encrypted) {
      const secret = decryptSecret(user.mfa_secret_encrypted, loadApiEnv().MFA_ENCRYPTION_KEY);
      if (verifyTotp(secret, trimmed)) return true;
    }
    const consumed = await this.pool.query<{ ok: boolean }>(
      'SELECT app.try_consume_backup_code($1, $2) AS ok',
      [user.id, hashBackupCode(trimmed)],
    );
    return consumed.rows[0]?.ok === true;
  }

  private async completeLogin(
    req: Request,
    res: Response,
    user: UserAuthRow,
  ): Promise<Awaited<ReturnType<ActorService['buildActorContext']>>> {
    const env = loadApiEnv();
    const now = Date.now();
    const raw = randomToken();
    const id = randomUUID();
    const idle = new Date(now + env.SESSION_IDLE_MINUTES * 60 * 1000);
    const absolute = new Date(now + env.SESSION_ABSOLUTE_HOURS * 60 * 60 * 1000);
    const ip = clientIp(req);
    const userAgent = req.headers['user-agent'] ?? null;
    const context = getRequestContext();
    const actor = await this.actors.buildActorContext(user, id);
    if (!actor.role || !actor.scopeType) {
      throw new UnauthenticatedError('This account has no role assignment.');
    }

    await this.pool.query(
      `SELECT app.insert_session($1::uuid, $2::uuid, $3::text, $4::inet, $5::text, $6::text, $7::timestamptz, $8::timestamptz, $9::text)`,
      [
        id,
        user.id,
        hashSecret(raw),
        ip,
        userAgent,
        deviceLabel(userAgent),
        idle,
        absolute,
        context?.requestId ?? null,
      ],
    );
    await this.pool.query('SELECT app.record_login_success($1::uuid, $2::inet, $3::text)', [
      user.id,
      ip,
      userAgent,
    ]);
    await this.pool.query(
      `SELECT app.insert_auth_audit(
         $1::uuid,
         $2::text,
         $3::role_key,
         $4::scope_type,
         $5::uuid[],
         'login'::audit_action,
         'session'::text,
         $6::uuid,
         $7::text,
         $8::inet,
         $9::text,
         $6::text,
         $10::text,
         $11::jsonb
       )`,
      [
        user.id,
        user.name,
        actor.role,
        actor.scopeType,
        actor.entityIds,
        id,
        user.email,
        ip,
        userAgent,
        context?.requestId ?? null,
        JSON.stringify({ sessionId: id }),
      ],
    );

    res.cookie(SESSION_COOKIE, raw, cookieOptions(env.SESSION_ABSOLUTE_HOURS * 60 * 60));
    this.issueCsrf(res);
    return actor;
  }

  private async assertLoginRate(email: string, ip: string | null): Promise<void> {
    const result = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM login_attempts
        WHERE attempted_at > now() - ($1 || ' minutes')::interval
          AND success = false
          AND email = $2::citext
          AND ($3::inet IS NULL OR ip_address = $3::inet)`,
      [String(LOGIN_WINDOW_MINUTES), email, ip],
    );
    if (Number.parseInt(result.rows[0]?.n ?? '0', 10) >= LOGIN_RATE_LIMIT) {
      throw new RateLimitedError('Too many sign-in attempts. Wait 15 minutes and try again.');
    }
  }

  private async recordAttempt(
    email: string,
    ip: string | null,
    success: boolean,
    reason: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO login_attempts (email, ip_address, success, reason) VALUES ($1::citext, $2::inet, $3, $4)`,
      [email, ip, success, reason],
    );
  }
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim() !== '') {
    return forwarded.split(',')[0]?.trim() ?? null;
  }
  return req.ip ?? req.socket.remoteAddress ?? null;
}

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  if (/Edg\//.test(userAgent)) return 'Edge';
  if (/Chrome\//.test(userAgent)) return 'Chrome';
  if (/Firefox\//.test(userAgent)) return 'Firefox';
  if (/Safari\//.test(userAgent)) return 'Safari';
  return 'Browser';
}
