-- ---------------------------------------------------------------------------
-- 0048_payroll
--
-- Payroll runs, effective-dated structures, statutory config, payment
-- batches and official HR/payroll report templates. No ninth role.
-- ---------------------------------------------------------------------------

INSERT INTO permissions (key, description, created_by) VALUES
  ('payroll.structure.manage', 'Create and confirm effective-dated salary structures.', 'system:seed'),
  ('payroll.run.prepare', 'Prepare and submit a payroll run for a subsidiary period.', 'system:seed'),
  ('payroll.run.approve', 'Approve a payroll run at the current workflow stage.', 'system:seed'),
  ('payroll.pay', 'Execute a locked payroll payment batch with evidence.', 'system:seed'),
  ('payroll.view', 'View payroll runs, line amounts and payslips within granted entities.', 'system:seed'),
  ('payroll.config', 'Maintain PAYE, pension and other statutory payroll configuration.', 'system:seed')
ON CONFLICT (key) DO NOTHING;

SET session_replication_role = replica;
INSERT INTO role_permissions (role_id, permission_key, created_by)
SELECT r.id, k.key, 'system:seed'
  FROM roles r
  JOIN (VALUES
    ('hr_officer', 'payroll.structure.manage'),
    ('hr_officer', 'payroll.run.prepare'),
    ('hr_officer', 'payroll.config'),
    ('hr_officer', 'payroll.view'),
    ('hr_officer', 'org_report.create'),
    ('hr_officer', 'org_report.submit'),
    ('hr_officer', 'org_report.view'),
    ('hr_officer', 'org_report.minute.respond'),
    ('finance_head', 'payroll.run.approve'),
    ('finance_head', 'payroll.pay'),
    ('finance_head', 'payroll.view'),
    ('ed_finance', 'payroll.run.approve'),
    ('ed_finance', 'payroll.view')
  ) AS k(role_key, key) ON k.role_key = r.key::text
ON CONFLICT DO NOTHING;
SET session_replication_role = DEFAULT;


ALTER TABLE journals DROP CONSTRAINT IF EXISTS journals_source;
ALTER TABLE journals ADD CONSTRAINT journals_source CHECK (source IN (
  'MANUAL', 'BANK_TRANSFER', 'RECONCILIATION', 'REVERSAL',
  'PROCUREMENT_PAYMENT', 'PROCUREMENT_RECLASS', 'PROCUREMENT_RECOVERY',
  'FUNDING_TRANSFER', 'INTERCOMPANY',
  'INCOME', 'EXPENSE', 'PAYABLE', 'RECEIVABLE', 'RECEIPT',
  'INVENTORY_RECEIPT', 'INVENTORY_ISSUE', 'INVENTORY_WRITE_OFF', 'INVENTORY_ADJUSTMENT', 'INVENTORY_TRANSFER',
  'PRODUCTION_WIP', 'PRODUCTION_OUTPUT', 'PRODUCTION_WASTE', 'PRODUCTION_OVERHEAD',
  'SALES_REVENUE', 'SALES_COGS', 'SALES_RETURN',
  'PAYROLL'
));


INSERT INTO account_templates (
  code, name, type, parent_code, normal_balance, consolidation_code, intercompany, sort_order, created_by
) VALUES
  ('1160', 'Staff advances', 'ASSET', '1100', 'DEBIT', '1160', false, 55, 'system:seed'),
  ('2130', 'PAYE payable', 'LIABILITY', '2100', 'CREDIT', '2130', false, 145, 'system:seed'),
  ('2140', 'Pension payable', 'LIABILITY', '2100', 'CREDIT', '2140', false, 146, 'system:seed'),
  ('2150', 'Net salaries payable', 'LIABILITY', '2100', 'CREDIT', '2150', false, 147, 'system:seed'),
  ('2135', 'Other statutory payable', 'LIABILITY', '2100', 'CREDIT', '2135', false, 148, 'system:seed')
ON CONFLICT (code) DO NOTHING;

