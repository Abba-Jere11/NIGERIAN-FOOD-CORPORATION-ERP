-- ---------------------------------------------------------------------------
-- 0046_hr
--
-- People system: org units and positions, employees, recruitment, leave,
-- attendance, performance, confidential disciplinary cases, training.
-- HR Officer is corporate and holds hr.* except disciplinary.approve (MD).
-- Administrator holds none of these keys.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.next_reference(p_kind text, p_year integer DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_kind text;
  v_year integer;
  v_next integer;
  v_allowed text[] := ARRAY[
    'PR','PAY','TRF','GRN','INV','EMP','DOC','SEAL','JNL','BUD','VND','CUS','SO','PRD','PRL','LV','VAC',
    'ICT','ARI','BILL','INC','EXP','RCT','RPT','CASE','IST','ITR','IAD','CNT','DSP','SRN',
    'ORG','MIN','RSP','DEC','DISC','TRN'
  ];
BEGIN
  v_kind := upper(btrim(p_kind));
  IF v_kind IS NULL OR v_kind = '' THEN
    RAISE EXCEPTION 'A reference kind is required.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_kind = ANY (v_allowed) THEN
    RAISE EXCEPTION 'Unknown reference kind "%".', v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_kind = 'VND' THEN
    v_year := 0;
  ELSIF p_year IS NULL OR p_year = 0 THEN
    v_year := EXTRACT(YEAR FROM timezone('Africa/Lagos', clock_timestamp()))::integer;
  ELSE
    v_year := p_year;
  END IF;

  INSERT INTO reference_counters (kind, year, last_value)
  VALUES (v_kind, v_year, 0)
  ON CONFLICT (kind, year) DO NOTHING;

  SELECT last_value INTO v_next
    FROM reference_counters
   WHERE kind = v_kind AND year = v_year
   FOR UPDATE;

  IF v_kind IN ('PR', 'GRN') THEN
    v_next := GREATEST(v_next, app.existing_max_reference(v_kind, v_year));
  END IF;

  v_next := v_next + 1;

  UPDATE reference_counters
     SET last_value = v_next,
         updated_at = clock_timestamp()
   WHERE kind = v_kind AND year = v_year;

  IF v_kind = 'VND' THEN
    RETURN v_kind || '-' || lpad(v_next::text, 6, '0');
  END IF;
  RETURN v_kind || '-' || v_year::text || '-' || lpad(v_next::text, 6, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION app.next_reference(text, integer) TO nfc_app;


INSERT INTO permissions (key, description, created_by) VALUES
  ('hr.employee.view', 'View non-sensitive employee records across granted entities.', 'system:seed'),
  ('hr.view_sensitive', 'View bank, personal contact and pay fields on an employee record.', 'system:seed'),
  ('hr.employee.manage', 'Create and update employee master records.', 'system:seed'),
  ('hr.org.manage', 'Create, edit and deactivate departments, units and positions for HR.', 'system:seed'),
  ('hr.recruitment.manage', 'Manage vacancies, applicants, interviews, offers and onboarding.', 'system:seed'),
  ('hr.change.approve', 'Approve an HR change, vacancy or offer.', 'system:seed'),
  ('hr.leave.approve', 'Approve or refuse a leave request.', 'system:seed'),
  ('hr.attendance.manage', 'Record attendance, import sheets and approve overtime.', 'system:seed'),
  ('hr.performance.manage', 'Run review cycles, objectives and appraisals.', 'system:seed'),
  ('hr.documents.manage', 'Attach and version employee documents in EDMS.', 'system:seed'),
  ('hr.disciplinary.view', 'View disciplinary cases the actor is allowed to see.', 'system:seed'),
  ('hr.disciplinary.manage', 'Open and carry a disciplinary case through investigation.', 'system:seed'),
  ('hr.disciplinary.investigate', 'Record investigation findings, statements and hearings.', 'system:seed'),
  ('hr.disciplinary.approve', 'Approve a suspension or more serious disciplinary outcome (MD).', 'system:seed'),
  ('hr.disciplinary.close', 'Close a disciplinary case.', 'system:seed'),
  ('hr.training.view', 'View training sessions and participant records.', 'system:seed'),
  ('hr.training.manage', 'Create training sessions and record attendance and completion.', 'system:seed'),
  ('hr.training.approve', 'Send a costed training session to Finance for expense approval.', 'system:seed'),
  ('hr.training.report', 'View training cost and expenditure figures.', 'system:seed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO roles (key, name, short_name, scope_type, home_path, description, created_by, updated_by)
VALUES (
  'hr_officer',
  'HR Officer',
  'HR Officer',
  'CORPORATE',
  '/home/hr',
  'Manages the employee lifecycle across all subsidiaries: records, recruitment, leave, attendance, performance, disciplinary cases and training. Not a line-manager role.',
  'system:seed',
  'system:seed'
)
ON CONFLICT (key) DO NOTHING;

SET session_replication_role = replica;
INSERT INTO role_permissions (role_id, permission_key, created_by)
SELECT r.id, k.key, 'system:seed'
  FROM roles r
  JOIN (VALUES
    ('hr_officer', 'hr.employee.view'),
    ('hr_officer', 'hr.view_sensitive'),
    ('hr_officer', 'hr.employee.manage'),
    ('hr_officer', 'hr.org.manage'),
    ('hr_officer', 'hr.recruitment.manage'),
    ('hr_officer', 'hr.change.approve'),
    ('hr_officer', 'hr.leave.approve'),
    ('hr_officer', 'hr.attendance.manage'),
    ('hr_officer', 'hr.performance.manage'),
    ('hr_officer', 'hr.documents.manage'),
    ('hr_officer', 'hr.disciplinary.view'),
    ('hr_officer', 'hr.disciplinary.manage'),
    ('hr_officer', 'hr.disciplinary.investigate'),
    ('hr_officer', 'hr.disciplinary.close'),
    ('hr_officer', 'hr.training.view'),
    ('hr_officer', 'hr.training.manage'),
    ('hr_officer', 'hr.training.approve'),
    ('hr_officer', 'hr.training.report'),
    ('hr_officer', 'organization.view'),
    ('hr_officer', 'document.upload'),
    ('hr_officer', 'document.view'),
    ('hr_officer', 'document.view_history'),
    ('hr_officer', 'document.replace'),
    ('hr_officer', 'edms.portal.access'),
    ('hr_officer', 'edms.view'),
    ('hr_officer', 'edms.upload'),
    ('hr_officer', 'edms.version.replace'),
    ('md', 'hr.disciplinary.approve')
  ) AS k(role_key, key) ON k.role_key = r.key::text
ON CONFLICT DO NOTHING;
SET session_replication_role = DEFAULT;

UPDATE sensitive_fields
   SET permission_key = 'hr.view_sensitive',
       description = 'Employee salary, bank and personal contact fields.'
 WHERE field_key = 'hr.salary';

UPDATE org_report_templates
   SET required_permission = 'hr.view_sensitive'
 WHERE required_permission = 'hr.salary.view';

INSERT INTO expense_categories (key, name, account_code, created_by, updated_by) VALUES
  ('training', 'Training and development', '5220', 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;


CREATE TABLE org_units (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid NOT NULL REFERENCES entities (id),
  department_id   uuid NOT NULL REFERENCES departments (id),
  name            text NOT NULL,
  code            text,
  status          record_status NOT NULL DEFAULT 'ACTIVE',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL,
  row_version     integer NOT NULL DEFAULT 1,
  CONSTRAINT org_units_name_not_blank CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX org_units_department_name_key ON org_units (department_id, lower(name));

SELECT app.add_row_version_trigger('org_units');
SELECT app.forbid_hard_delete('org_units');
SELECT app.grant_mutable_table('org_units');
ALTER TABLE org_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_units_select ON org_units FOR SELECT TO nfc_app
  USING ((app.has_permission('hr.employee.view') OR app.has_permission('hr.org.manage') OR app.has_permission('organization.department.manage')) AND app.can_access_entity(entity_id));
CREATE POLICY org_units_write ON org_units FOR ALL TO nfc_app
  USING ((app.has_permission('hr.org.manage') OR app.has_permission('organization.department.manage')) AND app.can_access_entity(entity_id))
  WITH CHECK ((app.has_permission('hr.org.manage') OR app.has_permission('organization.department.manage')) AND app.can_access_entity(entity_id));


CREATE TABLE hr_positions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid NOT NULL REFERENCES entities (id),
  department_id   uuid REFERENCES departments (id),
  title           text NOT NULL,
  grade           text,
  status          record_status NOT NULL DEFAULT 'ACTIVE',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL,
  row_version     integer NOT NULL DEFAULT 1,
  CONSTRAINT hr_positions_title_not_blank CHECK (btrim(title) <> '')
);

SELECT app.add_row_version_trigger('hr_positions');
SELECT app.forbid_hard_delete('hr_positions');
SELECT app.grant_mutable_table('hr_positions');
ALTER TABLE hr_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_positions_select ON hr_positions FOR SELECT TO nfc_app
  USING ((app.has_permission('hr.employee.view') OR app.has_permission('hr.org.manage')) AND app.can_access_entity(entity_id));
CREATE POLICY hr_positions_write ON hr_positions FOR ALL TO nfc_app
  USING (app.has_permission('hr.org.manage') AND app.can_access_entity(entity_id))
  WITH CHECK (app.has_permission('hr.org.manage') AND app.can_access_entity(entity_id));


CREATE TABLE hr_employees (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number           text NOT NULL UNIQUE,
  entity_id                  uuid NOT NULL REFERENCES entities (id),
  department_id              uuid REFERENCES departments (id),
  unit_id                    uuid REFERENCES org_units (id),
  position_id                uuid REFERENCES hr_positions (id),
  first_name                 text NOT NULL,
  last_name                  text NOT NULL,
  other_names                text,
  gender                     text,
  employment_type            text NOT NULL DEFAULT 'PERMANENT',
  grade                      text,
  date_employed              date,
  status                     text NOT NULL DEFAULT 'ACTIVE',
  reporting_manager_id       uuid REFERENCES hr_employees (id),
  work_email                 text,
  work_phone                 text,
  personal_email             text,
  personal_phone             text,
  emergency_name             text,
  emergency_phone            text,
  bank_name                  text,
  bank_account_name          text,
  bank_account_number        text,
  salary_kobo                bigint,
  photo_document_id          uuid,
  edms_folder_id             uuid,
  idempotency_key            text UNIQUE,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 text NOT NULL,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 text NOT NULL,
  row_version                integer NOT NULL DEFAULT 1,
  CONSTRAINT hr_employees_name_not_blank CHECK (btrim(first_name) <> '' AND btrim(last_name) <> ''),
  CONSTRAINT hr_employees_type CHECK (employment_type IN ('PERMANENT', 'CONTRACT', 'TEMP', 'INTERN')),
  CONSTRAINT hr_employees_status CHECK (status IN ('DRAFT', 'ACTIVE', 'PROBATION', 'CONFIRMED', 'SUSPENDED', 'TERMINATED', 'RESIGNED', 'INACTIVE'))
);

SELECT app.add_row_version_trigger('hr_employees');
SELECT app.forbid_hard_delete('hr_employees');
SELECT app.grant_mutable_table('hr_employees');
ALTER TABLE hr_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_employees_select ON hr_employees FOR SELECT TO nfc_app
  USING (app.has_permission('hr.employee.view') AND app.can_access_entity(entity_id));
CREATE POLICY hr_employees_write ON hr_employees FOR ALL TO nfc_app
  USING (app.has_permission('hr.employee.manage') AND app.can_access_entity(entity_id))
  WITH CHECK (app.has_permission('hr.employee.manage') AND app.can_access_entity(entity_id));


CREATE TABLE hr_employee_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES hr_employees (id),
  entity_id       uuid NOT NULL REFERENCES entities (id),
  department_id   uuid REFERENCES departments (id),
  unit_id         uuid REFERENCES org_units (id),
  position_id     uuid REFERENCES hr_positions (id),
  kind            text NOT NULL,
  effective_on    date NOT NULL,
  ended_on        date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL
);

GRANT SELECT, INSERT, UPDATE ON hr_employee_assignments TO nfc_app;
ALTER TABLE hr_employee_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_employee_assignments_acl ON hr_employee_assignments FOR ALL TO nfc_app
  USING (app.has_permission('hr.employee.view') AND app.can_access_entity(entity_id))
  WITH CHECK (app.has_permission('hr.employee.manage') AND app.can_access_entity(entity_id));


CREATE TABLE hr_employment_changes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           uuid NOT NULL REFERENCES hr_employees (id),
  entity_id             uuid NOT NULL REFERENCES entities (id),
  kind                  text NOT NULL,
  status                text NOT NULL DEFAULT 'DRAFT',
  effective_on          date NOT NULL,
  reason                text NOT NULL,
  from_department_id    uuid,
  to_department_id      uuid,
  from_unit_id          uuid,
  to_unit_id            uuid,
  from_position_id      uuid,
  to_position_id        uuid,
  workflow_instance_id  uuid,
  idempotency_key       text UNIQUE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  row_version           integer NOT NULL DEFAULT 1,
  CONSTRAINT hr_changes_kind CHECK (kind IN ('TRANSFER', 'PROMOTION', 'CONFIRMATION', 'DEPARTMENT_CHANGE', 'UNIT_CHANGE', 'TERMINATION', 'RESIGNATION')),
  CONSTRAINT hr_changes_status CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
  CONSTRAINT hr_changes_reason CHECK (btrim(reason) <> '')
);

SELECT app.add_row_version_trigger('hr_employment_changes');
SELECT app.forbid_hard_delete('hr_employment_changes');
SELECT app.grant_mutable_table('hr_employment_changes');
ALTER TABLE hr_employment_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_employment_changes_acl ON hr_employment_changes FOR ALL TO nfc_app
  USING (app.has_permission('hr.employee.view') AND app.can_access_entity(entity_id))
  WITH CHECK (app.has_permission('hr.employee.manage') AND app.can_access_entity(entity_id));


CREATE TABLE hr_vacancies (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number      text NOT NULL UNIQUE,
  entity_id             uuid NOT NULL REFERENCES entities (id),
  department_id         uuid REFERENCES departments (id),
  unit_id               uuid REFERENCES org_units (id),
  position_id           uuid REFERENCES hr_positions (id),
  title                 text NOT NULL,
  body                  text,
  headcount             integer NOT NULL DEFAULT 1,
  status                text NOT NULL DEFAULT 'DRAFT',
  workflow_instance_id  uuid,
  idempotency_key       text UNIQUE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  row_version           integer NOT NULL DEFAULT 1,
  CONSTRAINT hr_vacancies_title CHECK (btrim(title) <> ''),
  CONSTRAINT hr_vacancies_status CHECK (status IN ('DRAFT', 'SUBMITTED', 'OPEN', 'SHORTLISTING', 'INTERVIEWING', 'OFFER', 'FILLED', 'CANCELLED'))
);

SELECT app.add_row_version_trigger('hr_vacancies');
SELECT app.forbid_hard_delete('hr_vacancies');
SELECT app.grant_mutable_table('hr_vacancies');
ALTER TABLE hr_vacancies ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_vacancies_acl ON hr_vacancies FOR ALL TO nfc_app
  USING (app.has_permission('hr.recruitment.manage') AND app.can_access_entity(entity_id))
  WITH CHECK (app.has_permission('hr.recruitment.manage') AND app.can_access_entity(entity_id));


CREATE TABLE hr_applicants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id      uuid NOT NULL REFERENCES hr_vacancies (id),
  name            text NOT NULL,
  email           text,
  stage           text NOT NULL DEFAULT 'APPLIED',
  score           numeric(6, 2),
  notes           text,
  employee_id     uuid REFERENCES hr_employees (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL,
  row_version     integer NOT NULL DEFAULT 1,
  CONSTRAINT hr_applicants_name CHECK (btrim(name) <> '')
);

SELECT app.add_row_version_trigger('hr_applicants');
SELECT app.forbid_hard_delete('hr_applicants');
SELECT app.grant_mutable_table('hr_applicants');
ALTER TABLE hr_applicants ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_applicants_acl ON hr_applicants FOR ALL TO nfc_app
  USING (app.has_permission('hr.recruitment.manage'));


CREATE TABLE hr_interviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id    uuid NOT NULL REFERENCES hr_applicants (id),
  scheduled_at    timestamptz,
  score           numeric(6, 2),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL
);

SELECT app.apply_append_only_conventions('hr_interviews');
ALTER TABLE hr_interviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_interviews_acl ON hr_interviews FOR ALL TO nfc_app
  USING (app.has_permission('hr.recruitment.manage'));


CREATE TABLE hr_offers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id            uuid NOT NULL REFERENCES hr_vacancies (id),
  applicant_id          uuid NOT NULL REFERENCES hr_applicants (id),
  status                text NOT NULL DEFAULT 'DRAFT',
  salary_kobo           bigint,
  starts_on             date,
  workflow_instance_id  uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  row_version           integer NOT NULL DEFAULT 1,
  CONSTRAINT hr_offers_status CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'ISSUED', 'ACCEPTED', 'DECLINED'))
);

