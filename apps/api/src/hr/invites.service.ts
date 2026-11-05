import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type { Pool } from 'pg';
import argon2 from 'argon2';
import type { StaffInvitePreview, StaffInviteView } from '@nfc/shared';
import { assertCan } from '../auth/can';
import { assertPasswordPolicy } from '../auth/password-policy';
import { hashSecret, randomToken } from '../auth/tokens';
import { loadApiEnv } from '../config/env';
import { ConflictError, NotFoundError, ValidationFailedError } from '../common/errors/domain-error';
import { UnitOfWork } from '../database/unit-of-work';
import { APP_POOL } from '../database/tokens';
import { INVITE_TTL_MS, inviteIsUsable } from './invite-rules';

export interface RegisterInviteInput {
  password: string;
  otherNames?: string | null;
  gender?: string | null;
  personalPhone?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
}

@Injectable()
export class InvitesService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    @Inject(APP_POOL) private readonly pool: Pool,
  ) {}

  async issue(actor: ActorContext, employeeId: string): Promise<StaffInviteView & { link: string }> {
    assertCan(actor, 'hr.invite.manage');
    return this.unitOfWork.write(actor, async (tx) => {
      const employee = await tx.client.query<{
        id: string;
        entity_id: string;
        personal_email: string | null;
        work_email: string | null;
        user_id: string | null;
      }>(
        `SELECT id, entity_id, personal_email, work_email, user_id FROM hr_employees WHERE id = $1 FOR UPDATE`,
        [employeeId],
      );
      const row = employee.rows[0];
      if (!row) throw new NotFoundError('That employee was not found.');
      assertCan(actor, 'hr.invite.manage', row.entity_id);
      if (row.user_id) throw new ConflictError('This employee already has a sign-in.');
      const email = (row.personal_email ?? row.work_email ?? '').trim().toLowerCase();
      if (!email.includes('@')) throw new ValidationFailedError('Add a personal or work email before inviting.');
      const open = await tx.client.query<{ id: string }>(
        `SELECT id FROM hr_invites WHERE employee_id = $1 AND status = 'REGISTERED'`,
        [employeeId],
      );
      if (open.rows[0]) throw new ConflictError('This invite is already waiting for HR approval.');

      const raw = randomToken();
      const expires = new Date(Date.now() + INVITE_TTL_MS);
      await tx.client.query(
        `UPDATE hr_invites SET status = 'EXPIRED', updated_by = $2
          WHERE employee_id = $1 AND status = 'ISSUED'`,
        [employeeId, actor.ref],
      );
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO hr_invites (
           employee_id, entity_id, email, token_hash, expires_at, status, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, 'ISSUED', $6, $6) RETURNING id`,
        [employeeId, row.entity_id, email, hashSecret(raw), expires, actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The invite was not created.');
      const link = `${loadApiEnv().WEB_ORIGIN.replace(/\/$/, '')}/invite/${raw}`;
      await tx.client.query(
        `INSERT INTO mail_outbox (kind, recipient, subject, body, payload, created_by)
         VALUES ('staff-invite', $1, $2, $3, $4::jsonb, $5)`,
        [
          email,
          'Your NFC staff invite',
          `Use this link within 72 hours to register: ${link}`,
          JSON.stringify({ link }),
          actor.ref,
        ],
      );
      await tx.audit({
        action: 'account_change',
        subjectType: 'hr_invite',
        subjectId: id,
        subjectLabel: email,
        entityId: row.entity_id,
        newValue: { status: 'ISSUED' },
        reason: 'Staff invite issued',
      });
      return { id, employeeId, email, status: 'ISSUED' as const, expiresAt: expires.toISOString(), link };
    });
  }

  async listPending(actor: ActorContext): Promise<StaffInviteView[]> {
    assertCan(actor, 'hr.invite.manage');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        employee_id: string;
        email: string;
        status: StaffInviteView['status'];
        expires_at: Date;
      }>(
        `SELECT id, employee_id, email::text AS email, status, expires_at
           FROM hr_invites
          WHERE status IN ('ISSUED', 'REGISTERED')
          ORDER BY created_at DESC`,
      );
      return result.rows.map((row) => ({
        id: row.id,
        employeeId: row.employee_id,
        email: row.email,
        status: row.expires_at.getTime() < Date.now() && row.status === 'ISSUED' ? 'EXPIRED' : row.status,
        expiresAt: row.expires_at.toISOString(),
      }));
    });
  }

  async preview(token: string, ip: string | null): Promise<StaffInvitePreview> {
    await this.noteAttempt(ip);
    const result = await this.pool.query<{ preview: { ok: boolean; error?: string; email?: string; firstName?: string; lastName?: string; expiresAt?: string } }>(
      `SELECT app.preview_staff_invite($1) AS preview`,
      [hashSecret(token)],
    );
    const preview = result.rows[0]?.preview;
    if (!preview?.ok || !preview.email || !preview.firstName || !preview.lastName || !preview.expiresAt) {
      throw new NotFoundError(preview?.error ?? 'This invite link is not valid.');
    }
    if (!inviteIsUsable('ISSUED', new Date(preview.expiresAt))) {
      throw new NotFoundError('This invite link has expired or was already used.');
    }
    return {
      email: preview.email,
      firstName: preview.firstName,
      lastName: preview.lastName,
      expiresAt: new Date(preview.expiresAt).toISOString(),
    };
  }

  async register(token: string, input: RegisterInviteInput, ip: string | null): Promise<void> {
    await this.noteAttempt(ip);
    await assertPasswordPolicy(input.password);
    const hash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      await this.pool.query(`SELECT app.register_staff_invite($1, $2, $3::jsonb)`, [
        hashSecret(token),
        hash,
        JSON.stringify({
          otherNames: input.otherNames ?? null,
          gender: input.gender ?? null,
          personalPhone: input.personalPhone ?? null,
          emergencyName: input.emergencyName ?? null,
          emergencyPhone: input.emergencyPhone ?? null,
          bankName: input.bankName ?? null,
          bankAccountName: input.bankAccountName ?? null,
          bankAccountNumber: input.bankAccountNumber ?? null,
        }),
      ]);
    } catch (error) {
      const pg = error as { code?: string; message?: string };
      if (pg.code === '23514' || pg.code === '23505') {
        throw new ValidationFailedError(cleanPg(pg.message));
      }
      throw error;
    }
  }

  async decide(actor: ActorContext, inviteId: string, approve: boolean, reason: string): Promise<void> {
    assertCan(actor, 'hr.invite.manage');
    await this.unitOfWork.write(actor, async (tx) => {
      const before = await tx.client.query<{ user_id: string; entity_id: string; email: string }>(
        `SELECT user_id, entity_id, email::text AS email FROM hr_invites WHERE id = $1`,
        [inviteId],
      );
      const row = before.rows[0];
      if (!row?.user_id) throw new NotFoundError('That invite is not waiting for approval.');
      try {
        await tx.client.query(`SELECT app.decide_staff_invite($1, $2)`, [inviteId, approve]);
      } catch (error) {
        const pg = error as { code?: string; message?: string };
        if (pg.code === '23514' || pg.code === '42501') throw new ValidationFailedError(cleanPg(pg.message));
        throw error;
      }
      await tx.audit({
        action: 'account_change',
        subjectType: 'hr_invite',
        subjectId: inviteId,
        subjectLabel: row.email,
        entityId: row.entity_id,
        newValue: { status: approve ? 'APPROVED' : 'REVOKED' },
        reason,
      });
      await tx.publish({
        eventType: approve ? 'hr.invite.approved' : 'hr.invite.rejected',
        subjectType: 'HR_INVITE',
        subjectId: inviteId,
        entityId: row.entity_id,
        payload: {
          type: approve ? 'hr.invite.approved' : 'hr.invite.rejected',
          reference: row.email,
          title: approve ? 'Access approved' : 'Access not approved',
          reason,
          recipientUserId: row.user_id,
          href: '/me',
        },
      });
    });
  }

  async linkUser(actor: ActorContext, employeeId: string, userId: string): Promise<void> {
    assertCan(actor, 'hr.employee.manage');
    await this.unitOfWork.write(actor, async (tx) => {
      const employee = await tx.client.query<{ entity_id: string; user_id: string | null }>(
        `SELECT entity_id, user_id FROM hr_employees WHERE id = $1 FOR UPDATE`,
        [employeeId],
      );
      const row = employee.rows[0];
      if (!row) throw new NotFoundError('That employee was not found.');
      assertCan(actor, 'hr.employee.manage', row.entity_id);
      if (row.user_id) throw new ConflictError('This employee already has a sign-in.');
      const taken = await tx.client.query(`SELECT 1 FROM hr_employees WHERE user_id = $1`, [userId]);
      if (taken.rows[0]) throw new ConflictError('That user is already linked to an employee.');
      const user = await tx.client.query<{ id: string }>(`SELECT id FROM users WHERE id = $1 AND status = 'ACTIVE'`, [
        userId,
      ]);
      if (!user.rows[0]) throw new NotFoundError('That user was not found.');
      const staffRole = await tx.client.query(
        `SELECT 1 FROM user_role_assignments a JOIN roles r ON r.id = a.role_id
          WHERE a.user_id = $1 AND a.status = 'ACTIVE' AND r.key = 'staff'`,
        [userId],
      );
      const otherRole = await tx.client.query(
        `SELECT 1 FROM user_role_assignments a JOIN roles r ON r.id = a.role_id
          WHERE a.user_id = $1 AND a.status = 'ACTIVE' AND r.key <> 'staff'`,
        [userId],
      );
      if (staffRole.rows[0] && otherRole.rows[0]) {
        throw new ConflictError('The staff role cannot sit beside a management role.');
      }
      await tx.client.query(`UPDATE hr_employees SET user_id = $1, updated_by = $2 WHERE id = $3`, [
        userId,
        actor.ref,
        employeeId,
      ]);
      await tx.audit({
        action: 'account_change',
        subjectType: 'hr_employee',
        subjectId: employeeId,
        entityId: row.entity_id,
        newValue: { userId },
        reason: 'Linked an existing user to the employee record',
      });
    });
  }

  private async noteAttempt(ip: string | null): Promise<void> {
    const count = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM hr_invite_attempts
        WHERE ip_address = $1 AND created_at > now() - interval '15 minutes'`,
      [ip ?? 'unknown'],
    );
    if (Number(count.rows[0]?.n ?? 0) >= 20) {
      throw new ValidationFailedError('Too many invite attempts. Wait a few minutes and try again.');
    }
    await this.pool.query(`INSERT INTO hr_invite_attempts (ip_address) VALUES ($1)`, [ip ?? 'unknown']);
  }
}

function cleanPg(message: string | undefined): string {
  if (!message) return 'The invite could not be used.';
  return message.replace(/^.*ERROR:\s*/, '').split('\n')[0] ?? message;
}

export function inviteTokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}
