/**
 * M18 payroll: structures, PRL runs, payroll-run-v1, PAYROLL journals,
 * payslips, remittance, and official HR/payroll report snapshots.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { DEFAULT_ROLE_GRANTS, ROLE_KEYS, SEED_USERS, type PermissionKey } from '@nfc/shared';
import type { ActorContext } from '../src/session';
import { UnitOfWork } from '../../../apps/api/src/database/unit-of-work';
import { DocumentsService } from '../../../apps/api/src/documents/documents.service';
import { FileStorageDriver } from '../../../apps/api/src/documents/file-storage';
import { NoopMalwareScanner } from '../../../apps/api/src/documents/malware';
import { DashboardService } from '../../../apps/api/src/finance/dashboard.service';
import { JournalsService } from '../../../apps/api/src/finance/journals.service';
import { LedgerPostingService } from '../../../apps/api/src/finance/ledger-posting.service';
import { ReportsService } from '../../../apps/api/src/finance/reports.service';
import { HrService } from '../../../apps/api/src/hr/hr.service';
import { OrgReportsService } from '../../../apps/api/src/org-reports/org-reports.service';
import { PayrollService } from '../../../apps/api/src/payroll/payroll.service';
import { SealsService } from '../../../apps/api/src/seals/seals.service';
import { WorkflowsService } from '../../../apps/api/src/workflows/workflows.service';
import { resetApiEnvCache } from '../../../apps/api/src/config/env';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../apps/api/src/common/errors/domain-error';
import { appPool, entityIdFor, ownerPool } from './support';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

describe('M18 payroll and HR reports', () => {
  let owner: Pool;
  let app: Pool;
  let yfz: string;
  let dma: string;
  let nfc: string;
  let yfzHr: string;
  let hrPeople: HrService;
  let payroll: PayrollService;
  let workflows: WorkflowsService;
  let documents: DocumentsService;
  let reports: ReportsService;
  let dashboard: DashboardService;
  let orgReports: OrgReportsService;
  let amina: ActorContext;
  let yahuza: ActorContext;
  let emeka: ActorContext;
  let musa: ActorContext;
  let hauwa: ActorContext;
  let admin: ActorContext;
  let abubakar: ActorContext;

  beforeAll(async () => {
    ensureApiEnv();
    owner = ownerPool('nfc-erp-test-m18-payroll-owner');
    app = appPool('nfc-erp-test-m18-payroll-app');
    yfz = await entityIdFor(owner, 'YFZ');
    dma = await entityIdFor(owner, 'DMA');
    nfc = await entityIdFor(owner, 'NFC');
    yfzHr = await departmentId(owner, yfz, 'HR');
    const uow = new UnitOfWork(app);
    const storage = new FileStorageDriver();
    workflows = new WorkflowsService(uow, new SealsService());
    hrPeople = new HrService(uow, workflows);
    const journals = new JournalsService(uow, workflows);
    const ledger = new LedgerPostingService(journals);
    documents = new DocumentsService(uow, storage, new NoopMalwareScanner());
    payroll = new PayrollService(uow, workflows, journals, ledger, documents, hrPeople, storage);
    workflows.attachHr(hrPeople);
    workflows.attachPayroll(payroll);
    reports = new ReportsService(uow);
    dashboard = new DashboardService(uow);
    orgReports = new OrgReportsService(uow, payroll);
    const all = [yfz, dma, nfc];
    amina = actorFromSeed('hr@nfc.local', all);
    yahuza = actorFromSeed('fh.yfz@nfc.local', [yfz]);
    emeka = actorFromSeed('ed.finance@nfc.local', all);
    musa = actorFromSeed('gm.yfz@nfc.local', [yfz]);
    hauwa = actorFromSeed('inventory@nfc.local', all);
    admin = actorFromSeed('administrator@nfc.local', []);
    abubakar = actorFromSeed('md@nfc.local', all);

    const grade = await payroll.createStructure(amina, {
      entityId: yfz,
      gradeKey: 'm18-fallback',
      basicKobo: 1,
      effectiveOn: '2020-01-01',
    });
    await payroll.confirmStructure(amina, grade.id, grade.rowVersion);
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
      reason: 'Approved in the M18 fixture.',
      rowVersion: instance.rowVersion,
    });
  }

  async function hire(lastName?: string) {
    const tag = randomUUID().slice(0, 8);
    return hrPeople.createEmployee(amina, {
      entityId: yfz,
      departmentId: yfzHr,
      firstName: 'Pay',
      lastName: lastName ?? `Staff${tag}`,
      employmentType: 'PERMANENT',
      dateEmployed: '2026-01-02',
      workEmail: `pay.${tag}@nfc.local`,
      bankName: 'First Bank',
      bankAccountName: `Pay ${tag}`,
      bankAccountNumber: '1234567890',
      salaryKobo: 500_000_00,
      idempotencyKey: key('hire'),
    });
  }

  async function confirmPay(employeeId: string, basicKobo: number, effectiveOn: string) {
    const draft = await payroll.createStructure(amina, {
      entityId: yfz,
      employeeId,
      basicKobo,
      effectiveOn,
    });
    return payroll.confirmStructure(amina, draft.id, draft.rowVersion);
  }

  async function period(index: number) {
    const result = await owner.query<{ id: string; name: string; starts_on: string; ends_on: string }>(
      `SELECT id, name, starts_on::text, ends_on::text
         FROM fiscal_periods
        WHERE entity_id = $1 AND period_index = $2 AND status = 'OPEN'`,
      [yfz, index],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Open fiscal period ${index} was not found for YFZ.`);
    return row;
  }

  async function evidence() {
    return documents.upload(yahuza, {
      title: `Payroll evidence ${randomUUID().slice(0, 8)}`,
      category: 'payment_proof',
      context: 'general',
      entityId: yfz,
      ownerType: 'standalone',
      file: { buffer: PNG, originalname: 'pay.png' },
    });
  }

  it('has eight roles and no Payroll Officer', () => {
    expect(ROLE_KEYS).toHaveLength(9);
    expect([...ROLE_KEYS]).not.toContain('payroll_officer');
  });

  it('picks up a ₦500,000 to ₦600,000 structure in the next period without re-keying', async () => {
    const employee = await hire('Raise');
    await confirmPay(employee.id, 500_000_00, '2026-01-01');
    await confirmPay(employee.id, 600_000_00, '2026-02-01');
    const january = await period(1);
    const february = await period(2);
    const first = await payroll.createRun(amina, {
      entityId: yfz,
      fiscalPeriodId: january.id,
      idempotencyKey: key('run-jan'),
    });
    const janCalc = await payroll.calculate(amina, first.id, first.rowVersion);
    expect(janCalc.lines.find((row) => row.employeeId === employee.id)?.basicKobo).toBe(500_000_00);
    const second = await payroll.createRun(amina, {
      entityId: yfz,
      fiscalPeriodId: february.id,
      idempotencyKey: key('run-feb'),
    });
    const febCalc = await payroll.calculate(amina, second.id, second.rowVersion);
    expect(febCalc.lines.find((row) => row.employeeId === employee.id)?.basicKobo).toBe(600_000_00);
  });

  it('excludes a terminated employee whose approved effective date is in the period', async () => {
    const employee = await hire('Leaver');
    await confirmPay(employee.id, 400_000_00, '2026-01-01');
    const change = await hrPeople.createChange(amina, {
      employeeId: employee.id,
      kind: 'TERMINATION',
      effectiveOn: '2026-03-10',
      reason: 'End of contract.',
      idempotencyKey: key('term'),
    });
    await approve(amina, change.workflowInstanceId);
    const march = await period(3);
    const run = await payroll.createRun(amina, {
      entityId: yfz,
      fiscalPeriodId: march.id,
      idempotencyKey: key('run-term'),
    });
    const calculated = await payroll.calculate(amina, run.id, run.rowVersion);
    expect(calculated.lines.some((row) => row.employeeId === employee.id)).toBe(false);
  });

  it('changes PAYE from config rows and writes a payroll_change audit', async () => {
    const employee = await hire('Tax');
    await confirmPay(employee.id, 800_000_00, '2026-01-01');
    const april = await period(4);
    const beforeRun = await payroll.createRun(amina, {
      entityId: yfz,
      fiscalPeriodId: april.id,
      idempotencyKey: key('run-paye-before'),
    });
    const before = await payroll.calculate(amina, beforeRun.id, beforeRun.rowVersion);
    const beforePaye = before.lines.find((row) => row.employeeId === employee.id)?.payeKobo ?? 0;
    expect(beforePaye).toBeGreaterThan(0);

    await payroll.createPaye(amina, {
      effectiveOn: '2026-05-01',
      fromKobo: 0,
      toKobo: null,
      rateBps: 0,
    });
    const audit = await owner.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE action = 'payroll_change' AND subject_type = 'payroll_paye_bands'
       ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect(audit.rows[0]?.action).toBe('payroll_change');

    const may = await period(5);
    const afterRun = await payroll.createRun(amina, {
      entityId: yfz,
      fiscalPeriodId: may.id,
      idempotencyKey: key('run-paye-after'),
    });
    const after = await payroll.calculate(amina, afterRun.id, afterRun.rowVersion);
    expect(after.lines.find((row) => row.employeeId === employee.id)?.payeKobo).toBe(0);
  });

  it('refuses two open runs for the same subsidiary period', async () => {
    const june = await period(6);
    const first = await payroll.createRun(amina, {
      entityId: yfz,
      fiscalPeriodId: june.id,
      idempotencyKey: key('open-a'),
    });
    expect(first.referenceNumber.startsWith('PRL-')).toBe(true);
    await expect(
      payroll.createRun(amina, {
        entityId: yfz,
        fiscalPeriodId: june.id,
        idempotencyKey: key('open-b'),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('lets Finance Head approve and pay; HR cannot approve; locked lines are not edited', async () => {
    const employee = await hire('Approve');
    await confirmPay(employee.id, 350_000_00, '2026-01-01');
    const july = await period(7);
    const created = await payroll.createRun(amina, {
      entityId: yfz,
      fiscalPeriodId: july.id,
      idempotencyKey: key('run-lock'),
    });
    const calculated = await payroll.calculate(amina, created.id, created.rowVersion);
    expect(calculated.exceptions, JSON.stringify(calculated.exceptions)).toEqual([]);
    const submitted = await payroll.submit(amina, calculated.id, calculated.rowVersion);
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.workflowInstanceId).toBeTruthy();

    await expect(approve(amina, submitted.workflowInstanceId)).rejects.toBeInstanceOf(ForbiddenError);
    await approve(yahuza, submitted.workflowInstanceId);
    const locked = await payroll.getRun(amina, submitted.id);
    expect(locked.status).toBe('LOCKED');
    await expect(payroll.calculate(amina, locked.id, locked.rowVersion)).rejects.toBeInstanceOf(ConflictError);

    const proof = await evidence();
    const paid = await payroll.pay(yahuza, locked.id, {
      evidenceDocumentId: proof.id,
      rowVersion: locked.rowVersion,
      idempotencyKey: key('pay'),
    });
    expect(paid.status).toBe('PAID');

    const journal = await owner.query<{ source: string; debit: string; credit: string }>(
      `SELECT j.source, coalesce(sum(l.debit_kobo), 0)::text AS debit, coalesce(sum(l.credit_kobo), 0)::text AS credit
         FROM journals j
         JOIN journal_lines l ON l.journal_id = j.id
        WHERE j.id = (SELECT journal_id FROM payroll_runs WHERE id = $1)
        GROUP BY j.source`,
      [paid.id],
    );
    expect(journal.rows[0]?.source).toBe('PAYROLL');
    expect(journal.rows[0]?.debit).toBe(journal.rows[0]?.credit);
    expect(Number(journal.rows[0]?.debit ?? 0)).toBeGreaterThan(0);

    const remittance = await payroll.remittanceReport(yahuza, yfz);
    expect(remittance.some((row) => row.runId === paid.id && row.kind === 'PAYE' && row.status === 'UNREMITTED')).toBe(
      true,
    );
    const remitProof = await evidence();
    const remitted = await payroll.remit(yahuza, paid.id, {
      kind: 'PAYE',
      evidenceDocumentId: remitProof.id,
      rowVersion: paid.rowVersion,
    });
    expect(remitted.find((row) => row.kind === 'PAYE')?.status).toBe('REMITTED');

    const slip = await payroll.downloadPayslip(amina, paid.id, employee.id);
    expect(slip.buffer.subarray(0, 4).toString()).toBe('%PDF');
    const filed = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM payroll_payslips p
         JOIN hr_employees e ON e.id = p.employee_id
         JOIN edms_folder_items i ON i.document_id = p.document_id AND i.folder_id = e.edms_folder_id
        WHERE p.run_id = $1 AND p.employee_id = $2`,
      [paid.id, employee.id],
    );
    expect(Number(filed.rows[0]?.n ?? 0)).toBe(1);

    const tiles = await dashboard.get(emeka);
    const yfzTile = tiles.entities.find((row) => row.entityCode === 'YFZ');
    expect((yfzTile?.payrollCostKobo ?? 0) > 0 || (tiles.consolidated?.payrollCostKobo ?? 0) > 0).toBe(true);
    const summary = await reports.run(emeka, 'payroll_summary', { entityId: yfz });
    expect(summary.rows.some((row) => row.key === 'net' && (row.cells.currentKobo ?? 0) > 0)).toBe(true);
    expect(summary.rows.every((row) => !/staff|employee/i.test(row.label))).toBe(true);

    const adjusted = await payroll.adjust(amina, paid.id, {
      reason: 'Correct overtime hours.',
      rowVersion: (await payroll.getRun(amina, paid.id)).rowVersion,
      idempotencyKey: key('adj'),
    });
    expect(adjusted.referenceNumber.startsWith('PRL-')).toBe(true);
    expect(adjusted.id).not.toBe(paid.id);
    expect((await payroll.getRun(amina, paid.id)).status).toBe('REVERSED');
  }, 120_000);

  it('hides salary lines and payslips from GM, Administrator and Inventory', async () => {
    const employee = await hire('Secret');
    await confirmPay(employee.id, 250_000_00, '2026-01-01');
    const august = await period(8);
    const created = await payroll.createRun(amina, {
      entityId: yfz,
      fiscalPeriodId: august.id,
      idempotencyKey: key('run-acl'),
    });
    const calculated = await payroll.calculate(amina, created.id, created.rowVersion);
    await expect(payroll.getRun(musa, calculated.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payroll.getRun(admin, calculated.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payroll.getRun(hauwa, calculated.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payroll.downloadPayslip(musa, calculated.id, employee.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payroll.createRun(yahuza, {
      entityId: yfz,
      fiscalPeriodId: august.id,
      idempotencyKey: key('fh-prep'),
    })).rejects.toBeInstanceOf(ForbiddenError);

    const indexed = await owner.query<{ searchable_text: string; title: string }>(
      `SELECT searchable_text, title FROM search_index WHERE record_type = 'PAYROLL_RUN' AND record_id = $1`,
      [calculated.id],
    );
    const haystack = `${indexed.rows[0]?.searchable_text ?? ''} ${indexed.rows[0]?.title ?? ''}`;
    const net = calculated.lines.find((row) => row.employeeId === employee.id)?.netKobo;
    expect(haystack).toMatch(/PRL-/);
    expect(haystack.includes(String(net))).toBe(false);
    expect(haystack).not.toMatch(/1234567890/);
  });

  it('enables official HR and payroll templates with a live snapshot at submit', async () => {
    const templates = await orgReports.templates(admin, false);
    expect(templates.find((row) => row.key === 'hr_staff')?.available).toBe(true);
    expect(templates.find((row) => row.key === 'payroll')?.available).toBe(true);

    await expect(
      orgReports.create(musa, {
        entityId: yfz,
        templateKey: 'payroll',
        title: 'GM cannot file payroll',
        body: 'No payroll.view.',
        idempotencyKey: key('gm-pay'),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const staff = await orgReports.create(amina, {
      entityId: yfz,
      templateKey: 'hr_staff',
      title: `M18 HR staff ${Date.now()}`,
      body: 'Headcount snapshot for the Managing Director.',
      idempotencyKey: key('hr-staff'),
    });
    const submittedStaff = await orgReports.submit(amina, staff.id, {
      idempotencyKey: key('hr-staff-sub'),
      rowVersion: staff.rowVersion,
    });
    expect(submittedStaff.status).toBe('SUBMITTED');
    expect(submittedStaff.snapshot?.kind).toBe('hr_staff');

    const september = await period(9);
    const employee = await hire('Snapshot');
    await confirmPay(employee.id, 300_000_00, '2026-01-01');
    const created = await payroll.createRun(amina, {
      entityId: yfz,
      fiscalPeriodId: september.id,
      idempotencyKey: key('run-snap'),
    });
    const calculated = await payroll.calculate(amina, created.id, created.rowVersion);
    expect(calculated.exceptions, JSON.stringify(calculated.exceptions)).toEqual([]);
    const submitted = await payroll.submit(amina, calculated.id, calculated.rowVersion);
    await approve(yahuza, submitted.workflowInstanceId);
    const locked = await payroll.getRun(amina, submitted.id);
    expect(locked.status).toBe('LOCKED');

    const payrollReport = await orgReports.create(amina, {
      entityId: yfz,
      templateKey: 'payroll',
      title: `M18 payroll ${Date.now()}`,
      body: 'Payroll specialist report.',
      idempotencyKey: key('hr-pay'),
    });
    const submittedPayroll = await orgReports.submit(amina, payrollReport.id, {
      idempotencyKey: key('hr-pay-sub'),
      rowVersion: payrollReport.rowVersion,
    });
    expect(submittedPayroll.snapshot?.kind).toBe('payroll');
    expect(submittedPayroll.snapshot?.runReference).toBe(locked.referenceNumber);
    expect(submittedPayroll.snapshot?.netKobo).toBe(locked.netKobo);
    const asMd = await orgReports.get(abubakar, submittedPayroll.id);
    expect(asMd.snapshot?.netKobo).toBe(locked.netKobo);
  }, 120_000);

  it('returns not found for a payslip that was never issued', async () => {
    await expect(
      payroll.downloadPayslip(amina, randomUUID(), randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
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
