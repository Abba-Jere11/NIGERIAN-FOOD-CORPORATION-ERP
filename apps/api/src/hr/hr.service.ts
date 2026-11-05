import { Inject, Injectable, forwardRef } from '@nestjs/common';
import type { ActorContext } from '@nfc/db';
import {
  HR_DISC_SERIOUS_OUTCOMES,
  HR_SENSITIVE_FIELDS,
  type HrAppraisalView,
  type HrApplicantView,
  type HrAssignmentView,
  type HrAttendanceView,
  type HrChangeView,
  type HrCycleView,
  type HrDashboardView,
  type HrDiscOutcome,
  type HrDiscStatus,
  type HrDisciplinaryView,
  type HrEmployeeListItemView,
  type HrEmployeeView,
  type HrHolidayView,
  type HrImportBatchView,
  type HrLeaveBalanceView,
  type HrLeaveRequestView,
  type HrLeaveTypeView,
  type HrOfferView,
  type HrOvertimeView,
  type HrPositionView,
  type HrTrainingView,
  type HrUnitView,
  type HrVacancyView,
  HR_LEAVE_WORKFLOW_KEY_V2,
} from '@nfc/shared';
import { assertCan, can } from '../auth/can';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StaleRecordError,
  ValidationFailedError,
} from '../common/errors/domain-error';
import type { TxScope } from '../database/unit-of-work';
import { UnitOfWork } from '../database/unit-of-work';
import { WorkflowsService } from '../workflows/workflows.service';
import { renderAppointmentPdf, renderOfferPdf } from './hr-pdf';
import type {
  CancelLeaveInput,
  CreateApplicantInput,
  CreateAppraisalInput,
  CreateChangeInput,
  CreateCycleInput,
  CreateDisciplinaryInput,
  CreateEmployeeInput,
  CreateHolidayInput,
  CreateLeaveInput,
  CreateObjectiveInput,
  CreateOfferInput,
  CreateOvertimeInput,
  CreatePositionInput,
  CreateTrainingInput,
  CreateUnitInput,
  CreateVacancyInput,
  DiscEventInput,
  DiscRecommendInput,
  DiscReopenInput,
  ImportAttendanceInput,
  InterviewInput,
  OnboardInput,
  RecordAttendanceInput,
  TrainingAttendanceInput,
  TrainingParticipantsInput,
  UpdateEmployeeInput,
} from './hr.dto';

const HR_SELF_APPROVE = new Set(['HR_CHANGE', 'HR_LEAVE', 'HR_OVERTIME', 'HR_PERFORMANCE']);

