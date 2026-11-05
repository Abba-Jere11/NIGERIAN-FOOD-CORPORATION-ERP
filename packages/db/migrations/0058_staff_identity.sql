-- ---------------------------------------------------------------------------
-- 0058_staff_identity
--
-- Links an employee to at most one user, adds the staff role, and lets HR
-- invite that person to register. Self-service permissions are granted to
-- every role; the endpoints still require a linked employee.
-- ---------------------------------------------------------------------------

INSERT INTO permissions (key, description, created_by) VALUES
  ('self.workspace', 'Open My workspace when the account is linked to an employee.', 'system:seed'),
  ('self.leave.request', 'Request leave for the linked employee record.', 'system:seed'),
  ('self.payslip.view', 'View payslips for the linked employee record.', 'system:seed'),
  ('directory.view', 'View the staff directory of work contacts.', 'system:seed'),
  ('notice.view', 'Read notices addressed to the user.', 'system:seed'),
  ('notice.manage', 'Draft and publish notices.', 'system:seed'),
  ('message.use', 'Send and read internal messages.', 'system:seed'),
  ('complaint.submit', 'Submit a complaint to HR.', 'system:seed'),
  ('complaint.manage', 'Review and respond to staff complaints.', 'system:seed'),
  ('hr.invite.manage', 'Issue, approve and reject staff invite links.', 'system:seed')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE roles DROP CONSTRAINT roles_home_path_format;
ALTER TABLE roles
  ADD CONSTRAINT roles_home_path_format CHECK (home_path ~ '^/(home/[a-z0-9-]+|me)$');

INSERT INTO roles (key, name, short_name, scope_type, home_path, description, created_by, updated_by)
VALUES (
  'staff',
  'Staff',
  'Staff',
  'ENTITY',
  '/me',
  'Employee self-service. Not combined with a management role.',
  'system:seed',
  'system:seed'
)
ON CONFLICT (key) DO NOTHING;

SET session_replication_role = replica;
INSERT INTO role_permissions (role_id, permission_key, created_by)
SELECT r.id, p.key, 'system:seed'
  FROM roles r
  CROSS JOIN (VALUES
    ('self.workspace'),
    ('self.leave.request'),
    ('self.payslip.view'),
    ('directory.view'),
    ('notice.view'),
    ('message.use'),
    ('complaint.submit')
  ) AS p(key)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key, created_by)
SELECT r.id, p.key, 'system:seed'
  FROM roles r
  JOIN (VALUES
    ('hr_officer', 'hr.invite.manage'),
    ('hr_officer', 'notice.manage'),
    ('hr_officer', 'complaint.manage')
  ) AS p(role_key, key) ON p.role_key = r.key::text
ON CONFLICT DO NOTHING;
SET session_replication_role = DEFAULT;

INSERT INTO role_conflicts (role_key_a, role_key_b, same_entity, reason, created_by)
SELECT r.key, 'staff', false,
       'The staff role is only for people who have no management role.',
       'system:seed'
  FROM roles r
 WHERE r.key <> 'staff'
ON CONFLICT DO NOTHING;


ALTER TABLE hr_employees
  ADD COLUMN user_id uuid UNIQUE REFERENCES users (id);