SELECT app.add_row_version_trigger('hr_offers');
SELECT app.forbid_hard_delete('hr_offers');
SELECT app.grant_mutable_table('hr_offers');
ALTER TABLE hr_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_offers_acl ON hr_offers FOR ALL TO nfc_app
  USING (app.has_permission('hr.recruitment.manage'));


CREATE TABLE hr_onboarding_checklists (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id        uuid NOT NULL REFERENCES hr_offers (id),
  employee_id     uuid REFERENCES hr_employees (id),
  items           jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL,
  row_version     integer NOT NULL DEFAULT 1
);

SELECT app.add_row_version_trigger('hr_onboarding_checklists');
SELECT app.forbid_hard_delete('hr_onboarding_checklists');
SELECT app.grant_mutable_table('hr_onboarding_checklists');
ALTER TABLE hr_onboarding_checklists ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_onboarding_acl ON hr_onboarding_checklists FOR ALL TO nfc_app
  USING (app.has_permission('hr.recruitment.manage'));


CREATE TABLE hr_leave_types (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text NOT NULL UNIQUE,
  name            text NOT NULL,
  days_per_year   integer NOT NULL DEFAULT 0,
  paid            boolean NOT NULL DEFAULT true,
  status          record_status NOT NULL DEFAULT 'ACTIVE',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL,
  row_version     integer NOT NULL DEFAULT 1
);

