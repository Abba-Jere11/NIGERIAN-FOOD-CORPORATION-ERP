-- ---------------------------------------------------------------------------
-- 0023_finance_m10
--
-- Finance 1: fiscal calendar, chart of accounts, journals, banking extensions,
-- versioned budgets. Procurement PAY/TRF stay off-ledger (M11).
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
    'PR','PAY','TRF','GRN','INV','EMP','DOC','SEAL','JNL','BUD','VND','CUS','SO','PRD','PRL','LV','VAC'
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


CREATE TABLE fiscal_years (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities (id),
  year        integer NOT NULL,
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  status      text NOT NULL DEFAULT 'OPEN',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT fiscal_years_year CHECK (year >= 2000),
  CONSTRAINT fiscal_years_range CHECK (ends_on >= starts_on),
  CONSTRAINT fiscal_years_status CHECK (status IN ('OPEN', 'CLOSED', 'LOCKED')),
  CONSTRAINT fiscal_years_entity_year UNIQUE (entity_id, year)
);

SELECT app.apply_mutable_conventions('fiscal_years', 'entity_id');


CREATE TABLE fiscal_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year_id  uuid NOT NULL REFERENCES fiscal_years (id),
  entity_id       uuid NOT NULL REFERENCES entities (id),
  period_index    integer NOT NULL,
  name            text NOT NULL,
  starts_on       date NOT NULL,
  ends_on         date NOT NULL,
  status          text NOT NULL DEFAULT 'OPEN',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL,
  row_version     integer NOT NULL DEFAULT 1,
  CONSTRAINT fiscal_periods_index CHECK (period_index BETWEEN 1 AND 12),
  CONSTRAINT fiscal_periods_range CHECK (ends_on >= starts_on),
  CONSTRAINT fiscal_periods_status CHECK (status IN ('OPEN', 'CLOSED', 'LOCKED')),
  CONSTRAINT fiscal_periods_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT fiscal_periods_year_index UNIQUE (fiscal_year_id, period_index)
);

SELECT app.apply_mutable_conventions('fiscal_periods', 'entity_id');


CREATE TABLE account_templates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE,
  name                text NOT NULL,
  type                text NOT NULL,
  parent_code         text,
  normal_balance      text NOT NULL,
  consolidation_code  text NOT NULL,
  intercompany        boolean NOT NULL DEFAULT false,
  sort_order          integer NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text NOT NULL,
  CONSTRAINT account_templates_type CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE')),
  CONSTRAINT account_templates_balance CHECK (normal_balance IN ('DEBIT', 'CREDIT')),
  CONSTRAINT account_templates_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT account_templates_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TABLE accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id           uuid NOT NULL REFERENCES entities (id),
  template_id         uuid REFERENCES account_templates (id),
  code                text NOT NULL,
  name                text NOT NULL,
  type                text NOT NULL,
  parent_id           uuid REFERENCES accounts (id),
  normal_balance      text NOT NULL,
  active              boolean NOT NULL DEFAULT true,
  consolidation_code  text NOT NULL,
  intercompany        boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text NOT NULL,
  row_version         integer NOT NULL DEFAULT 1,
  CONSTRAINT accounts_type CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE')),
  CONSTRAINT accounts_balance CHECK (normal_balance IN ('DEBIT', 'CREDIT')),
  CONSTRAINT accounts_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT accounts_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT accounts_entity_code UNIQUE (entity_id, code)
);

SELECT app.apply_mutable_conventions('accounts', 'entity_id');


CREATE TABLE journals (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number        text NOT NULL UNIQUE,
  entity_id               uuid NOT NULL REFERENCES entities (id),
  fiscal_period_id        uuid NOT NULL REFERENCES fiscal_periods (id),
  status                  text NOT NULL DEFAULT 'DRAFT',
  source                  text NOT NULL DEFAULT 'MANUAL',
  narration               text NOT NULL,
  reverses_journal_id     uuid REFERENCES journals (id),
  workflow_instance_id    uuid REFERENCES workflow_instances (id),
  idempotency_key         text NOT NULL UNIQUE,
  posted_at               timestamptz,
  posted_by               text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              text NOT NULL,
  row_version             integer NOT NULL DEFAULT 1,
  CONSTRAINT journals_status CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'REVERSED')),
  CONSTRAINT journals_source CHECK (source IN ('MANUAL', 'BANK_TRANSFER', 'RECONCILIATION', 'REVERSAL')),
  CONSTRAINT journals_narration_not_blank CHECK (btrim(narration) <> '')
);

