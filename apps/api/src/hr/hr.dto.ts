import { z } from 'zod';
import {
  HR_ATTENDANCE_KINDS,
  HR_CHANGE_KINDS,
  HR_DISC_OUTCOMES,
  HR_DISC_STATUSES,
  HR_EMPLOYEE_STATUSES,
  HR_EMPLOYMENT_TYPES,
} from '@nfc/shared';

const uuid = z.string().uuid();
const idempotency = z.string().trim().min(8).max(80);
const date = z.string().trim().min(8).max(10);
const reason = z.string().trim().min(1).max(2000);

export const createUnitSchema = z.object({
  entityId: uuid,
  departmentId: uuid,
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().max(20).optional().nullable(),
});
export type CreateUnitInput = z.infer<typeof createUnitSchema>;

export const createPositionSchema = z.object({
  entityId: uuid,
  departmentId: uuid.optional().nullable(),
  title: z.string().trim().min(1).max(160),
  grade: z.string().trim().max(40).optional().nullable(),
});
export type CreatePositionInput = z.infer<typeof createPositionSchema>;

export const statusChangeSchema = z.object({
  reason: reason,
  rowVersion: z.number().int().positive(),
});
export type StatusChangeInput = z.infer<typeof statusChangeSchema>;

export const createEmployeeSchema = z.object({
  entityId: uuid,
  departmentId: uuid.optional().nullable(),
  unitId: uuid.optional().nullable(),
  positionId: uuid.optional().nullable(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  otherNames: z.string().trim().max(80).optional().nullable(),
  gender: z.string().trim().max(40).optional().nullable(),
  employmentType: z.enum(HR_EMPLOYMENT_TYPES).optional(),
  grade: z.string().trim().max(40).optional().nullable(),
  dateEmployed: date.optional().nullable(),
  status: z.enum(HR_EMPLOYEE_STATUSES).optional(),
  reportingManagerId: uuid.optional().nullable(),
  workEmail: z.string().trim().email().max(160).optional().nullable(),
  workPhone: z.string().trim().max(40).optional().nullable(),
  personalEmail: z.string().trim().email().max(160).optional().nullable(),
  personalPhone: z.string().trim().max(40).optional().nullable(),
  emergencyName: z.string().trim().max(120).optional().nullable(),
  emergencyPhone: z.string().trim().max(40).optional().nullable(),
  bankName: z.string().trim().max(120).optional().nullable(),
  bankAccountName: z.string().trim().max(120).optional().nullable(),
  bankAccountNumber: z.string().trim().max(40).optional().nullable(),
  salaryKobo: z.number().int().nonnegative().optional().nullable(),
  idempotencyKey: idempotency,
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = createEmployeeSchema
  .omit({ entityId: true, idempotencyKey: true })
  .partial()
  .extend({ rowVersion: z.number().int().positive() });
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const createChangeSchema = z.object({
  employeeId: uuid,
  kind: z.enum(HR_CHANGE_KINDS),
  effectiveOn: date,
  reason: reason,
  toDepartmentId: uuid.optional().nullable(),
  toUnitId: uuid.optional().nullable(),
  toPositionId: uuid.optional().nullable(),
  idempotencyKey: idempotency,
});
export type CreateChangeInput = z.infer<typeof createChangeSchema>;

export const createVacancySchema = z.object({
  entityId: uuid,
  departmentId: uuid.optional().nullable(),
  unitId: uuid.optional().nullable(),
  positionId: uuid.optional().nullable(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(8000).optional().nullable(),
  headcount: z.number().int().positive().optional(),
  idempotencyKey: idempotency,
});
export type CreateVacancyInput = z.infer<typeof createVacancySchema>;

export const createApplicantSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(160).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});
export type CreateApplicantInput = z.infer<typeof createApplicantSchema>;

export const interviewSchema = z.object({
  scheduledAt: z.string().trim().min(10).optional().nullable(),
  score: z.number().min(0).max(100).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});
export type InterviewInput = z.infer<typeof interviewSchema>;

export const createOfferSchema = z.object({
  applicantId: uuid,
  salaryKobo: z.number().int().nonnegative().optional().nullable(),
  startsOn: date.optional().nullable(),
});
export type CreateOfferInput = z.infer<typeof createOfferSchema>;

export const onboardSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  employmentType: z.enum(HR_EMPLOYMENT_TYPES).optional(),
  dateEmployed: date.optional().nullable(),
  idempotencyKey: idempotency,
});
export type OnboardInput = z.infer<typeof onboardSchema>;

export const createLeaveSchema = z.object({
  employeeId: uuid,
  typeKey: z.string().trim().min(1).max(40),
  startsOn: date,
  endsOn: date,
  reason: z.string().trim().max(2000).optional().nullable(),
  reliefEmployeeId: z.string().uuid().optional().nullable(),
  idempotencyKey: idempotency,
});
export type CreateLeaveInput = z.infer<typeof createLeaveSchema>;