@Injectable()
export class HrService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    @Inject(forwardRef(() => WorkflowsService)) private readonly workflows: WorkflowsService,
  ) {}

  allowsOriginatorApproval(subjectType: string): boolean {
    return HR_SELF_APPROVE.has(subjectType);
  }

  async dashboard(actor: ActorContext): Promise<HrDashboardView> {
    assertCan(actor, 'hr.employee.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const head = await tx.client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM hr_employees WHERE status NOT IN ('TERMINATED', 'RESIGNED', 'INACTIVE')`,
      );
      const byEntity = await tx.client.query<{ entity_code: string; count: string }>(
        `SELECT e.code AS entity_code, count(*)::text AS count
           FROM hr_employees emp JOIN entities e ON e.id = emp.entity_id
          WHERE emp.status NOT IN ('TERMINATED', 'RESIGNED', 'INACTIVE')
          GROUP BY e.code ORDER BY e.code`,
      );
      const leave = await tx.client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM hr_leave_requests WHERE status = 'SUBMITTED'`,
      );
      const disc = await tx.client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM hr_disciplinary_cases WHERE status NOT IN ('CLOSED', 'DRAFT')`,
      );
      const training = await tx.client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM hr_training_sessions
          WHERE status IN ('SCHEDULED', 'IN_PROGRESS') AND starts_on >= CURRENT_DATE`,
      );
      const vacancies = await tx.client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM hr_vacancies WHERE status IN ('OPEN', 'SHORTLISTING', 'INTERVIEWING', 'OFFER')`,
      );
      const overdue = await tx.client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM hr_training_sessions
          WHERE status IN ('SCHEDULED', 'IN_PROGRESS') AND ends_on < CURRENT_DATE`,
      );
      const payroll = await tx.client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM payroll_runs WHERE status IN ('CALCULATED', 'SUBMITTED')`,
      );
      return {
        headcount: Number(head.rows[0]?.n ?? 0),
        byEntity: byEntity.rows.map((row) => ({ entityCode: row.entity_code, count: Number(row.count) })),
        pendingLeave: Number(leave.rows[0]?.n ?? 0),
        openDisciplinary: Number(disc.rows[0]?.n ?? 0),
        upcomingTraining: Number(training.rows[0]?.n ?? 0),
        openVacancies: Number(vacancies.rows[0]?.n ?? 0),
        overdueTraining: Number(overdue.rows[0]?.n ?? 0),
        pendingPayroll: Number(payroll.rows[0]?.n ?? 0),
      };
    });
  }

  async listUnits(actor: ActorContext, entityId?: string): Promise<HrUnitView[]> {
    if (!can(actor, 'hr.employee.view') && !can(actor, 'hr.org.manage')) {
      throw new ForbiddenError('You cannot view organisation units.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<UnitRow>(
        `${UNIT_SQL} WHERE ($1::uuid IS NULL OR u.entity_id = $1) ORDER BY e.code, d.name, u.name`,
        [entityId ?? null],
      );
      return result.rows.map(toUnit);
    });
  }

  async createUnit(actor: ActorContext, input: CreateUnitInput): Promise<HrUnitView> {
    assertCan(actor, 'hr.org.manage', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      await this.assertHierarchy(tx, input.entityId, input.departmentId, null, null);
      const clash = await tx.client.query(
        `SELECT 1 FROM org_units WHERE department_id = $1 AND lower(name) = lower($2)`,
        [input.departmentId, input.name],
      );
      if (clash.rows[0]) throw new ConflictError(`A unit called "${input.name}" already exists in that department.`);
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO org_units (entity_id, department_id, name, code, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
        [input.entityId, input.departmentId, input.name, input.code ?? null, actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The unit was not created.');
      const row = await this.unitRow(tx, id);
      await tx.audit({
        action: 'create',
        subjectType: 'hr_unit',
        subjectId: id,
        subjectLabel: row.name,
        entityId: row.entity_id,
        newValue: { name: row.name, departmentId: row.department_id },
      });
      return toUnit(row);
    });
  }

  async setUnitStatus(
    actor: ActorContext,
    id: string,
    status: 'ACTIVE' | 'INACTIVE',
    input: { reason: string; rowVersion: number },
  ): Promise<HrUnitView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const before = await this.unitRow(tx, id, true);
      assertCan(actor, 'hr.org.manage', before.entity_id);
      if (before.row_version !== input.rowVersion) throw stale('unit');
      await tx.client.query(
        `UPDATE org_units SET status = $1::record_status, updated_by = $2 WHERE id = $3 AND row_version = $4`,
        [status, actor.ref, id, input.rowVersion],
      );
      const after = await this.unitRow(tx, id);
      await tx.audit({
        action: 'edit',
        subjectType: 'hr_unit',
        subjectId: id,
        subjectLabel: after.name,
        entityId: after.entity_id,
        oldValue: { status: before.status },
        newValue: { status: after.status },
        reason: input.reason,
      });
      return toUnit(after);
    });
  }

  async listPositions(actor: ActorContext, entityId?: string): Promise<HrPositionView[]> {
    if (!can(actor, 'hr.employee.view') && !can(actor, 'hr.org.manage')) {
      throw new ForbiddenError('You cannot view positions.');
    }
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<PositionRow>(
        `${POSITION_SQL} WHERE ($1::uuid IS NULL OR p.entity_id = $1) ORDER BY e.code, p.title`,
        [entityId ?? null],
      );
      return result.rows.map(toPosition);
    });
  }

  async createPosition(actor: ActorContext, input: CreatePositionInput): Promise<HrPositionView> {
    assertCan(actor, 'hr.org.manage', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      if (input.departmentId) await this.assertHierarchy(tx, input.entityId, input.departmentId, null, null);
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO hr_positions (entity_id, department_id, title, grade, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
        [input.entityId, input.departmentId ?? null, input.title, input.grade ?? null, actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The position was not created.');
      const row = await this.positionRow(tx, id);
      await tx.audit({
        action: 'create',
        subjectType: 'hr_position',
        subjectId: id,
        subjectLabel: row.title,
        entityId: row.entity_id,
        newValue: { title: row.title, departmentId: row.department_id },
      });
      return toPosition(row);
    });
  }

  async listEmployees(actor: ActorContext, entityId?: string): Promise<HrEmployeeListItemView[]> {
    assertCan(actor, 'hr.employee.view', entityId);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<EmployeeListRow>(
        `${EMPLOYEE_LIST_SQL} WHERE ($1::uuid IS NULL OR emp.entity_id = $1)
         ORDER BY e.code, emp.last_name, emp.first_name`,
        [entityId ?? null],
      );
      return result.rows.map(toListItem);
    });
  }

  async getEmployee(actor: ActorContext, id: string): Promise<HrEmployeeView> {
    return this.unitOfWork.read(actor, async (tx) => this.employeeView(tx, actor, id));
  }

  async createEmployee(actor: ActorContext, input: CreateEmployeeInput): Promise<HrEmployeeView> {
    assertCan(actor, 'hr.employee.manage', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM hr_employees WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) return this.employeeView(tx, actor, existing.rows[0].id);
      await this.assertHierarchy(
        tx,
        input.entityId,
        input.departmentId ?? null,
        input.unitId ?? null,
        input.positionId ?? null,
      );
      const allocated = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('EMP') AS ref`);
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The employee number was not allocated.');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO hr_employees (
           reference_number, entity_id, department_id, unit_id, position_id, first_name, last_name, other_names,
           gender, employment_type, grade, date_employed, status, reporting_manager_id, work_email, work_phone,
           personal_email, personal_phone, emergency_name, emergency_phone, bank_name, bank_account_name,
           bank_account_number, salary_kobo, idempotency_key, created_by, updated_by
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$26
         ) RETURNING id`,
        [
          reference,
          input.entityId,
          input.departmentId ?? null,
          input.unitId ?? null,
          input.positionId ?? null,
          input.firstName,
          input.lastName,
          input.otherNames ?? null,
          input.gender ?? null,
          input.employmentType ?? 'PERMANENT',
          input.grade ?? null,
          input.dateEmployed ?? null,
          input.status ?? 'ACTIVE',
          input.reportingManagerId ?? null,
          input.workEmail ?? null,
          input.workPhone ?? null,
          input.personalEmail ?? null,
          input.personalPhone ?? null,
          input.emergencyName ?? null,
          input.emergencyPhone ?? null,
          input.bankName ?? null,
          input.bankAccountName ?? null,
          input.bankAccountNumber ?? null,
          input.salaryKobo ?? null,
          input.idempotencyKey,
          actor.ref,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The employee was not created.');
      const folderId = await this.ensureEmployeeFolder(tx, actor, input.entityId, `${input.firstName} ${input.lastName} ${reference}`);
      await tx.client.query(`UPDATE hr_employees SET edms_folder_id = $1, updated_by = $2 WHERE id = $3`, [
        folderId,
        actor.ref,
        id,
      ]);
      await this.insertAssignment(tx, actor, {
        employeeId: id,
        entityId: input.entityId,
        departmentId: input.departmentId ?? null,
        unitId: input.unitId ?? null,
        positionId: input.positionId ?? null,
        kind: 'HIRE',
        effectiveOn: input.dateEmployed ?? today(),
      });
      await this.seedEntitlements(tx, id);
      await this.indexEmployee(tx, id);
      await tx.audit({
        action: 'create',
        subjectType: 'hr_employee',
        subjectId: id,
        subjectLabel: `${input.firstName} ${input.lastName}`,
        subjectReferenceNumber: reference,
        entityId: input.entityId,
        newValue: { status: input.status ?? 'ACTIVE', departmentId: input.departmentId ?? null },
      });
      return this.employeeView(tx, actor, id);
    });
  }

  async updateEmployee(actor: ActorContext, id: string, input: UpdateEmployeeInput): Promise<HrEmployeeView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const before = await this.lockEmployee(tx, id);
      assertCan(actor, 'hr.employee.manage', before.entity_id);
      if (before.row_version !== input.rowVersion) throw stale('employee');
      const departmentId = input.departmentId === undefined ? before.department_id : input.departmentId;
      const unitId = input.unitId === undefined ? before.unit_id : input.unitId;
      const positionId = input.positionId === undefined ? before.position_id : input.positionId;
      await this.assertHierarchy(tx, before.entity_id, departmentId, unitId, positionId);
      await tx.client.query(
        `UPDATE hr_employees SET
           department_id = $1, unit_id = $2, position_id = $3, first_name = $4, last_name = $5, other_names = $6,
           gender = $7, employment_type = $8, grade = $9, date_employed = $10, status = $11, reporting_manager_id = $12,
           work_email = $13, work_phone = $14, personal_email = $15, personal_phone = $16, emergency_name = $17,
           emergency_phone = $18, bank_name = $19, bank_account_name = $20, bank_account_number = $21, salary_kobo = $22,
           updated_by = $23
         WHERE id = $24 AND row_version = $25`,
        [
          departmentId,
          unitId,
          positionId,
          input.firstName ?? before.first_name,
          input.lastName ?? before.last_name,
          input.otherNames === undefined ? before.other_names : input.otherNames,
          input.gender === undefined ? before.gender : input.gender,
          input.employmentType ?? before.employment_type,
          input.grade === undefined ? before.grade : input.grade,
          input.dateEmployed === undefined ? isoDate(before.date_employed) : input.dateEmployed,
          input.status ?? before.status,
          input.reportingManagerId === undefined ? before.reporting_manager_id : input.reportingManagerId,
          input.workEmail === undefined ? before.work_email : input.workEmail,
          input.workPhone === undefined ? before.work_phone : input.workPhone,
          input.personalEmail === undefined ? before.personal_email : input.personalEmail,
          input.personalPhone === undefined ? before.personal_phone : input.personalPhone,
          input.emergencyName === undefined ? before.emergency_name : input.emergencyName,
          input.emergencyPhone === undefined ? before.emergency_phone : input.emergencyPhone,
          input.bankName === undefined ? before.bank_name : input.bankName,
          input.bankAccountName === undefined ? before.bank_account_name : input.bankAccountName,
          input.bankAccountNumber === undefined ? before.bank_account_number : input.bankAccountNumber,
          input.salaryKobo === undefined ? before.salary_kobo : input.salaryKobo,
          actor.ref,
          id,
          input.rowVersion,
        ],
      );
      const after = await this.lockEmployee(tx, id);
      await this.indexEmployee(tx, id);
      await tx.audit({
        action: 'edit',
        subjectType: 'hr_employee',
        subjectId: id,
        subjectLabel: `${after.first_name} ${after.last_name}`,
        subjectReferenceNumber: after.reference_number,
        entityId: after.entity_id,
        oldValue: { status: before.status, departmentId: before.department_id },
        newValue: { status: after.status, departmentId: after.department_id },
      });
      return this.employeeView(tx, actor, id);
    });
  }

  async appointmentPdf(actor: ActorContext, id: string): Promise<{ filename: string; buffer: Buffer }> {
    const employee = await this.getEmployee(actor, id);
    const entity = await this.unitOfWork.read(actor, async (tx) => {
      const row = await tx.client.query<{ name: string; code: string }>(
        `SELECT name, code FROM entities WHERE id = $1`,
        [employee.entityId],
      );
      return row.rows[0] ?? { name: employee.entityCode, code: employee.entityCode };
    });
    const buffer = await renderAppointmentPdf({
      reference: employee.referenceNumber,
      employeeName: employee.name,
      title: employee.positionTitle ?? 'Staff',
      entityName: entity.name,
      entityCode: entity.code,
      dateEmployed: employee.dateEmployed,
    });
    return { filename: `${employee.referenceNumber}-appointment.pdf`, buffer };
  }

  async listChanges(actor: ActorContext, employeeId?: string): Promise<HrChangeView[]> {
    assertCan(actor, 'hr.employee.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<ChangeRow>(
        `${CHANGE_SQL} WHERE ($1::uuid IS NULL OR c.employee_id = $1) ORDER BY c.created_at DESC`,
        [employeeId ?? null],
      );
      return result.rows.map(toChange);
    });
  }

  async createChange(actor: ActorContext, input: CreateChangeInput): Promise<HrChangeView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM hr_employment_changes WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) return this.changeView(tx, existing.rows[0].id);
      const employee = await this.lockEmployee(tx, input.employeeId);
      assertCan(actor, 'hr.employee.manage', employee.entity_id);
      const toDepartment = input.toDepartmentId ?? employee.department_id;
      const toUnit = input.toUnitId ?? employee.unit_id;
      const toPosition = input.toPositionId ?? employee.position_id;
      if (input.kind !== 'TERMINATION' && input.kind !== 'RESIGNATION' && input.kind !== 'CONFIRMATION') {
        await this.assertHierarchy(tx, employee.entity_id, toDepartment, toUnit, toPosition);
      }
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO hr_employment_changes (
           employee_id, entity_id, kind, effective_on, reason, from_department_id, to_department_id,
           from_unit_id, to_unit_id, from_position_id, to_position_id, idempotency_key, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING id`,
        [
          input.employeeId,
          employee.entity_id,
          input.kind,
          input.effectiveOn,
          input.reason,
          employee.department_id,
          toDepartment,
          employee.unit_id,
          toUnit,
          employee.position_id,
          toPosition,
          input.idempotencyKey,
          actor.ref,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The employment change was not created.');
      const instance = await this.workflows.startHrInTx(tx, actor, {
        definitionKey: 'hr-change-v1',
        subjectType: 'HR_CHANGE',
        subjectId: id,
        entityId: employee.entity_id,
        reference: employee.reference_number,
        title: `${input.kind} ${employee.first_name} ${employee.last_name}`,
        href: `/hr/employees/${employee.id}`,
      });
      await tx.client.query(
        `UPDATE hr_employment_changes SET status = 'SUBMITTED', workflow_instance_id = $1, updated_by = $2 WHERE id = $3`,
        [instance.id, actor.ref, id],
      );
      await tx.audit({
        action: 'create',
        subjectType: 'hr_change',
        subjectId: id,
        subjectLabel: `${input.kind} ${employee.reference_number}`,
        entityId: employee.entity_id,
        newValue: { kind: input.kind, status: 'SUBMITTED' },
      });
      await tx.publish({
        eventType: 'hr.change.submitted',
        subjectType: 'HR_CHANGE',
        subjectId: id,
        entityId: employee.entity_id,
        payload: {
          type: 'hr.change.submitted',
          reference: employee.reference_number,
          title: `${input.kind} ${employee.first_name} ${employee.last_name}`,
          href: `/hr/employees/${employee.id}`,
        },
      });
      return this.changeView(tx, id);
    });
  }

  async applyHrOutcomeInTx(
    tx: TxScope,
    actor: ActorContext,
    subjectType: string,
    subjectId: string,
    action: 'APPROVE' | 'REJECT',
  ): Promise<void> {
    if (subjectType === 'HR_CHANGE') {
      const change = await tx.client.query<ChangeRow>(`${CHANGE_SQL} WHERE c.id = $1 FOR UPDATE OF c`, [subjectId]);
      const row = change.rows[0];
      if (row) {
        await this.applyChangeRow(tx, actor, row, action);
        return;
      }
      const vacancy = await tx.client.query<{ id: string; status: string }>(
        `SELECT id, status FROM hr_vacancies WHERE id = $1 FOR UPDATE`,
        [subjectId],
      );
      if (vacancy.rows[0]) {
        await tx.client.query(`UPDATE hr_vacancies SET status = $1, updated_by = $2 WHERE id = $3`, [
          action === 'APPROVE' ? 'OPEN' : 'CANCELLED',
          actor.ref,
          subjectId,
        ]);
        return;
      }
      const offer = await tx.client.query<{ id: string }>(`SELECT id FROM hr_offers WHERE id = $1 FOR UPDATE`, [
        subjectId,
      ]);
      if (offer.rows[0]) {
        await tx.client.query(`UPDATE hr_offers SET status = $1, updated_by = $2 WHERE id = $3`, [
          action === 'APPROVE' ? 'APPROVED' : 'DECLINED',
          actor.ref,
          subjectId,
        ]);
      }
      return;
    }
    if (subjectType === 'HR_LEAVE') {
      const leave = await tx.client.query<{
        id: string;
        status: string;
        employee_id: string;
        entity_id: string;
        reference_number: string;
      }>(`SELECT id, status, employee_id, entity_id, reference_number FROM hr_leave_requests WHERE id = $1 FOR UPDATE`, [
        subjectId,
      ]);
      const row = leave.rows[0];
      if (!row) return;
      await tx.client.query(`UPDATE hr_leave_requests SET status = $1, updated_by = $2 WHERE id = $3`, [
        action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        actor.ref,
        subjectId,
      ]);
      await tx.audit({
        action: action === 'APPROVE' ? 'approve' : 'reject',
        subjectType: 'hr_leave',
        subjectId,
        subjectLabel: row.reference_number,
        subjectReferenceNumber: row.reference_number,
        entityId: row.entity_id,
        oldValue: { status: row.status },
        newValue: { status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED' },
      });
      return;
    }
    if (subjectType === 'HR_OVERTIME') {
      await tx.client.query(`UPDATE hr_overtime_requests SET status = $1, updated_by = $2 WHERE id = $3`, [
        action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        actor.ref,
        subjectId,
      ]);
      return;
    }
    if (subjectType === 'HR_PERFORMANCE') {
      await tx.client.query(`UPDATE hr_appraisals SET status = $1, updated_by = $2 WHERE id = $3`, [
        action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        actor.ref,
        subjectId,
      ]);
      return;
    }
    if (subjectType === 'HR_DISCIPLINARY') {
      const current = await tx.client.query<{
        id: string;
        status: string;
        outcome: string | null;
        entity_id: string;
        reference_number: string;
      }>(
        `SELECT id, status, outcome, entity_id, reference_number FROM hr_disciplinary_cases WHERE id = $1 FOR UPDATE`,
        [subjectId],
      );
      const row = current.rows[0];
      if (!row) return;
      if (action === 'APPROVE') {
        await tx.client.query(
          `UPDATE hr_disciplinary_cases SET status = 'DECIDED', updated_by = $1 WHERE id = $2`,
          [actor.ref, subjectId],
        );
        await tx.client.query(
          `INSERT INTO hr_disciplinary_events (case_id, kind, body, outcome, created_by)
           VALUES ($1, 'DECISION', 'MD approved the recommended outcome.', $2, $3)`,
          [subjectId, row.outcome, actor.ref],
        );
      } else {
        await tx.client.query(
          `UPDATE hr_disciplinary_cases SET status = 'RECOMMENDATION', updated_by = $1 WHERE id = $2`,
          [actor.ref, subjectId],
        );
        await tx.client.query(
          `INSERT INTO hr_disciplinary_events (case_id, kind, body, created_by)
           VALUES ($1, 'DECISION', 'MD refused the recommended outcome.', $2)`,
          [subjectId, actor.ref],
        );
      }
      await tx.publish({
        eventType: 'hr.disciplinary.decided',
        subjectType: 'HR_DISCIPLINARY',
        subjectId,
        entityId: row.entity_id,
        payload: {
          type: 'hr.disciplinary.decided',
          reference: row.reference_number,
          title: row.reference_number,
          href: `/hr/disciplinary/${subjectId}`,
        },
      });
    }
  }

  async listVacancies(actor: ActorContext): Promise<HrVacancyView[]> {
    assertCan(actor, 'hr.recruitment.manage');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<VacancyRow>(`${VACANCY_SQL} ORDER BY v.created_at DESC`);
      return result.rows.map(toVacancy);
    });
  }

  async getVacancy(
    actor: ActorContext,
    id: string,
  ): Promise<HrVacancyView & { applicants: HrApplicantView[]; offers: HrOfferView[] }> {
    assertCan(actor, 'hr.recruitment.manage');
    return this.unitOfWork.read(actor, async (tx) => {
      const vacancy = await tx.client.query<VacancyRow>(`${VACANCY_SQL} WHERE v.id = $1`, [id]);
      const row = vacancy.rows[0];
      if (!row) throw new NotFoundError('That vacancy was not found.');
      const applicants = await tx.client.query<{
        id: string;
        vacancy_id: string;
        name: string;
        email: string | null;
        stage: string;
        score: string | null;
        employee_id: string | null;
      }>(`SELECT id, vacancy_id, name, email, stage, score::text, employee_id FROM hr_applicants WHERE vacancy_id = $1`, [
        id,
      ]);
      const offers = await tx.client.query<{
        id: string;
        vacancy_id: string;
        applicant_id: string;
        status: HrOfferView['status'];
        salary_kobo: string | null;
        workflow_instance_id: string | null;
      }>(
        `SELECT id, vacancy_id, applicant_id, status, salary_kobo::text, workflow_instance_id
           FROM hr_offers WHERE vacancy_id = $1 ORDER BY created_at`,
        [id],
      );
      return {
        ...toVacancy(row),
        applicants: applicants.rows.map((item) => ({
          id: item.id,
          vacancyId: item.vacancy_id,
          name: item.name,
          email: item.email,
          stage: item.stage,
          score: item.score == null ? null : Number(item.score),
          employeeId: item.employee_id,
        })),
        offers: offers.rows.map((item) => ({
          id: item.id,
          vacancyId: item.vacancy_id,
          applicantId: item.applicant_id,
          status: item.status,
          salaryKobo: item.salary_kobo == null ? null : Number(item.salary_kobo),
          workflowInstanceId: item.workflow_instance_id,
        })),
      };
    });
  }

  async createVacancy(actor: ActorContext, input: CreateVacancyInput): Promise<HrVacancyView> {
    assertCan(actor, 'hr.recruitment.manage', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM hr_vacancies WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) return this.vacancyView(tx, existing.rows[0].id);
      await this.assertHierarchy(
        tx,
        input.entityId,
        input.departmentId ?? null,
        input.unitId ?? null,
        input.positionId ?? null,
      );
      const allocated = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('VAC') AS ref`);
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The vacancy reference was not allocated.');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO hr_vacancies (
           reference_number, entity_id, department_id, unit_id, position_id, title, body, headcount,
           idempotency_key, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id`,
        [
          reference,
          input.entityId,
          input.departmentId ?? null,
          input.unitId ?? null,
          input.positionId ?? null,
          input.title,
          input.body ?? null,
          input.headcount ?? 1,
          input.idempotencyKey,
          actor.ref,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The vacancy was not created.');
      const instance = await this.workflows.startHrInTx(tx, actor, {
        definitionKey: 'hr-change-v1',
        subjectType: 'HR_CHANGE',
        subjectId: id,
        entityId: input.entityId,
        reference,
        title: input.title,
        href: `/hr/recruitment/${id}`,
      });
      await tx.client.query(
        `UPDATE hr_vacancies SET status = 'SUBMITTED', workflow_instance_id = $1, updated_by = $2 WHERE id = $3`,
        [instance.id, actor.ref, id],
      );
      await tx.audit({
        action: 'create',
        subjectType: 'hr_vacancy',
        subjectId: id,
        subjectLabel: input.title,
        subjectReferenceNumber: reference,
        entityId: input.entityId,
        newValue: { status: 'SUBMITTED' },
      });
      return this.vacancyView(tx, id);
    });
  }

  async addApplicant(actor: ActorContext, vacancyId: string, input: CreateApplicantInput): Promise<HrApplicantView> {
    assertCan(actor, 'hr.recruitment.manage');
    return this.unitOfWork.write(actor, async (tx) => {
      const vacancy = await this.vacancyView(tx, vacancyId);
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO hr_applicants (vacancy_id, name, email, notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`,
        [vacancyId, input.name, input.email ?? null, input.notes ?? null, actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The applicant was not recorded.');
      await tx.client.query(
        `UPDATE hr_vacancies SET status = CASE WHEN status = 'OPEN' THEN 'SHORTLISTING' ELSE status END, updated_by = $1 WHERE id = $2`,
        [actor.ref, vacancyId],
      );
      await tx.audit({
        action: 'create',
        subjectType: 'hr_applicant',
        subjectId: id,
        subjectLabel: input.name,
        entityId: vacancy.entityId,
        newValue: { vacancyId, name: input.name },
      });
      return {
        id,
        vacancyId,
        name: input.name,
        email: input.email ?? null,
        stage: 'APPLIED',
        score: null,
        employeeId: null,
      };
    });
  }

  async shortlistApplicant(actor: ActorContext, applicantId: string): Promise<HrApplicantView> {
    return this.setApplicantStage(actor, applicantId, 'SHORTLISTED');
  }

  async scheduleInterview(
    actor: ActorContext,
    applicantId: string,
    input: InterviewInput,
  ): Promise<HrApplicantView> {
    assertCan(actor, 'hr.recruitment.manage');
    return this.unitOfWork.write(actor, async (tx) => {
      const applicant = await this.applicantRow(tx, applicantId);
      await tx.client.query(
        `INSERT INTO hr_interviews (applicant_id, scheduled_at, score, notes, created_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [applicantId, input.scheduledAt ?? null, input.score ?? null, input.notes ?? null, actor.ref],
      );
      await tx.client.query(
        `UPDATE hr_applicants SET stage = 'INTERVIEW', score = coalesce($1, score), updated_by = $2 WHERE id = $3`,
        [input.score ?? null, actor.ref, applicantId],
      );
      await tx.client.query(
        `UPDATE hr_vacancies SET status = 'INTERVIEWING', updated_by = $1 WHERE id = $2`,
        [actor.ref, applicant.vacancy_id],
      );
      return this.applicantView(tx, applicantId);
    });
  }

  async createOffer(actor: ActorContext, vacancyId: string, input: CreateOfferInput): Promise<HrOfferView> {
    assertCan(actor, 'hr.recruitment.manage');
    return this.unitOfWork.write(actor, async (tx) => {
      const vacancy = await this.vacancyView(tx, vacancyId);
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO hr_offers (vacancy_id, applicant_id, salary_kobo, starts_on, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`,
        [vacancyId, input.applicantId, input.salaryKobo ?? null, input.startsOn ?? null, actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The offer was not created.');
      const instance = await this.workflows.startHrInTx(tx, actor, {
        definitionKey: 'hr-change-v1',
        subjectType: 'HR_CHANGE',
        subjectId: id,
        entityId: vacancy.entityId,
        reference: vacancy.referenceNumber,
        title: `Offer ${vacancy.title}`,
        href: `/hr/recruitment/${vacancyId}`,
      });
      await tx.client.query(
        `UPDATE hr_offers SET status = 'SUBMITTED', workflow_instance_id = $1, updated_by = $2 WHERE id = $3`,
        [instance.id, actor.ref, id],
      );
      await tx.client.query(`UPDATE hr_vacancies SET status = 'OFFER', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        vacancyId,
      ]);
      return this.offerView(tx, id);
    });
  }

  async offerPdf(actor: ActorContext, offerId: string): Promise<{ filename: string; buffer: Buffer }> {
    assertCan(actor, 'hr.recruitment.manage');
    return this.unitOfWork.read(actor, async (tx) => {
      const offer = await this.offerRow(tx, offerId);
      const applicant = await this.applicantRow(tx, offer.applicant_id);
      const vacancy = await this.vacancyView(tx, offer.vacancy_id);
      const entity = await tx.client.query<{ name: string }>(`SELECT name FROM entities WHERE id = $1`, [
        vacancy.entityId,
      ]);
      const buffer = await renderOfferPdf({
        reference: vacancy.referenceNumber,
        candidateName: applicant.name,
        title: vacancy.title,
        entityName: entity.rows[0]?.name ?? vacancy.entityCode,
        entityCode: vacancy.entityCode,
        startsOn: offer.starts_on ? isoDate(offer.starts_on) : null,
        salaryKobo: offer.salary_kobo,
      });
      return { filename: `${vacancy.referenceNumber}-offer.pdf`, buffer };
    });
  }

  async issueOffer(actor: ActorContext, offerId: string): Promise<HrOfferView> {
    assertCan(actor, 'hr.recruitment.manage');
    return this.unitOfWork.write(actor, async (tx) => {
      const offer = await this.offerRow(tx, offerId);
      if (offer.status !== 'APPROVED') throw new ConflictError('The offer must be approved before it is issued.');
      await tx.client.query(`UPDATE hr_offers SET status = 'ISSUED', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        offerId,
      ]);
      return this.offerView(tx, offerId);
    });
  }

  async onboard(actor: ActorContext, offerId: string, input: OnboardInput): Promise<HrEmployeeView> {
    assertCan(actor, 'hr.recruitment.manage');
    return this.unitOfWork.write(actor, async (tx) => {
      const offer = await this.offerRow(tx, offerId);
      if (!['APPROVED', 'ISSUED', 'ACCEPTED'].includes(offer.status)) {
        throw new ConflictError('Onboarding needs an approved offer.');
      }
      const applicant = await this.applicantRow(tx, offer.applicant_id);
      if (applicant.employee_id) return this.employeeView(tx, actor, applicant.employee_id);
      const vacancy = await this.vacancyView(tx, offer.vacancy_id);
      const names = splitName(applicant.name);
      const employee = await this.createEmployeeInTx(tx, actor, {
        entityId: vacancy.entityId,
        departmentId: vacancy.departmentId,
        unitId: vacancy.unitId,
        positionId: vacancy.positionId,
        firstName: input.firstName ?? names.first,
        lastName: input.lastName ?? names.last,
        employmentType: input.employmentType ?? 'PERMANENT',
        dateEmployed: input.dateEmployed ?? (offer.starts_on ? isoDate(offer.starts_on) : today()),
        salaryKobo: offer.salary_kobo,
        workEmail: applicant.email,
        idempotencyKey: input.idempotencyKey,
      });
      await tx.client.query(
        `UPDATE hr_applicants SET employee_id = $1, stage = 'HIRED', updated_by = $2 WHERE id = $3`,
        [employee.id, actor.ref, applicant.id],
      );
      await tx.client.query(`UPDATE hr_offers SET status = 'ACCEPTED', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        offerId,
      ]);
      await tx.client.query(`UPDATE hr_vacancies SET status = 'FILLED', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        vacancy.id,
      ]);
      await tx.client.query(
        `INSERT INTO hr_onboarding_checklists (offer_id, employee_id, items, completed, created_by, updated_by)
         VALUES ($1,$2,$3::jsonb, true, $4, $4)`,
        [
          offerId,
          employee.id,
          JSON.stringify([
            { key: 'employee_record', done: true },
            { key: 'edms_folder', done: Boolean(employee.edmsFolderId) },
            { key: 'offer_accepted', done: true },
          ]),
          actor.ref,
        ],
      );
      return employee;
    });
  }

  async leaveTypes(actor: ActorContext): Promise<HrLeaveTypeView[]> {
    assertCan(actor, 'hr.employee.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        key: string;
        name: string;
        days_per_year: number;
        paid: boolean;
        status: 'ACTIVE' | 'INACTIVE';
      }>(`SELECT id, key, name, days_per_year, paid, status FROM hr_leave_types ORDER BY name`);
      return result.rows.map((row) => ({
        id: row.id,
        key: row.key,
        name: row.name,
        daysPerYear: row.days_per_year,
        paid: row.paid,
        status: row.status,
      }));
    });
  }

  async holidays(actor: ActorContext): Promise<HrHolidayView[]> {
    assertCan(actor, 'hr.employee.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        name: string;
        observed_on: Date;
        entity_id: string | null;
      }>(`SELECT id, name, observed_on, entity_id FROM hr_public_holidays ORDER BY observed_on`);
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        observedOn: isoDate(row.observed_on) ?? '',
        entityId: row.entity_id,
      }));
    });
  }

  async createHoliday(actor: ActorContext, input: CreateHolidayInput): Promise<HrHolidayView> {
    assertCan(actor, 'hr.org.manage', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO hr_public_holidays (name, observed_on, entity_id, created_by)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [input.name, input.observedOn, input.entityId ?? null, actor.ref],
      );
      return {
        id: inserted.rows[0]!.id,
        name: input.name,
        observedOn: input.observedOn,
        entityId: input.entityId ?? null,
      };
    });
  }

  async listLeave(actor: ActorContext): Promise<HrLeaveRequestView[]> {
    assertCan(actor, 'hr.leave.approve');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<LeaveRow>(`${LEAVE_SQL} ORDER BY l.starts_on DESC`);
      return result.rows.map(toLeave);
    });
  }

  async leaveCalendar(actor: ActorContext): Promise<HrLeaveRequestView[]> {
    assertCan(actor, 'hr.employee.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<LeaveRow>(
        `${LEAVE_SQL} WHERE l.status = 'APPROVED' ORDER BY l.starts_on`,
      );
      return result.rows.map(toLeave);
    });
  }

  async leaveBalances(actor: ActorContext, employeeId: string): Promise<HrLeaveBalanceView[]> {
    assertCan(actor, 'hr.employee.view');
    return this.unitOfWork.read(actor, async (tx) => this.balancesInTx(tx, employeeId));
  }

  async noteReliefInTx(
    tx: TxScope,
    actor: ActorContext,
    subjectId: string,
    action: 'APPROVE' | 'REJECT',
  ): Promise<void> {
    await tx.client.query(
      `UPDATE hr_leave_requests
          SET relief_status = $1, updated_by = $2
        WHERE id = $3 AND relief_status = 'PENDING'`,
      [action === 'APPROVE' ? 'ACCEPTED' : 'DECLINED', actor.ref, subjectId],
    );
  }

  attendanceForUser(tx: TxScope, userId: string): Promise<HrAttendanceView[]> {
    return tx.client
      .query<AttendanceRow>(`${ATTENDANCE_SQL} WHERE emp.user_id = $1 ORDER BY a.work_date DESC LIMIT 90`, [userId])
      .then((result) => result.rows.map(toAttendance));
  }

  leaveForEmployee(tx: TxScope, employeeId: string): Promise<HrLeaveRequestView[]> {
    return tx.client
      .query<LeaveRow>(`${LEAVE_SQL} WHERE l.employee_id = $1 ORDER BY l.starts_on DESC`, [employeeId])
      .then((result) => result.rows.map(toLeave));
  }

  balancesFor(tx: TxScope, employeeId: string): Promise<HrLeaveBalanceView[]> {
    return this.balancesInTx(tx, employeeId);
  }

  reliefInbox(tx: TxScope, employeeId: string): Promise<HrLeaveRequestView[]> {
    return tx.client
      .query<LeaveRow>(
        `${LEAVE_SQL} WHERE l.relief_employee_id = $1 AND l.relief_status = 'PENDING' AND l.status = 'SUBMITTED'`,
        [employeeId],
      )
      .then((result) => result.rows.map(toLeave));
  }

  async setDepartmentHead(actor: ActorContext, departmentId: string, employeeId: string): Promise<void> {
    assertCan(actor, 'hr.org.manage');
    await this.unitOfWork.write(actor, async (tx) => {
      const department = await tx.client.query<{ entity_id: string }>(
        `SELECT entity_id FROM departments WHERE id = $1`,
        [departmentId],
      );
      const entityId = department.rows[0]?.entity_id;
      if (!entityId) throw new NotFoundError('That department was not found.');
      assertCan(actor, 'hr.org.manage', entityId);
      const employee = await tx.client.query<{ id: string }>(
        `SELECT id FROM hr_employees WHERE id = $1 AND entity_id = $2`,
        [employeeId, entityId],
      );
      if (!employee.rows[0]) throw new ValidationFailedError('Choose an employee in that department’s subsidiary.');
      await tx.client.query(`UPDATE departments SET head_employee_id = $1, updated_by = $2 WHERE id = $3`, [
        employeeId,
        actor.ref,
        departmentId,
      ]);
    });
  }

  async createLeave(actor: ActorContext, input: CreateLeaveInput): Promise<HrLeaveRequestView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM hr_leave_requests WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) return this.leaveView(tx, existing.rows[0].id);
      const employee = await this.lockEmployee(tx, input.employeeId);
      const own = employee.user_id === actor.ref;
      if (own) assertCan(actor, 'self.leave.request');
      else assertCan(actor, 'hr.employee.manage', employee.entity_id);
      const type = await tx.client.query<{ id: string; key: string }>(
        `SELECT id, key FROM hr_leave_types WHERE key = $1 AND status = 'ACTIVE'`,
        [input.typeKey],
      );
      const typeId = type.rows[0]?.id;
      if (!typeId) throw new ValidationFailedError('That leave type is not available.');
      const days = await this.leaveDays(tx, employee.entity_id, input.startsOn, input.endsOn);
      if (days <= 0) throw new ValidationFailedError('The leave period must include at least one working day.');
      if (own) {
        const balances = await this.balancesInTx(tx, employee.id);
        const balance = balances.find((row) => row.typeKey === input.typeKey);
        if (balance && days > balance.remaining) {
          throw new ValidationFailedError('That request is longer than the remaining balance.');
        }
      }
      const policy = await tx.client.query<{ block: boolean; exceptions: string[] }>(
        `SELECT block_department_overlap AS block, exception_type_keys AS exceptions FROM hr_leave_policy WHERE id = 1`,
      );
      const rule = policy.rows[0];
      if (rule?.block && employee.department_id && !rule.exceptions.includes(input.typeKey)) {
        const overlap = await tx.client.query(
          `SELECT 1 FROM hr_leave_requests l
             JOIN hr_employees e ON e.id = l.employee_id
            WHERE l.status = 'APPROVED' AND e.department_id = $1
              AND l.starts_on <= $3 AND l.ends_on >= $2
            LIMIT 1`,
          [employee.department_id, input.startsOn, input.endsOn],
        );
        if (overlap.rows[0]) {
          throw new ValidationFailedError('Someone in this department is already on leave for those dates.');
        }
      }
      let reliefEmployeeId: string | null = input.reliefEmployeeId ?? null;
      let reliefUserId: string | null = null;
      if (reliefEmployeeId) {
        if (reliefEmployeeId === employee.id) throw new ValidationFailedError('Choose a colleague as relief officer.');
        const relief = await tx.client.query<{ user_id: string | null; department_id: string | null }>(
          `SELECT user_id, department_id FROM hr_employees WHERE id = $1`,
          [reliefEmployeeId],
        );
        const reliefRow = relief.rows[0];
        if (!reliefRow?.user_id) throw new ValidationFailedError('The relief officer needs a sign-in.');
        if (employee.department_id && reliefRow.department_id !== employee.department_id) {
          throw new ValidationFailedError('Choose a relief officer from the same department.');
        }
        reliefUserId = reliefRow.user_id;
      } else if (own) {
        throw new ValidationFailedError('Choose a relief officer.');
      }
      const head = employee.department_id
        ? await tx.client.query<{ id: string; user_id: string | null }>(
            `SELECT e.id, e.user_id
               FROM departments d
               JOIN hr_employees e ON e.id = d.head_employee_id
              WHERE d.id = $1`,
            [employee.department_id],
          )
        : { rows: [] as Array<{ id: string; user_id: string | null }> };
      const headRow = head.rows[0];
      const allocated = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('LV') AS ref`);
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The leave reference was not allocated.');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO hr_leave_requests (
           reference_number, employee_id, entity_id, type_id, starts_on, ends_on, days, reason,
           relief_employee_id, relief_status, idempotency_key, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`,
        [
          reference,
          input.employeeId,
          employee.entity_id,
          typeId,
          input.startsOn,
          input.endsOn,
          days,
          input.reason ?? null,
          reliefEmployeeId,
          reliefUserId ? 'PENDING' : 'NOT_REQUIRED',
          input.idempotencyKey,
          actor.ref,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The leave request was not created.');
      const assignees: Array<{ stageKey: string; userId: string }> = [];
      if (reliefUserId) assignees.push({ stageKey: 'relief', userId: reliefUserId });
      if (headRow?.user_id && headRow.id !== employee.id) {
        assignees.push({ stageKey: 'department-head', userId: headRow.user_id });
      }
      const instance = await this.workflows.startHrInTx(tx, actor, {
        definitionKey: HR_LEAVE_WORKFLOW_KEY_V2,
        subjectType: 'HR_LEAVE',
        subjectId: id,
        entityId: employee.entity_id,
        reference,
        title: `${employee.first_name} ${employee.last_name} leave`,
        href: `/hr/leave`,
        assignees,
      });
      await tx.client.query(
        `UPDATE hr_leave_requests SET status = 'SUBMITTED', workflow_instance_id = $1, updated_by = $2 WHERE id = $3`,
        [instance.id, actor.ref, id],
      );
      await tx.audit({
        action: 'create',
        subjectType: 'hr_leave',
        subjectId: id,
        subjectLabel: reference,
        subjectReferenceNumber: reference,
        entityId: employee.entity_id,
        newValue: { status: 'SUBMITTED', days },
      });
      await tx.publish({
        eventType: 'hr.leave.submitted',
        subjectType: 'HR_LEAVE',
        subjectId: id,
        entityId: employee.entity_id,
        payload: { type: 'hr.leave.submitted', reference, title: reference, href: '/hr/leave' },
      });
      return this.leaveView(tx, id);
    });
  }

  async cancelLeave(actor: ActorContext, id: string, input: CancelLeaveInput): Promise<HrLeaveRequestView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.leaveView(tx, id);
      assertCan(actor, 'hr.leave.approve', current.entityCode ? undefined : undefined);
      const row = await tx.client.query<{
        entity_id: string;
        status: string;
        row_version: number;
        reference_number: string;
      }>(`SELECT entity_id, status, row_version, reference_number FROM hr_leave_requests WHERE id = $1 FOR UPDATE`, [
        id,
      ]);
      const locked = row.rows[0];
      if (!locked) throw new NotFoundError('That leave request was not found.');
      assertCan(actor, 'hr.leave.approve', locked.entity_id);
      if (locked.row_version !== input.rowVersion) throw stale('leave request');
      if (locked.status === 'CANCELLED') throw new ConflictError('That leave request is already cancelled.');
      await tx.client.query(
        `UPDATE hr_leave_requests SET status = 'CANCELLED', cancel_reason = $1, updated_by = $2 WHERE id = $3`,
        [input.reason, actor.ref, id],
      );
      await tx.audit({
        action: 'edit',
        subjectType: 'hr_leave',
        subjectId: id,
        subjectLabel: locked.reference_number,
        subjectReferenceNumber: locked.reference_number,
        entityId: locked.entity_id,
        oldValue: { status: locked.status },
        newValue: { status: 'CANCELLED' },
        reason: input.reason,
      });
      return this.leaveView(tx, id);
    });
  }

  async listAttendance(
    actor: ActorContext,
    query: { entityId?: string; from?: string; to?: string },
  ): Promise<HrAttendanceView[]> {
    assertCan(actor, 'hr.attendance.manage', query.entityId);
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<AttendanceRow>(
        `${ATTENDANCE_SQL}
          WHERE ($1::uuid IS NULL OR a.entity_id = $1)
            AND ($2::date IS NULL OR a.work_date >= $2::date)
            AND ($3::date IS NULL OR a.work_date <= $3::date)
          ORDER BY a.work_date DESC, emp.last_name`,
        [query.entityId ?? null, query.from ?? null, query.to ?? null],
      );
      return result.rows.map(toAttendance);
    });
  }

  async recordAttendance(actor: ActorContext, input: RecordAttendanceInput): Promise<HrAttendanceView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const employee = await this.lockEmployee(tx, input.employeeId);
      assertCan(actor, 'hr.attendance.manage', employee.entity_id);
      if (input.hoursWorked != null && input.hoursWorked < 0) {
        throw new ValidationFailedError('Hours worked cannot be negative.');
      }
      await tx.client.query(
        `INSERT INTO hr_attendance_records (
           employee_id, entity_id, work_date, kind, minutes_late, hours_worked, notes, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
         ON CONFLICT (employee_id, work_date) DO UPDATE
           SET kind = excluded.kind, minutes_late = excluded.minutes_late, hours_worked = excluded.hours_worked,
               notes = excluded.notes, updated_by = excluded.updated_by`,
        [
          input.employeeId,
          employee.entity_id,
          input.workDate,
          input.kind,
          input.minutesLate ?? 0,
          input.hoursWorked ?? null,
          input.notes ?? null,
          actor.ref,
        ],
      );
      const row = await tx.client.query<AttendanceRow>(
        `${ATTENDANCE_SQL} WHERE a.employee_id = $1 AND a.work_date = $2::date`,
        [input.employeeId, input.workDate],
      );
      return toAttendance(row.rows[0]!);
    });
  }

  async importAttendance(actor: ActorContext, input: ImportAttendanceInput): Promise<HrImportBatchView> {
    assertCan(actor, 'hr.attendance.manage');
    return this.unitOfWork.write(actor, async (tx) => {
      const errors: Array<{ line: number; message: string }> = [];
      let accepted = 0;
      const lines = input.csv.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim() !== '');
      const start = lines[0]?.toLowerCase().includes('employee') ? 1 : 0;
      const seen = new Set<string>();
      for (let i = start; i < lines.length; i += 1) {
        const lineNo = i + 1;
        const cols = lines[i]!.split(',').map((part) => part.trim());
        const [ref, workDate, kind, hoursRaw, lateRaw] = cols;
        if (!ref || !workDate) {
          errors.push({ line: lineNo, message: 'Employee number and date are required.' });
          continue;
        }
        const employee = await tx.client.query<{ id: string; entity_id: string }>(
          `SELECT id, entity_id FROM hr_employees WHERE reference_number = $1`,
          [ref],
        );
        if (!employee.rows[0]) {
          errors.push({ line: lineNo, message: `Unknown employee ${ref}.` });
          continue;
        }
        const punchKey = `${employee.rows[0].id}:${workDate}`;
        if (seen.has(punchKey)) {
          errors.push({ line: lineNo, message: `Duplicate punch for ${ref} on ${workDate}.` });
          continue;
        }
        seen.add(punchKey);
        const hours = hoursRaw ? Number(hoursRaw) : null;
        if (hours != null && (Number.isNaN(hours) || hours < 0)) {
          errors.push({ line: lineNo, message: 'Hours worked cannot be negative.' });
          continue;
        }
        const minutesLate = lateRaw ? Number(lateRaw) : 0;
        const attendanceKind = (kind || 'PRESENT').toUpperCase();
        if (!['PRESENT', 'ABSENT', 'LATE', 'LEAVE', 'HOLIDAY'].includes(attendanceKind)) {
          errors.push({ line: lineNo, message: `Unknown attendance kind ${kind}.` });
          continue;
        }
        await tx.client.query(
          `INSERT INTO hr_attendance_records (
             employee_id, entity_id, work_date, kind, minutes_late, hours_worked, source, created_by, updated_by
           ) VALUES ($1,$2,$3,$4,$5,$6,'CSV',$7,$7)
           ON CONFLICT (employee_id, work_date) DO UPDATE
             SET kind = excluded.kind, minutes_late = excluded.minutes_late, hours_worked = excluded.hours_worked,
                 source = 'CSV', updated_by = excluded.updated_by`,
          [
            employee.rows[0].id,
            employee.rows[0].entity_id,
            workDate,
            attendanceKind,
            Number.isFinite(minutesLate) ? minutesLate : 0,
            hours,
            actor.ref,
          ],
        );
        accepted += 1;
      }
      const inserted = await tx.client.query<{ id: string; created_at: Date }>(
        `INSERT INTO hr_attendance_import_batches (file_name, accepted, flagged, errors, created_by)
         VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id, created_at`,
        [input.fileName, accepted, errors.length, JSON.stringify(errors), actor.ref],
      );
      const batch = inserted.rows[0]!;
      await tx.audit({
        action: 'create',
        subjectType: 'hr_attendance_import',
        subjectId: batch.id,
        subjectLabel: input.fileName,
        newValue: { accepted, flagged: errors.length },
      });
      return {
        id: batch.id,
        fileName: input.fileName,
        importedAt: batch.created_at.toISOString(),
        accepted,
        flagged: errors.length,
        errors,
      };
    });
  }

  async monthlySummary(
    actor: ActorContext,
    year: number,
    month: number,
  ): Promise<Array<{ employeeId: string; employeeName: string; present: number; absent: number; late: number; overtimeHours: number }>> {
    assertCan(actor, 'hr.attendance.manage');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        employee_id: string;
        name: string;
        present: string;
        absent: string;
        late: string;
        overtime: string;
      }>(
        `SELECT emp.id AS employee_id, emp.first_name || ' ' || emp.last_name AS name,
                count(*) FILTER (WHERE a.kind IN ('PRESENT','LATE'))::text AS present,
                count(*) FILTER (WHERE a.kind = 'ABSENT')::text AS absent,
                count(*) FILTER (WHERE a.kind = 'LATE')::text AS late,
                coalesce((SELECT sum(hours) FROM hr_overtime_requests o
                           WHERE o.employee_id = emp.id AND o.status = 'APPROVED'
                             AND extract(year from o.work_date) = $1
                             AND extract(month from o.work_date) = $2), 0)::text AS overtime
           FROM hr_employees emp
           LEFT JOIN hr_attendance_records a
             ON a.employee_id = emp.id
            AND extract(year from a.work_date) = $1
            AND extract(month from a.work_date) = $2
          GROUP BY emp.id, emp.first_name, emp.last_name
          ORDER BY emp.last_name`,
        [year, month],
      );
      return result.rows.map((row) => ({
        employeeId: row.employee_id,
        employeeName: row.name,
        present: Number(row.present),
        absent: Number(row.absent),
        late: Number(row.late),
        overtimeHours: Number(row.overtime),
      }));
    });
  }

  async listOvertime(actor: ActorContext): Promise<HrOvertimeView[]> {
    assertCan(actor, 'hr.attendance.manage');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<OvertimeRow>(`${OVERTIME_SQL} ORDER BY o.work_date DESC`);
      return result.rows.map(toOvertime);
    });
  }

  async createOvertime(actor: ActorContext, input: CreateOvertimeInput): Promise<HrOvertimeView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const employee = await this.lockEmployee(tx, input.employeeId);
      assertCan(actor, 'hr.attendance.manage', employee.entity_id);
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO hr_overtime_requests (employee_id, entity_id, work_date, hours, reason, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
        [input.employeeId, employee.entity_id, input.workDate, input.hours, input.reason ?? null, actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The overtime request was not created.');
      const instance = await this.workflows.startHrInTx(tx, actor, {
        definitionKey: 'hr-overtime-v1',
        subjectType: 'HR_OVERTIME',
        subjectId: id,
        entityId: employee.entity_id,
        reference: employee.reference_number,
        title: `Overtime ${employee.first_name} ${employee.last_name}`,
        href: '/hr/attendance',
      });
      await tx.client.query(
        `UPDATE hr_overtime_requests SET status = 'SUBMITTED', workflow_instance_id = $1, updated_by = $2 WHERE id = $3`,
        [instance.id, actor.ref, id],
      );
      return this.overtimeView(tx, id);
    });
  }

  async listCycles(actor: ActorContext): Promise<HrCycleView[]> {
    assertCan(actor, 'hr.performance.manage');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<{
        id: string;
        name: string;
        starts_on: Date;
        ends_on: Date;
        status: string;
      }>(`SELECT id, name, starts_on, ends_on, status FROM hr_review_cycles ORDER BY starts_on DESC`);
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        startsOn: isoDate(row.starts_on) ?? '',
        endsOn: isoDate(row.ends_on) ?? '',
        status: row.status,
      }));
    });
  }

  async createCycle(actor: ActorContext, input: CreateCycleInput): Promise<HrCycleView> {
    assertCan(actor, 'hr.performance.manage');
    return this.unitOfWork.write(actor, async (tx) => {
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO hr_review_cycles (name, starts_on, ends_on, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$4) RETURNING id`,
        [input.name, input.startsOn, input.endsOn, actor.ref],
      );
      return {
        id: inserted.rows[0]!.id,
        name: input.name,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        status: 'OPEN',
      };
    });
  }

  async addObjective(actor: ActorContext, cycleId: string, input: CreateObjectiveInput): Promise<void> {
    assertCan(actor, 'hr.performance.manage');
    await this.unitOfWork.write(actor, async (tx) => {
      await tx.client.query(
        `INSERT INTO hr_objectives (employee_id, cycle_id, title, notes, created_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [input.employeeId, cycleId, input.title, input.notes ?? null, actor.ref],
      );
    });
  }

  async listAppraisals(actor: ActorContext): Promise<HrAppraisalView[]> {
    assertCan(actor, 'hr.performance.manage');
    return this.unitOfWork.read(actor, async (tx) => {
      const result = await tx.client.query<AppraisalRow>(`${APPRAISAL_SQL} ORDER BY a.created_at DESC`);
      return result.rows.map(toAppraisal);
    });
  }

  async createAppraisal(
    actor: ActorContext,
    cycleId: string,
    input: CreateAppraisalInput,
  ): Promise<HrAppraisalView> {
    return this.unitOfWork.write(actor, async (tx) => {
      const employee = await this.lockEmployee(tx, input.employeeId);
      assertCan(actor, 'hr.performance.manage', employee.entity_id);
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO hr_appraisals (employee_id, entity_id, cycle_id, rating, summary, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
        [input.employeeId, employee.entity_id, cycleId, input.rating ?? null, input.summary ?? null, actor.ref],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The appraisal was not created.');
      const instance = await this.workflows.startHrInTx(tx, actor, {
        definitionKey: 'hr-performance-v1',
        subjectType: 'HR_PERFORMANCE',
        subjectId: id,
        entityId: employee.entity_id,
        reference: employee.reference_number,
        title: `Appraisal ${employee.first_name} ${employee.last_name}`,
        href: '/hr/performance',
      });
      await tx.client.query(
        `UPDATE hr_appraisals SET status = 'SUBMITTED', workflow_instance_id = $1, updated_by = $2 WHERE id = $3`,
        [instance.id, actor.ref, id],
      );
      return this.appraisalView(tx, id);
    });
  }

  async listDisciplinary(actor: ActorContext): Promise<HrDisciplinaryView[]> {
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT id FROM hr_disciplinary_cases ORDER BY updated_at DESC`,
      );
      const rows: HrDisciplinaryView[] = [];
      for (const item of ids.rows) {
        rows.push(await this.discView(tx, actor, item.id, false));
      }
      return rows;
    });
  }

  async getDisciplinary(actor: ActorContext, id: string): Promise<HrDisciplinaryView> {
    return this.unitOfWork.write(actor, async (tx) => this.discView(tx, actor, id, true));
  }

  async createDisciplinary(actor: ActorContext, input: CreateDisciplinaryInput): Promise<HrDisciplinaryView> {
    assertCan(actor, 'hr.disciplinary.manage');
    return this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM hr_disciplinary_cases WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) return this.discView(tx, actor, existing.rows[0].id, false);
      const employee = await this.lockEmployee(tx, input.employeeId);
      assertCan(actor, 'hr.disciplinary.manage', employee.entity_id);
      const allocated = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('DISC') AS ref`);
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The disciplinary reference was not allocated.');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO hr_disciplinary_cases (
           reference_number, employee_id, entity_id, department_id, unit_id, category, incident_on, reported_on,
           description, handler_user_id, idempotency_key, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11,$12,$12) RETURNING id`,
        [
          reference,
          input.employeeId,
          employee.entity_id,
          employee.department_id,
          employee.unit_id,
          input.category,
          input.incidentOn,
          input.reportedOn ?? today(),
          input.description,
          actor.ref,
          input.idempotencyKey,
          actor.ref,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The disciplinary case was not opened.');
      await tx.client.query(
        `INSERT INTO hr_disciplinary_access (case_id, user_id, kind, created_by) VALUES ($1,$2::uuid,'HANDLER',$2)`,
        [id, actor.ref],
      );
      await tx.client.query(
        `INSERT INTO hr_disciplinary_events (case_id, kind, body, created_by) VALUES ($1,'OPENED',$2,$3)`,
        [id, input.description, actor.ref],
      );
      await tx.audit({
        action: 'create',
        subjectType: 'hr_disciplinary',
        subjectId: id,
        subjectLabel: reference,
        subjectReferenceNumber: reference,
        entityId: employee.entity_id,
        newValue: { status: 'DRAFT', category: input.category },
      });
      return this.discView(tx, actor, id, false);
    });
  }

  async submitDisciplinary(actor: ActorContext, id: string, rowVersion: number): Promise<HrDisciplinaryView> {
    return this.advanceDisciplinary(actor, id, 'PRELIMINARY_REVIEW', rowVersion, 'SUBMITTED');
  }

  async advanceDisciplinary(
    actor: ActorContext,
    id: string,
    status: HrDiscStatus,
    rowVersion: number,
    eventKind = 'ADVANCE',
  ): Promise<HrDisciplinaryView> {
    assertCan(actor, 'hr.disciplinary.manage');
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lockDisc(tx, id);
      if (current.row_version !== rowVersion) throw stale('disciplinary case');
      await tx.client.query(`UPDATE hr_disciplinary_cases SET status = $1, updated_by = $2 WHERE id = $3`, [
        status,
        actor.ref,
        id,
      ]);
      await tx.client.query(
        `INSERT INTO hr_disciplinary_events (case_id, kind, body, created_by) VALUES ($1,$2,$3,$4)`,
        [id, eventKind, `Status set to ${status}.`, actor.ref],
      );
      await tx.audit({
        action: 'edit',
        subjectType: 'hr_disciplinary',
        subjectId: id,
        subjectLabel: current.reference_number,
        subjectReferenceNumber: current.reference_number,
        entityId: current.entity_id,
        oldValue: { status: current.status },
        newValue: { status },
      });
      return this.discView(tx, actor, id, false);
    });
  }

  async addDiscEvent(actor: ActorContext, id: string, input: DiscEventInput): Promise<HrDisciplinaryView> {
    if (!can(actor, 'hr.disciplinary.investigate') && !can(actor, 'hr.disciplinary.manage')) {
      throw new ForbiddenError('You cannot record investigation notes on this case.');
    }
    return this.unitOfWork.write(actor, async (tx) => {
      await this.lockDisc(tx, id);
      await tx.client.query(
        `INSERT INTO hr_disciplinary_events (case_id, kind, body, created_by) VALUES ($1,$2,$3,$4)`,
        [id, input.kind, input.body, actor.ref],
      );
      return this.discView(tx, actor, id, false);
    });
  }

  async recommendDisciplinary(
    actor: ActorContext,
    id: string,
    input: DiscRecommendInput,
  ): Promise<HrDisciplinaryView> {
    assertCan(actor, 'hr.disciplinary.manage');
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lockDisc(tx, id);
      if (current.row_version !== input.rowVersion) throw stale('disciplinary case');
      const serious = (HR_DISC_SERIOUS_OUTCOMES as readonly string[]).includes(input.outcome);
      if (serious) {
        await tx.client.query(
          `UPDATE hr_disciplinary_cases SET status = 'AWAITING_MD', outcome = $1, updated_by = $2 WHERE id = $3`,
          [input.outcome, actor.ref, id],
        );
        const mds = await tx.client.query<{ user_id: string }>(
          `SELECT DISTINCT ura.user_id::text AS user_id
             FROM user_role_assignments ura
             JOIN role_permissions rp ON rp.role_id = ura.role_id
            WHERE rp.permission_key = 'hr.disciplinary.approve'`,
        );
        for (const md of mds.rows) {
          await tx.client.query(
            `INSERT INTO hr_disciplinary_access (case_id, user_id, kind, created_by)
             VALUES ($1,$2::uuid,'DECISION_MAKER',$3)
             ON CONFLICT DO NOTHING`,
            [id, md.user_id, actor.ref],
          );
        }
        const instance = await this.workflows.startHrInTx(tx, actor, {
          definitionKey: 'hr-disciplinary-md-v1',
          subjectType: 'HR_DISCIPLINARY',
          subjectId: id,
          entityId: current.entity_id,
          reference: current.reference_number,
          title: current.reference_number,
          href: `/hr/disciplinary/${id}`,
        });
        await tx.client.query(
          `UPDATE hr_disciplinary_cases SET workflow_instance_id = $1, updated_by = $2 WHERE id = $3`,
          [instance.id, actor.ref, id],
        );
        await tx.publish({
          eventType: 'hr.disciplinary.submitted',
          subjectType: 'HR_DISCIPLINARY',
          subjectId: id,
          entityId: current.entity_id,
          payload: {
            type: 'hr.disciplinary.submitted',
            reference: current.reference_number,
            title: current.reference_number,
            href: `/hr/disciplinary/${id}`,
          },
        });
      } else {
        await tx.client.query(
          `UPDATE hr_disciplinary_cases SET status = 'DECIDED', outcome = $1, updated_by = $2 WHERE id = $3`,
          [input.outcome, actor.ref, id],
        );
      }
      await tx.client.query(
        `INSERT INTO hr_disciplinary_events (case_id, kind, body, outcome, created_by)
         VALUES ($1,'RECOMMENDATION',$2,$3,$4)`,
        [id, input.body, input.outcome, actor.ref],
      );
      await tx.audit({
        action: 'edit',
        subjectType: 'hr_disciplinary',
        subjectId: id,
        subjectLabel: current.reference_number,
        subjectReferenceNumber: current.reference_number,
        entityId: current.entity_id,
        oldValue: { status: current.status, outcome: current.outcome },
        newValue: { status: serious ? 'AWAITING_MD' : 'DECIDED', outcome: input.outcome },
      });
      return this.discView(tx, actor, id, false);
    });
  }

  async closeDisciplinary(
    actor: ActorContext,
    id: string,
    input: { reason: string; rowVersion: number },
  ): Promise<HrDisciplinaryView> {
    assertCan(actor, 'hr.disciplinary.close');
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lockDisc(tx, id);
      if (current.row_version !== input.rowVersion) throw stale('disciplinary case');
      if (current.status === 'AWAITING_MD') {
        throw new ConflictError(
          'A suspension or more serious outcome must wait for the Managing Director.',
        );
      }
      await tx.client.query(
        `UPDATE hr_disciplinary_cases
            SET status = 'CLOSED', close_reason = $1, closed_at = now(), updated_by = $2
          WHERE id = $3`,
        [input.reason, actor.ref, id],
      );
      await tx.client.query(
        `INSERT INTO hr_disciplinary_events (case_id, kind, body, created_by) VALUES ($1,'CLOSURE',$2,$3)`,
        [id, input.reason, actor.ref],
      );
      await tx.audit({
        action: 'edit',
        subjectType: 'hr_disciplinary',
        subjectId: id,
        subjectLabel: current.reference_number,
        subjectReferenceNumber: current.reference_number,
        entityId: current.entity_id,
        oldValue: { status: current.status },
        newValue: { status: 'CLOSED' },
        reason: input.reason,
      });
      return this.discView(tx, actor, id, false);
    });
  }

  async reopenDisciplinary(actor: ActorContext, id: string, input: DiscReopenInput): Promise<HrDisciplinaryView> {
    assertCan(actor, 'hr.disciplinary.manage');
    return this.unitOfWork.write(actor, async (tx) => {
      const current = await this.lockDisc(tx, id);
      if (current.row_version !== input.rowVersion) throw stale('disciplinary case');
      await tx.client.query(
        `UPDATE hr_disciplinary_cases SET status = 'APPEAL', closed_at = NULL, updated_by = $1 WHERE id = $2`,
        [actor.ref, id],
      );
      await tx.client.query(
        `INSERT INTO hr_disciplinary_events (case_id, kind, body, created_by) VALUES ($1,'REOPEN',$2,$3)`,
        [id, input.reason, actor.ref],
      );
      await tx.audit({
        action: 'edit',
        subjectType: 'hr_disciplinary',
        subjectId: id,
        subjectLabel: current.reference_number,
        subjectReferenceNumber: current.reference_number,
        entityId: current.entity_id,
        oldValue: { status: current.status },
        newValue: { status: 'APPEAL' },
        reason: input.reason,
      });
      return this.discView(tx, actor, id, false);
    });
  }

  async listTraining(actor: ActorContext): Promise<HrTrainingView[]> {
    assertCan(actor, 'hr.training.view');
    return this.unitOfWork.read(actor, async (tx) => {
      const ids = await tx.client.query<{ id: string }>(
        `SELECT id FROM hr_training_sessions ORDER BY created_at DESC`,
      );
      return Promise.all(ids.rows.map((row) => this.trainingView(tx, actor, row.id)));
    });
  }

  async getTraining(actor: ActorContext, id: string): Promise<HrTrainingView> {
    assertCan(actor, 'hr.training.view');
    return this.unitOfWork.read(actor, async (tx) => this.trainingView(tx, actor, id));
  }

  async createTraining(actor: ActorContext, input: CreateTrainingInput): Promise<HrTrainingView> {
    assertCan(actor, 'hr.training.manage', input.entityId);
    return this.unitOfWork.write(actor, async (tx) => {
      const existing = await tx.client.query<{ id: string }>(
        `SELECT id FROM hr_training_sessions WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) return this.trainingView(tx, actor, existing.rows[0].id);
      const allocated = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('TRN') AS ref`);
      const reference = allocated.rows[0]?.ref;
      if (!reference) throw new Error('The training reference was not allocated.');
      const inserted = await tx.client.query<{ id: string }>(
        `INSERT INTO hr_training_sessions (
           reference_number, entity_id, department_id, unit_id, title, category, description, provider,
           internal, starts_on, ends_on, estimated_cost_kobo, idempotency_key, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING id`,
        [
          reference,
          input.entityId,
          input.departmentId ?? null,
          input.unitId ?? null,
          input.title,
          input.category ?? 'general',
          input.description ?? null,
          input.provider ?? null,
          input.internal ?? true,
          input.startsOn ?? null,
          input.endsOn ?? null,
          input.estimatedCostKobo ?? null,
          input.idempotencyKey,
          actor.ref,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('The training session was not created.');
      for (const employeeId of input.participantIds ?? []) {
        await tx.client.query(
          `INSERT INTO hr_training_participants (session_id, employee_id, created_by)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [id, employeeId, actor.ref],
        );
      }
      await tx.audit({
        action: 'create',
        subjectType: 'hr_training',
        subjectId: id,
        subjectLabel: input.title,
        subjectReferenceNumber: reference,
        entityId: input.entityId,
        newValue: { status: 'DRAFT', participants: (input.participantIds ?? []).length },
      });
      return this.trainingView(tx, actor, id);
    });
  }

  async addTrainingParticipants(
    actor: ActorContext,
    id: string,
    input: TrainingParticipantsInput,
  ): Promise<HrTrainingView> {
    assertCan(actor, 'hr.training.manage');
    return this.unitOfWork.write(actor, async (tx) => {
      for (const employeeId of input.employeeIds) {
        await tx.client.query(
          `INSERT INTO hr_training_participants (session_id, employee_id, created_by)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [id, employeeId, actor.ref],
        );
      }
      return this.trainingView(tx, actor, id);
    });
  }

  async recordTrainingAttendance(
    actor: ActorContext,
    id: string,
    input: TrainingAttendanceInput,
  ): Promise<HrTrainingView> {
    assertCan(actor, 'hr.training.manage');
    return this.unitOfWork.write(actor, async (tx) => {
      await tx.client.query(
        `UPDATE hr_training_participants
            SET attendance = $1, completed = $2, assessment = $3, hours = $4, certificate_expires_on = $5
          WHERE session_id = $6 AND employee_id = $7`,
        [
          input.attendance,
          input.completed ?? false,
          input.assessment ?? null,
          input.hours ?? null,
          input.certificateExpiresOn ?? null,
          id,
          input.employeeId,
        ],
      );
      return this.trainingView(tx, actor, id);
    });
  }

  async sendTrainingToFinance(actor: ActorContext, id: string, rowVersion: number): Promise<HrTrainingView> {
    assertCan(actor, 'hr.training.approve');
    return this.unitOfWork.write(actor, async (tx) => {
      const session = await tx.client.query<{
        id: string;
        entity_id: string;
        title: string;
        reference_number: string;
        estimated_cost_kobo: string | null;
        row_version: number;
        expense_entry_id: string | null;
      }>(
        `SELECT id, entity_id, title, reference_number, estimated_cost_kobo::text, row_version, expense_entry_id
           FROM hr_training_sessions WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const row = session.rows[0];
      if (!row) throw new NotFoundError('That training session was not found.');
      if (row.row_version !== rowVersion) throw stale('training session');
      if (!row.estimated_cost_kobo || Number(row.estimated_cost_kobo) <= 0) {
        throw new ValidationFailedError('A costed session needs an estimated cost before it is sent to Finance.');
      }
      if (row.expense_entry_id) return this.trainingView(tx, actor, id);
      const allocated = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('EXP') AS ref`);
      const expense = await tx.client.query<{ id: string }>(
        `INSERT INTO expense_entries (
           reference_number, entity_id, category_key, settlement, amount_kobo, occurred_on, narration,
           idempotency_key, created_by, updated_by
         ) VALUES ($1,$2,'training','ON_ACCOUNT',$3,CURRENT_DATE,$4,$5,$6,$6)
         RETURNING id`,
        [
          allocated.rows[0]?.ref,
          row.entity_id,
          Number(row.estimated_cost_kobo),
          `Training ${row.reference_number}: ${row.title}`,
          `trn-${id}`.slice(0, 80),
          actor.ref,
        ],
      );
      const expenseId = expense.rows[0]?.id;
      if (!expenseId) throw new Error('The training expense was not created.');
      await tx.client.query(`UPDATE expense_entries SET status = 'PENDING_APPROVAL', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        expenseId,
      ]);
      const instance = await this.workflows.startExpenseInTx(tx, actor, {
        expenseId,
        snapshot: { reference: allocated.rows[0]?.ref, amountKobo: Number(row.estimated_cost_kobo) },
      });
      await tx.client.query(
        `UPDATE expense_entries SET workflow_instance_id = $1, updated_by = $2 WHERE id = $3`,
        [instance.id, actor.ref, expenseId],
      );
      await tx.client.query(
        `UPDATE hr_training_sessions
            SET expense_entry_id = $1, status = 'AWAITING_FINANCE', updated_by = $2
          WHERE id = $3`,
        [expenseId, actor.ref, id],
      );
      await tx.publish({
        eventType: 'hr.training.finance',
        subjectType: 'EXPENSE',
        subjectId: expenseId,
        entityId: row.entity_id,
        payload: {
          type: 'hr.training.finance',
          reference: row.reference_number,
          title: row.title,
          href: `/finance/expenses/${expenseId}`,
        },
      });
      return this.trainingView(tx, actor, id);
    });
  }

  async remindDue(tx: TxScope, now: Date): Promise<number> {
    const leave = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      starts_on: Date;
    }>(
      `SELECT id, reference_number, entity_id, starts_on
         FROM hr_leave_requests
        WHERE status = 'APPROVED'
          AND starts_on BETWEEN $1::date AND ($1::date + 3)
          AND NOT EXISTS (
            SELECT 1 FROM domain_events e
             WHERE e.event_type = 'hr.leave.reminder' AND e.subject_id = hr_leave_requests.id
          )`,
      [now],
    );
    let sent = 0;
    for (const row of leave.rows) {
      await tx.publish({
        eventType: 'hr.leave.reminder',
        subjectType: 'HR_LEAVE',
        subjectId: row.id,
        entityId: row.entity_id,
        payload: {
          type: 'hr.leave.reminder',
          reference: row.reference_number,
          title: row.reference_number,
          startsOn: isoDate(row.starts_on) ?? '',
          href: '/hr/leave',
        },
      });
      sent += 1;
    }
    const training = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      title: string;
    }>(
      `SELECT id, reference_number, entity_id, title
         FROM hr_training_sessions
        WHERE status IN ('SCHEDULED','IN_PROGRESS')
          AND starts_on BETWEEN $1::date AND ($1::date + 3)
          AND NOT EXISTS (
            SELECT 1 FROM domain_events e
             WHERE e.event_type = 'hr.training.reminder' AND e.subject_id = hr_training_sessions.id
          )`,
      [now],
    );
    for (const row of training.rows) {
      await tx.publish({
        eventType: 'hr.training.reminder',
        subjectType: 'HR_TRAINING',
        subjectId: row.id,
        entityId: row.entity_id,
        payload: {
          type: 'hr.training.reminder',
          reference: row.reference_number,
          title: row.title,
          href: `/hr/training/${row.id}`,
        },
      });
      sent += 1;
    }
    return sent;
  }

  private async applyChangeRow(
    tx: TxScope,
    actor: ActorContext,
    row: ChangeRow,
    action: 'APPROVE' | 'REJECT',
  ): Promise<void> {
    if (action === 'REJECT') {
      await tx.client.query(`UPDATE hr_employment_changes SET status = 'REJECTED', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        row.id,
      ]);
      return;
    }
    const employee = await this.lockEmployee(tx, row.employee_id);
    if (row.kind === 'CONFIRMATION') {
      await tx.client.query(`UPDATE hr_employees SET status = 'CONFIRMED', updated_by = $1 WHERE id = $2`, [
        actor.ref,
        employee.id,
      ]);
    } else if (row.kind === 'TERMINATION' || row.kind === 'RESIGNATION') {
      await tx.client.query(
        `UPDATE hr_employees SET status = $1, updated_by = $2 WHERE id = $3`,
        [row.kind === 'TERMINATION' ? 'TERMINATED' : 'RESIGNED', actor.ref, employee.id],
      );
      await tx.client.query(
        `UPDATE hr_employee_assignments SET ended_on = $1
          WHERE employee_id = $2 AND ended_on IS NULL`,
        [row.effective_on, employee.id],
      );
    } else {
      await tx.client.query(
        `UPDATE hr_employee_assignments SET ended_on = $1
          WHERE employee_id = $2 AND ended_on IS NULL`,
        [row.effective_on, employee.id],
      );
      await this.insertAssignment(tx, actor, {
        employeeId: employee.id,
        entityId: employee.entity_id,
        departmentId: row.to_department_id,
        unitId: row.to_unit_id,
        positionId: row.to_position_id,
        kind: row.kind,
        effectiveOn: isoDate(row.effective_on) ?? today(),
      });
      await tx.client.query(
        `UPDATE hr_employees SET department_id = $1, unit_id = $2, position_id = $3, updated_by = $4 WHERE id = $5`,
        [row.to_department_id, row.to_unit_id, row.to_position_id, actor.ref, employee.id],
      );
    }
    await tx.client.query(`UPDATE hr_employment_changes SET status = 'APPROVED', updated_by = $1 WHERE id = $2`, [
      actor.ref,
      row.id,
    ]);
    await this.indexEmployee(tx, employee.id);
    await tx.audit({
      action: 'approve',
      subjectType: 'hr_change',
      subjectId: row.id,
      subjectLabel: `${row.kind} ${employee.reference_number}`,
      entityId: employee.entity_id,
      oldValue: { status: 'SUBMITTED' },
      newValue: { status: 'APPROVED' },
    });
  }

  private async createEmployeeInTx(
    tx: TxScope,
    actor: ActorContext,
    input: {
      entityId: string;
      departmentId: string | null;
      unitId: string | null;
      positionId: string | null;
      firstName: string;
      lastName: string;
      employmentType: string;
      dateEmployed: string | null;
      salaryKobo: number | null;
      workEmail: string | null;
      idempotencyKey: string;
    },
  ): Promise<HrEmployeeView> {
    const existing = await tx.client.query<{ id: string }>(
      `SELECT id FROM hr_employees WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    if (existing.rows[0]) return this.employeeView(tx, actor, existing.rows[0].id);
    await this.assertHierarchy(tx, input.entityId, input.departmentId, input.unitId, input.positionId);
    const allocated = await tx.client.query<{ ref: string }>(`SELECT app.next_reference('EMP') AS ref`);
    const reference = allocated.rows[0]?.ref;
    if (!reference) throw new Error('The employee number was not allocated.');
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO hr_employees (
         reference_number, entity_id, department_id, unit_id, position_id, first_name, last_name,
         employment_type, date_employed, salary_kobo, work_email, idempotency_key, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING id`,
      [
        reference,
        input.entityId,
        input.departmentId,
        input.unitId,
        input.positionId,
        input.firstName,
        input.lastName,
        input.employmentType,
        input.dateEmployed,
        input.salaryKobo,
        input.workEmail,
        input.idempotencyKey,
        actor.ref,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('The employee was not created.');
    const folderId = await this.ensureEmployeeFolder(
      tx,
      actor,
      input.entityId,
      `${input.firstName} ${input.lastName} ${reference}`,
    );
    await tx.client.query(`UPDATE hr_employees SET edms_folder_id = $1, updated_by = $2 WHERE id = $3`, [
      folderId,
      actor.ref,
      id,
    ]);
    await this.insertAssignment(tx, actor, {
      employeeId: id,
      entityId: input.entityId,
      departmentId: input.departmentId,
      unitId: input.unitId,
      positionId: input.positionId,
      kind: 'HIRE',
      effectiveOn: input.dateEmployed ?? today(),
    });
    await this.seedEntitlements(tx, id);
    await this.indexEmployee(tx, id);
    await tx.audit({
      action: 'create',
      subjectType: 'hr_employee',
      subjectId: id,
      subjectLabel: `${input.firstName} ${input.lastName}`,
      subjectReferenceNumber: reference,
      entityId: input.entityId,
      newValue: { status: 'ACTIVE', source: 'onboarding' },
    });
    return this.employeeView(tx, actor, id);
  }

  private async assertHierarchy(
    tx: TxScope,
    entityId: string,
    departmentId: string | null,
    unitId: string | null,
    positionId: string | null,
  ): Promise<void> {
    if (departmentId) {
      const dept = await tx.client.query<{ entity_id: string }>(`SELECT entity_id FROM departments WHERE id = $1`, [
        departmentId,
      ]);
      if (!dept.rows[0]) throw new ValidationFailedError('That department was not found.');
      if (dept.rows[0].entity_id !== entityId) {
        throw new ValidationFailedError('That department does not belong to the chosen subsidiary.');
      }
    }
    if (unitId) {
      if (!departmentId) throw new ValidationFailedError('A unit must sit under a department.');
      const unit = await tx.client.query<{ department_id: string; entity_id: string }>(
        `SELECT department_id, entity_id FROM org_units WHERE id = $1`,
        [unitId],
      );
      if (!unit.rows[0]) throw new ValidationFailedError('That unit was not found.');
      if (unit.rows[0].department_id !== departmentId || unit.rows[0].entity_id !== entityId) {
        throw new ValidationFailedError('That unit does not belong to the chosen department.');
      }
    }
    if (positionId) {
      const position = await tx.client.query<{ entity_id: string; department_id: string | null }>(
        `SELECT entity_id, department_id FROM hr_positions WHERE id = $1`,
        [positionId],
      );
      if (!position.rows[0]) throw new ValidationFailedError('That position was not found.');
      if (position.rows[0].entity_id !== entityId) {
        throw new ValidationFailedError('That position does not belong to the chosen subsidiary.');
      }
      if (position.rows[0].department_id && departmentId && position.rows[0].department_id !== departmentId) {
        throw new ValidationFailedError('That position is attached to a different department.');
      }
    }
  }

  async ensureEmployeeFolder(
    tx: TxScope,
    actor: ActorContext,
    entityId: string,
    name: string,
  ): Promise<string | null> {
    await tx.client.query(`SELECT app.seed_edms_entity_folders($1, $2)`, [entityId, actor.ref]);
    const root = await tx.client.query<{ id: string }>(
      `SELECT id FROM edms_folders WHERE entity_id = $1 AND parent_id IS NULL AND name = 'Active'`,
      [entityId],
    );
    const rootId = root.rows[0]?.id;
    if (!rootId) return null;
    const hr = await this.ensureChildFolder(tx, entityId, rootId, 'HR', 'module', actor);
    return this.ensureChildFolder(tx, entityId, hr, name, 'user', actor);
  }

  private async ensureChildFolder(
    tx: TxScope,
    entityId: string,
    parentId: string,
    name: string,
    kind: string,
    actor: ActorContext,
  ): Promise<string> {
    const existing = await tx.client.query<{ id: string }>(
      `SELECT id FROM edms_folders WHERE entity_id = $1 AND parent_id = $2 AND name = $3`,
      [entityId, parentId, name],
    );
    if (existing.rows[0]) return existing.rows[0].id;
    const inserted = await tx.client.query<{ id: string }>(
      `INSERT INTO edms_folders (entity_id, parent_id, name, kind, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'ACTIVE',$5,$5)
       ON CONFLICT (entity_id, parent_id, name) WHERE parent_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [entityId, parentId, name, kind, actor.ref],
    );
    if (inserted.rows[0]) return inserted.rows[0].id;
    const again = await tx.client.query<{ id: string }>(
      `SELECT id FROM edms_folders WHERE entity_id = $1 AND parent_id = $2 AND name = $3`,
      [entityId, parentId, name],
    );
    const id = again.rows[0]?.id;
    if (!id) throw new Error(`Could not create EDMS folder ${name}.`);
    return id;
  }

  private async insertAssignment(
    tx: TxScope,
    actor: ActorContext,
    input: {
      employeeId: string;
      entityId: string;
      departmentId: string | null;
      unitId: string | null;
      positionId: string | null;
      kind: string;
      effectiveOn: string;
    },
  ): Promise<void> {
    await tx.client.query(
      `INSERT INTO hr_employee_assignments (
         employee_id, entity_id, department_id, unit_id, position_id, kind, effective_on, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.employeeId,
        input.entityId,
        input.departmentId,
        input.unitId,
        input.positionId,
        input.kind,
        input.effectiveOn,
        actor.ref,
      ],
    );
  }

  private async seedEntitlements(tx: TxScope, employeeId: string): Promise<void> {
    const year = new Date().getFullYear();
    await tx.client.query(
      `INSERT INTO hr_leave_entitlements (employee_id, type_id, year, days)
       SELECT $1, id, $2, days_per_year FROM hr_leave_types WHERE status = 'ACTIVE'
       ON CONFLICT (employee_id, type_id, year) DO NOTHING`,
      [employeeId, year],
    );
  }

  private async indexEmployee(tx: TxScope, id: string): Promise<void> {
    const row = await tx.client.query<{
      id: string;
      reference_number: string;
      first_name: string;
      last_name: string;
      entity_id: string;
      title: string | null;
    }>(
      `SELECT emp.id, emp.reference_number, emp.first_name, emp.last_name, emp.entity_id, p.title
         FROM hr_employees emp
         LEFT JOIN hr_positions p ON p.id = emp.position_id
        WHERE emp.id = $1`,
      [id],
    );
    const employee = row.rows[0];
    if (!employee) return;
    const name = `${employee.first_name} ${employee.last_name}`;
    await tx.indexSearch({
      recordType: 'EMPLOYEE',
      recordId: employee.id,
      referenceNumber: employee.reference_number,
      title: name,
      searchableText: `${name} ${employee.reference_number} ${employee.title ?? ''}`,
      entityId: employee.entity_id,
      permissionKey: 'hr.employee.view',
    });
  }

  private async employeeView(tx: TxScope, actor: ActorContext, id: string): Promise<HrEmployeeView> {
    if (!can(actor, 'hr.employee.view')) {
      throw new ForbiddenError('You cannot view employee records.');
    }
    const result = await tx.client.query<EmployeeRow>(`${EMPLOYEE_SQL} WHERE emp.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That employee was not found, or is outside your access.');
    const assignments = await tx.client.query<{
      id: string;
      entity_code: string;
      department_name: string | null;
      unit_name: string | null;
      position_title: string | null;
      effective_on: Date | string;
      ended_on: Date | string | null;
      kind: string;
    }>(
      `SELECT a.id, e.code AS entity_code, d.name AS department_name, u.name AS unit_name, p.title AS position_title,
              a.effective_on::text AS effective_on, a.ended_on::text AS ended_on, a.kind
         FROM hr_employee_assignments a
         JOIN entities e ON e.id = a.entity_id
         LEFT JOIN departments d ON d.id = a.department_id
         LEFT JOIN org_units u ON u.id = a.unit_id
         LEFT JOIN hr_positions p ON p.id = a.position_id
        WHERE a.employee_id = $1
        ORDER BY a.effective_on, a.created_at`,
      [id],
    );
    const view = toEmployee(row, assignments.rows.map(toAssignment));
    if (!can(actor, 'hr.view_sensitive', row.entity_id)) {
      for (const field of HR_SENSITIVE_FIELDS) {
        (view as unknown as Record<string, unknown>)[field] = null;
      }
    }
    return view;
  }

  private async lockEmployee(tx: TxScope, id: string): Promise<EmployeeRow> {
    const result = await tx.client.query<EmployeeRow>(`${EMPLOYEE_SQL} WHERE emp.id = $1 FOR UPDATE OF emp`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That employee was not found, or is outside your access.');
    return row;
  }

  private async unitRow(tx: TxScope, id: string, lock = false): Promise<UnitRow> {
    const result = await tx.client.query<UnitRow>(
      `${UNIT_SQL} WHERE u.id = $1${lock ? ' FOR UPDATE OF u' : ''}`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That unit was not found.');
    return row;
  }

  private async positionRow(tx: TxScope, id: string): Promise<PositionRow> {
    const result = await tx.client.query<PositionRow>(`${POSITION_SQL} WHERE p.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That position was not found.');
    return row;
  }

  private async changeView(tx: TxScope, id: string): Promise<HrChangeView> {
    const result = await tx.client.query<ChangeRow>(`${CHANGE_SQL} WHERE c.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That employment change was not found.');
    return toChange(row);
  }

  private async vacancyView(tx: TxScope, id: string): Promise<HrVacancyView> {
    const result = await tx.client.query<VacancyRow>(`${VACANCY_SQL} WHERE v.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That vacancy was not found.');
    return toVacancy(row);
  }

  private async applicantRow(tx: TxScope, id: string): Promise<{
    id: string;
    vacancy_id: string;
    name: string;
    email: string | null;
    employee_id: string | null;
  }> {
    const result = await tx.client.query<{
      id: string;
      vacancy_id: string;
      name: string;
      email: string | null;
      employee_id: string | null;
    }>(`SELECT id, vacancy_id, name, email, employee_id FROM hr_applicants WHERE id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That applicant was not found.');
    return row;
  }

  private async applicantView(tx: TxScope, id: string): Promise<HrApplicantView> {
    const result = await tx.client.query<{
      id: string;
      vacancy_id: string;
      name: string;
      email: string | null;
      stage: string;
      score: string | null;
      employee_id: string | null;
    }>(`SELECT id, vacancy_id, name, email, stage, score::text, employee_id FROM hr_applicants WHERE id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That applicant was not found.');
    return {
      id: row.id,
      vacancyId: row.vacancy_id,
      name: row.name,
      email: row.email,
      stage: row.stage,
      score: row.score == null ? null : Number(row.score),
      employeeId: row.employee_id,
    };
  }

  private async setApplicantStage(actor: ActorContext, id: string, stage: string): Promise<HrApplicantView> {
    assertCan(actor, 'hr.recruitment.manage');
    return this.unitOfWork.write(actor, async (tx) => {
      await tx.client.query(`UPDATE hr_applicants SET stage = $1, updated_by = $2 WHERE id = $3`, [
        stage,
        actor.ref,
        id,
      ]);
      return this.applicantView(tx, id);
    });
  }

  private async offerRow(tx: TxScope, id: string): Promise<{
    id: string;
    vacancy_id: string;
    applicant_id: string;
    status: string;
    salary_kobo: number | null;
    starts_on: Date | null;
    workflow_instance_id: string | null;
  }> {
    const result = await tx.client.query<{
      id: string;
      vacancy_id: string;
      applicant_id: string;
      status: string;
      salary_kobo: string | null;
      starts_on: Date | null;
      workflow_instance_id: string | null;
    }>(
      `SELECT id, vacancy_id, applicant_id, status, salary_kobo::text, starts_on, workflow_instance_id
         FROM hr_offers WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That offer was not found.');
    return { ...row, salary_kobo: row.salary_kobo == null ? null : Number(row.salary_kobo) };
  }

  private async offerView(tx: TxScope, id: string): Promise<HrOfferView> {
    const row = await this.offerRow(tx, id);
    return {
      id: row.id,
      vacancyId: row.vacancy_id,
      applicantId: row.applicant_id,
      status: row.status as HrOfferView['status'],
      salaryKobo: row.salary_kobo,
      workflowInstanceId: row.workflow_instance_id,
    };
  }

  private async leaveView(tx: TxScope, id: string): Promise<HrLeaveRequestView> {
    const result = await tx.client.query<LeaveRow>(`${LEAVE_SQL} WHERE l.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That leave request was not found.');
    return toLeave(row);
  }

  private async overtimeView(tx: TxScope, id: string): Promise<HrOvertimeView> {
    const result = await tx.client.query<OvertimeRow>(`${OVERTIME_SQL} WHERE o.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That overtime request was not found.');
    return toOvertime(row);
  }

  private async appraisalView(tx: TxScope, id: string): Promise<HrAppraisalView> {
    const result = await tx.client.query<AppraisalRow>(`${APPRAISAL_SQL} WHERE a.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That appraisal was not found.');
    return toAppraisal(row);
  }

  private async balancesInTx(tx: TxScope, employeeId: string): Promise<HrLeaveBalanceView[]> {
    const year = new Date().getFullYear();
    const result = await tx.client.query<{
      employee_id: string;
      type_key: string;
      type_name: string;
      entitled: string;
      taken: string;
    }>(
      `SELECT e.employee_id, t.key AS type_key, t.name AS type_name, e.days::text AS entitled,
              coalesce((
                SELECT sum(l.days) FROM hr_leave_requests l
                 WHERE l.employee_id = e.employee_id AND l.type_id = e.type_id
                   AND l.status = 'APPROVED'
                   AND extract(year from l.starts_on) = e.year
              ), 0)::text AS taken
         FROM hr_leave_entitlements e
         JOIN hr_leave_types t ON t.id = e.type_id
        WHERE e.employee_id = $1 AND e.year = $2
        ORDER BY t.name`,
      [employeeId, year],
    );
    return result.rows.map((row) => ({
      employeeId: row.employee_id,
      typeKey: row.type_key,
      typeName: row.type_name,
      entitled: Number(row.entitled),
      taken: Number(row.taken),
      remaining: Number(row.entitled) - Number(row.taken),
      year,
    }));
  }

  private async leaveDays(tx: TxScope, entityId: string, startsOn: string, endsOn: string): Promise<number> {
    const result = await tx.client.query<{ days: string }>(
      `SELECT count(*)::text AS days
         FROM generate_series($1::date, $2::date, interval '1 day') d
        WHERE extract(dow from d) NOT IN (0, 6)
          AND NOT EXISTS (
            SELECT 1 FROM hr_public_holidays h
             WHERE h.observed_on = d::date AND (h.entity_id IS NULL OR h.entity_id = $3)
          )`,
      [startsOn, endsOn, entityId],
    );
    return Number(result.rows[0]?.days ?? 0);
  }

  private async lockDisc(tx: TxScope, id: string): Promise<{
    id: string;
    reference_number: string;
    entity_id: string;
    status: string;
    outcome: string | null;
    row_version: number;
  }> {
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      entity_id: string;
      status: string;
      outcome: string | null;
      row_version: number;
    }>(
      `SELECT id, reference_number, entity_id, status, outcome, row_version
         FROM hr_disciplinary_cases WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That disciplinary case was not found.');
    return row;
  }

  private async discView(
    tx: TxScope,
    actor: ActorContext,
    id: string,
    logAccess: boolean,
  ): Promise<HrDisciplinaryView> {
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      employee_id: string;
      employee_name: string;
      entity_id: string;
      entity_code: string;
      department_name: string | null;
      unit_name: string | null;
      category: string;
      incident_on: Date;
      reported_on: Date;
      description: string;
      status: string;
      outcome: string | null;
      handler_user_id: string | null;
      workflow_instance_id: string | null;
      row_version: number;
    }>(
      `SELECT c.id, c.reference_number, c.employee_id,
              app.hr_employee_public_name(c.employee_id) AS employee_name,
              c.entity_id, e.code AS entity_code, d.name AS department_name, u.name AS unit_name,
              c.category, c.incident_on, c.reported_on, c.description, c.status, c.outcome,
              c.handler_user_id, c.workflow_instance_id, c.row_version
         FROM hr_disciplinary_cases c
         JOIN entities e ON e.id = c.entity_id
         LEFT JOIN departments d ON d.id = c.department_id
         LEFT JOIN org_units u ON u.id = c.unit_id
        WHERE c.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That disciplinary case was not found.');
    const events = await tx.client.query<{
      id: string;
      kind: string;
      body: string;
      outcome: string | null;
      actor_name: string;
      occurred_at: Date;
    }>(
      `SELECT ev.id, ev.kind, ev.body, ev.outcome, coalesce(app.user_public_name(ev.created_by::uuid), ev.created_by) AS actor_name,
              ev.created_at AS occurred_at
         FROM hr_disciplinary_events ev
        WHERE ev.case_id = $1
        ORDER BY ev.created_at`,
      [id],
    );
    if (logAccess) {
      await tx.client.query(
        `INSERT INTO hr_disciplinary_access_log (case_id, actor_ref, action) VALUES ($1,$2,'view')`,
        [id, actor.ref],
      );
    }
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      departmentName: row.department_name,
      unitName: row.unit_name,
      category: row.category,
      incidentOn: isoDate(row.incident_on) ?? '',
      reportedOn: isoDate(row.reported_on) ?? '',
      description: row.description,
      status: row.status as HrDiscStatus,
      outcome: (row.outcome as HrDiscOutcome | null) ?? null,
      handlerUserId: row.handler_user_id,
      workflowInstanceId: row.workflow_instance_id,
      rowVersion: row.row_version,
      events: events.rows.map((event) => ({
        id: event.id,
        kind: event.kind,
        body: event.body,
        outcome: (event.outcome as HrDiscOutcome | null) ?? null,
        actorName: event.actor_name,
        occurredAt: event.occurred_at.toISOString(),
      })),
    };
  }

  private async trainingView(tx: TxScope, actor: ActorContext, id: string): Promise<HrTrainingView> {
    const result = await tx.client.query<{
      id: string;
      reference_number: string;
      title: string;
      category: string;
      entity_id: string;
      entity_code: string;
      starts_on: Date | null;
      ends_on: Date | null;
      status: string;
      provider: string | null;
      internal: boolean;
      estimated_cost_kobo: string | null;
      actual_cost_kobo: string | null;
      expense_entry_id: string | null;
      row_version: number;
    }>(
      `SELECT s.id, s.reference_number, s.title, s.category, s.entity_id, e.code AS entity_code,
              s.starts_on, s.ends_on, s.status, s.provider, s.internal,
              s.estimated_cost_kobo::text, s.actual_cost_kobo::text, s.expense_entry_id, s.row_version
         FROM hr_training_sessions s
         JOIN entities e ON e.id = s.entity_id
        WHERE s.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('That training session was not found.');
    const parts = await tx.client.query<{
      employee_id: string;
      employee_name: string;
      attendance: string;
      completed: boolean;
      assessment: string | null;
      hours: string | null;
      certificate_expires_on: Date | null;
    }>(
      `SELECT p.employee_id, emp.first_name || ' ' || emp.last_name AS employee_name, p.attendance, p.completed,
              p.assessment, p.hours::text, p.certificate_expires_on
         FROM hr_training_participants p
         JOIN hr_employees emp ON emp.id = p.employee_id
        WHERE p.session_id = $1
        ORDER BY emp.last_name`,
      [id],
    );
    const report = can(actor, 'hr.training.report', row.entity_id);
    return {
      id: row.id,
      referenceNumber: row.reference_number,
      title: row.title,
      category: row.category,
      entityId: row.entity_id,
      entityCode: row.entity_code,
      startsOn: isoDate(row.starts_on),
      endsOn: isoDate(row.ends_on),
      status: row.status as HrTrainingView['status'],
      provider: row.provider,
      internal: row.internal,
      estimatedCostKobo: report && row.estimated_cost_kobo != null ? Number(row.estimated_cost_kobo) : null,
      actualCostKobo: report && row.actual_cost_kobo != null ? Number(row.actual_cost_kobo) : null,
      expenseEntryId: row.expense_entry_id,
      rowVersion: row.row_version,
      participants: parts.rows.map((part) => ({
        employeeId: part.employee_id,
        employeeName: part.employee_name,
        attendance: part.attendance,
        completed: part.completed,
        assessment: part.assessment,
        hours: part.hours == null ? null : Number(part.hours),
        certificateExpiresOn: isoDate(part.certificate_expires_on),
      })),
    };
  }
}

const UNIT_SQL = `
  SELECT u.id, u.entity_id, e.code AS entity_code, u.department_id, d.name AS department_name,
         u.name, u.code, u.status, u.row_version
    FROM org_units u
    JOIN entities e ON e.id = u.entity_id
    JOIN departments d ON d.id = u.department_id`;

const POSITION_SQL = `
  SELECT p.id, p.entity_id, e.code AS entity_code, p.department_id, d.name AS department_name,
         p.title, p.grade, p.status, p.row_version
    FROM hr_positions p
    JOIN entities e ON e.id = p.entity_id
    LEFT JOIN departments d ON d.id = p.department_id`;

const EMPLOYEE_LIST_SQL = `
  SELECT emp.id, emp.reference_number, emp.first_name || ' ' || emp.last_name AS name,
         emp.entity_id, e.code AS entity_code, d.name AS department_name, u.name AS unit_name,
         p.title AS position_title, emp.grade, emp.status, emp.employment_type
    FROM hr_employees emp
    JOIN entities e ON e.id = emp.entity_id
    LEFT JOIN departments d ON d.id = emp.department_id
    LEFT JOIN org_units u ON u.id = emp.unit_id
    LEFT JOIN hr_positions p ON p.id = emp.position_id`;

const EMPLOYEE_SQL = `
  SELECT emp.*, e.code AS entity_code, d.name AS department_name, u.name AS unit_name, p.title AS position_title,
         mgr.first_name || ' ' || mgr.last_name AS reporting_manager_name
    FROM hr_employees emp
    JOIN entities e ON e.id = emp.entity_id
    LEFT JOIN departments d ON d.id = emp.department_id
    LEFT JOIN org_units u ON u.id = emp.unit_id
    LEFT JOIN hr_positions p ON p.id = emp.position_id
    LEFT JOIN hr_employees mgr ON mgr.id = emp.reporting_manager_id`;

const CHANGE_SQL = `
  SELECT c.*, emp.first_name || ' ' || emp.last_name AS employee_name
    FROM hr_employment_changes c
    JOIN hr_employees emp ON emp.id = c.employee_id`;

const VACANCY_SQL = `
  SELECT v.*, e.code AS entity_code
    FROM hr_vacancies v
    JOIN entities e ON e.id = v.entity_id`;

const LEAVE_SQL = `
  SELECT l.*, emp.first_name || ' ' || emp.last_name AS employee_name, t.key AS type_key, t.name AS type_name,
         e.code AS entity_code
    FROM hr_leave_requests l
    JOIN hr_employees emp ON emp.id = l.employee_id
    JOIN hr_leave_types t ON t.id = l.type_id
    JOIN entities e ON e.id = l.entity_id`;

const ATTENDANCE_SQL = `
  SELECT a.*, emp.first_name || ' ' || emp.last_name AS employee_name, e.code AS entity_code
    FROM hr_attendance_records a
    JOIN hr_employees emp ON emp.id = a.employee_id
    JOIN entities e ON e.id = a.entity_id`;

const OVERTIME_SQL = `
  SELECT o.*, emp.first_name || ' ' || emp.last_name AS employee_name
    FROM hr_overtime_requests o
    JOIN hr_employees emp ON emp.id = o.employee_id`;

const APPRAISAL_SQL = `
  SELECT a.*, emp.first_name || ' ' || emp.last_name AS employee_name, c.name AS cycle_name
    FROM hr_appraisals a
    JOIN hr_employees emp ON emp.id = a.employee_id
    JOIN hr_review_cycles c ON c.id = a.cycle_id`;

interface UnitRow {
  id: string;
  entity_id: string;
  entity_code: string;
  department_id: string;
  department_name: string;
  name: string;
  code: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  row_version: number;
}

interface PositionRow {
  id: string;
  entity_id: string;
  entity_code: string;
  department_id: string | null;
  department_name: string | null;
  title: string;
  grade: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  row_version: number;
}

interface EmployeeListRow {
  id: string;
  reference_number: string;
  name: string;
  entity_id: string;
  entity_code: string;
  department_name: string | null;
  unit_name: string | null;
  position_title: string | null;
  grade: string | null;
  status: HrEmployeeListItemView['status'];
  employment_type: HrEmployeeListItemView['employmentType'];
}

interface EmployeeRow {
  id: string;
  reference_number: string;
  entity_id: string;
  entity_code: string;
  department_id: string | null;
  department_name: string | null;
  unit_id: string | null;
  unit_name: string | null;
  position_id: string | null;
  position_title: string | null;
  first_name: string;
  last_name: string;
  other_names: string | null;
  gender: string | null;
  employment_type: HrEmployeeView['employmentType'];
  grade: string | null;
  date_employed: Date | null;
  status: HrEmployeeView['status'];
  reporting_manager_id: string | null;
  reporting_manager_name: string | null;
  user_id: string | null;
  work_email: string | null;
  work_phone: string | null;
  personal_email: string | null;
  personal_phone: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  salary_kobo: string | null;
  photo_document_id: string | null;
  edms_folder_id: string | null;
  row_version: number;
}

interface ChangeRow {
  id: string;
  employee_id: string;
  employee_name: string;
  kind: HrChangeView['kind'];
  status: HrChangeView['status'];
  effective_on: Date;
  reason: string;
  from_department_id: string | null;
  to_department_id: string | null;
  from_unit_id: string | null;
  to_unit_id: string | null;
  from_position_id: string | null;
  to_position_id: string | null;
  workflow_instance_id: string | null;
  row_version: number;
}

interface VacancyRow {
  id: string;
  reference_number: string;
  entity_id: string;
  entity_code: string;
  title: string;
  department_id: string | null;
  unit_id: string | null;
  position_id: string | null;
  status: HrVacancyView['status'];
  headcount: number;
  workflow_instance_id: string | null;
  row_version: number;
}

interface LeaveRow {
  id: string;
  reference_number: string;
  employee_id: string;
  employee_name: string;
  type_key: string;
  type_name: string;
  starts_on: Date;
  ends_on: Date;
  days: string;
  status: HrLeaveRequestView['status'];
  reason: string | null;
  entity_code: string;
  workflow_instance_id: string | null;
  row_version: number;
}

interface AttendanceRow {
  id: string;
  employee_id: string;
  employee_name: string;
  entity_code: string;
  work_date: Date;
  kind: HrAttendanceView['kind'];
  minutes_late: number;
  hours_worked: string | null;
  notes: string | null;
}

interface OvertimeRow {
  id: string;
  employee_id: string;
  employee_name: string;
  work_date: Date;
  hours: string;
  status: HrOvertimeView['status'];
  reason: string | null;
  workflow_instance_id: string | null;
  row_version: number;
}

interface AppraisalRow {
  id: string;
  employee_id: string;
  employee_name: string;
  cycle_id: string;
  cycle_name: string;
  rating: string | null;
  summary: string | null;
  status: HrAppraisalView['status'];
  workflow_instance_id: string | null;
  row_version: number;
}

function toUnit(row: UnitRow): HrUnitView {
  return {
    id: row.id,
    entityId: row.entity_id,
    entityCode: row.entity_code,
    departmentId: row.department_id,
    departmentName: row.department_name,
    name: row.name,
    code: row.code,
    status: row.status,
    rowVersion: row.row_version,
  };
}

function toPosition(row: PositionRow): HrPositionView {
  return {
    id: row.id,
    entityId: row.entity_id,
    entityCode: row.entity_code,
    departmentId: row.department_id,
    departmentName: row.department_name,
    title: row.title,
    grade: row.grade,
    status: row.status,
    rowVersion: row.row_version,
  };
}

function toListItem(row: EmployeeListRow): HrEmployeeListItemView {
  return {
    id: row.id,
    referenceNumber: row.reference_number,
    name: row.name,
    entityId: row.entity_id,
    entityCode: row.entity_code,
    departmentName: row.department_name,
    unitName: row.unit_name,
    positionTitle: row.position_title,
    grade: row.grade,
    status: row.status,
    employmentType: row.employment_type,
  };
}

function toEmployee(row: EmployeeRow, assignments: HrAssignmentView[]): HrEmployeeView {
  return {
    id: row.id,
    referenceNumber: row.reference_number,
    name: `${row.first_name} ${row.last_name}`.trim(),
    entityId: row.entity_id,
    entityCode: row.entity_code,
    departmentName: row.department_name,
    unitName: row.unit_name,
    positionTitle: row.position_title,
    grade: row.grade,
    status: row.status,
    employmentType: row.employment_type,
    firstName: row.first_name,
    lastName: row.last_name,
    otherNames: row.other_names,
    gender: row.gender,
    dateEmployed: isoDate(row.date_employed),
    reportingManagerId: row.reporting_manager_id,
    reportingManagerName: row.reporting_manager_name,
    departmentId: row.department_id,
    unitId: row.unit_id,
    positionId: row.position_id,
    photoDocumentId: row.photo_document_id,
    edmsFolderId: row.edms_folder_id,
    workEmail: row.work_email,
    workPhone: row.work_phone,
    personalEmail: row.personal_email,
    personalPhone: row.personal_phone,
    emergencyName: row.emergency_name,
    emergencyPhone: row.emergency_phone,
    bankName: row.bank_name,
    bankAccountName: row.bank_account_name,
    bankAccountNumber: row.bank_account_number,
    salaryKobo: row.salary_kobo == null ? null : Number(row.salary_kobo),
    rowVersion: row.row_version,
    assignments,
  };
}

function toAssignment(row: {
  id: string;
  entity_code: string;
  department_name: string | null;
  unit_name: string | null;
  position_title: string | null;
  effective_on: Date | string;
  ended_on: Date | string | null;
  kind: string;
}): HrAssignmentView {
  return {
    id: row.id,
    entityCode: row.entity_code,
    departmentName: row.department_name,
    unitName: row.unit_name,
    positionTitle: row.position_title,
    effectiveOn: isoDate(row.effective_on) ?? '',
    endedOn: isoDate(row.ended_on),
    kind: row.kind,
  };
}

function toChange(row: ChangeRow): HrChangeView {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    kind: row.kind,
    status: row.status,
    effectiveOn: isoDate(row.effective_on) ?? '',
    reason: row.reason,
    fromDepartmentId: row.from_department_id,
    toDepartmentId: row.to_department_id,
    fromUnitId: row.from_unit_id,
    toUnitId: row.to_unit_id,
    fromPositionId: row.from_position_id,
    toPositionId: row.to_position_id,
    workflowInstanceId: row.workflow_instance_id,
    rowVersion: row.row_version,
  };
}

function toVacancy(row: VacancyRow): HrVacancyView {
  return {
    id: row.id,
    referenceNumber: row.reference_number,
    entityId: row.entity_id,
    entityCode: row.entity_code,
    title: row.title,
    departmentId: row.department_id,
    unitId: row.unit_id,
    positionId: row.position_id,
    status: row.status,
    headcount: row.headcount,
    workflowInstanceId: row.workflow_instance_id,
    rowVersion: row.row_version,
  };
}

function toLeave(row: LeaveRow): HrLeaveRequestView {
  return {
    id: row.id,
    referenceNumber: row.reference_number,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    typeKey: row.type_key,
    typeName: row.type_name,
    startsOn: isoDate(row.starts_on) ?? '',
    endsOn: isoDate(row.ends_on) ?? '',
    days: Number(row.days),
    status: row.status,
    reason: row.reason,
    entityCode: row.entity_code,
    workflowInstanceId: row.workflow_instance_id,
    rowVersion: row.row_version,
  };
}

function toAttendance(row: AttendanceRow): HrAttendanceView {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    entityCode: row.entity_code,
    workDate: isoDate(row.work_date) ?? '',
    kind: row.kind,
    minutesLate: row.minutes_late,
    hoursWorked: row.hours_worked == null ? null : Number(row.hours_worked),
    notes: row.notes,
  };
}

function toOvertime(row: OvertimeRow): HrOvertimeView {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    workDate: isoDate(row.work_date) ?? '',
    hours: Number(row.hours),
    status: row.status,
    reason: row.reason,
    workflowInstanceId: row.workflow_instance_id,
    rowVersion: row.row_version,
  };
}

function toAppraisal(row: AppraisalRow): HrAppraisalView {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    cycleId: row.cycle_id,
    cycleName: row.cycle_name,
    rating: row.rating,
    summary: row.summary,
    status: row.status,
    workflowInstanceId: row.workflow_instance_id,
    rowVersion: row.row_version,
  };
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function stale(label: string): StaleRecordError {
  return new StaleRecordError(`This ${label} changed while you were working. Reload and try again.`);
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0]!, last: parts[0]! };
  return { first: parts[0]!, last: parts.slice(1).join(' ') };
}