INSERT INTO accounts (
  entity_id, template_id, code, name, type, parent_id, normal_balance, consolidation_code,
  intercompany, created_by, updated_by
)
SELECT e.id, t.id, t.code, t.name, t.type, p.id, t.normal_balance, t.consolidation_code,
       t.intercompany, 'system:seed', 'system:seed'
  FROM entities e
  JOIN account_templates t ON t.code IN ('1160', '2130', '2135', '2140', '2150')
  LEFT JOIN accounts p ON p.entity_id = e.id AND p.code = t.parent_code
 WHERE EXISTS (SELECT 1 FROM accounts a WHERE a.entity_id = e.id)
ON CONFLICT (entity_id, code) DO NOTHING;


INSERT INTO hr_leave_types (key, name, days_per_year, paid, created_by, updated_by) VALUES
  ('unpaid', 'Unpaid leave', 0, false, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;


CREATE TABLE payroll_settings (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ed_finance_threshold_kobo   bigint NOT NULL DEFAULT 5000000000,
  overtime_multiplier_bps     integer NOT NULL DEFAULT 15000,
  include_suspended           boolean NOT NULL DEFAULT false,
  unpaid_leave_daily_divisor  integer NOT NULL DEFAULT 22,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  text NOT NULL,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  text NOT NULL,
  row_version                 integer NOT NULL DEFAULT 1,
  CONSTRAINT payroll_settings_threshold CHECK (ed_finance_threshold_kobo >= 0),
  CONSTRAINT payroll_settings_ot CHECK (overtime_multiplier_bps >= 0),
  CONSTRAINT payroll_settings_divisor CHECK (unpaid_leave_daily_divisor > 0)
);

SELECT app.apply_mutable_conventions('payroll_settings');
ALTER TABLE payroll_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_settings_select ON payroll_settings FOR SELECT TO nfc_app
  USING (app.has_permission('payroll.view') OR app.has_permission('payroll.config') OR app.has_permission('payroll.run.prepare'));
CREATE POLICY payroll_settings_write ON payroll_settings FOR ALL TO nfc_app
  USING (app.has_permission('payroll.config'))
  WITH CHECK (app.has_permission('payroll.config'));

INSERT INTO payroll_settings (
  ed_finance_threshold_kobo, overtime_multiplier_bps, include_suspended,
  unpaid_leave_daily_divisor, created_by, updated_by
) VALUES (5000000000, 15000, false, 22, 'system:seed', 'system:seed');


CREATE TABLE payroll_paye_bands (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_on date NOT NULL,
  from_kobo    bigint NOT NULL,
  to_kobo      bigint,
  rate_bps     integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL,
  row_version  integer NOT NULL DEFAULT 1,
  CONSTRAINT payroll_paye_from CHECK (from_kobo >= 0),
  CONSTRAINT payroll_paye_to CHECK (to_kobo IS NULL OR to_kobo > from_kobo),
  CONSTRAINT payroll_paye_rate CHECK (rate_bps >= 0 AND rate_bps <= 10000)
);

SELECT app.apply_mutable_conventions('payroll_paye_bands');
ALTER TABLE payroll_paye_bands ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_paye_select ON payroll_paye_bands FOR SELECT TO nfc_app
  USING (app.has_permission('payroll.view') OR app.has_permission('payroll.config') OR app.has_permission('payroll.run.prepare'));
CREATE POLICY payroll_paye_write ON payroll_paye_bands FOR ALL TO nfc_app
  USING (app.has_permission('payroll.config'))
  WITH CHECK (app.has_permission('payroll.config'));

INSERT INTO payroll_paye_bands (effective_on, from_kobo, to_kobo, rate_bps, created_by, updated_by) VALUES
  ('2026-01-01', 0, 80000000, 0, 'system:seed', 'system:seed'),
  ('2026-01-01', 80000000, 300000000, 1500, 'system:seed', 'system:seed'),
  ('2026-01-01', 300000000, 1200000000, 1800, 'system:seed', 'system:seed'),
  ('2026-01-01', 1200000000, 2500000000, 2100, 'system:seed', 'system:seed'),
  ('2026-01-01', 2500000000, 5000000000, 2300, 'system:seed', 'system:seed'),
  ('2026-01-01', 5000000000, NULL, 2500, 'system:seed', 'system:seed');


CREATE TABLE payroll_pension_rates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_on  date NOT NULL,
  employee_bps  integer NOT NULL,
  employer_bps  integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL,
  row_version   integer NOT NULL DEFAULT 1,
  CONSTRAINT payroll_pension_ee CHECK (employee_bps >= 0 AND employee_bps <= 10000),
  CONSTRAINT payroll_pension_er CHECK (employer_bps >= 0 AND employer_bps <= 10000)
);