SELECT app.add_row_version_trigger('hr_leave_types');
SELECT app.forbid_hard_delete('hr_leave_types');
SELECT app.grant_mutable_table('hr_leave_types');
ALTER TABLE hr_leave_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_leave_types_select ON hr_leave_types FOR SELECT TO nfc_app
  USING (app.has_permission('hr.employee.view') OR app.has_permission('hr.leave.approve'));
CREATE POLICY hr_leave_types_write ON hr_leave_types FOR ALL TO nfc_app
  USING (app.has_permission('hr.org.manage'))
  WITH CHECK (app.has_permission('hr.org.manage'));

INSERT INTO hr_leave_types (key, name, days_per_year, paid, created_by, updated_by) VALUES
  ('annual', 'Annual leave', 21, true, 'system:seed', 'system:seed'),
  ('sick', 'Sick leave', 10, true, 'system:seed', 'system:seed'),
  ('casual', 'Casual leave', 5, true, 'system:seed', 'system:seed'),
  ('maternity', 'Maternity leave', 84, true, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;


CREATE TABLE hr_leave_entitlements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES hr_employees (id),
  type_id         uuid NOT NULL REFERENCES hr_leave_types (id),
  year            integer NOT NULL,
  days            numeric(6, 2) NOT NULL,
  UNIQUE (employee_id, type_id, year)
);

