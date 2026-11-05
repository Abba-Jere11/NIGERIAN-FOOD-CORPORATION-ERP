-- ---------------------------------------------------------------------------
-- 0059_leave_relief_hod
--
-- Leave can name a relief officer and the head of department. Those stages
-- are actionable only by the user stored on the instance.
-- ---------------------------------------------------------------------------

ALTER TABLE workflow_stages DROP CONSTRAINT workflow_stages_scope;
ALTER TABLE workflow_stages
  ADD CONSTRAINT workflow_stages_scope
  CHECK (scope_resolver IN ('SAME_ENTITY', 'CORPORATE', 'ALL', 'NAMED_ASSIGNEE'));

CREATE TABLE workflow_stage_assignees (
  instance_id  uuid NOT NULL REFERENCES workflow_instances (id),
  stage_key    text NOT NULL,
  user_id      uuid NOT NULL REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,
  PRIMARY KEY (instance_id, stage_key)
);
GRANT SELECT, INSERT, UPDATE ON workflow_stage_assignees TO nfc_app;

ALTER TABLE hr_leave_requests
  ADD COLUMN relief_employee_id uuid REFERENCES hr_employees (id),
  ADD COLUMN relief_status text NOT NULL DEFAULT 'NOT_REQUIRED';

ALTER TABLE hr_leave_requests
  DROP CONSTRAINT IF EXISTS hr_leave_relief_status;
ALTER TABLE hr_leave_requests
  ADD CONSTRAINT hr_leave_relief_status
  CHECK (relief_status IN ('NOT_REQUIRED', 'PENDING', 'ACCEPTED', 'DECLINED'));

CREATE POLICY hr_leave_requests_self_select ON hr_leave_requests FOR SELECT TO nfc_app
  USING (employee_id = app.current_employee_id());
CREATE POLICY hr_leave_requests_self_insert ON hr_leave_requests FOR INSERT TO nfc_app
  WITH CHECK (
    employee_id = app.current_employee_id()
    AND app.has_permission('self.leave.request')
    AND app.can_access_entity(entity_id)
  );
CREATE POLICY hr_leave_requests_party_update ON hr_leave_requests FOR UPDATE TO nfc_app
  USING (
    app.can_access_entity(entity_id)
    AND (
      employee_id = app.current_employee_id()
      OR EXISTS (
        SELECT 1 FROM workflow_stage_assignees a
          JOIN workflow_instances i ON i.id = a.instance_id
         WHERE i.subject_id = hr_leave_requests.id
           AND i.subject_type = 'HR_LEAVE'
           AND a.user_id = app.current_user_id()
      )
    )
  )
  WITH CHECK (app.can_access_entity(entity_id));

CREATE TABLE hr_leave_policy (
  id                         integer PRIMARY KEY DEFAULT 1,
  block_department_overlap   boolean NOT NULL DEFAULT false,
  exception_type_keys        text[] NOT NULL DEFAULT ARRAY['maternity'],
  CONSTRAINT hr_leave_policy_singleton CHECK (id = 1)
);
INSERT INTO hr_leave_policy (id) VALUES (1);
GRANT SELECT, UPDATE ON hr_leave_policy TO nfc_app;
ALTER TABLE hr_leave_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_leave_policy_read ON hr_leave_policy FOR SELECT TO nfc_app USING (true);
CREATE POLICY hr_leave_policy_write ON hr_leave_policy FOR UPDATE TO nfc_app
  USING (app.has_permission('hr.org.manage'))
  WITH CHECK (app.has_permission('hr.org.manage'));

INSERT INTO workflow_definitions (key, name, version, created_by, updated_by)
VALUES ('hr-leave-v2', 'Leave request approval', 2, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO workflow_stages (
  definition_id, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days, created_by
)
SELECT d.id, s.sort_order, s.key, s.label, s.required_permission, s.scope_resolver, s.allowed_actions, s.sla_days, 'system:seed'
  FROM workflow_definitions d
  JOIN (VALUES
    ('hr-leave-v2', 1, 'relief', 'Relief officer', NULL::text, 'NAMED_ASSIGNEE', ARRAY['APPROVE', 'REJECT']::text[], 2),
    ('hr-leave-v2', 2, 'department-head', 'Head of department', NULL::text, 'NAMED_ASSIGNEE', ARRAY['APPROVE', 'REJECT']::text[], 3),
    ('hr-leave-v2', 3, 'hr-review', 'HR review', 'hr.leave.approve', 'ALL', ARRAY['APPROVE', 'REJECT']::text[], 3)
  ) AS s(def_key, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days)
    ON s.def_key = d.key
ON CONFLICT (definition_id, key) DO NOTHING;