SELECT app.apply_mutable_conventions('payroll_pension_rates');
ALTER TABLE payroll_pension_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_pension_select ON payroll_pension_rates FOR SELECT TO nfc_app
  USING (app.has_permission('payroll.view') OR app.has_permission('payroll.config') OR app.has_permission('payroll.run.prepare'));
CREATE POLICY payroll_pension_write ON payroll_pension_rates FOR ALL TO nfc_app
  USING (app.has_permission('payroll.config'))
  WITH CHECK (app.has_permission('payroll.config'));

INSERT INTO payroll_pension_rates (effective_on, employee_bps, employer_bps, created_by, updated_by) VALUES
  ('2026-01-01', 800, 1000, 'system:seed', 'system:seed');


CREATE TABLE payroll_other_statutory (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL,
  name         text NOT NULL,
  effective_on date NOT NULL,
  rate_bps     integer,
  amount_kobo  bigint,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL,
  row_version  integer NOT NULL DEFAULT 1,
  CONSTRAINT payroll_other_key CHECK (btrim(key) <> ''),
  CONSTRAINT payroll_other_name CHECK (btrim(name) <> ''),
  CONSTRAINT payroll_other_basis CHECK (rate_bps IS NOT NULL OR amount_kobo IS NOT NULL)
);

SELECT app.apply_mutable_conventions('payroll_other_statutory');
ALTER TABLE payroll_other_statutory ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_other_select ON payroll_other_statutory FOR SELECT TO nfc_app
  USING (app.has_permission('payroll.view') OR app.has_permission('payroll.config') OR app.has_permission('payroll.run.prepare'));
CREATE POLICY payroll_other_write ON payroll_other_statutory FOR ALL TO nfc_app
  USING (app.has_permission('payroll.config'))
  WITH CHECK (app.has_permission('payroll.config'));


CREATE TABLE payroll_salary_structures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid REFERENCES hr_employees (id),
  grade_key       text,
  entity_id       uuid NOT NULL REFERENCES entities (id),
  basic_kobo      bigint NOT NULL,
  allowances      jsonb NOT NULL DEFAULT '[]'::jsonb,
  overtime_rule   text,
  effective_on    date NOT NULL,
  supersedes_id   uuid REFERENCES payroll_salary_structures (id),
  status          text NOT NULL DEFAULT 'DRAFT',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL,
  row_version     integer NOT NULL DEFAULT 1,
  CONSTRAINT payroll_structures_target CHECK (employee_id IS NOT NULL OR btrim(coalesce(grade_key, '')) <> ''),
  CONSTRAINT payroll_structures_basic CHECK (basic_kobo >= 0),
  CONSTRAINT payroll_structures_status CHECK (status IN ('DRAFT', 'CONFIRMED', 'SUPERSEDED'))
);

SELECT app.apply_mutable_conventions('payroll_salary_structures');
ALTER TABLE payroll_salary_structures ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_structures_select ON payroll_salary_structures FOR SELECT TO nfc_app
  USING ((app.has_permission('payroll.view') OR app.has_permission('payroll.structure.manage')) AND app.can_access_entity(entity_id));
CREATE POLICY payroll_structures_write ON payroll_salary_structures FOR ALL TO nfc_app
  USING (app.has_permission('payroll.structure.manage') AND app.can_access_entity(entity_id))
  WITH CHECK (app.has_permission('payroll.structure.manage') AND app.can_access_entity(entity_id));