SELECT app.grant_mutable_table('hr_leave_entitlements');
ALTER TABLE hr_leave_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_leave_entitlements_acl ON hr_leave_entitlements FOR ALL TO nfc_app
  USING (app.has_permission('hr.employee.view') OR app.has_permission('hr.leave.approve'));


CREATE TABLE hr_leave_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number      text NOT NULL UNIQUE,
  employee_id           uuid NOT NULL REFERENCES hr_employees (id),
  entity_id             uuid NOT NULL REFERENCES entities (id),
  type_id               uuid NOT NULL REFERENCES hr_leave_types (id),
  starts_on             date NOT NULL,
  ends_on               date NOT NULL,
  days                  numeric(6, 2) NOT NULL,
  reason                text,
  status                text NOT NULL DEFAULT 'DRAFT',
  cancel_reason         text,
  workflow_instance_id  uuid,
  idempotency_key       text UNIQUE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  row_version           integer NOT NULL DEFAULT 1,
  CONSTRAINT hr_leave_status CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT hr_leave_range CHECK (ends_on >= starts_on)
);

SELECT app.add_row_version_trigger('hr_leave_requests');
SELECT app.forbid_hard_delete('hr_leave_requests');
SELECT app.grant_mutable_table('hr_leave_requests');
ALTER TABLE hr_leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_leave_requests_acl ON hr_leave_requests FOR ALL TO nfc_app
  USING ((app.has_permission('hr.employee.view') OR app.has_permission('hr.leave.approve')) AND app.can_access_entity(entity_id))
  WITH CHECK ((app.has_permission('hr.employee.manage') OR app.has_permission('hr.leave.approve')) AND app.can_access_entity(entity_id));


