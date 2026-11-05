import { Inject, Injectable, forwardRef } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import type {
  ComplaintView,
  ConversationView,
  DirectoryEntryView,
  HrAttendanceView,
  HrLeaveBalanceView,
  HrLeaveRequestView,
  MeProfileView,
  MessageView,
  NoticeView,
} from '@nfc/shared';
import { assertCan, can, scopeFilter } from '../auth/can';
import { ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../common/errors/domain-error';
import { UnitOfWork } from '../database/unit-of-work';
import type { TxScope } from '../database/unit-of-work';
import { HrService } from '../hr/hr.service';

@Injectable()
export class MeService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    @Inject(forwardRef(() => HrService)) private readonly hr: HrService,
  ) {}

  async summary(actor: ActorContext): Promise<{ linked: boolean; unreadMessages: number; unreadNotices: number }> {
    if (!can(actor, 'self.workspace')) return { linked: false, unreadMessages: 0, unreadNotices: 0 };
    return this.unitOfWork.read(actor, async (tx) => {
      const employee = await this.employeeId(tx, actor.ref);
      if (!employee) return { linked: false, unreadMessages: 0, unreadNotices: 0 };
      const messages = await tx.client.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM messages m
           JOIN conversation_members mem ON mem.conversation_id = m.conversation_id
          WHERE mem.user_id = $1::uuid
            AND m.sender_user_id <> $1::uuid
            AND (mem.last_read_at IS NULL OR m.created_at > mem.last_read_at)`,
        [actor.ref],
      );
      const notices = await tx.client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM notices n
          WHERE n.status = 'PUBLISHED'
            AND NOT EXISTS (SELECT 1 FROM notice_reads r WHERE r.notice_id = n.id AND r.user_id = $1::uuid)`,
        [actor.ref],
      );
      return {
        linked: true,
        unreadMessages: Number(messages.rows[0]?.n ?? 0),
        unreadNotices: Number(notices.rows[0]?.n ?? 0),
      };
    });
  }

  async profile(actor: ActorContext): Promise<MeProfileView> {
    assertCan(actor, 'self.workspace');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        reference_number: string;
        first_name: string;
        last_name: string;
        entity_code: string;
        department_name: string | null;
        position_title: string | null;
        work_email: string | null;
        work_phone: string | null;
        other_names: string | null;
        gender: string | null;
        personal_email: string | null;
        personal_phone: string | null;
        emergency_name: string | null;
        emergency_phone: string | null;
        row_version: number;
      }>(
        `SELECT e.id, e.reference_number, e.first_name, e.last_name, ent.code AS entity_code,
                d.name AS department_name, p.title AS position_title, e.work_email, e.work_phone,
                e.other_names, e.gender, e.personal_email, e.personal_phone,
                e.emergency_name, e.emergency_phone, e.row_version
           FROM hr_employees e
           JOIN entities ent ON ent.id = e.entity_id
           LEFT JOIN departments d ON d.id = e.department_id
           LEFT JOIN hr_positions p ON p.id = e.position_id
          WHERE e.user_id = $1`,
        [actor.ref],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundError('Your account is not linked to an employee record yet.');
      return {
        employeeId: row.id,
        referenceNumber: row.reference_number,
        name: `${row.first_name} ${row.last_name}`,
        entityCode: row.entity_code,
        departmentName: row.department_name,
        positionTitle: row.position_title,
        workEmail: row.work_email,
        workPhone: row.work_phone,
        otherNames: row.other_names,
        gender: row.gender,
        personalEmail: row.personal_email,
        personalPhone: row.personal_phone,
        emergencyName: row.emergency_name,
        emergencyPhone: row.emergency_phone,
        rowVersion: row.row_version,
      };
    });
  }

  async updateProfile(
    actor: ActorContext,
    input: {
      otherNames?: string | null;
      gender?: string | null;
      personalEmail?: string | null;
      personalPhone?: string | null;
      emergencyName?: string | null;
      emergencyPhone?: string | null;
      rowVersion: number;
    },
  ): Promise<MeProfileView> {
    assertCan(actor, 'self.workspace');
    await this.unitOfWork.write(actor, async (tx) => {
      const current = await tx.client.query<{ id: string; row_version: number }>(
        `SELECT id, row_version FROM hr_employees WHERE user_id = $1 FOR UPDATE`,
        [actor.ref],
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundError('Your account is not linked to an employee record yet.');
      if (row.row_version !== input.rowVersion) {
        throw new ConflictError('Your profile changed. Refresh and try again.');
      }
      await tx.client.query(
        `UPDATE hr_employees SET
           other_names = $2, gender = $3, personal_email = $4, personal_phone = $5,
           emergency_name = $6, emergency_phone = $7, updated_by = $8
         WHERE id = $1`,
        [
          row.id,
          input.otherNames ?? null,
          input.gender ?? null,
          input.personalEmail ?? null,
          input.personalPhone ?? null,
          input.emergencyName ?? null,
          input.emergencyPhone ?? null,
          actor.ref,
        ],
      );
    });
    return this.profile(actor);
  }

  async attendance(actor: ActorContext): Promise<HrAttendanceView[]> {
    assertCan(actor, 'self.workspace');
    return this.unitOfWork.read(actor, (tx) => this.hr.attendanceForUser(tx, actor.ref));
  }

  async payslips(actor: ActorContext): Promise<Array<{ runId: string; periodName: string; referenceNumber: string }>> {
    assertCan(actor, 'self.payslip.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{ run_id: string; period_name: string; reference_number: string }>(
        `SELECT run_id, period_name, reference_number FROM app.own_payslips()`,
      );
      return result.rows.map((row) => ({
        runId: row.run_id,
        periodName: row.period_name,
        referenceNumber: row.reference_number,
      }));
    });
  }

  async leave(actor: ActorContext): Promise<{ requests: HrLeaveRequestView[]; balances: HrLeaveBalanceView[] }> {
    assertCan(actor, 'self.leave.request');
    return this.unitOfWork.read(actor, async (tx) => {
      const employeeId = await this.requireEmployee(tx, actor.ref);
      return {
        requests: await this.hr.leaveForEmployee(tx, employeeId),
        balances: await this.hr.balancesFor(tx, employeeId),
      };
    });
  }

  async requestLeave(
    actor: ActorContext,
    input: {
      typeKey: string;
      startsOn: string;
      endsOn: string;
      reason?: string | null;
      reliefEmployeeId: string;
      idempotencyKey: string;
    },
  ): Promise<HrLeaveRequestView> {
    const employeeId = await this.unitOfWork.read(actor, (tx) => this.requireEmployee(tx, actor.ref));
    return this.hr.createLeave(actor, { ...input, employeeId });
  }

  async reliefInbox(actor: ActorContext): Promise<HrLeaveRequestView[]> {
    assertCan(actor, 'self.workspace');
    return this.unitOfWork.read(actor, async (tx) => {
      const employeeId = await this.requireEmployee(tx, actor.ref);
      return this.hr.reliefInbox(tx, employeeId);
    });
  }

  async directory(actor: ActorContext, query: string): Promise<DirectoryEntryView[]> {
    assertCan(actor, 'directory.view');
    const entities = scopeFilter(actor);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        name: string;
        position_title: string | null;
        department_name: string | null;
        department_id: string | null;
        entity_code: string;
        work_email: string | null;
        work_phone: string | null;
        user_id: string | null;
      }>(
        `SELECT id, name, position_title, department_name, department_id, entity_code, work_email, work_phone, user_id
           FROM app.directory_entries($1::uuid[], $2)`,
        [entities, query.trim()],
      );
      return result.rows.map((row) => ({
        employeeId: row.id,
        name: row.name,
        positionTitle: row.position_title,
        departmentName: row.department_name,
        departmentId: row.department_id,
        entityCode: row.entity_code,
        workEmail: row.work_email,
        workPhone: row.work_phone,
        userId: row.user_id,
      }));
    });
  }

  async notices(actor: ActorContext): Promise<NoticeView[]> {
    assertCan(actor, 'notice.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        title: string;
        body: string;
        pinned: boolean;
        publish_at: Date | null;
        read: boolean;
      }>(
        `SELECT n.id, n.title, n.body, n.pinned, n.publish_at,
                EXISTS (SELECT 1 FROM notice_reads r WHERE r.notice_id = n.id AND r.user_id = $1::uuid) AS read
           FROM notices n
          ORDER BY n.pinned DESC, n.publish_at DESC NULLS LAST`,
        [actor.ref],
      );
      return result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        pinned: row.pinned,
        publishAt: row.publish_at?.toISOString() ?? null,
        read: row.read,
      }));
    });
  }

  async markNoticeRead(actor: ActorContext, noticeId: string): Promise<void> {
    assertCan(actor, 'notice.view');
    await this.unitOfWork.write(actor, async (tx) => {
      await tx.client.query(
        `INSERT INTO notice_reads (notice_id, user_id) VALUES ($1, $2::uuid) ON CONFLICT DO NOTHING`,
        [noticeId, actor.ref],
      );
    });
  }

  async publishNotice(
    actor: ActorContext,
    input: { title: string; body: string; entityId?: string | null; audience: Record<string, unknown>; pinned?: boolean },
  ): Promise<void> {
    assertCan(actor, 'notice.manage', input.entityId);
    await this.unitOfWork.write(actor, async (tx) => {
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO notices (entity_id, title, body, audience, publish_at, pinned, status, created_by, updated_by)
         VALUES ($1, $2, $3, $4::jsonb, now(), $5, 'PUBLISHED', $6, $6) RETURNING id`,
        [input.entityId ?? null, input.title, input.body, JSON.stringify(input.audience), input.pinned ?? false, actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The notice was not published.');
      const recipients = await tx.client.query<{ id: string }>(
        `SELECT u.id FROM users u WHERE u.status = 'ACTIVE'`,
      );
      for (const recipient of recipients.rows) {
        await tx.publish({
          eventType: 'notice.published',
          subjectType: 'NOTICE',
          subjectId: id,
          entityId: input.entityId ?? null,
          payload: {
            type: 'notice.published',
            reference: input.title,
            title: input.title,
            recipientUserId: recipient.id,
            href: '/me/notices',
          },
        });
      }
    });
  }

  async listManagedNotices(actor: ActorContext): Promise<NoticeView[]> {
    assertCan(actor, 'notice.manage');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{ id: string; title: string; body: string; pinned: boolean; status: string; publish_at: Date | null }>(
        `SELECT id, title, body, pinned, status, publish_at FROM notices ORDER BY created_at DESC`,
      );
      return result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        pinned: row.pinned,
        status: row.status,
        publishAt: row.publish_at?.toISOString() ?? null,
        read: true,
      }));
    });
  }

  async complaints(actor: ActorContext): Promise<ComplaintView[]> {
    if (!can(actor, 'complaint.submit') && !can(actor, 'complaint.manage')) {
      throw new ForbiddenError('Your role does not permit this action.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        reference_number: string;
        category: string;
        subject: string;
        body: string;
        is_anonymous: boolean;
        status: string;
        created_at: Date;
        row_version: number;
      }>(
        `SELECT id, reference_number, category, subject, body, is_anonymous, status, created_at, row_version
           FROM app.complaints_for_actor()`,
      );
      return result.rows.map(toComplaint);
    });
  }

  async submitComplaint(
    actor: ActorContext,
    input: { category: string; subject: string; body: string; anonymous: boolean },
  ): Promise<ComplaintView> {
    assertCan(actor, 'complaint.submit');
    return this.unitOfWork.write(actor, async (tx) => {
      const employee = await tx.client.query<{ entity_id: string }>(
        `SELECT entity_id FROM hr_employees WHERE user_id = $1`,
        [actor.ref],
      );
      const entityId = employee.rows[0]?.entity_id ?? actor.entityIds[0];
      if (!entityId) throw new ValidationFailedError('Your account is not linked to a subsidiary.');
      const reference = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('CMP') AS ref`);
      const ref = reference.rows[0]?.ref;
      if (!ref) throw new Error('The complaint reference was not allocated.');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO hr_complaints (
           reference_number, entity_id, category, subject, body, is_anonymous, submitted_by_user_id,
           created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8, $8) RETURNING id`,
        [ref, entityId, input.category, input.subject, input.body, input.anonymous, actor.ref, actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The complaint was not saved.');
      const hr = await tx.client.query<{ user_id: string }>(
        `SELECT user_id FROM app.users_holding_permission('complaint.manage', $1::uuid, 'ALL')`,
        [entityId],
      );
      for (const holder of hr.rows) {
        await tx.publish({
          eventType: 'complaint.submitted',
          subjectType: 'COMPLAINT',
          subjectId: id,
          entityId,
          payload: {
            type: 'complaint.submitted',
            reference: ref,
            title: input.subject,
            recipientUserId: holder.user_id,
            href: '/hr/complaints',
          },
        });
      }
      await tx.audit({
        action: 'create',
        subjectType: 'hr_complaint',
        subjectId: id,
        subjectLabel: ref,
        subjectReferenceNumber: ref,
        entityId,
        newValue: { anonymous: input.anonymous, category: input.category },
      });
      const view = await tx.client.query(`SELECT * FROM app.complaints_for_actor() WHERE id = $1`, [id]);
      return toComplaint(view.rows[0] as never);
    });
  }

  async replyComplaint(actor: ActorContext, id: string, body: string, status?: string): Promise<void> {
    if (!can(actor, 'complaint.submit') && !can(actor, 'complaint.manage')) {
      throw new ForbiddenError('Your role does not permit this action.');
    }
    await this.unitOfWork.write(actor, async (tx) => {
      await tx.client.query(
        `INSERT INTO hr_complaint_messages (complaint_id, author_user_id, body, created_by)
         VALUES ($1, $2::uuid, $3, $2)`,
        [id, actor.ref, body],
      );
      if (status && can(actor, 'complaint.manage')) {
        await tx.client.query(`UPDATE hr_complaints SET status = $2, updated_by = $3 WHERE id = $1`, [
          id,
          status,
          actor.ref,
        ]);
      }
    });
  }

  async conversations(actor: ActorContext): Promise<ConversationView[]> {
    assertCan(actor, 'message.use');
    return this.unitOfWork.read(actor, async (tx) => {
      await this.syncDepartment(tx, actor.ref);
      const result = await tx.client.query<{ id: string; kind: ConversationView['kind']; title: string | null; unread: string }>(
        `SELECT c.id, c.kind,
                coalesce(c.title, (
                  SELECT u.name FROM conversation_members om
                    JOIN users u ON u.id = om.user_id
                   WHERE om.conversation_id = c.id AND om.user_id <> $1::uuid
                   LIMIT 1
                ), 'Conversation') AS title,
                (SELECT count(*) FROM messages m
                  JOIN conversation_members mem ON mem.conversation_id = m.conversation_id AND mem.user_id = $1::uuid
                 WHERE m.conversation_id = c.id AND m.sender_user_id <> $1::uuid
                   AND (mem.last_read_at IS NULL OR m.created_at > mem.last_read_at))::text AS unread
           FROM conversations c
           JOIN conversation_members me ON me.conversation_id = c.id AND me.user_id = $1::uuid
          ORDER BY c.updated_at DESC`,
        [actor.ref],
      );
      return result.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title ?? 'Conversation',
        unread: Number(row.unread),
      }));
    });
  }

  async messages(actor: ActorContext, conversationId: string): Promise<MessageView[]> {
    assertCan(actor, 'message.use');
    return this.unitOfWork.write(actor, async (tx) => {
      const member = await tx.client.query(`SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`, [
        conversationId,
        actor.ref,
      ]);
      if (!member.rows[0]) throw new ForbiddenError('You are not in that conversation.');
      await tx.client.query(
        `UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, actor.ref],
      );
      const result = await tx.client.query<{ id: string; sender_user_id: string; sender_name: string; body: string; created_at: Date }>(
        `SELECT m.id, m.sender_user_id, u.name AS sender_name, m.body, m.created_at
           FROM messages m JOIN users u ON u.id = m.sender_user_id
          WHERE m.conversation_id = $1
          ORDER BY m.created_at`,
        [conversationId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        senderUserId: row.sender_user_id,
        senderName: row.sender_name,
        body: row.body,
        createdAt: row.created_at.toISOString(),
      }));
    });
  }

  async sendMessage(actor: ActorContext, conversationId: string, body: string): Promise<void> {
    assertCan(actor, 'message.use');
    await this.unitOfWork.write(actor, async (tx) => {
      await tx.client.query(
        `INSERT INTO messages (conversation_id, sender_user_id, body, created_by) VALUES ($1, $2::uuid, $3, $2)`,
        [conversationId, actor.ref, body],
      );
      await tx.client.query(`UPDATE conversations SET updated_by = $2 WHERE id = $1`, [conversationId, actor.ref]);
      const others = await tx.client.query<{ user_id: string }>(
        `SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2::uuid`,
        [conversationId, actor.ref],
      );
      for (const other of others.rows) {
        await tx.publish({
          eventType: 'message.received',
          subjectType: 'MESSAGE',
          subjectId: conversationId,
          entityId: actor.entityIds[0] ?? null,
          payload: {
            type: 'message.received',
            title: 'New message',
            reference: '',
            recipientUserId: other.user_id,
            href: `/me/messages/${conversationId}`,
          },
        });
      }
    });
  }

  async openDirect(actor: ActorContext, otherUserId: string): Promise<string> {
    assertCan(actor, 'message.use');
    if (otherUserId === actor.ref) throw new ValidationFailedError('Choose a colleague to message.');
    return this.unitOfWork.write(actor, async (tx) => {
      const low = actor.ref < otherUserId ? actor.ref : otherUserId;
      const high = actor.ref < otherUserId ? otherUserId : actor.ref;
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM conversations WHERE kind = 'DIRECT' AND direct_low = $1 AND direct_high = $2`,
        [low, high],
      );
      if (existing.rows[0]) return existing.rows[0].id;
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO conversations (kind, direct_low, direct_high, created_by, updated_by)
         VALUES ('DIRECT', $1, $2, $3, $3) RETURNING id`,
        [low, high, actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The conversation was not created.');
      await tx.client.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role, created_by) VALUES ($1, $2::uuid, 'OWNER', $3), ($1, $4::uuid, 'MEMBER', $3)`,
        [id, actor.ref, actor.ref, otherUserId],
      );
      return id;
    });
  }

  async openGroup(actor: ActorContext, title: string, memberIds: string[]): Promise<string> {
    assertCan(actor, 'message.use');
    const members = [...new Set([actor.ref, ...memberIds])];
    return this.unitOfWork.write(actor, async (tx) => {
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO conversations (kind, title, created_by, updated_by) VALUES ('GROUP', $1, $2, $2) RETURNING id`,
        [title, actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The group was not created.');
      for (const member of members) {
        await tx.client.query(
          `INSERT INTO conversation_members (conversation_id, user_id, role, created_by) VALUES ($1, $2::uuid, $3, $4)`,
          [id, member, member === actor.ref ? 'OWNER' : 'MEMBER', actor.ref],
        );
      }
      return id;
    });
  }

  private async syncDepartment(tx: TxScope, userId: string): Promise<void> {
    const department = await tx.client.query<{ department_id: string | null }>(
      `SELECT department_id FROM hr_employees WHERE user_id = $1`,
      [userId],
    );
    const departmentId = department.rows[0]?.department_id;
    if (departmentId) await tx.client.query(`SELECT app.ensure_department_channel($1)`, [departmentId]);
  }

  private async employeeId(tx: TxScope, userId: string): Promise<string | null> {
    const result = await tx.client.query<{ id: string }>(`SELECT id FROM hr_employees WHERE user_id = $1`, [userId]);
    return result.rows[0]?.id ?? null;
  }

  private async requireEmployee(tx: TxScope, userId: string): Promise<string> {
    const id = await this.employeeId(tx, userId);
    if (!id) throw new NotFoundError('Your account is not linked to an employee record yet.');
    return id;
  }
}

function toComplaint(row: {
  id: string;
  reference_number: string;
  category: string;
  subject: string;
  body: string;
  is_anonymous: boolean;
  status: string;
  created_at: Date;
  row_version: number;
}): ComplaintView {
  return {
    id: row.id,
    referenceNumber: row.reference_number,
    category: row.category,
    subject: row.subject,
    body: row.body,
    anonymous: row.is_anonymous,
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    rowVersion: row.row_version,
  };
}