CREATE TABLE payroll_loans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      uuid NOT NULL REFERENCES hr_employees (id),
  entity_id        uuid NOT NULL REFERENCES entities (id),
  principal_kobo   bigint NOT NULL,
  remaining_kobo   bigint NOT NULL,
  installment_kobo bigint NOT NULL,
  starts_on        date NOT NULL,
  status           text NOT NULL DEFAULT 'ACTIVE',
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL,
  row_version      integer NOT NULL DEFAULT 1,
  CONSTRAINT payroll_loans_principal CHECK (principal_kobo > 0),
  CONSTRAINT payroll_loans_remaining CHECK (remaining_kobo >= 0),
  CONSTRAINT payroll_loans_installment CHECK (installment_kobo > 0),
  CONSTRAINT payroll_loans_status CHECK (status IN ('ACTIVE', 'SETTLED', 'CANCELLED'))
);

SELECT app.apply_mutable_conventions('payroll_loans');
ALTER TABLE payroll_loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_loans_select ON payroll_loans FOR SELECT TO nfc_app
  USING ((app.has_permission('payroll.view') OR app.has_permission('payroll.run.prepare')) AND app.can_access_entity(entity_id));
CREATE POLICY payroll_loans_write ON payroll_loans FOR ALL TO nfc_app
  USING (app.has_permission('payroll.structure.manage') AND app.can_access_entity(entity_id))
  WITH CHECK (app.has_permission('payroll.structure.manage') AND app.can_access_entity(entity_id));


CREATE TABLE payroll_loan_schedule (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id      uuid NOT NULL REFERENCES payroll_loans (id),
  entity_id    uuid NOT NULL REFERENCES entities (id),
  due_on       date NOT NULL,
  amount_kobo  bigint NOT NULL,
  applied_run_id uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,
  CONSTRAINT payroll_loan_schedule_amount CHECK (amount_kobo > 0)
);

SELECT app.apply_append_only_conventions('payroll_loan_schedule');
ALTER TABLE payroll_loan_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_loan_schedule_select ON payroll_loan_schedule FOR SELECT TO nfc_app
  USING ((app.has_permission('payroll.view') OR app.has_permission('payroll.run.prepare')) AND app.can_access_entity(entity_id));
CREATE POLICY payroll_loan_schedule_insert ON payroll_loan_schedule FOR INSERT TO nfc_app
  WITH CHECK (
    (app.has_permission('payroll.structure.manage') OR app.has_permission('payroll.run.prepare'))
    AND app.can_access_entity(entity_id)
  );


CREATE TABLE payroll_runs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number        text NOT NULL UNIQUE,
  entity_id               uuid NOT NULL REFERENCES entities (id),
  fiscal_period_id        uuid NOT NULL REFERENCES fiscal_periods (id),
  status                  text NOT NULL DEFAULT 'DRAFT',
  workflow_instance_id    uuid REFERENCES workflow_instances (id),
  employee_count          integer NOT NULL DEFAULT 0,
  gross_kobo              bigint NOT NULL DEFAULT 0,
  net_kobo                bigint NOT NULL DEFAULT 0,
  paye_kobo               bigint NOT NULL DEFAULT 0,
  pension_employee_kobo   bigint NOT NULL DEFAULT 0,
  pension_employer_kobo   bigint NOT NULL DEFAULT 0,
  other_statutory_kobo    bigint NOT NULL DEFAULT 0,
  exceptions              jsonb NOT NULL DEFAULT '[]'::jsonb,
  adjusting_run_id        uuid REFERENCES payroll_runs (id),
  journal_id              uuid REFERENCES journals (id),
  reversal_journal_id     uuid REFERENCES journals (id),
  idempotency_key         text NOT NULL UNIQUE,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              text NOT NULL,
  row_version             integer NOT NULL DEFAULT 1,
  CONSTRAINT payroll_runs_status CHECK (
    status IN ('DRAFT', 'CALCULATED', 'SUBMITTED', 'APPROVED', 'LOCKED', 'PAID', 'REVERSED')
  ),
  CONSTRAINT payroll_runs_counts CHECK (employee_count >= 0)
);