CREATE TABLE hr_public_holidays (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  observed_on     date NOT NULL,
  entity_id       uuid REFERENCES entities (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  UNIQUE (observed_on, entity_id, name)
);

SELECT app.grant_mutable_table('hr_public_holidays');
ALTER TABLE hr_public_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_public_holidays_acl ON hr_public_holidays FOR ALL TO nfc_app
  USING (app.has_permission('hr.employee.view') OR app.has_permission('hr.org.manage'));

INSERT INTO hr_public_holidays (name, observed_on, created_by) VALUES
  ('New Year''s Day', DATE '2026-01-01', 'system:seed'),
  ('Workers'' Day', DATE '2026-05-01', 'system:seed'),
  ('Independence Day', DATE '2026-10-01', 'system:seed'),
  ('Christmas Day', DATE '2026-12-25', 'system:seed')
ON CONFLICT DO NOTHING;


CREATE TABLE hr_attendance_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES hr_employees (id),
  entity_id       uuid NOT NULL REFERENCES entities (id),
  work_date       date NOT NULL,
  kind            text NOT NULL DEFAULT 'PRESENT',
  minutes_late    integer NOT NULL DEFAULT 0,
  hours_worked    numeric(6, 2),
  notes           text,
  source          text NOT NULL DEFAULT 'MANUAL',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL,
  row_version     integer NOT NULL DEFAULT 1,
  UNIQUE (employee_id, work_date),
  CONSTRAINT hr_attendance_kind CHECK (kind IN ('PRESENT', 'ABSENT', 'LATE', 'LEAVE', 'HOLIDAY'))
);

SELECT app.add_row_version_trigger('hr_attendance_records');
SELECT app.forbid_hard_delete('hr_attendance_records');
SELECT app.grant_mutable_table('hr_attendance_records');
ALTER TABLE hr_attendance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_attendance_acl ON hr_attendance_records FOR ALL TO nfc_app
  USING (app.has_permission('hr.attendance.manage') AND app.can_access_entity(entity_id))
  WITH CHECK (app.has_permission('hr.attendance.manage') AND app.can_access_entity(entity_id));


CREATE TABLE hr_overtime_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           uuid NOT NULL REFERENCES hr_employees (id),
  entity_id             uuid NOT NULL REFERENCES entities (id),
  work_date             date NOT NULL,
  hours                 numeric(6, 2) NOT NULL,
  reason                text,
  status                text NOT NULL DEFAULT 'DRAFT',
  workflow_instance_id  uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  row_version           integer NOT NULL DEFAULT 1,
  CONSTRAINT hr_overtime_status CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
  CONSTRAINT hr_overtime_hours CHECK (hours > 0)
);

SELECT app.add_row_version_trigger('hr_overtime_requests');
SELECT app.forbid_hard_delete('hr_overtime_requests');
SELECT app.grant_mutable_table('hr_overtime_requests');
ALTER TABLE hr_overtime_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_overtime_acl ON hr_overtime_requests FOR ALL TO nfc_app
  USING (app.has_permission('hr.attendance.manage') AND app.can_access_entity(entity_id))
  WITH CHECK (app.has_permission('hr.attendance.manage') AND app.can_access_entity(entity_id));


CREATE TABLE hr_attendance_import_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name       text NOT NULL,
  accepted        integer NOT NULL DEFAULT 0,
  flagged         integer NOT NULL DEFAULT 0,
  errors          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL
);

