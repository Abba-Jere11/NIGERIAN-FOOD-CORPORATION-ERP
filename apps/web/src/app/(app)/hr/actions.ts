'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type {
  HrEmployeeView,
  HrLeaveRequestView,
  HrTrainingView,
  HrVacancyView,
} from '@nfc/shared';
import type { ActionResult } from '@/lib/action-result';
import { ApiError, apiFetch } from '@/lib/api';

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

function optional(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value === '' ? null : value;
}

function omitBlank(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  );
}

function toActionResult(error: unknown): ActionResult {
  if (error instanceof ApiError) {
    return {
      status: 'error',
      message: error.message,
      ...(Object.keys(error.fieldErrors).length > 0 ? { fieldErrors: error.fieldErrors } : {}),
      requestId: error.requestId,
    };
  }
  return { status: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' };
}

function revalidateHr(): void {
  revalidatePath('/hr');
  revalidatePath('/home/hr');
  revalidatePath('/hr/employees');
  revalidatePath('/hr/recruitment');
  revalidatePath('/hr/leave');
  revalidatePath('/hr/attendance');
  revalidatePath('/hr/performance');
  revalidatePath('/hr/disciplinary');
  revalidatePath('/hr/training');
}

export async function createEmployeeAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let created: HrEmployeeView;
  try {
    created = await apiFetch<HrEmployeeView>('/api/hr/employees', {
      method: 'POST',
      body: omitBlank({
        entityId: text(formData, 'entityId'),
        departmentId: optional(formData, 'departmentId'),
        unitId: optional(formData, 'unitId'),
        positionId: optional(formData, 'positionId'),
        firstName: text(formData, 'firstName'),
        lastName: text(formData, 'lastName'),
        employmentType: text(formData, 'employmentType') || 'PERMANENT',
        dateEmployed: optional(formData, 'dateEmployed'),
        workEmail: optional(formData, 'workEmail'),
        personalEmail: optional(formData, 'personalEmail'),
        personalPhone: optional(formData, 'personalPhone'),
        bankName: optional(formData, 'bankName'),
        bankAccountNumber: optional(formData, 'bankAccountNumber'),
        salaryKobo: optional(formData, 'salaryKobo') ? Number(text(formData, 'salaryKobo')) : null,
        idempotencyKey: text(formData, 'idempotencyKey'),
      }),
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  redirect(`/hr/employees/${created.id}`);
}

export async function createUnitAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    await apiFetch('/api/hr/units', {
      method: 'POST',
      body: omitBlank({
        entityId: text(formData, 'entityId'),
        departmentId: text(formData, 'departmentId'),
        name: text(formData, 'name'),
        code: optional(formData, 'code'),
      }),
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  return { status: 'ok', message: 'Unit created.' };
}

export async function createPositionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch('/api/hr/positions', {
      method: 'POST',
      body: omitBlank({
        entityId: text(formData, 'entityId'),
        departmentId: optional(formData, 'departmentId'),
        title: text(formData, 'title'),
        grade: optional(formData, 'grade'),
      }),
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  return { status: 'ok', message: 'Position created.' };
}

export async function createChangeAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    await apiFetch('/api/hr/changes', {
      method: 'POST',
      body: omitBlank({
        employeeId: text(formData, 'employeeId'),
        kind: text(formData, 'kind'),
        effectiveOn: text(formData, 'effectiveOn'),
        reason: text(formData, 'reason'),
        toDepartmentId: optional(formData, 'toDepartmentId'),
        toUnitId: optional(formData, 'toUnitId'),
        toPositionId: optional(formData, 'toPositionId'),
        idempotencyKey: text(formData, 'idempotencyKey'),
      }),
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  revalidatePath(`/hr/employees/${text(formData, 'employeeId')}`);
  return { status: 'ok', message: 'Change submitted for HR approval.' };
}

export async function createVacancyAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let created: HrVacancyView;
  try {
    created = await apiFetch<HrVacancyView>('/api/hr/vacancies', {
      method: 'POST',
      body: omitBlank({
        entityId: text(formData, 'entityId'),
        departmentId: optional(formData, 'departmentId'),
        unitId: optional(formData, 'unitId'),
        positionId: optional(formData, 'positionId'),
        title: text(formData, 'title'),
        body: optional(formData, 'body'),
        idempotencyKey: text(formData, 'idempotencyKey'),
      }),
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  redirect(`/hr/recruitment/${created.id}`);
}

export async function addApplicantAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/hr/vacancies/${text(formData, 'vacancyId')}/applicants`, {
      method: 'POST',
      body: { name: text(formData, 'name'), email: optional(formData, 'email') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/hr/recruitment/${text(formData, 'vacancyId')}`);
  return { status: 'ok', message: 'Applicant recorded.' };
}

export async function interviewAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    await apiFetch(`/api/hr/applicants/${text(formData, 'applicantId')}/interviews`, {
      method: 'POST',
      body: omitBlank({
        scheduledAt: optional(formData, 'scheduledAt'),
        score: optional(formData, 'score') ? Number(text(formData, 'score')) : null,
        notes: optional(formData, 'notes'),
      }),
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  return { status: 'ok', message: 'Interview recorded.' };
}

export async function createOfferAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    await apiFetch(`/api/hr/vacancies/${text(formData, 'vacancyId')}/offers`, {
      method: 'POST',
      body: omitBlank({
        applicantId: text(formData, 'applicantId'),
        salaryKobo: optional(formData, 'salaryKobo') ? Number(text(formData, 'salaryKobo')) : null,
        startsOn: optional(formData, 'startsOn'),
      }),
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  return { status: 'ok', message: 'Offer submitted for approval.' };
}

export async function onboardAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  let employee: HrEmployeeView;
  try {
    employee = await apiFetch<HrEmployeeView>(`/api/hr/offers/${text(formData, 'offerId')}/onboard`, {
      method: 'POST',
      body: { idempotencyKey: text(formData, 'idempotencyKey') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  redirect(`/hr/employees/${employee.id}`);
}

export async function createLeaveAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    await apiFetch<HrLeaveRequestView>('/api/hr/leave', {
      method: 'POST',
      body: omitBlank({
        employeeId: text(formData, 'employeeId'),
        typeKey: text(formData, 'typeKey'),
        startsOn: text(formData, 'startsOn'),
        endsOn: text(formData, 'endsOn'),
        reason: optional(formData, 'reason'),
        idempotencyKey: text(formData, 'idempotencyKey'),
      }),
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  return { status: 'ok', message: 'Leave submitted for HR approval.' };
}

export async function cancelLeaveAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    await apiFetch(`/api/hr/leave/${text(formData, 'id')}/cancel`, {
      method: 'POST',
      body: { reason: text(formData, 'reason'), rowVersion: Number(text(formData, 'rowVersion')) },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  return { status: 'ok', message: 'Leave cancelled.' };
}

export async function recordAttendanceAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch('/api/hr/attendance', {
      method: 'POST',
      body: omitBlank({
        employeeId: text(formData, 'employeeId'),
        workDate: text(formData, 'workDate'),
        kind: text(formData, 'kind'),
        minutesLate: Number(text(formData, 'minutesLate') || '0'),
        hoursWorked: optional(formData, 'hoursWorked') ? Number(text(formData, 'hoursWorked')) : null,
        notes: optional(formData, 'notes'),
      }),
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  return { status: 'ok', message: 'Attendance recorded.' };
}

export async function importAttendanceAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch('/api/hr/attendance/import', {
      method: 'POST',
      body: { fileName: text(formData, 'fileName') || 'import.csv', csv: text(formData, 'csv') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  return { status: 'ok', message: 'Attendance sheet imported.' };
}

export async function createOvertimeAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch('/api/hr/overtime', {
      method: 'POST',
      body: omitBlank({
        employeeId: text(formData, 'employeeId'),
        workDate: text(formData, 'workDate'),
        hours: Number(text(formData, 'hours')),
        reason: optional(formData, 'reason'),
      }),
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  return { status: 'ok', message: 'Overtime submitted for approval.' };
}

export async function createCycleAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    await apiFetch('/api/hr/cycles', {
      method: 'POST',
      body: {
        name: text(formData, 'name'),
        startsOn: text(formData, 'startsOn'),
        endsOn: text(formData, 'endsOn'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  return { status: 'ok', message: 'Review cycle opened.' };
}

export async function createAppraisalAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/hr/cycles/${text(formData, 'cycleId')}/appraisals`, {
      method: 'POST',
      body: omitBlank({
        employeeId: text(formData, 'employeeId'),
        rating: optional(formData, 'rating'),
        summary: optional(formData, 'summary'),
      }),
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  return { status: 'ok', message: 'Appraisal submitted.' };
}

export async function createDisciplinaryAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let created: { id: string };
  try {
    created = await apiFetch<{ id: string }>('/api/hr/disciplinary', {
      method: 'POST',
      body: omitBlank({
        employeeId: text(formData, 'employeeId'),
        category: text(formData, 'category'),
        incidentOn: text(formData, 'incidentOn'),
        description: text(formData, 'description'),
        idempotencyKey: text(formData, 'idempotencyKey'),
      }),
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  redirect(`/hr/disciplinary/${created.id}`);
}

export async function recommendDisciplinaryAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/hr/disciplinary/${text(formData, 'id')}/recommend`, {
      method: 'POST',
      body: {
        outcome: text(formData, 'outcome'),
        body: text(formData, 'body'),
        rowVersion: Number(text(formData, 'rowVersion')),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/hr/disciplinary/${text(formData, 'id')}`);
  return { status: 'ok', message: 'Recommendation recorded.' };
}

export async function reopenDisciplinaryAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/hr/disciplinary/${text(formData, 'id')}/reopen`, {
      method: 'POST',
      body: { reason: text(formData, 'reason'), rowVersion: Number(text(formData, 'rowVersion')) },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/hr/disciplinary/${text(formData, 'id')}`);
  return { status: 'ok', message: 'Case reopened. Prior events remain.' };
}

export async function createTrainingAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let created: HrTrainingView;
  try {
    created = await apiFetch<HrTrainingView>('/api/hr/training', {
      method: 'POST',
      body: omitBlank({
        entityId: text(formData, 'entityId'),
        title: text(formData, 'title'),
        category: optional(formData, 'category'),
        startsOn: optional(formData, 'startsOn'),
        estimatedCostKobo: optional(formData, 'estimatedCostKobo')
          ? Number(text(formData, 'estimatedCostKobo'))
          : null,
        participantIds: formData.getAll('participantIds').map(String).filter(Boolean),
        idempotencyKey: text(formData, 'idempotencyKey'),
      }),
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  redirect(`/hr/training/${created.id}`);
}

export async function sendTrainingFinanceAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/hr/training/${text(formData, 'id')}/finance`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')) },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/hr/training/${text(formData, 'id')}`);
  return { status: 'ok', message: 'Sent to Finance on expense-v1.' };
}

export async function trainingAttendanceAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/hr/training/${text(formData, 'id')}/attendance`, {
      method: 'POST',
      body: omitBlank({
        employeeId: text(formData, 'employeeId'),
        attendance: text(formData, 'attendance'),
        completed: text(formData, 'completed') === 'on',
      }),
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/hr/training/${text(formData, 'id')}`);
  return { status: 'ok', message: 'Participant record updated.' };
}

export async function approveWorkflowAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/workflows/${text(formData, 'workflowId')}/actions`, {
      method: 'POST',
      body: omitBlank({
        action: text(formData, 'action') || 'APPROVE',
        reason: optional(formData, 'reason'),
        idempotencyKey: text(formData, 'idempotencyKey'),
      }),
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateHr();
  return { status: 'ok', message: 'Workflow action recorded.' };
}
