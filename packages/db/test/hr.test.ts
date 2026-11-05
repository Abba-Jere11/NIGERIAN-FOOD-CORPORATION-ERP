/**
 * M17 HR people system: directory, changes, recruitment, leave, attendance,
 * performance, confidential disciplinary cases, training + expense-v1.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  DEFAULT_ROLE_GRANTS,
  EXPENSE_WORKFLOW_KEY,
  HR_SENSITIVE_FIELDS,
  ROLE_KEYS,
  SEED_USERS,
  type PermissionKey,
} from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { HrService } from '../../../apps/api/src/hr/hr.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../../apps/api/src/common/errors/domain-error';
import { appPool, entityIdFor, ownerPool } from './support';

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

describe('M17 HR people system', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let yfw: string;
  let nom: string;
  let yfzHr: string;
  let dmaHr: string;
  let hr: HrService;
  let workflows: WorkflowsService;
  let amina: ActorContext;
  let musa: ActorContext;
  let yahuza: ActorContext;
  let hauwa: ActorContext;
  let admin: ActorContext;
  let abubakar: ActorContext;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-m17-hr-owner');
    app = appPool('nfc-erp-test-m17-hr-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
    yfw = await entityIdFor(owner, 'YFW');
    nom = await entityIdFor(owner, 'NOM');
    yfzHr = await departmentId(owner, yfz, 'HR');
    dmaHr = await departmentId(owner, dma, 'HR');
    const uow = new UnitOfWork(app);
    workflows = new WorkflowsService(uow, new SealsService());
    hr = new HrService(uow, workflows);
    workflows.attachHr(hr);
    const all = [yfz, dma, yfw, nom];
    amina = actorFromSeed('hr@nfc.local', all);
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
    yahuza = actorFromSeed('fh.yfz@nfc.local', [yfz]);
    hauwa = actorFromSeed('inventory@nfc.local', all);
    admin = actorFromSeed('administrator@nfc.local', []);
    abubakar = actorFromSeed('md@nfc.local', all);
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  async function approve(actor: ActorContext, instanceId: string | null) {
    if (!instanceId) throw new Error('Expected a workflow instance.');
    const instance = await workflows.get(actor, instanceId);
    return workflows.act(actor, {
      instanceId,
      action: 'APPROVE',
      reason: 'Approved in the M17 fixture.',
      rowVersion: instance.rowVersion,
    });
  }

  async function hire(
    entityId: string,
    departmentId: string,
    extras: { unitId?: string; positionId?: string; lastName?: string } = {},
  ) {
    const tag = randomUUID().slice(0, 8);
    return hr.createEmployee(amina, {
      entityId,
      departmentId,
      unitId: extras.unitId,
      positionId: extras.positionId,
      firstName: 'Test',
      lastName: extras.lastName ?? `Staff${tag}`,
      employmentType: 'PERMANENT',
      dateEmployed: '2026-01-12',
      workEmail: `staff.${tag}@nfc.local`,
      personalEmail: `personal.${tag}@example.com`,
      personalPhone: '08011110000',
      emergencyName: 'Next of kin',
      emergencyPhone: '08022220000',
      bankName: 'First Bank',
      bankAccountName: `Staff ${tag}`,
      bankAccountNumber: '1234567890',
      salaryKobo: 250_000_00,
      idempotencyKey: key('hire'),
    });
  }

  it('has eight roles and no Payroll Officer', () => {
    expect(ROLE_KEYS).toHaveLength(9);
    expect([...ROLE_KEYS]).not.toContain('payroll_officer');
  });

  it('strips sensitive fields without hr.view_sensitive', async () => {
    const employee = await hire(yfz, yfzHr);
    expect(employee.bankAccountNumber).toBe('1234567890');
    expect(employee.salaryKobo).toBe(250_000_00);
    expect(employee.personalEmail).toMatch(/@example.com$/);
    const viewer: ActorContext = {
      ...amina,
      permissions: amina.permissions.filter((item) => item !== 'hr.view_sensitive'),
    };
    const stripped = await hr.getEmployee(viewer, employee.id);
    const visible = stripped as unknown as Record<string, unknown>;
    for (const field of HR_SENSITIVE_FIELDS) {
      expect(visible[field], field).toBeNull();
    }
    expect(stripped.workEmail).toBe(employee.workEmail);
    expect(stripped.referenceNumber.startsWith('EMP-')).toBe(true);
  });

  it('rejects a unit from another department and a position from another subsidiary', async () => {
    const dmaUnit = await hr.createUnit(amina, {
      entityId: dma,
      departmentId: dmaHr,
      name: `Abattoir shift ${randomUUID().slice(0, 8)}`,
    });
    const yfzSeat = await hr.createPosition(amina, {
      entityId: yfz,
      departmentId: yfzHr,
      title: `Plant HR ${randomUUID().slice(0, 8)}`,
    });
    await expect(
      hr.createUnit(amina, { entityId: yfz, departmentId: dmaHr, name: 'Cross unit' }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
    await expect(
      hire(yfz, yfzHr, { unitId: dmaUnit.id }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
    await expect(
      hire(dma, dmaHr, { positionId: yfzSeat.id }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('onboards from a vacancy into EMP- with an EDMS HR user folder', async () => {
    const vacancy = await hr.createVacancy(amina, {
      entityId: yfz,
      departmentId: yfzHr,
      title: `Mill operator ${randomUUID().slice(0, 8)}`,
      idempotencyKey: key('vac'),
    });
    expect(vacancy.referenceNumber.startsWith('VAC-')).toBe(true);
    expect(vacancy.status).toBe('SUBMITTED');
    await approve(amina, vacancy.workflowInstanceId);
    const applicant = await hr.addApplicant(amina, vacancy.id, {
      name: 'Ibrahim Onboard',
      email: `ibrahim.${randomUUID().slice(0, 6)}@example.com`,
    });
    await hr.shortlistApplicant(amina, applicant.id);
    await hr.scheduleInterview(amina, applicant.id, { notes: 'Panel at YFZ.', score: 82 });
    const offer = await hr.createOffer(amina, vacancy.id, { applicantId: applicant.id, salaryKobo: 180_000_00 });
    await approve(amina, offer.workflowInstanceId);
    const pdf = await hr.offerPdf(amina, offer.id);
    expect(pdf.buffer.subarray(0, 4).toString()).toBe('%PDF');
    await hr.issueOffer(amina, offer.id);
    const hired = await hr.onboard(amina, offer.id, { idempotencyKey: key('onboard') });
    expect(hired.referenceNumber.startsWith('EMP-')).toBe(true);
    expect(hired.edmsFolderId).toBeTruthy();
    const folder = await owner.query<{ kind: string; name: string; parent: string }>(
      `SELECT f.kind, f.name, p.name AS parent
         FROM edms_folders f JOIN edms_folders p ON p.id = f.parent_id
        WHERE f.id = $1`,
      [hired.edmsFolderId],
    );
    expect(folder.rows[0]?.kind).toBe('user');
    expect(folder.rows[0]?.parent).toBe('HR');
    expect(folder.rows[0]?.name).toContain(hired.referenceNumber);
  });

  it('requires approval for promotion and keeps the previous assignment', async () => {
    const junior = await hr.createPosition(amina, {
      entityId: yfz,
      departmentId: yfzHr,
      title: `Officer ${randomUUID().slice(0, 8)}`,
    });
    const senior = await hr.createPosition(amina, {
      entityId: yfz,
      departmentId: yfzHr,
      title: `Senior officer ${randomUUID().slice(0, 8)}`,
    });
    const employee = await hire(yfz, yfzHr, { positionId: junior.id });
    expect(employee.assignments).toHaveLength(1);
    const change = await hr.createChange(amina, {
      employeeId: employee.id,
      kind: 'PROMOTION',
      effectiveOn: '2026-03-01',
      reason: 'Confirmed after probation.',
      toPositionId: senior.id,
      idempotencyKey: key('promo'),
    });
    expect(change.status).toBe('SUBMITTED');
    const before = await hr.getEmployee(amina, employee.id);
    expect(before.positionId).toBe(junior.id);
    await approve(amina, change.workflowInstanceId);
    const after = await hr.getEmployee(amina, employee.id);
    expect(after.positionId).toBe(senior.id);
    expect(after.assignments.length).toBeGreaterThanOrEqual(2);
    expect(after.assignments[0]?.endedOn).toBe('2026-03-01');
    expect(after.assignments.some((row) => row.kind === 'HIRE' && row.endedOn)).toBe(true);
    expect(after.assignments.some((row) => row.kind === 'PROMOTION' && !row.endedOn)).toBe(true);

    const leaving = await hire(yfz, yfzHr);
    const termination = await hr.createChange(amina, {
      employeeId: leaving.id,
      kind: 'TERMINATION',
      effectiveOn: '2026-04-01',
      reason: 'End of contract.',
      idempotencyKey: key('term'),
    });
    await approve(amina, termination.workflowInstanceId);
    const ended = await hr.getEmployee(amina, leaving.id);
    expect(ended.status).toBe('TERMINATED');
    expect(ended.assignments.every((row) => row.endedOn)).toBe(true);
  });

  it('approves leave, updates balances and shows the group calendar', async () => {
    const employee = await hire(yfz, yfzHr);
    const before = await hr.leaveBalances(amina, employee.id);
    const annual = before.find((row) => row.typeKey === 'annual');
    expect(annual?.entitled).toBeGreaterThan(0);
    const request = await hr.createLeave(amina, {
      employeeId: employee.id,
      typeKey: 'annual',
      startsOn: '2026-10-19',
      endsOn: '2026-10-20',
      reason: 'Family visit.',
      idempotencyKey: key('leave'),
    });
    expect(request.referenceNumber.startsWith('LV-')).toBe(true);
    expect(request.status).toBe('SUBMITTED');
    await approve(amina, request.workflowInstanceId);
    const after = await hr.leaveBalances(amina, employee.id);
    const taken = after.find((row) => row.typeKey === 'annual');
    expect(taken?.taken).toBe((annual?.taken ?? 0) + request.days);
    const calendar = await hr.leaveCalendar(amina);
    expect(calendar.some((row) => row.id === request.id && row.entityCode === 'YFZ')).toBe(true);
    const cancelled = await hr.cancelLeave(amina, request.id, {
      reason: 'Trip postponed.',
      rowVersion: (await hr.listLeave(amina)).find((row) => row.id === request.id)!.rowVersion,
    });
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('flags CSV attendance anomalies and approves overtime', async () => {
    const employee = await hire(yfz, yfzHr);
    const batch = await hr.importAttendance(amina, {
      fileName: 'october.csv',
      csv: [
        'employee,date,kind,hours,late',
        `${employee.referenceNumber},2026-10-19,PRESENT,8,0`,
        `${employee.referenceNumber},2026-10-19,PRESENT,8,0`,
        `EMP-2099-000001,2026-10-19,PRESENT,8,0`,
        `${employee.referenceNumber},2026-10-20,PRESENT,-3,0`,
      ].join('\n'),
    });
    expect(batch.accepted).toBe(1);
    expect(batch.flagged).toBe(3);
    expect(batch.errors.some((row) => /Unknown employee/.test(row.message))).toBe(true);
    expect(batch.errors.some((row) => /Duplicate punch/.test(row.message))).toBe(true);
    expect(batch.errors.some((row) => /negative/.test(row.message))).toBe(true);
    await hr.recordAttendance(amina, {
      employeeId: employee.id,
      workDate: '2026-10-21',
      kind: 'LATE',
      minutesLate: 25,
      hoursWorked: 7.5,
    });
    const overtime = await hr.createOvertime(amina, {
      employeeId: employee.id,
      workDate: '2026-10-21',
      hours: 2,
      reason: 'Month-end close.',
    });
    await approve(amina, overtime.workflowInstanceId);
    const summary = await hr.monthlySummary(amina, 2026, 10);
    const row = summary.find((item) => item.employeeId === employee.id);
    expect(row?.present).toBeGreaterThanOrEqual(1);
    expect(row?.late).toBeGreaterThanOrEqual(1);
    expect(row?.overtimeHours).toBe(2);
  });

  it('lets the HR Officer manage all four subsidiaries and refuses GM, Finance Head, Inventory and Admin', async () => {
    const yfwHr = await departmentId(owner, yfw, 'HR');
    const nomHr = await departmentId(owner, nom, 'HR');
    const yfzEmp = await hire(yfz, yfzHr);
    const dmaEmp = await hire(dma, dmaHr);
    const yfwEmp = await hire(yfw, yfwHr);
    const nomEmp = await hire(nom, nomHr);
    const listed = await hr.listEmployees(amina);
    expect(listed.some((row) => row.id === yfzEmp.id && row.entityCode === 'YFZ')).toBe(true);
    expect(listed.some((row) => row.id === dmaEmp.id && row.entityCode === 'DMA')).toBe(true);
    expect(listed.some((row) => row.id === yfwEmp.id && row.entityCode === 'YFW')).toBe(true);
    expect(listed.some((row) => row.id === nomEmp.id && row.entityCode === 'NOM')).toBe(true);
    await expect(hr.getEmployee(musa, yfzEmp.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(hr.getEmployee(yahuza, yfzEmp.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(hr.getEmployee(hauwa, yfzEmp.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(hr.getEmployee(admin, yfzEmp.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(hr.getEmployee(abubakar, yfzEmp.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('records a written warning without MD and holds suspension until MD approval', async () => {
    const employee = await hire(yfz, yfzHr);
    const warning = await hr.createDisciplinary(amina, {
      employeeId: employee.id,
      category: 'conduct',
      incidentOn: '2026-09-01',
      description: 'Late without notice.',
      idempotencyKey: key('warn'),
    });
    const submitted = await hr.submitDisciplinary(amina, warning.id, warning.rowVersion);
    const decided = await hr.recommendDisciplinary(amina, submitted.id, {
      outcome: 'WRITTEN_WARNING',
      body: 'First written warning.',
      rowVersion: submitted.rowVersion,
    });
    expect(decided.status).toBe('DECIDED');
    expect(decided.outcome).toBe('WRITTEN_WARNING');
    expect(decided.workflowInstanceId).toBeNull();

    const suspension = await hr.createDisciplinary(amina, {
      employeeId: employee.id,
      category: 'gross_misconduct',
      incidentOn: '2026-09-15',
      description: 'Serious safety breach.',
      idempotencyKey: key('susp'),
    });
    const open = await hr.submitDisciplinary(amina, suspension.id, suspension.rowVersion);
    const waiting = await hr.recommendDisciplinary(amina, open.id, {
      outcome: 'SUSPENSION',
      body: 'Recommend unpaid suspension.',
      rowVersion: open.rowVersion,
    });
    expect(waiting.status).toBe('AWAITING_MD');
    expect(waiting.workflowInstanceId).toBeTruthy();
    await expect(
      hr.closeDisciplinary(amina, waiting.id, {
        reason: 'Trying to skip MD.',
        rowVersion: waiting.rowVersion,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      approve(amina, waiting.workflowInstanceId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await approve(abubakar, waiting.workflowInstanceId);
    const final = await hr.getDisciplinary(amina, waiting.id);
    expect(final.status).toBe('DECIDED');
    expect(final.outcome).toBe('SUSPENSION');
    expect(final.events.some((row) => row.kind === 'DECISION')).toBe(true);
  });

  it('hides disciplinary evidence from callers without access', async () => {
    const employee = await hire(yfz, yfzHr);
    const evidence = `CONFIDENTIAL-EVIDENCE-${randomUUID()}`;
    const opened = await hr.createDisciplinary(amina, {
      employeeId: employee.id,
      category: 'investigation',
      incidentOn: '2026-08-01',
      description: evidence,
      idempotencyKey: key('evd'),
    });
    await hr.addDiscEvent(amina, opened.id, { kind: 'STATEMENT', body: `${evidence} statement` });
    const asHr = await hr.getDisciplinary(amina, opened.id);
    expect(asHr.description).toBe(evidence);
    await expect(hr.getDisciplinary(musa, opened.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(hr.getDisciplinary(admin, opened.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await hr.listDisciplinary(musa)).toEqual([]);
  });

  it('keeps prior events when a decided case is reopened', async () => {
    const employee = await hire(yfz, yfzHr);
    const opened = await hr.createDisciplinary(amina, {
      employeeId: employee.id,
      category: 'conduct',
      incidentOn: '2026-07-01',
      description: 'Reopen fixture.',
      idempotencyKey: key('reopen'),
    });
    const submitted = await hr.submitDisciplinary(amina, opened.id, opened.rowVersion);
    const decided = await hr.recommendDisciplinary(amina, submitted.id, {
      outcome: 'NO_CASE_TO_ANSWER',
      body: 'Insufficient evidence.',
      rowVersion: submitted.rowVersion,
    });
    const closed = await hr.closeDisciplinary(amina, decided.id, {
      reason: 'File closed.',
      rowVersion: decided.rowVersion,
    });
    const reopened = await hr.reopenDisciplinary(amina, closed.id, {
      reason: 'New witness statement.',
      rowVersion: closed.rowVersion,
    });
    expect(reopened.status).toBe('APPEAL');
    const kinds = reopened.events.map((row) => row.kind);
    expect(kinds).toContain('OPENED');
    expect(kinds).toContain('RECOMMENDATION');
    expect(kinds).toContain('CLOSURE');
    expect(kinds).toContain('REOPEN');
    expect(reopened.events.find((row) => row.kind === 'RECOMMENDATION')?.outcome).toBe(
      'NO_CASE_TO_ANSWER',
    );
  });

  it('never writes disciplinary bodies or bank fields into search_index', async () => {
    const evidence = `DISC-BODY-${randomUUID()}`;
    const employee = await hire(yfz, yfzHr, { lastName: `Indexed${randomUUID().slice(0, 6)}` });
    const opened = await hr.createDisciplinary(amina, {
      employeeId: employee.id,
      category: 'conduct',
      incidentOn: '2026-06-01',
      description: evidence,
      idempotencyKey: key('idx'),
    });
    const indexed = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM search_index
        WHERE searchable_text ILIKE $1 OR title ILIKE $1 OR reference_number = $2`,
      [`%${evidence}%`, opened.referenceNumber],
    );
    expect(indexed.rows[0]?.n).toBe('0');
    const types = await owner.query<{ record_type: string }>(
      `SELECT DISTINCT record_type FROM search_index WHERE record_type ILIKE '%DISC%' OR record_type ILIKE '%disciplin%'`,
    );
    expect(types.rows).toEqual([]);
    const employeeHit = await owner.query<{ searchable_text: string }>(
      `SELECT searchable_text FROM search_index WHERE record_id = $1 AND record_type = 'EMPLOYEE'`,
      [employee.id],
    );
    expect(employeeHit.rows[0]?.searchable_text).toContain(employee.referenceNumber);
    expect(employeeHit.rows[0]?.searchable_text).not.toContain('1234567890');
    expect(employeeHit.rows[0]?.searchable_text).not.toContain('First Bank');
  });

  it('records one training session with many participants and per-person completion', async () => {
    const a = await hire(yfz, yfzHr);
    const b = await hire(dma, dmaHr);
    const session = await hr.createTraining(amina, {
      entityId: yfz,
      title: `HSE induction ${randomUUID().slice(0, 8)}`,
      estimatedCostKobo: 75_000_00,
      participantIds: [a.id, b.id],
      idempotencyKey: key('trn'),
    });
    expect(session.referenceNumber.startsWith('TRN-')).toBe(true);
    expect(session.participants).toHaveLength(2);
    await hr.recordTrainingAttendance(amina, session.id, {
      employeeId: a.id,
      attendance: 'PRESENT',
      completed: true,
      hours: 6,
    });
    await hr.recordTrainingAttendance(amina, session.id, {
      employeeId: b.id,
      attendance: 'ABSENT',
      completed: false,
    });
    const viewed = await hr.getTraining(amina, session.id);
    expect(viewed.participants.find((row) => row.employeeId === a.id)?.completed).toBe(true);
    expect(viewed.participants.find((row) => row.employeeId === b.id)?.completed).toBe(false);
  });

  it('sends costed training through expense-v1, not a new payment workflow', async () => {
    const employee = await hire(yfz, yfzHr);
    const session = await hr.createTraining(amina, {
      entityId: yfz,
      title: `Finance-linked course ${randomUUID().slice(0, 8)}`,
      estimatedCostKobo: 120_000_00,
      participantIds: [employee.id],
      idempotencyKey: key('cost'),
    });
    const sent = await hr.sendTrainingToFinance(amina, session.id, session.rowVersion);
    expect(sent.status).toBe('AWAITING_FINANCE');
    expect(sent.expenseEntryId).toBeTruthy();
    const workflow = await owner.query<{ key: string; subject_type: string }>(
      `SELECT d.key, i.subject_type
         FROM workflow_instances i
         JOIN workflow_definitions d ON d.id = i.definition_id
        WHERE i.subject_id = $1`,
      [sent.expenseEntryId],
    );
    expect(workflow.rows[0]?.key).toBe(EXPENSE_WORKFLOW_KEY);
    expect(workflow.rows[0]?.subject_type).toBe('EXPENSE');
    expect(workflow.rows.some((row) => row.key.startsWith('hr-') && row.subject_type === 'EXPENSE')).toBe(
      false,
    );
  });

  it('omits training costs without hr.training.report', async () => {
    const session = await hr.createTraining(amina, {
      entityId: yfz,
      title: `Cost strip ${randomUUID().slice(0, 8)}`,
      estimatedCostKobo: 50_000_00,
      idempotencyKey: key('strip'),
    });
    expect(session.estimatedCostKobo).toBe(50_000_00);
    const viewer: ActorContext = {
      ...amina,
      permissions: amina.permissions.filter((item) => item !== 'hr.training.report'),
    };
    const hidden = await hr.getTraining(viewer, session.id);
    expect(hidden.estimatedCostKobo).toBeNull();
    expect(hidden.actualCostKobo).toBeNull();
  });

  it('writes audit old and new values for HR, org and disciplinary mutations', async () => {
    const employee = await hire(yfz, yfzHr);
    const opened = await hr.createDisciplinary(amina, {
      employeeId: employee.id,
      category: 'audit',
      incidentOn: '2026-05-01',
      description: 'Audit fixture.',
      idempotencyKey: key('aud'),
    });
    const submitted = await hr.submitDisciplinary(amina, opened.id, opened.rowVersion);
    await hr.recommendDisciplinary(amina, submitted.id, {
      outcome: 'ADVISORY',
      body: 'Advisory note.',
      rowVersion: submitted.rowVersion,
    });
    const rows = await owner.query<{
      subject_type: string;
      action: string;
      old_value: unknown;
      new_value: unknown;
    }>(
      `SELECT subject_type, action, old_value, new_value
         FROM audit_log
        WHERE subject_id IN ($1, $2)
        ORDER BY occurred_at`,
      [employee.id, opened.id],
    );
    expect(rows.rows.some((row) => row.subject_type === 'hr_employee' && row.action === 'create' && row.new_value)).toBe(
      true,
    );
    expect(
      rows.rows.some(
        (row) =>
          row.subject_type === 'hr_disciplinary' &&
          row.action === 'edit' &&
          row.old_value &&
          row.new_value,
      ),
    ).toBe(true);
  });

  it('runs a performance cycle, objective and appraisal through hr-performance-v1', async () => {
    const employee = await hire(yfz, yfzHr);
    const cycle = await hr.createCycle(amina, {
      name: `FY26 review ${randomUUID().slice(0, 6)}`,
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
    });
    await hr.addObjective(amina, cycle.id, {
      employeeId: employee.id,
      title: 'Keep the mill safe.',
    });
    const appraisal = await hr.createAppraisal(amina, cycle.id, {
      employeeId: employee.id,
      rating: 'MEETS',
      summary: 'Solid year.',
    });
    expect(appraisal.status).toBe('SUBMITTED');
    await approve(amina, appraisal.workflowInstanceId);
    const listed = await hr.listAppraisals(amina);
    expect(listed.find((row) => row.id === appraisal.id)?.status).toBe('APPROVED');
  });
});

async function departmentId(pool: Pool, entityId: string, name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM departments WHERE entity_id = $1 AND name = $2`,
    [entityId, name],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`No ${name} department for ${entityId}.`);
  return id;
}