SELECT app.grant_mutable_table('hr_attendance_import_batches');
ALTER TABLE hr_attendance_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_import_acl ON hr_attendance_import_batches FOR ALL TO nfc_app
  USING (app.has_permission('hr.attendance.manage'));


CREATE TABLE hr_review_cycles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  starts_on       date NOT NULL,
  ends_on         date NOT NULL,
  status          text NOT NULL DEFAULT 'OPEN',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL,
  row_version     integer NOT NULL DEFAULT 1
);

SELECT app.add_row_version_trigger('hr_review_cycles');
SELECT app.forbid_hard_delete('hr_review_cycles');
SELECT app.grant_mutable_table('hr_review_cycles');
ALTER TABLE hr_review_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_cycles_acl ON hr_review_cycles FOR ALL TO nfc_app
  USING (app.has_permission('hr.performance.manage'));


CREATE TABLE hr_objectives (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES hr_employees (id),
  cycle_id        uuid NOT NULL REFERENCES hr_review_cycles (id),
  title           text NOT NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL
);

SELECT app.apply_append_only_conventions('hr_objectives');
ALTER TABLE hr_objectives ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_objectives_acl ON hr_objectives FOR ALL TO nfc_app
  USING (app.has_permission('hr.performance.manage'));


CREATE TABLE hr_appraisals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           uuid NOT NULL REFERENCES hr_employees (id),
  entity_id             uuid NOT NULL REFERENCES entities (id),
  cycle_id              uuid NOT NULL REFERENCES hr_review_cycles (id),
  rating                text,
  summary               text,
  status                text NOT NULL DEFAULT 'DRAFT',
  workflow_instance_id  uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  row_version           integer NOT NULL DEFAULT 1,
  CONSTRAINT hr_appraisals_status CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'))
);

SELECT app.add_row_version_trigger('hr_appraisals');
SELECT app.forbid_hard_delete('hr_appraisals');
SELECT app.grant_mutable_table('hr_appraisals');
ALTER TABLE hr_appraisals ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_appraisals_acl ON hr_appraisals FOR ALL TO nfc_app
  USING (app.has_permission('hr.performance.manage') AND app.can_access_entity(entity_id))
  WITH CHECK (app.has_permission('hr.performance.manage') AND app.can_access_entity(entity_id));


CREATE TABLE hr_disciplinary_cases (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number      text NOT NULL UNIQUE,
  employee_id           uuid NOT NULL REFERENCES hr_employees (id),
  entity_id             uuid NOT NULL REFERENCES entities (id),
  department_id         uuid,
  unit_id               uuid,
  category              text NOT NULL,
  incident_on           date NOT NULL,
  reported_on           date NOT NULL,
  description           text NOT NULL,
  status                text NOT NULL DEFAULT 'DRAFT',
  outcome               text,
  handler_user_id       uuid,
  workflow_instance_id  uuid,
  closed_at             timestamptz,
  close_reason          text,
  idempotency_key       text UNIQUE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  row_version           integer NOT NULL DEFAULT 1,
  CONSTRAINT hr_disc_status CHECK (status IN (
    'DRAFT', 'SUBMITTED', 'PRELIMINARY_REVIEW', 'INVESTIGATION', 'EMPLOYEE_RESPONSE',
    'RECOMMENDATION', 'AWAITING_MD', 'DECIDED', 'COMMUNICATED', 'APPEAL', 'CLOSED'
  )),
  CONSTRAINT hr_disc_outcome CHECK (outcome IS NULL OR outcome IN (
    'NO_CASE_TO_ANSWER', 'ADVISORY', 'WRITTEN_WARNING', 'FURTHER_TRAINING', 'SUSPENSION', 'OTHER', 'REFERRAL'
  ))
);

CREATE TABLE hr_disciplinary_access (
  case_id   uuid NOT NULL REFERENCES hr_disciplinary_cases (id),
  user_id   uuid NOT NULL REFERENCES users (id),
  kind      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  PRIMARY KEY (case_id, user_id, kind),
  CONSTRAINT hr_disc_access_kind CHECK (kind IN ('HANDLER', 'DECISION_MAKER'))
);

CREATE TABLE hr_disciplinary_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES hr_disciplinary_cases (id),
  kind        text NOT NULL,
  body        text NOT NULL,
  outcome     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL
);

CREATE TABLE hr_disciplinary_access_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES hr_disciplinary_cases (id),
  actor_ref   text NOT NULL,
  action      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION app.hr_disciplinary_has_access(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM hr_disciplinary_access a
     WHERE a.case_id = p_case_id AND a.user_id = app.current_actor_id()
  );
$$;

REVOKE ALL ON FUNCTION app.hr_disciplinary_has_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.hr_disciplinary_has_access(uuid) TO nfc_app;