export const cancelLeaveSchema = z.object({
  reason: reason,
  rowVersion: z.number().int().positive(),
});
export type CancelLeaveInput = z.infer<typeof cancelLeaveSchema>;

export const createHolidaySchema = z.object({
  name: z.string().trim().min(1).max(120),
  observedOn: date,
  entityId: uuid.optional().nullable(),
});
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;

export const recordAttendanceSchema = z.object({
  employeeId: uuid,
  workDate: date,
  kind: z.enum(HR_ATTENDANCE_KINDS),
  minutesLate: z.number().int().nonnegative().optional(),
  hoursWorked: z.number().min(0).max(24).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});
export type RecordAttendanceInput = z.infer<typeof recordAttendanceSchema>;

export const importAttendanceSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  csv: z.string().min(1).max(2_000_000),
});
export type ImportAttendanceInput = z.infer<typeof importAttendanceSchema>;

export const createOvertimeSchema = z.object({
  employeeId: uuid,
  workDate: date,
  hours: z.number().positive().max(24),
  reason: z.string().trim().max(2000).optional().nullable(),
});
export type CreateOvertimeInput = z.infer<typeof createOvertimeSchema>;

export const createCycleSchema = z.object({
  name: z.string().trim().min(1).max(160),
  startsOn: date,
  endsOn: date,
});
export type CreateCycleInput = z.infer<typeof createCycleSchema>;

export const createObjectiveSchema = z.object({
  employeeId: uuid,
  title: z.string().trim().min(1).max(240),
  notes: z.string().trim().max(4000).optional().nullable(),
});
export type CreateObjectiveInput = z.infer<typeof createObjectiveSchema>;

export const createAppraisalSchema = z.object({
  employeeId: uuid,
  rating: z.string().trim().max(40).optional().nullable(),
  summary: z.string().trim().max(8000).optional().nullable(),
});
export type CreateAppraisalInput = z.infer<typeof createAppraisalSchema>;

export const createDisciplinarySchema = z.object({
  employeeId: uuid,
  category: z.string().trim().min(1).max(80),
  incidentOn: date,
  reportedOn: date.optional(),
  description: z.string().trim().min(1).max(8000),
  idempotencyKey: idempotency,
});
export type CreateDisciplinaryInput = z.infer<typeof createDisciplinarySchema>;

export const discEventSchema = z.object({
  kind: z.string().trim().min(1).max(40),
  body: z.string().trim().min(1).max(8000),
});
export type DiscEventInput = z.infer<typeof discEventSchema>;

export const discRecommendSchema = z.object({
  outcome: z.enum(HR_DISC_OUTCOMES),
  body: z.string().trim().min(1).max(8000),
  rowVersion: z.number().int().positive(),
});
export type DiscRecommendInput = z.infer<typeof discRecommendSchema>;

export const discAdvanceSchema = z.object({
  status: z.enum(HR_DISC_STATUSES).optional(),
  rowVersion: z.number().int().positive(),
});
export type DiscAdvanceInput = z.infer<typeof discAdvanceSchema>;

export const discReopenSchema = z.object({
  reason: reason,
  rowVersion: z.number().int().positive(),
});
export type DiscReopenInput = z.infer<typeof discReopenSchema>;

export const createTrainingSchema = z.object({
  entityId: uuid,
  departmentId: uuid.optional().nullable(),
  unitId: uuid.optional().nullable(),
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().max(80).optional(),
  description: z.string().trim().max(8000).optional().nullable(),
  provider: z.string().trim().max(160).optional().nullable(),
  internal: z.boolean().optional(),
  startsOn: date.optional().nullable(),
  endsOn: date.optional().nullable(),
  estimatedCostKobo: z.number().int().nonnegative().optional().nullable(),
  participantIds: z.array(uuid).max(200).optional(),
  idempotencyKey: idempotency,
});
export type CreateTrainingInput = z.infer<typeof createTrainingSchema>;

export const trainingParticipantsSchema = z.object({
  employeeIds: z.array(uuid).min(1).max(200),
});
export type TrainingParticipantsInput = z.infer<typeof trainingParticipantsSchema>;

export const trainingAttendanceSchema = z.object({
  employeeId: uuid,
  attendance: z.string().trim().min(1).max(40),
  completed: z.boolean().optional(),
  assessment: z.string().trim().max(2000).optional().nullable(),
  hours: z.number().min(0).max(400).optional().nullable(),
  certificateExpiresOn: date.optional().nullable(),
});
export type TrainingAttendanceInput = z.infer<typeof trainingAttendanceSchema>;

export const rowVersionSchema = z.object({
  rowVersion: z.number().int().positive(),
});
export type RowVersionInput = z.infer<typeof rowVersionSchema>;