SELECT app.apply_mutable_conventions('journals', 'entity_id');
SELECT app.protect_reference_number('journals');


CREATE TABLE journal_lines (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id              uuid NOT NULL REFERENCES journals (id),
  entity_id               uuid NOT NULL REFERENCES entities (id),
  account_id              uuid NOT NULL REFERENCES accounts (id),
  line_number             integer NOT NULL,
  debit_kobo              bigint NOT NULL DEFAULT 0,
  credit_kobo             bigint NOT NULL DEFAULT 0,
  narration               text,
  department_id           uuid REFERENCES departments (id),
  project_id              uuid REFERENCES projects (id),
  procurement_request_id  uuid REFERENCES procurement_requests (id),
  vendor_id               uuid REFERENCES vendors (id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              text NOT NULL,
  row_version             integer NOT NULL DEFAULT 1,
  CONSTRAINT journal_lines_amount CHECK (
    (debit_kobo > 0 AND credit_kobo = 0) OR (credit_kobo > 0 AND debit_kobo = 0)
  ),
  CONSTRAINT journal_lines_number CHECK (line_number >= 1),
  CONSTRAINT journal_lines_unique_number UNIQUE (journal_id, line_number)
);

SELECT app.apply_mutable_conventions('journal_lines', 'entity_id');


CREATE OR REPLACE FUNCTION app.journal_totals(p_journal uuid)
RETURNS TABLE (debit bigint, credit bigint)
LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(debit_kobo), 0), coalesce(sum(credit_kobo), 0)
    FROM journal_lines WHERE journal_id = p_journal;
$$;

CREATE OR REPLACE FUNCTION app.assert_journal_balanced()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE totals record;
BEGIN
  IF NEW.status IN ('PENDING_APPROVAL', 'POSTED') THEN
    SELECT * INTO totals FROM app.journal_totals(NEW.id);
    IF totals.debit = 0 OR totals.debit <> totals.credit THEN
      RAISE EXCEPTION 'An unbalanced journal cannot be saved.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('POSTED', 'REVERSED') THEN
    IF NEW.status = OLD.status
       AND NEW.narration IS NOT DISTINCT FROM OLD.narration
       AND NEW.fiscal_period_id IS NOT DISTINCT FROM OLD.fiscal_period_id
       AND NEW.workflow_instance_id IS NOT DISTINCT FROM OLD.workflow_instance_id
       AND NEW.posted_at IS NOT DISTINCT FROM OLD.posted_at
       AND NEW.posted_by IS NOT DISTINCT FROM OLD.posted_by
       AND NEW.reverses_journal_id IS NOT DISTINCT FROM OLD.reverses_journal_id THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED' THEN
      RETURN NEW;
    END IF;
    IF NEW.workflow_instance_id IS DISTINCT FROM OLD.workflow_instance_id
       AND OLD.status IN ('DRAFT', 'PENDING_APPROVAL') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'A posted journal cannot be edited or deleted.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journals_balanced_and_posted
  BEFORE INSERT OR UPDATE ON journals
  FOR EACH ROW EXECUTE FUNCTION app.assert_journal_balanced();

CREATE OR REPLACE FUNCTION app.forbid_posted_journal_line_change()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM journals WHERE id = coalesce(NEW.journal_id, OLD.journal_id);
  IF st IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'A posted journal cannot be edited or deleted.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_lines_posted_guard
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION app.forbid_posted_journal_line_change();