SELECT app.apply_mutable_conventions('payroll_runs');
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_runs_select ON payroll_runs FOR SELECT TO nfc_app
  USING (
    (app.has_permission('payroll.view') OR app.has_permission('payroll.run.prepare')
      OR app.has_permission('payroll.run.approve') OR app.has_permission('payroll.pay'))
    AND app.can_access_entity(entity_id)
  );
CREATE POLICY payroll_runs_write ON payroll_runs FOR ALL TO nfc_app
  USING (
    (app.has_permission('payroll.run.prepare') OR app.has_permission('payroll.run.approve')
      OR app.has_permission('payroll.pay'))
    AND app.can_access_entity(entity_id)
  )
  WITH CHECK (
    (app.has_permission('payroll.run.prepare') OR app.has_permission('payroll.run.approve')
      OR app.has_permission('payroll.pay'))
    AND app.can_access_entity(entity_id)
  );

CREATE UNIQUE INDEX payroll_runs_open_period
  ON payroll_runs (entity_id, fiscal_period_id)
  WHERE status IN ('DRAFT', 'CALCULATED', 'SUBMITTED', 'APPROVED');


CREATE TABLE payroll_run_lines (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                  uuid NOT NULL REFERENCES payroll_runs (id),
  entity_id               uuid NOT NULL REFERENCES entities (id),
  employee_id             uuid NOT NULL REFERENCES hr_employees (id),
  employee_name           text,
  employee_number         text,
  bank_name               text,
  bank_account_name       text,
  bank_account_number     text,
  structure_id            uuid REFERENCES payroll_salary_structures (id),
  basic_kobo              bigint NOT NULL DEFAULT 0,
  allowances_kobo         bigint NOT NULL DEFAULT 0,
  overtime_kobo           bigint NOT NULL DEFAULT 0,
  unpaid_leave_kobo       bigint NOT NULL DEFAULT 0,
  loan_kobo               bigint NOT NULL DEFAULT 0,
  paye_kobo               bigint NOT NULL DEFAULT 0,
  pension_employee_kobo   bigint NOT NULL DEFAULT 0,
  pension_employer_kobo   bigint NOT NULL DEFAULT 0,
  other_statutory_kobo    bigint NOT NULL DEFAULT 0,
  gross_kobo              bigint NOT NULL DEFAULT 0,
  net_kobo                bigint NOT NULL DEFAULT 0,
  exceptions              jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              text NOT NULL,
  row_version             integer NOT NULL DEFAULT 1,
  UNIQUE (run_id, employee_id)
);

SELECT app.apply_mutable_conventions('payroll_run_lines');
DROP TRIGGER IF EXISTS payroll_run_lines_forbid_delete ON payroll_run_lines;
ALTER TABLE payroll_run_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_run_lines_select ON payroll_run_lines FOR SELECT TO nfc_app
  USING (
    (app.has_permission('payroll.view') OR app.has_permission('payroll.run.prepare')
      OR app.has_permission('payroll.run.approve') OR app.has_permission('payroll.pay'))
    AND app.can_access_entity(entity_id)
  );
CREATE POLICY payroll_run_lines_write ON payroll_run_lines FOR ALL TO nfc_app
  USING (app.has_permission('payroll.run.prepare') AND app.can_access_entity(entity_id))
  WITH CHECK (app.has_permission('payroll.run.prepare') AND app.can_access_entity(entity_id));

CREATE OR REPLACE FUNCTION app.replace_payroll_run_lines(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM payroll_runs WHERE id = p_run_id FOR UPDATE;
  IF st IS NULL OR st NOT IN ('DRAFT', 'CALCULATED') THEN
    RAISE EXCEPTION 'Only a draft or calculated payroll run can replace lines.';
  END IF;
  DELETE FROM payroll_run_lines WHERE run_id = p_run_id;
END $$;
GRANT EXECUTE ON FUNCTION app.replace_payroll_run_lines(uuid) TO nfc_app;


CREATE TABLE payroll_adjustments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_run_id uuid NOT NULL REFERENCES payroll_runs (id),
  new_run_id      uuid NOT NULL REFERENCES payroll_runs (id),
  entity_id       uuid NOT NULL REFERENCES entities (id),
  reason          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  CONSTRAINT payroll_adjustments_reason CHECK (btrim(reason) <> '')
);

