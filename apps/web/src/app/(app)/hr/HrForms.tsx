'use client';

import { useActionState } from 'react';
import { IDLE_ACTION_RESULT } from '@/lib/action-result';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import {
  addApplicantAction,
  createAppraisalAction,
  createChangeAction,
  createCycleAction,
  createDisciplinaryAction,
  createEmployeeAction,
  createLeaveAction,
  createOfferAction,
  createOvertimeAction,
  createPositionAction,
  createTrainingAction,
  createUnitAction,
  createVacancyAction,
  importAttendanceAction,
  onboardAction,
  recommendDisciplinaryAction,
  recordAttendanceAction,
  sendTrainingFinanceAction,
  trainingAttendanceAction,
} from './actions';

type Option = { value: string; label: string };

function IdempotencyField() {
  return (
    <input
      type="hidden"
      name="idempotencyKey"
      defaultValue={`hr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}
    />
  );
}

export function EmployeeCreateForm({
  entities,
  departments,
  units,
  positions,
}: {
  entities: Option[];
  departments: Option[];
  units: Option[];
  positions: Option[];
}) {
  const [state, formAction] = useActionState(createEmployeeAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-3">
      {state.status === 'error' ? (
        <ErrorState title="Employee was not created" message={state.message} requestId={state.requestId} />
      ) : null}
      <IdempotencyField />
      <SelectField label="Subsidiary" name="entityId" required options={entities} placeholder="Choose" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextField label="First name" name="firstName" required />
        <TextField label="Last name" name="lastName" required />
      </div>
      <SelectField label="Department" name="departmentId" options={departments} placeholder="Optional" />
      <SelectField label="Unit" name="unitId" options={units} placeholder="Optional" />
      <SelectField label="Position" name="positionId" options={positions} placeholder="Optional" />
      <SelectField
        label="Employment type"
        name="employmentType"
        options={[
          { value: 'PERMANENT', label: 'Permanent' },
          { value: 'CONTRACT', label: 'Contract' },
          { value: 'TEMP', label: 'Temporary' },
          { value: 'INTERN', label: 'Intern' },
        ]}
      />
      <TextField label="Date employed" name="dateEmployed" type="date" />
      <TextField label="Work email" name="workEmail" type="email" />
      <TextField label="Personal email" name="personalEmail" type="email" />
      <TextField label="Bank name" name="bankName" />
      <TextField label="Bank account" name="bankAccountNumber" />
      <TextField label="Salary (kobo)" name="salaryKobo" inputMode="numeric" />
      <Button type="submit" variant="primary">
        Create employee
      </Button>
    </form>
  );
}

export function UnitForm({ entities, departments }: { entities: Option[]; departments: Option[] }) {
  const [state, formAction] = useActionState(createUnitAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      {state.status === 'error' ? <ErrorState title="Unit not created" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <SelectField label="Subsidiary" name="entityId" required options={entities} />
      <SelectField label="Department" name="departmentId" required options={departments} />
      <TextField label="Unit name" name="name" required />
      <Button type="submit" size="sm">
        Add unit
      </Button>
    </form>
  );
}

export function PositionForm({ entities, departments }: { entities: Option[]; departments: Option[] }) {
  const [state, formAction] = useActionState(createPositionAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      {state.status === 'error' ? <ErrorState title="Position not created" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <SelectField label="Subsidiary" name="entityId" required options={entities} />
      <SelectField label="Department" name="departmentId" options={departments} placeholder="Optional" />
      <TextField label="Title" name="title" required />
      <TextField label="Grade" name="grade" />
      <Button type="submit" size="sm">
        Add position
      </Button>
    </form>
  );
}

export function ChangeForm({
  employeeId,
  departments,
  units,
  positions,
}: {
  employeeId: string;
  departments: Option[];
  units: Option[];
  positions: Option[];
}) {
  const [state, formAction] = useActionState(createChangeAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <IdempotencyField />
      {state.status === 'error' ? <ErrorState title="Change not submitted" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <SelectField
        label="Kind"
        name="kind"
        required
        options={[
          { value: 'TRANSFER', label: 'Transfer' },
          { value: 'PROMOTION', label: 'Promotion' },
          { value: 'CONFIRMATION', label: 'Confirmation' },
          { value: 'DEPARTMENT_CHANGE', label: 'Department change' },
          { value: 'UNIT_CHANGE', label: 'Unit change' },
          { value: 'TERMINATION', label: 'Termination' },
          { value: 'RESIGNATION', label: 'Resignation' },
        ]}
      />
      <TextField label="Effective on" name="effectiveOn" type="date" required />
      <SelectField label="To department" name="toDepartmentId" options={departments} placeholder="Unchanged" />
      <SelectField label="To unit" name="toUnitId" options={units} placeholder="Unchanged" />
      <SelectField label="To position" name="toPositionId" options={positions} placeholder="Unchanged" />
      <TextAreaField label="Reason" name="reason" required rows={3} />
      <Button type="submit" size="sm">
        Submit change
      </Button>
    </form>
  );
}

export function VacancyForm({
  entities,
  departments,
  units,
  positions,
}: {
  entities: Option[];
  departments: Option[];
  units: Option[];
  positions: Option[];
}) {
  const [state, formAction] = useActionState(createVacancyAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      <IdempotencyField />
      {state.status === 'error' ? <ErrorState title="Vacancy not created" message={state.message} /> : null}
      <SelectField label="Subsidiary" name="entityId" required options={entities} />
      <TextField label="Title" name="title" required />
      <SelectField label="Department" name="departmentId" options={departments} placeholder="Optional" />
      <SelectField label="Unit" name="unitId" options={units} placeholder="Optional" />
      <SelectField label="Position" name="positionId" options={positions} placeholder="Optional" />
      <TextAreaField label="Notes" name="body" rows={3} />
      <Button type="submit" variant="primary">
        Submit vacancy
      </Button>
    </form>
  );
}

export function ApplicantForm({ vacancyId }: { vacancyId: string }) {
  const [state, formAction] = useActionState(addApplicantAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="vacancyId" value={vacancyId} />
      {state.status === 'error' ? <ErrorState title="Applicant not saved" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <TextField label="Name" name="name" required />
      <TextField label="Email" name="email" type="email" />
      <Button type="submit" size="sm">
        Add applicant
      </Button>
    </form>
  );
}

export function OfferForm({ vacancyId, applicants }: { vacancyId: string; applicants: Option[] }) {
  const [state, formAction] = useActionState(createOfferAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="vacancyId" value={vacancyId} />
      {state.status === 'error' ? <ErrorState title="Offer not created" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <SelectField label="Applicant" name="applicantId" required options={applicants} />
      <TextField label="Salary (kobo)" name="salaryKobo" inputMode="numeric" />
      <TextField label="Starts on" name="startsOn" type="date" />
      <Button type="submit" size="sm">
        Submit offer
      </Button>
    </form>
  );
}

export function OnboardForm({ offerId }: { offerId: string }) {
  const [state, formAction] = useActionState(onboardAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="offerId" value={offerId} />
      <IdempotencyField />
      {state.status === 'error' ? <ErrorState title="Onboarding failed" message={state.message} /> : null}
      <Button type="submit" variant="primary" size="sm">
        Create employee record
      </Button>
    </form>
  );
}

export function LeaveForm({ employees, types }: { employees: Option[]; types: Option[] }) {
  const [state, formAction] = useActionState(createLeaveAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      <IdempotencyField />
      {state.status === 'error' ? <ErrorState title="Leave not submitted" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <SelectField label="Employee" name="employeeId" required options={employees} />
      <SelectField label="Type" name="typeKey" required options={types} />
      <TextField label="Starts" name="startsOn" type="date" required />
      <TextField label="Ends" name="endsOn" type="date" required />
      <TextAreaField label="Reason" name="reason" rows={2} />
      <Button type="submit" size="sm">
        Request leave
      </Button>
    </form>
  );
}

export function AttendanceForm({ employees }: { employees: Option[] }) {
  const [state, formAction] = useActionState(recordAttendanceAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      {state.status === 'error' ? <ErrorState title="Attendance not saved" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <SelectField label="Employee" name="employeeId" required options={employees} />
      <TextField label="Date" name="workDate" type="date" required />
      <SelectField
        label="Kind"
        name="kind"
        options={[
          { value: 'PRESENT', label: 'Present' },
          { value: 'LATE', label: 'Late' },
          { value: 'ABSENT', label: 'Absent' },
          { value: 'LEAVE', label: 'Leave' },
          { value: 'HOLIDAY', label: 'Holiday' },
        ]}
      />
      <TextField label="Hours worked" name="hoursWorked" />
      <TextField label="Minutes late" name="minutesLate" />
      <Button type="submit" size="sm">
        Record
      </Button>
    </form>
  );
}

export function ImportForm() {
  const [state, formAction] = useActionState(importAttendanceAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      {state.status === 'error' ? <ErrorState title="Import failed" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <TextField label="File name" name="fileName" defaultValue="attendance.csv" />
      <TextAreaField
        label="CSV"
        name="csv"
        rows={6}
        hint="employeeRef,workDate,kind,hoursWorked,minutesLate"
      />
      <Button type="submit" size="sm">
        Import CSV
      </Button>
    </form>
  );
}

export function OvertimeForm({ employees }: { employees: Option[] }) {
  const [state, formAction] = useActionState(createOvertimeAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      {state.status === 'error' ? <ErrorState title="Overtime not submitted" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <SelectField label="Employee" name="employeeId" required options={employees} />
      <TextField label="Date" name="workDate" type="date" required />
      <TextField label="Hours" name="hours" required />
      <TextAreaField label="Reason" name="reason" rows={2} />
      <Button type="submit" size="sm">
        Submit overtime
      </Button>
    </form>
  );
}

export function RecommendForm({ id, rowVersion }: { id: string; rowVersion: number }) {
  const [state, formAction] = useActionState(recommendDisciplinaryAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="rowVersion" value={rowVersion} />
      {state.status === 'error' ? <ErrorState title="Recommendation failed" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <SelectField
        label="Outcome"
        name="outcome"
        required
        options={[
          { value: 'NO_CASE_TO_ANSWER', label: 'No case to answer' },
          { value: 'ADVISORY', label: 'Advisory' },
          { value: 'WRITTEN_WARNING', label: 'Written warning' },
          { value: 'FURTHER_TRAINING', label: 'Further training' },
          { value: 'SUSPENSION', label: 'Suspension' },
          { value: 'OTHER', label: 'Other' },
          { value: 'REFERRAL', label: 'Referral' },
        ]}
      />
      <TextAreaField label="Recommendation" name="body" required rows={3} />
      <Button type="submit" size="sm">
        Record recommendation
      </Button>
    </form>
  );
}

export function TrainingForm({ entities, employees }: { entities: Option[]; employees: Option[] }) {
  const [state, formAction] = useActionState(createTrainingAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      <IdempotencyField />
      {state.status === 'error' ? <ErrorState title="Training not created" message={state.message} /> : null}
      <SelectField label="Subsidiary" name="entityId" required options={entities} />
      <TextField label="Title" name="title" required />
      <TextField label="Starts on" name="startsOn" type="date" />
      <TextField label="Estimated cost (kobo)" name="estimatedCostKobo" />
      <SelectField label="Participants" name="participantIds" options={employees} multiple />
      <Button type="submit" variant="primary">
        Create session
      </Button>
    </form>
  );
}

export function SendFinanceForm({ id, rowVersion }: { id: string; rowVersion: number }) {
  const [state, formAction] = useActionState(sendTrainingFinanceAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="rowVersion" value={rowVersion} />
      {state.status === 'error' ? <ErrorState title="Not sent" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <Button type="submit" size="sm">
        Send cost to Finance
      </Button>
    </form>
  );
}

export function CycleForm() {
  const [state, formAction] = useActionState(createCycleAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      {state.status === 'error' ? <ErrorState title="Cycle not opened" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <TextField label="Name" name="name" required />
      <TextField label="Starts" name="startsOn" type="date" required />
      <TextField label="Ends" name="endsOn" type="date" required />
      <Button type="submit" size="sm">
        Open cycle
      </Button>
    </form>
  );
}

export function AppraisalForm({ cycles, employees }: { cycles: Option[]; employees: Option[] }) {
  const [state, formAction] = useActionState(createAppraisalAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      {state.status === 'error' ? <ErrorState title="Appraisal not submitted" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <SelectField label="Cycle" name="cycleId" required options={cycles} />
      <SelectField label="Employee" name="employeeId" required options={employees} />
      <TextField label="Rating" name="rating" />
      <TextAreaField label="Summary" name="summary" rows={3} />
      <Button type="submit" size="sm">
        Submit appraisal
      </Button>
    </form>
  );
}

export function DisciplinaryForm({ employees }: { employees: Option[] }) {
  const [state, formAction] = useActionState(createDisciplinaryAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      <IdempotencyField />
      {state.status === 'error' ? <ErrorState title="Case not opened" message={state.message} /> : null}
      <SelectField label="Employee" name="employeeId" required options={employees} />
      <TextField label="Category" name="category" required />
      <TextField label="Incident on" name="incidentOn" type="date" required />
      <TextAreaField label="Description" name="description" required rows={4} />
      <Button type="submit" variant="primary">
        Open case
      </Button>
    </form>
  );
}

export function ParticipantForm({ id, employees }: { id: string; employees: Option[] }) {
  const [state, formAction] = useActionState(trainingAttendanceAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      {state.status === 'error' ? <ErrorState title="Not updated" message={state.message} /> : null}
      {state.status === 'ok' ? <p className="text-[13px]">{state.message}</p> : null}
      <SelectField label="Employee" name="employeeId" required options={employees} />
      <SelectField
        label="Attendance"
        name="attendance"
        options={[
          { value: 'PRESENT', label: 'Present' },
          { value: 'ABSENT', label: 'Absent' },
          { value: 'COMPLETED', label: 'Completed' },
        ]}
      />
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" name="completed" /> Completed
      </label>
      <Button type="submit" size="sm">
        Update participant
      </Button>
    </form>
  );
}