CREATE OR REPLACE FUNCTION app.forbid_account_type_change()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM OLD.type AND EXISTS (
    SELECT 1 FROM journal_lines WHERE account_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'An account with postings cannot change type.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_type_guard
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION app.forbid_account_type_change();

CREATE OR REPLACE FUNCTION app.assert_period_open_for_journal()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  IF NEW.status IN ('PENDING_APPROVAL', 'POSTED') THEN
    SELECT status INTO st FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
    IF st IS DISTINCT FROM 'OPEN' THEN
      RAISE EXCEPTION 'Posting to a closed period is not allowed.'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journals_period_open
  BEFORE INSERT OR UPDATE ON journals
  FOR EACH ROW EXECUTE FUNCTION app.assert_period_open_for_journal();


ALTER TABLE entity_bank_accounts
  ADD COLUMN IF NOT EXISTS gl_account_id uuid REFERENCES accounts (id);


CREATE TABLE bank_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES entity_bank_accounts (id),
  entity_id       uuid NOT NULL REFERENCES entities (id),
  kind            text NOT NULL,
  amount_kobo     bigint NOT NULL,
  occurred_on     date NOT NULL,
  narration       text NOT NULL,
  journal_id      uuid REFERENCES journals (id),
  transfer_id     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  CONSTRAINT bank_transactions_kind CHECK (kind IN ('TRANSFER_OUT', 'TRANSFER_IN', 'STATEMENT', 'ADJUSTMENT')),
  CONSTRAINT bank_transactions_amount CHECK (amount_kobo <> 0),
  CONSTRAINT bank_transactions_narration CHECK (btrim(narration) <> '')
);

SELECT app.apply_append_only_conventions('bank_transactions', 'entity_id');


CREATE TABLE bank_transfers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id           uuid NOT NULL REFERENCES entities (id),
  source_account_id   uuid NOT NULL REFERENCES entity_bank_accounts (id),
  destination_account_id uuid NOT NULL REFERENCES entity_bank_accounts (id),
  amount_kobo         bigint NOT NULL,
  occurred_on         date NOT NULL,
  narration           text NOT NULL,
  journal_id          uuid REFERENCES journals (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text NOT NULL,
  CONSTRAINT bank_transfers_amount CHECK (amount_kobo > 0),
  CONSTRAINT bank_transfers_distinct CHECK (source_account_id <> destination_account_id),
  CONSTRAINT bank_transfers_narration CHECK (btrim(narration) <> '')
);

SELECT app.apply_append_only_conventions('bank_transfers', 'entity_id');

ALTER TABLE bank_transactions
  ADD CONSTRAINT bank_transactions_transfer_fk
    FOREIGN KEY (transfer_id) REFERENCES bank_transfers (id);


CREATE TABLE bank_statements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES entity_bank_accounts (id),
  entity_id       uuid NOT NULL REFERENCES entities (id),
  reference       text NOT NULL,
  imported_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  CONSTRAINT bank_statements_reference CHECK (btrim(reference) <> '')
);

SELECT app.apply_append_only_conventions('bank_statements', 'entity_id');


CREATE TABLE bank_statement_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id    uuid NOT NULL REFERENCES bank_statements (id),
  entity_id       uuid NOT NULL REFERENCES entities (id),
  occurred_on     date NOT NULL,
  description     text NOT NULL,
  amount_kobo     bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  CONSTRAINT bank_statement_lines_amount CHECK (amount_kobo <> 0),
  CONSTRAINT bank_statement_lines_description CHECK (btrim(description) <> '')
);

SELECT app.apply_append_only_conventions('bank_statement_lines', 'entity_id');


CREATE TABLE bank_reconciliation_matches (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id             uuid NOT NULL REFERENCES entities (id),
  statement_line_id     uuid NOT NULL REFERENCES bank_statement_lines (id),
  bank_transaction_id   uuid REFERENCES bank_transactions (id),
  journal_line_id       uuid REFERENCES journal_lines (id),
  reason                text,
  unmatched_at          timestamptz,
  unmatched_reason      text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  row_version           integer NOT NULL DEFAULT 1,
  CONSTRAINT bank_reconciliation_target CHECK (
    bank_transaction_id IS NOT NULL OR journal_line_id IS NOT NULL
  ),
  CONSTRAINT bank_reconciliation_unmatch_reason CHECK (
    unmatched_at IS NULL OR btrim(coalesce(unmatched_reason, '')) <> ''
  )
);

SELECT app.apply_mutable_conventions('bank_reconciliation_matches', 'entity_id');

CREATE UNIQUE INDEX bank_reconciliation_open_line
  ON bank_reconciliation_matches (statement_line_id)
  WHERE unmatched_at IS NULL;