CREATE INDEX hr_employees_user_id_idx ON hr_employees (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE departments
  ADD COLUMN head_employee_id uuid REFERENCES hr_employees (id);

CREATE OR REPLACE FUNCTION app.current_employee_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM hr_employees WHERE user_id = app.current_user_id() LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION app.current_employee_id() TO nfc_app;

CREATE OR REPLACE FUNCTION app.protect_employee_self_edit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app.has_permission('hr.employee.manage') OR app.is_admin_actor() OR app.current_user_id() IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.user_id IS DISTINCT FROM app.current_user_id() THEN
    RETURN NEW;
  END IF;
  IF NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.unit_id IS DISTINCT FROM OLD.unit_id
     OR NEW.position_id IS DISTINCT FROM OLD.position_id
     OR NEW.employment_type IS DISTINCT FROM OLD.employment_type
     OR NEW.grade IS DISTINCT FROM OLD.grade
     OR NEW.date_employed IS DISTINCT FROM OLD.date_employed
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.reporting_manager_id IS DISTINCT FROM OLD.reporting_manager_id
     OR NEW.work_email IS DISTINCT FROM OLD.work_email
     OR NEW.work_phone IS DISTINCT FROM OLD.work_phone
     OR NEW.bank_name IS DISTINCT FROM OLD.bank_name
     OR NEW.bank_account_name IS DISTINCT FROM OLD.bank_account_name
     OR NEW.bank_account_number IS DISTINCT FROM OLD.bank_account_number
     OR NEW.salary_kobo IS DISTINCT FROM OLD.salary_kobo
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.first_name IS DISTINCT FROM OLD.first_name
     OR NEW.last_name IS DISTINCT FROM OLD.last_name
     OR NEW.reference_number IS DISTINCT FROM OLD.reference_number
  THEN
    RAISE EXCEPTION 'Bank, pay and employment fields are maintained by HR.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS hr_employees_self_edit ON hr_employees;
CREATE TRIGGER hr_employees_self_edit
  BEFORE UPDATE ON hr_employees
  FOR EACH ROW EXECUTE FUNCTION app.protect_employee_self_edit();

CREATE OR REPLACE FUNCTION app.departments_head_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app.has_permission('organization.department.manage') OR app.is_admin_actor() THEN
    RETURN NEW;
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name
     OR NEW.code IS DISTINCT FROM OLD.code
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
  THEN
    RAISE EXCEPTION 'HR may only set the head of department.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS departments_head_only ON departments;
CREATE TRIGGER departments_head_only
  BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION app.departments_head_only();

CREATE POLICY departments_head_hr ON departments FOR UPDATE TO nfc_app
  USING (app.has_permission('hr.org.manage') AND app.can_access_entity(entity_id))
  WITH CHECK (app.has_permission('hr.org.manage') AND app.can_access_entity(entity_id));

CREATE POLICY hr_employees_self_select ON hr_employees FOR SELECT TO nfc_app
  USING (id = app.current_employee_id());
CREATE POLICY hr_employees_self_update ON hr_employees FOR UPDATE TO nfc_app
  USING (id = app.current_employee_id() AND app.has_permission('self.workspace'))
  WITH CHECK (id = app.current_employee_id() AND app.has_permission('self.workspace'));

CREATE POLICY hr_leave_entitlements_self ON hr_leave_entitlements FOR SELECT TO nfc_app
  USING (employee_id = app.current_employee_id());
CREATE POLICY hr_attendance_self ON hr_attendance_records FOR SELECT TO nfc_app
  USING (employee_id = app.current_employee_id() AND app.has_permission('self.workspace'));
CREATE POLICY payroll_payslips_self ON payroll_payslips FOR SELECT TO nfc_app
  USING (employee_id = app.current_employee_id() AND app.has_permission('self.payslip.view'));


CREATE TABLE hr_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES hr_employees (id),
  entity_id     uuid NOT NULL REFERENCES entities (id),
  email         citext NOT NULL,
  token_hash    text NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'ISSUED',
  user_id       uuid REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL,
  row_version   integer NOT NULL DEFAULT 1,
  CONSTRAINT hr_invites_status CHECK (status IN ('ISSUED', 'REGISTERED', 'APPROVED', 'REVOKED', 'EXPIRED')),
  CONSTRAINT hr_invites_email CHECK (email::text ~* '^[^@]+@[^@]+\.[^@]+$')
);

SELECT app.apply_mutable_conventions('hr_invites');
ALTER TABLE hr_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_invites_acl ON hr_invites FOR ALL TO nfc_app
  USING (app.has_permission('hr.invite.manage') AND app.can_access_entity(entity_id))
  WITH CHECK (app.has_permission('hr.invite.manage') AND app.can_access_entity(entity_id));