SELECT app.apply_append_only_conventions('payroll_adjustments');
ALTER TABLE payroll_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_adjustments_select ON payroll_adjustments FOR SELECT TO nfc_app
  USING ((app.has_permission('payroll.view') OR app.has_permission('payroll.run.prepare')) AND app.can_access_entity(entity_id));
CREATE POLICY payroll_adjustments_insert ON payroll_adjustments FOR INSERT TO nfc_app
  WITH CHECK (app.has_permission('payroll.run.prepare') AND app.can_access_entity(entity_id));


CREATE TABLE payroll_payment_batches (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                uuid NOT NULL REFERENCES payroll_runs (id),
  entity_id             uuid NOT NULL REFERENCES entities (id),
  evidence_document_id  uuid REFERENCES documents (id),
  bank_file_name        text,
  bank_file_sha256      text,
  journal_id            uuid REFERENCES journals (id),
  paid_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  row_version           integer NOT NULL DEFAULT 1,
  UNIQUE (run_id)
);

SELECT app.apply_mutable_conventions('payroll_payment_batches');
ALTER TABLE payroll_payment_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_batches_select ON payroll_payment_batches FOR SELECT TO nfc_app
  USING ((app.has_permission('payroll.view') OR app.has_permission('payroll.pay')) AND app.can_access_entity(entity_id));
CREATE POLICY payroll_batches_write ON payroll_payment_batches FOR ALL TO nfc_app
  USING (app.has_permission('payroll.pay') AND app.can_access_entity(entity_id))
  WITH CHECK (app.has_permission('payroll.pay') AND app.can_access_entity(entity_id));


CREATE TABLE payroll_remittances (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                uuid NOT NULL REFERENCES payroll_runs (id),
  entity_id             uuid NOT NULL REFERENCES entities (id),
  kind                  text NOT NULL,
  amount_kobo           bigint NOT NULL,
  status                text NOT NULL DEFAULT 'UNREMITTED',
  evidence_document_id  uuid REFERENCES documents (id),
  remitted_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  row_version           integer NOT NULL DEFAULT 1,
  CONSTRAINT payroll_remittances_kind CHECK (kind IN ('PAYE', 'PENSION', 'OTHER')),
  CONSTRAINT payroll_remittances_status CHECK (status IN ('UNREMITTED', 'REMITTED')),
  CONSTRAINT payroll_remittances_amount CHECK (amount_kobo >= 0),
  UNIQUE (run_id, kind)
);

SELECT app.apply_mutable_conventions('payroll_remittances');
ALTER TABLE payroll_remittances ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_remittances_select ON payroll_remittances FOR SELECT TO nfc_app
  USING ((app.has_permission('payroll.view') OR app.has_permission('payroll.pay')) AND app.can_access_entity(entity_id));
CREATE POLICY payroll_remittances_write ON payroll_remittances FOR ALL TO nfc_app
  USING (
    (app.has_permission('payroll.pay') OR app.has_permission('payroll.run.prepare'))
    AND app.can_access_entity(entity_id)
  )
  WITH CHECK (
    (app.has_permission('payroll.pay') OR app.has_permission('payroll.run.prepare'))
    AND app.can_access_entity(entity_id)
  );


