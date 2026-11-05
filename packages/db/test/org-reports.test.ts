/**
 * M16 official reports: ACL, forwarding ≠ instruction, minutes, responses, decisions.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { DEFAULT_ROLE_GRANTS, ROLE_KEYS, SEED_USERS, type PermissionKey } from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { OrgReportsService } from '../../../apps/api/src/org-reports/org-reports.service';
import { ForbiddenError, NotFoundError } from '../../../apps/api/src/common/errors/domain-error';
import { appPool, entityIdFor, ownerPool } from './support';

function actorFromSeed(email: string, entityIds: string[], extra: PermissionKey[] = []): ActorContext {
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
    permissions: [...DEFAULT_ROLE_GRANTS[user.role], ...extra],
    homePath: '/',
  };
}

function key(label: string): string {
  return `${label}-${randomUUID()}`;
}

describe('M16 organisational reports', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let nfc: string;
  let reports: OrgReportsService;
  let musa: ActorContext;
  let dmaGm: ActorContext;
  let abubakar: ActorContext;
  let halima: ActorContext;
  let yahuza: ActorContext;
  let hauwa: ActorContext;
  let admin: ActorContext;

  beforeAll(async () => {
    owner = ownerPool('nfc-erp-test-m16-owner');
    app = appPool('nfc-erp-test-m16-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
    nfc = await entityIdFor(owner, 'NFC');
    reports = new OrgReportsService(new UnitOfWork(app));
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
    dmaGm = actorFromSeed('gm.dma@nfc.local', [dma]);
    abubakar = actorFromSeed('md@nfc.local', [yfz, dma, nfc]);
    halima = actorFromSeed('ed.operations@nfc.local', [yfz, dma, nfc]);
    yahuza = actorFromSeed('fh.yfz@nfc.local', [yfz]);
    hauwa = actorFromSeed('inventory@nfc.local', [yfz, dma, nfc]);
    admin = actorFromSeed('administrator@nfc.local', []);
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  async function submitGeneral(title: string, ccUserIds: string[] = []) {
    const created = await reports.create(musa, {
      entityId: yfz,
      templateKey: 'general',
      title,
      body: 'Narrative body for the Managing Director.',
      ccUserIds,
      idempotencyKey: key('create'),
    });
    return reports.submit(musa, created.id, { idempotencyKey: key('submit'), rowVersion: created.rowVersion });
  }

  it('does not invent an HOD role; HR and payroll templates are specialist-only', async () => {
    expect([...ROLE_KEYS]).not.toContain('hod');
    const templates = await reports.templates(admin, false);
    expect(templates.some((row) => /hod/i.test(row.key) || /hod/i.test(row.title))).toBe(false);
    const hr = templates.find((row) => row.key === 'hr_staff');
    const payroll = templates.find((row) => row.key === 'payroll');
    expect(hr?.available).toBe(true);
    expect(payroll?.available).toBe(true);
    await expect(
      reports.create(musa, {
        entityId: yfz,
        templateKey: 'hr_staff',
        title: 'GM cannot file HR staff',
        body: 'No hr.employee.view.',
        idempotencyKey: key('hr'),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      reports.create(musa, {
        entityId: yfz,
        templateKey: 'payroll',
        title: 'GM cannot file payroll',
        body: 'No payroll.view.',
        idempotencyKey: key('pay'),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets a GM submit a general report with no CC that only the MD can open', async () => {
    const submitted = await submitGeneral(`M16 no-cc ${Date.now()}`);
    expect(submitted.referenceNumber.startsWith('ORG-')).toBe(true);
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.toUserId).toBe(abubakar.ref);
    expect(submitted.originalCc).toEqual([]);

    const asMd = await reports.get(abubakar, submitted.id);
    expect(asMd.myKind).toBe('TO');
    expect(asMd.status).toBe('UNDER_REVIEW');

    await expect(reports.get(halima, submitted.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(reports.get(admin, submitted.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(reports.get(dmaGm, submitted.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await reports.list(halima, 'incoming')).some((row) => row.id === submitted.id)).toBe(false);
  });

  it('gives a CC recipient a read-only copy and no MD powers', async () => {
    const submitted = await submitGeneral(`M16 cc ${Date.now()}`, [halima.ref]);
    const asCc = await reports.get(halima, submitted.id);
    expect(asCc.myKind).toBe('CC');
    expect(asCc.originalTo?.id).toBe(abubakar.ref);
    expect(asCc.originalCc.some((row) => row.id === halima.ref)).toBe(true);

    await expect(
      reports.forward(halima, submitted.id, { userIds: [yahuza.ref], rowVersion: asCc.rowVersion }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      reports.createMinute(halima, submitted.id, {
        subject: 'Not allowed',
        instruction: 'CC cannot issue.',
        toUserId: yahuza.ref,
        idempotencyKey: key('cc-minute'),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      reports.sendExternal(halima, submitted.id, {
        recipientEmail: 'outside@example.com',
        subject: 'Should fail',
        message: 'CC has no send authority.',
        idempotencyKey: key('cc-email'),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('gates specialist financial reports and isolates subsidiaries', async () => {
    await expect(
      reports.create(hauwa, {
        entityId: yfz,
        templateKey: 'financial',
        title: 'Inventory officer financial',
        body: 'No finance.view.',
        idempotencyKey: key('fin-inv'),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const financial = await reports.create(musa, {
      entityId: yfz,
      templateKey: 'financial',
      title: `M16 financial ${Date.now()}`,
      body: 'YFZ narrative, not a trial balance.',
      idempotencyKey: key('fin'),
    });
    const submitted = await reports.submit(musa, financial.id, {
      idempotencyKey: key('fin-sub'),
      rowVersion: financial.rowVersion,
    });
    await expect(reports.get(dmaGm, submitted.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      reports.create(dmaGm, {
        entityId: yfz,
        templateKey: 'general',
        title: 'DMA cannot file as YFZ',
        body: 'Wrong subsidiary.',
        idempotencyKey: key('dma-yfz'),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('forwards a copy without assigning work, then issues a minute that does', async () => {
    const submitted = await submitGeneral(`M16 forward-minute ${Date.now()}`);
    const opened = await reports.get(abubakar, submitted.id);
    const originalTo = opened.originalTo?.id;
    const originalCc = opened.originalCc.map((row) => row.id);

    const forwarded = await reports.forward(abubakar, opened.id, {
      userIds: [halima.ref],
      note: 'For information only.',
      rowVersion: opened.rowVersion,
    });
    expect(forwarded.originalTo?.id).toBe(originalTo);
    expect(forwarded.originalCc.map((row) => row.id)).toEqual(originalCc);
    expect(forwarded.forwards).toHaveLength(1);
    expect(forwarded.recipients.some((row) => row.userId === halima.ref && row.kind === 'FORWARD')).toBe(true);

    const asForward = await reports.get(halima, forwarded.id);
    expect(asForward.myKind).toBe('FORWARD');
    const assignedBefore = await reports.listMinutes(halima, 'assigned');
    expect(assignedBefore.some((row) => row.sourceReportId === forwarded.id)).toBe(false);

    const minute = await reports.createMinute(abubakar, forwarded.id, {
      subject: 'Prepare a briefing',
      instruction: 'Finance Head to report the cash position.',
      toUserId: yahuza.ref,
      idempotencyKey: key('minute'),
    });
    expect(minute.referenceNumber.startsWith('MIN-')).toBe(true);
    expect(minute.recipients.some((row) => row.userId === musa.ref && row.kind === 'CC')).toBe(true);
    const issued = await reports.issueMinute(abubakar, minute.id, minute.rowVersion);
    expect(issued.status).toBe('ISSUED');

    const assigned = await reports.listMinutes(yahuza, 'assigned');
    expect(assigned.some((row) => row.id === issued.id)).toBe(true);
    const stillNotAssigned = await reports.listMinutes(halima, 'assigned');
    expect(stillNotAssigned.some((row) => row.id === issued.id)).toBe(false);
  });

  it('keeps prior responses when further action is requested and stores decisions separately', async () => {
    const submitted = await submitGeneral(`M16 response ${Date.now()}`);
    await reports.get(abubakar, submitted.id);
    const minute = await reports.createMinute(abubakar, submitted.id, {
      subject: 'Respond with evidence',
      instruction: 'Submit the position.',
      toUserId: yahuza.ref,
      idempotencyKey: key('minute-2'),
    });
    const issued = await reports.issueMinute(abubakar, minute.id, minute.rowVersion);

    const first = await reports.createResponse(yahuza, issued.id, {
      subject: 'First response',
      body: 'Initial findings.',
      idempotencyKey: key('rsp-1'),
    });
    expect(first.responses).toHaveLength(1);
    expect(first.responses[0]?.referenceNumber.startsWith('RSP-')).toBe(true);

    const returned = await reports.reviewResponse(abubakar, issued.id, {
      action: 'further',
      note: 'Need the annex.',
      rowVersion: first.rowVersion,
    });
    expect(returned.status).toBe('FURTHER_ACTION_REQUIRED');
    expect(returned.responses).toHaveLength(1);
    expect(returned.responses[0]?.status).toBe('FURTHER_ACTION_REQUIRED');

    const second = await reports.createResponse(yahuza, issued.id, {
      subject: 'Second response',
      body: 'Annex attached in the record.',
      idempotencyKey: key('rsp-2'),
    });
    expect(second.responses).toHaveLength(2);

    const accepted = await reports.reviewResponse(abubakar, issued.id, {
      action: 'accept',
      note: 'Complete.',
      rowVersion: second.rowVersion,
    });
    expect(accepted.status).toBe('COMPLETED');
    expect(accepted.responses[1]?.status).toBe('ACCEPTED');

    const decision = await reports.createDecision(abubakar, submitted.id, {
      subject: 'Proceed',
      body: 'Management accepts the position.',
      minuteId: issued.id,
    });
    expect(decision.referenceNumber.startsWith('DEC-')).toBe(true);
    const report = await reports.get(abubakar, submitted.id);
    expect(report.decisions.some((row) => row.id === decision.id)).toBe(true);
    expect(report.history.some((row) => /submitted/i.test(row.action))).toBe(true);
    expect(report.history.some((row) => /minute/i.test(row.action))).toBe(true);
  });

  it('retries with the same idempotency key do not duplicate, and PATCH of issued records is refused', async () => {
    const idempotencyKey = key('dup');
    const first = await reports.create(musa, {
      entityId: yfz,
      templateKey: 'general',
      title: `M16 idempotent ${Date.now()}`,
      body: 'Draft once.',
      idempotencyKey,
    });
    const again = await reports.create(musa, {
      entityId: yfz,
      templateKey: 'general',
      title: 'Should not create a second row',
      body: 'Ignored.',
      idempotencyKey,
    });
    expect(again.id).toBe(first.id);
    expect(again.referenceNumber).toBe(first.referenceNumber);

    const submitted = await reports.submit(musa, first.id, {
      idempotencyKey: key('dup-sub'),
      rowVersion: first.rowVersion,
    });
    const retrySubmit = await reports.submit(musa, first.id, {
      idempotencyKey: key('dup-sub-2'),
      rowVersion: submitted.rowVersion,
    });
    expect(retrySubmit.id).toBe(submitted.id);

    await expect(
      reports.updateDraft(musa, submitted.id, { title: 'Silent overwrite', rowVersion: submitted.rowVersion }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const amended = await reports.amend(musa, submitted.id, {
      title: submitted.title,
      body: `${submitted.body}\nControlled amendment.`,
      reason: 'Correct a figure after issue.',
      rowVersion: submitted.rowVersion,
    });
    expect(amended.currentRevisionId).not.toBe(submitted.currentRevisionId);
  });

  it('denies a revoked forward recipient even when they still hold the old href', async () => {
    const submitted = await submitGeneral(`M16 revoke ${Date.now()}`);
    const opened = await reports.get(abubakar, submitted.id);
    await reports.forward(abubakar, opened.id, {
      userIds: [halima.ref],
      rowVersion: opened.rowVersion,
    });
    await reports.get(halima, opened.id);
    await reports.revokeAccess(abubakar, opened.id, halima.ref);
    await expect(reports.get(halima, opened.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