CREATE TABLE hr_invite_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON hr_invite_attempts TO nfc_app;


CREATE OR REPLACE FUNCTION app.preview_staff_invite(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv hr_invites%ROWTYPE;
  emp hr_employees%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM hr_invites WHERE token_hash = p_token_hash LIMIT 1;
  IF inv.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This invite link is not valid.');
  END IF;
  IF inv.status <> 'ISSUED' OR inv.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This invite link has expired or was already used.');
  END IF;
  SELECT * INTO emp FROM hr_employees WHERE id = inv.employee_id;
  RETURN jsonb_build_object(
    'ok', true,
    'inviteId', inv.id,
    'email', inv.email,
    'firstName', emp.first_name,
    'lastName', emp.last_name,
    'expiresAt', inv.expires_at
  );
END $$;

GRANT EXECUTE ON FUNCTION app.preview_staff_invite(text) TO nfc_app;

CREATE OR REPLACE FUNCTION app.register_staff_invite(
  p_token_hash text,
  p_password_hash text,
  p_personal jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv hr_invites%ROWTYPE;
  emp hr_employees%ROWTYPE;
  v_user uuid;
  v_role uuid;
  v_position text;
BEGIN
  SELECT * INTO inv FROM hr_invites WHERE token_hash = p_token_hash FOR UPDATE;
  IF inv.id IS NULL THEN
    RAISE EXCEPTION 'This invite link is not valid.' USING ERRCODE = 'check_violation';
  END IF;
  IF inv.status <> 'ISSUED' OR inv.expires_at <= now() THEN
    RAISE EXCEPTION 'This invite link has expired or was already used.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO emp FROM hr_employees WHERE id = inv.employee_id FOR UPDATE;
  IF emp.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'This employee already has a sign-in.' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE email = inv.email) THEN
    RAISE EXCEPTION 'An account with this email already exists.' USING ERRCODE = 'unique_violation';
  END IF;

  UPDATE hr_employees SET
    other_names = coalesce(p_personal->>'otherNames', other_names),
    gender = coalesce(p_personal->>'gender', gender),
    personal_phone = coalesce(p_personal->>'personalPhone', personal_phone),
    emergency_name = coalesce(p_personal->>'emergencyName', emergency_name),
    emergency_phone = coalesce(p_personal->>'emergencyPhone', emergency_phone),
    bank_name = coalesce(p_personal->>'bankName', bank_name),
    bank_account_name = coalesce(p_personal->>'bankAccountName', bank_account_name),
    bank_account_number = coalesce(p_personal->>'bankAccountNumber', bank_account_number),
    updated_by = 'system:invite'
  WHERE id = emp.id;

  SELECT coalesce(pos.title, 'Staff') INTO v_position
    FROM hr_employees e
    LEFT JOIN hr_positions pos ON pos.id = e.position_id
   WHERE e.id = emp.id;

  INSERT INTO users (
    name, email, phone, status, primary_entity_id, department_id, "position",
    password_hash, must_change_password, created_by, updated_by
  ) VALUES (
    emp.first_name || ' ' || emp.last_name,
    inv.email,
    p_personal->>'personalPhone',
    'PENDING_APPROVAL',
    emp.entity_id,
    emp.department_id,
    coalesce(v_position, 'Staff'),
    p_password_hash,
    false,
    'system:invite',
    'system:invite'
  ) RETURNING id INTO v_user;

  SELECT id INTO v_role FROM roles WHERE key = 'staff';
  INSERT INTO user_role_assignments (user_id, role_id, scope_type, entity_id, created_by, updated_by)
  VALUES (v_user, v_role, 'ENTITY', emp.entity_id, 'system:invite', 'system:invite');

  UPDATE hr_employees SET user_id = v_user, updated_by = 'system:invite' WHERE id = emp.id;
  UPDATE hr_invites
     SET status = 'REGISTERED', user_id = v_user, updated_by = 'system:invite'
   WHERE id = inv.id;
  RETURN v_user;
END $$;

GRANT EXECUTE ON FUNCTION app.register_staff_invite(text, text, jsonb) TO nfc_app;

CREATE OR REPLACE FUNCTION app.decide_staff_invite(p_invite_id uuid, p_approve boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv hr_invites%ROWTYPE;
BEGIN
  IF NOT app.has_permission('hr.invite.manage') THEN
    RAISE EXCEPTION 'Your role does not permit this action.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO inv FROM hr_invites WHERE id = p_invite_id FOR UPDATE;
  IF inv.id IS NULL OR inv.status <> 'REGISTERED' OR inv.user_id IS NULL THEN
    RAISE EXCEPTION 'That invite is not waiting for approval.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_approve THEN
    UPDATE users SET status = 'ACTIVE', updated_by = app.current_user_id()::text WHERE id = inv.user_id;
    UPDATE hr_invites SET status = 'APPROVED', updated_by = app.current_user_id()::text WHERE id = inv.id;
  ELSE
    UPDATE users SET status = 'DEACTIVATED', updated_by = app.current_user_id()::text WHERE id = inv.user_id;
    UPDATE hr_employees SET user_id = NULL, updated_by = app.current_user_id()::text WHERE id = inv.employee_id;
    UPDATE hr_invites SET status = 'REVOKED', updated_by = app.current_user_id()::text WHERE id = inv.id;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION app.decide_staff_invite(uuid, boolean) TO nfc_app;

CREATE OR REPLACE FUNCTION app.own_payslips()
RETURNS TABLE (run_id uuid, period_name text, reference_number text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.run_id, fp.name, r.reference_number, p.created_at
    FROM payroll_payslips p
    JOIN payroll_runs r ON r.id = p.run_id
    JOIN fiscal_periods fp ON fp.id = r.fiscal_period_id
   WHERE p.employee_id = app.current_employee_id()
   ORDER BY p.created_at DESC
$$;

GRANT EXECUTE ON FUNCTION app.own_payslips() TO nfc_app;

CREATE OR REPLACE FUNCTION app.directory_entries(p_entity_ids uuid[], p_query text)
RETURNS TABLE (
  id uuid,
  name text,
  position_title text,
  department_name text,
  department_id uuid,
  entity_code text,
  work_email text,
  work_phone text,
  user_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id,
         e.first_name || ' ' || e.last_name,
         p.title,
         d.name,
         e.department_id,
         ent.code,
         e.work_email,
         e.work_phone,
         e.user_id
    FROM hr_employees e
    JOIN entities ent ON ent.id = e.entity_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN hr_positions p ON p.id = e.position_id
   WHERE app.has_permission('directory.view')
     AND app.can_access_entity(e.entity_id)
     AND e.status NOT IN ('TERMINATED', 'RESIGNED', 'INACTIVE')
     AND (p_entity_ids IS NULL OR e.entity_id = ANY (p_entity_ids))
     AND (
       p_query = ''
       OR (e.first_name || ' ' || e.last_name) ILIKE '%' || p_query || '%'
       OR coalesce(d.name, '') ILIKE '%' || p_query || '%'
     )
   ORDER BY e.last_name, e.first_name
   LIMIT 100
$$;

GRANT EXECUTE ON FUNCTION app.directory_entries(uuid[], text) TO nfc_app;

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  ('hr.invite.approved', 'engine', 'Your NFC access is approved',
   'You can now sign in to My workspace.', true, true, 'system:seed'),
  ('hr.invite.rejected', 'engine', 'Your NFC access was not approved',
   'HR did not approve this invite. Reason: {reason}', true, true, 'system:seed')
ON CONFLICT (type) DO NOTHING;

INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('hr.invite.approved', 'notify.generic', 'system:seed'),
  ('hr.invite.rejected', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;