CREATE TABLE payroll_payslips (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES payroll_runs (id),
  employee_id   uuid NOT NULL REFERENCES hr_employees (id),
  entity_id     uuid NOT NULL REFERENCES entities (id),
  document_id   uuid NOT NULL REFERENCES documents (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  UNIQUE (run_id, employee_id)
);

SELECT app.apply_append_only_conventions('payroll_payslips');
ALTER TABLE payroll_payslips ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_payslips_select ON payroll_payslips FOR SELECT TO nfc_app
  USING (app.has_permission('payroll.view') AND app.can_access_entity(entity_id));
CREATE POLICY payroll_payslips_insert ON payroll_payslips FOR INSERT TO nfc_app
  WITH CHECK (
    (app.has_permission('payroll.pay') OR app.has_permission('payroll.run.approve'))
    AND app.can_access_entity(entity_id)
  );


ALTER TABLE payroll_loan_schedule
  ADD CONSTRAINT payroll_loan_schedule_run_fk
  FOREIGN KEY (applied_run_id) REFERENCES payroll_runs (id);


INSERT INTO workflow_definitions (key, name, version, created_by, updated_by)
VALUES ('payroll-run-v1', 'Payroll run approval', 1, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO workflow_stages (
  definition_id, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days, created_by
)
SELECT d.id, s.sort_order, s.key, s.label, s.required_permission, s.scope_resolver, s.allowed_actions, s.sla_days, 'system:seed'
  FROM workflow_definitions d
  JOIN (VALUES
    ('payroll-run-v1', 1, 'finance-head', 'Finance Head', 'payroll.run.approve', 'SAME_ENTITY',
      ARRAY['APPROVE', 'REJECT'], 3),
    ('payroll-run-v1', 2, 'ed-finance', 'ED Finance', 'payroll.run.approve', 'CORPORATE',
      ARRAY['APPROVE', 'REJECT'], 3)
  ) AS s(def_key, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days)
    ON s.def_key = d.key
ON CONFLICT (definition_id, key) DO NOTHING;


INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('payroll.submitted', 'notify.generic', 'system:seed'),
  ('payroll.approved', 'notify.generic', 'system:seed'),
  ('payroll.rejected', 'notify.generic', 'system:seed'),
  ('payroll.paid', 'notify.generic', 'system:seed'),
  ('payroll.period_close_reminder', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  ('payroll.submitted', 'action_required', 'Payroll {reference} awaits approval',
    '{title} {reference} has been submitted for payroll approval.', true, true, 'system:seed'),
  ('payroll.approved', 'engine', 'Payroll {reference} locked',
    'Payroll {reference} has been approved and locked.', true, false, 'system:seed'),
  ('payroll.rejected', 'action_required', 'Payroll {reference} rejected',
    'Payroll {reference} was rejected. Reason: {reason}', true, true, 'system:seed'),
  ('payroll.paid', 'engine', 'Payroll {reference} paid',
    'Payroll {reference} has been paid and posted to the ledger.', true, false, 'system:seed'),
  ('payroll.period_close_reminder', 'action_required', 'Draft payroll {reference} near period close',
    'A draft payroll run remains open as the fiscal period closes.', true, true, 'system:seed')
ON CONFLICT (type) DO NOTHING;


ALTER TABLE org_reports ADD COLUMN IF NOT EXISTS snapshot jsonb;

UPDATE org_report_templates
   SET available = true,
       required_permission = 'hr.employee.view',
       fields = jsonb_build_object(
         'sections', jsonb_build_array(
           jsonb_build_object('key', 'period', 'label', 'Reporting period'),
           jsonb_build_object('key', 'headcount', 'label', 'Headcount by subsidiary'),
           jsonb_build_object('key', 'vacancies', 'label', 'Open vacancies'),
           jsonb_build_object('key', 'leave', 'label', 'Leave days in period')
         )
       ),
       updated_by = 'system:seed'
 WHERE key = 'hr_staff';

UPDATE org_report_templates
   SET available = true,
       required_permission = 'payroll.view',
       fields = jsonb_build_object(
         'sections', jsonb_build_array(
           jsonb_build_object('key', 'period', 'label', 'Payroll period'),
           jsonb_build_object('key', 'gross', 'label', 'Gross pay'),
           jsonb_build_object('key', 'net', 'label', 'Net pay'),
           jsonb_build_object('key', 'paye', 'label', 'PAYE'),
           jsonb_build_object('key', 'pension', 'label', 'Pension'),
           jsonb_build_object('key', 'variance', 'label', 'Variance versus prior run')
         )
       ),
       updated_by = 'system:seed'
 WHERE key = 'payroll';