CREATE TABLE budgets (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number        text NOT NULL UNIQUE,
  entity_id               uuid NOT NULL REFERENCES entities (id),
  fiscal_year_id          uuid NOT NULL REFERENCES fiscal_years (id),
  version_number          integer NOT NULL,
  status                  text NOT NULL DEFAULT 'DRAFT',
  workflow_instance_id    uuid REFERENCES workflow_instances (id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              text NOT NULL,
  row_version             integer NOT NULL DEFAULT 1,
  CONSTRAINT budgets_status CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
  CONSTRAINT budgets_version CHECK (version_number >= 1),
  CONSTRAINT budgets_entity_year_version UNIQUE (entity_id, fiscal_year_id, version_number)
);

SELECT app.apply_mutable_conventions('budgets', 'entity_id');
SELECT app.protect_reference_number('budgets');


ALTER TABLE budget_lines
  ADD COLUMN IF NOT EXISTS budget_id uuid REFERENCES budgets (id),
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments (id);

CREATE TABLE budget_version_lines (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id               uuid NOT NULL REFERENCES budgets (id),
  entity_id               uuid NOT NULL REFERENCES entities (id),
  code                    text NOT NULL,
  name                    text NOT NULL,
  approved_amount_kobo    bigint NOT NULL,
  department_id           uuid REFERENCES departments (id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL,
  CONSTRAINT budget_version_lines_amount CHECK (approved_amount_kobo >= 0),
  CONSTRAINT budget_version_lines_code CHECK (btrim(code) <> ''),
  CONSTRAINT budget_version_lines_budget_code UNIQUE (budget_id, code)
);

SELECT app.apply_append_only_conventions('budget_version_lines', 'entity_id');


INSERT INTO account_templates (
  code, name, type, parent_code, normal_balance, consolidation_code, intercompany, sort_order, created_by
) VALUES
  ('1000', 'Assets', 'ASSET', NULL, 'DEBIT', '1000', false, 10, 'system:seed'),
  ('1100', 'Cash and bank', 'ASSET', '1000', 'DEBIT', '1100', false, 20, 'system:seed'),
  ('1110', 'Cash on hand', 'ASSET', '1100', 'DEBIT', '1110', false, 30, 'system:seed'),
  ('1120', 'Bank — operating', 'ASSET', '1100', 'DEBIT', '1120', false, 40, 'system:seed'),
  ('1130', 'Bank — holding', 'ASSET', '1100', 'DEBIT', '1130', false, 50, 'system:seed'),
  ('1200', 'Receivables', 'ASSET', '1000', 'DEBIT', '1200', false, 60, 'system:seed'),
  ('1210', 'Intercompany receivable', 'ASSET', '1200', 'DEBIT', '1210', true, 70, 'system:seed'),
  ('1300', 'Prepayments', 'ASSET', '1000', 'DEBIT', '1300', false, 80, 'system:seed'),
  ('1400', 'Inventory', 'ASSET', '1000', 'DEBIT', '1400', false, 90, 'system:seed'),
  ('1500', 'Property, plant and equipment', 'ASSET', '1000', 'DEBIT', '1500', false, 100, 'system:seed'),
  ('2000', 'Liabilities', 'LIABILITY', NULL, 'CREDIT', '2000', false, 110, 'system:seed'),
  ('2100', 'Payables', 'LIABILITY', '2000', 'CREDIT', '2100', false, 120, 'system:seed'),
  ('2110', 'Trade payables', 'LIABILITY', '2100', 'CREDIT', '2110', false, 130, 'system:seed'),
  ('2120', 'Intercompany payable', 'LIABILITY', '2100', 'CREDIT', '2120', true, 140, 'system:seed'),
  ('2200', 'Accruals', 'LIABILITY', '2000', 'CREDIT', '2200', false, 150, 'system:seed'),
  ('3000', 'Equity', 'EQUITY', NULL, 'CREDIT', '3000', false, 160, 'system:seed'),
  ('3100', 'Share capital', 'EQUITY', '3000', 'CREDIT', '3100', false, 170, 'system:seed'),
  ('3200', 'Retained earnings', 'EQUITY', '3000', 'CREDIT', '3200', false, 180, 'system:seed'),
  ('4000', 'Income', 'INCOME', NULL, 'CREDIT', '4000', false, 190, 'system:seed'),
  ('4100', 'Sales', 'INCOME', '4000', 'CREDIT', '4100', false, 200, 'system:seed'),
  ('4200', 'Other income', 'INCOME', '4000', 'CREDIT', '4200', false, 210, 'system:seed'),
  ('5000', 'Expenses', 'EXPENSE', NULL, 'DEBIT', '5000', false, 220, 'system:seed'),
  ('5100', 'Cost of sales', 'EXPENSE', '5000', 'DEBIT', '5100', false, 230, 'system:seed'),
  ('5200', 'Operating expenses', 'EXPENSE', '5000', 'DEBIT', '5200', false, 240, 'system:seed'),
  ('5210', 'Personnel', 'EXPENSE', '5200', 'DEBIT', '5210', false, 250, 'system:seed'),
  ('5220', 'Administration', 'EXPENSE', '5200', 'DEBIT', '5220', false, 260, 'system:seed'),
  ('5300', 'Capital expenditure', 'EXPENSE', '5000', 'DEBIT', '5300', false, 270, 'system:seed')
ON CONFLICT (code) DO NOTHING;


INSERT INTO workflow_definitions (key, name, version, created_by, updated_by)
VALUES
  ('journal-v1', 'Manual journal approval', 1, 'system:seed', 'system:seed'),
  ('budget-v1', 'Budget approval', 1, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO workflow_stages (
  definition_id, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days, created_by
)
SELECT d.id, s.sort_order, s.key, s.label, s.required_permission, s.scope_resolver, s.allowed_actions, s.sla_days, 'system:seed'
  FROM workflow_definitions d
  JOIN (VALUES
    ('journal-v1', 1, 'review', 'Journal approval', 'finance.journal.approve', 'ALL',
      ARRAY['APPROVE', 'REJECT'], 2),
    ('budget-v1', 1, 'review', 'Budget approval', 'finance.budget.approve', 'ALL',
      ARRAY['APPROVE', 'REJECT'], 2)
  ) AS s(def_key, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days)
    ON s.def_key = d.key
ON CONFLICT (definition_id, key) DO NOTHING;


INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('journal.submitted', 'notify.generic', 'system:seed'),
  ('journal.approved', 'notify.generic', 'system:seed'),
  ('journal.rejected', 'notify.generic', 'system:seed'),
  ('budget.submitted', 'notify.generic', 'system:seed'),
  ('budget.approved', 'notify.generic', 'system:seed'),
  ('budget.rejected', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  ('journal.submitted', 'action_required', 'Journal {reference} awaits approval',
    '{title} {reference} has been submitted for journal approval.', true, true, 'system:seed'),
  ('journal.approved', 'engine', 'Journal {reference} posted',
    'Journal {reference} has been approved and posted.', true, false, 'system:seed'),
  ('journal.rejected', 'action_required', 'Journal {reference} rejected',
    'Journal {reference} was rejected. Reason: {reason}', true, true, 'system:seed'),
  ('budget.submitted', 'action_required', 'Budget {reference} awaits approval',
    'Budget {reference} has been submitted for approval.', true, true, 'system:seed'),
  ('budget.approved', 'engine', 'Budget {reference} approved',
    'Budget {reference} has been approved.', true, false, 'system:seed'),
  ('budget.rejected', 'action_required', 'Budget {reference} rejected',
    'Budget {reference} was rejected. Reason: {reason}', true, true, 'system:seed')
ON CONFLICT (type) DO NOTHING;


CREATE OR REPLACE FUNCTION app.permission_is_approval_or_payment(p_key text)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_key IN (
    'procurement.approve.operations',
    'procurement.approve.final',
    'procurement.reject',
    'procurement.return',
    'procurement.archive',
    'procurement.restore',
    'procurement.review.finance',
    'procurement.verify.delivery',
    'procurement.grn.record',
    'procurement.close_short.request',
    'procurement.package.download',
    'procurement.report.view',
    'finance.payment.execute',
    'finance.payment.execute.corporate',
    'finance.payment.reverse.request',
    'finance.payment.reverse.approve',
    'finance.funding.authorize',
    'finance.funding.transfer.record',
    'finance.journal.prepare',
    'finance.journal.approve',
    'finance.period.close',
    'finance.bank.manage',
    'finance.reconcile',
    'finance.budget.prepare',
    'finance.budget.approve'
  );
$$;