CREATE OR REPLACE FUNCTION app.hr_employee_public_name(p_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT btrim(first_name || ' ' || last_name) FROM hr_employees WHERE id = p_id;
$$;
REVOKE ALL ON FUNCTION app.hr_employee_public_name(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.hr_employee_public_name(uuid) TO nfc_app;

SELECT app.add_row_version_trigger('hr_disciplinary_cases');
SELECT app.forbid_hard_delete('hr_disciplinary_cases');
SELECT app.grant_mutable_table('hr_disciplinary_cases');
SELECT app.apply_append_only_conventions('hr_disciplinary_access');
SELECT app.apply_append_only_conventions('hr_disciplinary_events');
SELECT app.apply_append_only_conventions('hr_disciplinary_access_log');

ALTER TABLE hr_disciplinary_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_disc_select ON hr_disciplinary_cases FOR SELECT TO nfc_app
  USING (
    app.has_permission('hr.disciplinary.view')
    OR created_by = app.current_actor_ref()
    OR app.hr_disciplinary_has_access(id)
  );
CREATE POLICY hr_disc_insert ON hr_disciplinary_cases FOR INSERT TO nfc_app
  WITH CHECK (created_by = app.current_actor_ref() AND app.has_permission('hr.disciplinary.manage'));
CREATE POLICY hr_disc_update ON hr_disciplinary_cases FOR UPDATE TO nfc_app
  USING (app.has_permission('hr.disciplinary.manage') OR app.hr_disciplinary_has_access(id))
  WITH CHECK (app.has_permission('hr.disciplinary.manage') OR app.hr_disciplinary_has_access(id));

ALTER TABLE hr_disciplinary_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_disc_access_acl ON hr_disciplinary_access FOR ALL TO nfc_app
  USING (app.has_permission('hr.disciplinary.view') OR user_id = app.current_actor_id())
  WITH CHECK (app.has_permission('hr.disciplinary.manage'));

ALTER TABLE hr_disciplinary_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_disc_events_acl ON hr_disciplinary_events FOR ALL TO nfc_app
  USING (
    app.has_permission('hr.disciplinary.view')
    OR app.hr_disciplinary_has_access(case_id)
  )
  WITH CHECK (
    app.has_permission('hr.disciplinary.investigate')
    OR app.has_permission('hr.disciplinary.manage')
    OR app.has_permission('hr.disciplinary.approve')
    OR app.hr_disciplinary_has_access(case_id)
  );

ALTER TABLE hr_disciplinary_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_disc_log_acl ON hr_disciplinary_access_log FOR ALL TO nfc_app
  USING (app.has_permission('hr.disciplinary.view') OR app.hr_disciplinary_has_access(case_id))
  WITH CHECK (true);


CREATE TABLE hr_training_sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number      text NOT NULL UNIQUE,
  entity_id             uuid NOT NULL REFERENCES entities (id),
  department_id         uuid REFERENCES departments (id),
  unit_id               uuid REFERENCES org_units (id),
  title                 text NOT NULL,
  category              text NOT NULL DEFAULT 'general',
  description           text,
  provider              text,
  internal              boolean NOT NULL DEFAULT true,
  delivery_method       text,
  starts_on             date,
  ends_on               date,
  venue                 text,
  instructor            text,
  estimated_cost_kobo   bigint,
  actual_cost_kobo      bigint,
  expense_entry_id      uuid,
  status                text NOT NULL DEFAULT 'DRAFT',
  idempotency_key       text UNIQUE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  row_version           integer NOT NULL DEFAULT 1,
  CONSTRAINT hr_training_title CHECK (btrim(title) <> ''),
  CONSTRAINT hr_training_status CHECK (status IN (
    'DRAFT', 'PROPOSED', 'AWAITING_FINANCE', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED'
  ))
);

CREATE TABLE hr_training_participants (
  session_id              uuid NOT NULL REFERENCES hr_training_sessions (id),
  employee_id             uuid NOT NULL REFERENCES hr_employees (id),
  attendance              text NOT NULL DEFAULT 'REGISTERED',
  completed               boolean NOT NULL DEFAULT false,
  assessment              text,
  hours                   numeric(6, 2),
  certificate_expires_on  date,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL,
  PRIMARY KEY (session_id, employee_id)
);

SELECT app.add_row_version_trigger('hr_training_sessions');
SELECT app.forbid_hard_delete('hr_training_sessions');
SELECT app.grant_mutable_table('hr_training_sessions');
GRANT SELECT, INSERT, UPDATE ON hr_training_participants TO nfc_app;

ALTER TABLE hr_training_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_training_select ON hr_training_sessions FOR SELECT TO nfc_app
  USING (app.has_permission('hr.training.view') AND app.can_access_entity(entity_id));
CREATE POLICY hr_training_write ON hr_training_sessions FOR ALL TO nfc_app
  USING (app.has_permission('hr.training.manage') AND app.can_access_entity(entity_id))
  WITH CHECK (app.has_permission('hr.training.manage') AND app.can_access_entity(entity_id));

ALTER TABLE hr_training_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_training_part_acl ON hr_training_participants FOR ALL TO nfc_app
  USING (app.has_permission('hr.training.view'))
  WITH CHECK (app.has_permission('hr.training.manage'));


INSERT INTO workflow_definitions (key, name, version, created_by, updated_by) VALUES
  ('hr-change-v1', 'HR change approval', 1, 'system:seed', 'system:seed'),
  ('hr-leave-v1', 'Leave request approval', 1, 'system:seed', 'system:seed'),
  ('hr-overtime-v1', 'Overtime approval', 1, 'system:seed', 'system:seed'),
  ('hr-performance-v1', 'Appraisal approval', 1, 'system:seed', 'system:seed'),
  ('hr-disciplinary-md-v1', 'Disciplinary MD approval', 1, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO workflow_stages (
  definition_id, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days, created_by
)
SELECT d.id, 1, 'review', s.label, s.perm, 'ALL', ARRAY['APPROVE', 'REJECT'], 3, 'system:seed'
  FROM workflow_definitions d
  JOIN (VALUES
    ('hr-change-v1', 'HR change approval', 'hr.change.approve'),
    ('hr-leave-v1', 'Leave approval', 'hr.leave.approve'),
    ('hr-overtime-v1', 'Overtime approval', 'hr.attendance.manage'),
    ('hr-performance-v1', 'Appraisal approval', 'hr.performance.manage'),
    ('hr-disciplinary-md-v1', 'MD disciplinary approval', 'hr.disciplinary.approve')
  ) AS s(def_key, label, perm) ON s.def_key = d.key
ON CONFLICT (definition_id, key) DO NOTHING;

INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('hr.change.submitted', 'notify.generic', 'system:seed'),
  ('hr.change.approved', 'notify.generic', 'system:seed'),
  ('hr.change.rejected', 'notify.generic', 'system:seed'),
  ('hr.leave.submitted', 'notify.generic', 'system:seed'),
  ('hr.leave.approved', 'notify.generic', 'system:seed'),
  ('hr.leave.rejected', 'notify.generic', 'system:seed'),
  ('hr.disciplinary.submitted', 'notify.generic', 'system:seed'),
  ('hr.disciplinary.decided', 'notify.generic', 'system:seed'),
  ('hr.training.finance', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  ('hr.change.submitted', 'action_required', 'HR change {reference} awaits approval',
    '{title} {reference} has been submitted for HR approval.', true, true, 'system:seed'),
  ('hr.change.approved', 'engine', 'HR change {reference} approved',
    'HR change {reference} has been approved.', true, false, 'system:seed'),
  ('hr.change.rejected', 'action_required', 'HR change {reference} rejected',
    'HR change {reference} was rejected. Reason: {reason}', true, true, 'system:seed'),
  ('hr.leave.submitted', 'action_required', 'Leave {reference} awaits approval',
    '{title} {reference} has been submitted for leave approval.', true, true, 'system:seed'),
  ('hr.leave.approved', 'engine', 'Leave {reference} approved',
    'Leave {reference} has been approved.', true, false, 'system:seed'),
  ('hr.leave.rejected', 'action_required', 'Leave {reference} rejected',
    'Leave {reference} was rejected. Reason: {reason}', true, true, 'system:seed'),
  ('hr.disciplinary.submitted', 'action_required', 'Disciplinary {reference} needs a decision',
    'Disciplinary case {reference} requires action.', true, true, 'system:seed'),
  ('hr.disciplinary.decided', 'engine', 'Disciplinary {reference} decided',
    'Disciplinary case {reference} has a recorded outcome.', true, false, 'system:seed'),
  ('hr.training.finance', 'action_required', 'Training {reference} awaits finance approval',
    'Training {reference} has been sent for expense approval.', true, true, 'system:seed'),
  ('hr.leave.reminder', 'action_required', 'Leave {reference} starts soon',
    'Approved leave {reference} begins on {startsOn}.', true, false, 'system:seed'),
  ('hr.training.reminder', 'action_required', 'Training {reference} starts soon',
    'Training {reference} is scheduled to begin.', true, false, 'system:seed')
ON CONFLICT DO NOTHING;

INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('hr.leave.reminder', 'notify.generic', 'system:seed'),
  ('hr.training.reminder', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;


CREATE TABLE hr_shifts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid NOT NULL REFERENCES entities (id),
  name            text NOT NULL,
  starts_at       time NOT NULL DEFAULT time '08:00',
  ends_at         time NOT NULL DEFAULT time '17:00',
  status          record_status NOT NULL DEFAULT 'ACTIVE',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL,
  row_version     integer NOT NULL DEFAULT 1,
  CONSTRAINT hr_shifts_name CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX hr_shifts_entity_name_key ON hr_shifts (entity_id, lower(name));

SELECT app.add_row_version_trigger('hr_shifts');
SELECT app.forbid_hard_delete('hr_shifts');
SELECT app.grant_mutable_table('hr_shifts');
ALTER TABLE hr_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_shifts_acl ON hr_shifts FOR ALL TO nfc_app
  USING ((app.has_permission('hr.attendance.manage') OR app.has_permission('hr.org.manage')) AND app.can_access_entity(entity_id))
  WITH CHECK (app.has_permission('hr.org.manage') AND app.can_access_entity(entity_id));

