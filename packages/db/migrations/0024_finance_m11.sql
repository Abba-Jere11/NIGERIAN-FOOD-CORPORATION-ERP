-- ---------------------------------------------------------------------------
-- 0024_finance_m11
--
-- Finance 2: income, AR, expenses, AP, inter-subsidiary, procurement–GL link.
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
    'ICT','ARI','BILL','INC','EXP','RCT'
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


ALTER TABLE journals DROP CONSTRAINT journals_source;
ALTER TABLE journals ADD CONSTRAINT journals_source CHECK (source IN (
  'MANUAL', 'BANK_TRANSFER', 'RECONCILIATION', 'REVERSAL',
  'PROCUREMENT_PAYMENT', 'PROCUREMENT_RECLASS', 'FUNDING_TRANSFER', 'INTERCOMPANY',
  'INCOME', 'EXPENSE', 'PAYABLE', 'RECEIVABLE', 'RECEIPT'
));

ALTER TABLE bank_transactions DROP CONSTRAINT bank_transactions_kind;
ALTER TABLE bank_transactions ADD CONSTRAINT bank_transactions_kind CHECK (kind IN (
  'TRANSFER_OUT', 'TRANSFER_IN', 'STATEMENT', 'ADJUSTMENT',
  'PAYMENT', 'FUNDING_OUT', 'FUNDING_IN', 'RECEIPT'
));


INSERT INTO account_templates (
  code, name, type, parent_code, normal_balance, consolidation_code, intercompany, sort_order, created_by
) VALUES
  ('1220', 'Trade receivables', 'ASSET', '1200', 'DEBIT', '1220', false, 65, 'system:seed'),
  ('4110', 'Service income', 'INCOME', '4000', 'CREDIT', '4110', false, 205, 'system:seed'),
  ('5230', 'Utilities', 'EXPENSE', '5200', 'DEBIT', '5230', false, 262, 'system:seed'),
  ('5240', 'Maintenance', 'EXPENSE', '5200', 'DEBIT', '5240', false, 264, 'system:seed'),
  ('5250', 'Transport', 'EXPENSE', '5200', 'DEBIT', '5250', false, 266, 'system:seed'),
  ('5260', 'Other expenses', 'EXPENSE', '5200', 'DEBIT', '5260', false, 268, 'system:seed')
ON CONFLICT (code) DO NOTHING;

INSERT INTO accounts (
  entity_id, template_id, code, name, type, parent_id, normal_balance, consolidation_code,
  intercompany, created_by, updated_by
)
SELECT e.id, t.id, t.code, t.name, t.type, p.id, t.normal_balance, t.consolidation_code,
       t.intercompany, 'system:seed', 'system:seed'
  FROM entities e
  JOIN account_templates t ON t.code IN ('1220', '4110', '5230', '5240', '5250', '5260')
  LEFT JOIN accounts p ON p.entity_id = e.id AND p.code = t.parent_code
 WHERE EXISTS (SELECT 1 FROM accounts a WHERE a.entity_id = e.id)
ON CONFLICT (entity_id, code) DO NOTHING;


CREATE TABLE income_categories (
  key           text PRIMARY KEY,
  name          text NOT NULL,
  account_code  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL,
  row_version   integer NOT NULL DEFAULT 1,
  CONSTRAINT income_categories_name_not_blank CHECK (btrim(name) <> '')
);

SELECT app.apply_mutable_conventions('income_categories');

CREATE TABLE expense_categories (
  key           text PRIMARY KEY,
  name          text NOT NULL,
  account_code  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL,
  row_version   integer NOT NULL DEFAULT 1,
  CONSTRAINT expense_categories_name_not_blank CHECK (btrim(name) <> '')
);

SELECT app.apply_mutable_conventions('expense_categories');

CREATE TABLE category_posting_rules (
  procurement_category_key  text PRIMARY KEY,
  prepayment_account_code   text NOT NULL,
  completion_account_code   text NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                text NOT NULL,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                text NOT NULL,
  row_version               integer NOT NULL DEFAULT 1
);

SELECT app.apply_mutable_conventions('category_posting_rules');

INSERT INTO income_categories (key, name, account_code, created_by, updated_by) VALUES
  ('sales', 'Sales', '4100', 'system:seed', 'system:seed'),
  ('service', 'Service income', '4110', 'system:seed', 'system:seed'),
  ('other', 'Other income', '4200', 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO expense_categories (key, name, account_code, created_by, updated_by) VALUES
  ('operating', 'Operating expenses', '5200', 'system:seed', 'system:seed'),
  ('utilities', 'Utilities', '5230', 'system:seed', 'system:seed'),
  ('maintenance', 'Maintenance', '5240', 'system:seed', 'system:seed'),
  ('transport', 'Transport', '5250', 'system:seed', 'system:seed'),
  ('admin', 'Administration', '5220', 'system:seed', 'system:seed'),
  ('other', 'Other expenses', '5260', 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO category_posting_rules (
  procurement_category_key, prepayment_account_code, completion_account_code, created_by, updated_by
) VALUES
  ('goods', '1300', '1400', 'system:seed', 'system:seed'),
  ('equipment', '1300', '1500', 'system:seed', 'system:seed'),
  ('services', '1300', '5220', 'system:seed', 'system:seed')
ON CONFLICT (procurement_category_key) DO NOTHING;


CREATE TABLE customers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number   text NOT NULL UNIQUE,
  entity_id          uuid NOT NULL REFERENCES entities (id),
  name               text NOT NULL,
  contacts           jsonb NOT NULL DEFAULT '[]'::jsonb,
  terms_days         integer NOT NULL DEFAULT 30,
  credit_limit_kobo  bigint NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'ACTIVE',
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text NOT NULL,
  row_version        integer NOT NULL DEFAULT 1,
  CONSTRAINT customers_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT customers_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT customers_terms CHECK (terms_days >= 0),
  CONSTRAINT customers_credit CHECK (credit_limit_kobo >= 0)
);

SELECT app.apply_mutable_conventions('customers', 'entity_id');
SELECT app.protect_reference_number('customers');


CREATE TABLE income_entries (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number        text NOT NULL UNIQUE,
  entity_id               uuid NOT NULL REFERENCES entities (id),
  category_key            text NOT NULL REFERENCES income_categories (key),
  settlement              text NOT NULL,
  customer_id             uuid REFERENCES customers (id),
  bank_account_id         uuid REFERENCES entity_bank_accounts (id),
  amount_kobo             bigint NOT NULL,
  occurred_on             date NOT NULL,
  due_date                date,
  narration               text NOT NULL,
  document_id             uuid REFERENCES documents (id),
  journal_id              uuid REFERENCES journals (id),
  receivable_invoice_id   uuid,
  workflow_instance_id    uuid REFERENCES workflow_instances (id),
  status                  text NOT NULL DEFAULT 'DRAFT',
  idempotency_key         text NOT NULL UNIQUE,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              text NOT NULL,
  row_version             integer NOT NULL DEFAULT 1,
  CONSTRAINT income_entries_settlement CHECK (settlement IN ('INVOICE', 'CASH')),
  CONSTRAINT income_entries_status CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'REJECTED')),
  CONSTRAINT income_entries_amount CHECK (amount_kobo > 0),
  CONSTRAINT income_entries_narration CHECK (btrim(narration) <> '')
);

SELECT app.apply_mutable_conventions('income_entries', 'entity_id');
SELECT app.protect_reference_number('income_entries');


CREATE TABLE expense_entries (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number        text NOT NULL UNIQUE,
  entity_id               uuid NOT NULL REFERENCES entities (id),
  category_key            text NOT NULL REFERENCES expense_categories (key),
  settlement              text NOT NULL,
  vendor_id               uuid REFERENCES vendors (id),
  bank_account_id         uuid REFERENCES entity_bank_accounts (id),
  amount_kobo             bigint NOT NULL,
  occurred_on             date NOT NULL,
  due_date                date,
  narration               text NOT NULL,
  document_id             uuid REFERENCES documents (id),
  journal_id              uuid REFERENCES journals (id),
  payable_invoice_id      uuid,
  workflow_instance_id    uuid REFERENCES workflow_instances (id),
  status                  text NOT NULL DEFAULT 'DRAFT',
  idempotency_key         text NOT NULL UNIQUE,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              text NOT NULL,
  row_version             integer NOT NULL DEFAULT 1,
  CONSTRAINT expense_entries_settlement CHECK (settlement IN ('ON_ACCOUNT', 'CASH')),
  CONSTRAINT expense_entries_status CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'REJECTED')),
  CONSTRAINT expense_entries_amount CHECK (amount_kobo > 0),
  CONSTRAINT expense_entries_narration CHECK (btrim(narration) <> '')
);

SELECT app.apply_mutable_conventions('expense_entries', 'entity_id');
SELECT app.protect_reference_number('expense_entries');


CREATE TABLE receivable_invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number   text NOT NULL UNIQUE,
  entity_id          uuid NOT NULL REFERENCES entities (id),
  customer_id        uuid NOT NULL REFERENCES customers (id),
  income_entry_id    uuid REFERENCES income_entries (id),
  invoice_date       date NOT NULL,
  due_date           date NOT NULL,
  amount_kobo        bigint NOT NULL,
  allocated_kobo     bigint NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'OPEN',
  journal_id         uuid REFERENCES journals (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text NOT NULL,
  row_version        integer NOT NULL DEFAULT 1,
  CONSTRAINT receivable_invoices_amount CHECK (amount_kobo > 0),
  CONSTRAINT receivable_invoices_allocated CHECK (allocated_kobo >= 0 AND allocated_kobo <= amount_kobo),
  CONSTRAINT receivable_invoices_status CHECK (status IN ('OPEN', 'PART_PAID', 'PAID'))
);

SELECT app.apply_mutable_conventions('receivable_invoices', 'entity_id');
SELECT app.protect_reference_number('receivable_invoices');

ALTER TABLE income_entries
  ADD CONSTRAINT income_entries_receivable_fk
  FOREIGN KEY (receivable_invoice_id) REFERENCES receivable_invoices (id);


CREATE TABLE receipts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number   text NOT NULL UNIQUE,
  entity_id          uuid NOT NULL REFERENCES entities (id),
  customer_id        uuid NOT NULL REFERENCES customers (id),
  bank_account_id    uuid NOT NULL REFERENCES entity_bank_accounts (id),
  received_on        date NOT NULL,
  amount_kobo        bigint NOT NULL,
  journal_id         uuid REFERENCES journals (id),
  idempotency_key    text NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text NOT NULL,
  row_version        integer NOT NULL DEFAULT 1,
  CONSTRAINT receipts_amount CHECK (amount_kobo > 0)
);

SELECT app.apply_mutable_conventions('receipts', 'entity_id');
SELECT app.protect_reference_number('receipts');


CREATE TABLE receipt_allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id      uuid NOT NULL REFERENCES receipts (id),
  invoice_id      uuid NOT NULL REFERENCES receivable_invoices (id),
  entity_id       uuid NOT NULL REFERENCES entities (id),
  amount_kobo     bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  CONSTRAINT receipt_allocations_amount CHECK (amount_kobo > 0),
  CONSTRAINT receipt_allocations_unique UNIQUE (receipt_id, invoice_id)
);

SELECT app.apply_append_only_conventions('receipt_allocations', 'entity_id');


CREATE TABLE payable_invoices (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number         text NOT NULL UNIQUE,
  entity_id                uuid NOT NULL REFERENCES entities (id),
  vendor_id                uuid REFERENCES vendors (id),
  source                   text NOT NULL,
  procurement_request_id   uuid REFERENCES procurement_requests (id),
  procurement_invoice_id   uuid REFERENCES procurement_invoices (id),
  expense_entry_id         uuid REFERENCES expense_entries (id),
  invoice_date             date NOT NULL,
  due_date                 date NOT NULL,
  amount_kobo              bigint NOT NULL,
  paid_kobo                bigint NOT NULL DEFAULT 0,
  status                   text NOT NULL DEFAULT 'DRAFT',
  journal_id               uuid REFERENCES journals (id),
  workflow_instance_id     uuid REFERENCES workflow_instances (id),
  document_id              uuid REFERENCES documents (id),
  narration                text NOT NULL DEFAULT '',
  idempotency_key          text UNIQUE,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               text NOT NULL,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               text NOT NULL,
  row_version              integer NOT NULL DEFAULT 1,
  CONSTRAINT payable_invoices_source CHECK (source IN ('BILL', 'PROCUREMENT', 'EXPENSE')),
  CONSTRAINT payable_invoices_status CHECK (status IN (
    'DRAFT', 'PENDING_APPROVAL', 'UNPAID', 'PART_PAID', 'PAID', 'REJECTED'
  )),
  CONSTRAINT payable_invoices_amount CHECK (amount_kobo > 0),
  CONSTRAINT payable_invoices_paid CHECK (paid_kobo >= 0 AND paid_kobo <= amount_kobo)
);

SELECT app.apply_mutable_conventions('payable_invoices', 'entity_id');
SELECT app.protect_reference_number('payable_invoices');

ALTER TABLE expense_entries
  ADD CONSTRAINT expense_entries_payable_fk
  FOREIGN KEY (payable_invoice_id) REFERENCES payable_invoices (id);


CREATE TABLE intercompany_transactions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number         text NOT NULL UNIQUE,
  type                     text NOT NULL,
  source_entity_id         uuid NOT NULL REFERENCES entities (id),
  destination_entity_id    uuid NOT NULL REFERENCES entities (id),
  amount_kobo              bigint NOT NULL,
  occurred_on              date NOT NULL,
  narration                text NOT NULL,
  funding_transfer_id      uuid REFERENCES funding_transfer_records (id),
  source_journal_id        uuid REFERENCES journals (id),
  destination_journal_id   uuid REFERENCES journals (id),
  source_bank_account_id   uuid REFERENCES entity_bank_accounts (id),
  dest_bank_account_id     uuid REFERENCES entity_bank_accounts (id),
  acknowledged_at          timestamptz,
  acknowledged_by          text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               text NOT NULL,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               text NOT NULL,
  row_version              integer NOT NULL DEFAULT 1,
  CONSTRAINT intercompany_type CHECK (type IN ('funding_allocation', 'loan', 'recharge', 'transfer')),
  CONSTRAINT intercompany_amount CHECK (amount_kobo > 0),
  CONSTRAINT intercompany_distinct CHECK (source_entity_id <> destination_entity_id),
  CONSTRAINT intercompany_narration CHECK (btrim(narration) <> '')
);

SELECT app.apply_mutable_conventions('intercompany_transactions');
SELECT app.protect_reference_number('intercompany_transactions');

ALTER TABLE intercompany_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY intercompany_entity_access ON intercompany_transactions
  FOR ALL TO nfc_app
  USING (
    app.can_access_entity(source_entity_id)
    OR app.can_access_entity(destination_entity_id)
  )
  WITH CHECK (
    app.can_access_entity(source_entity_id)
    OR app.can_access_entity(destination_entity_id)
  );


CREATE TABLE budget_commitment_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid REFERENCES procurement_requests (id),
  entity_id       uuid NOT NULL REFERENCES entities (id),
  budget_line_id  uuid REFERENCES budget_lines (id),
  action          text NOT NULL,
  amount_kobo     bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  CONSTRAINT budget_commitment_events_action CHECK (action IN (
    'COMMIT', 'APPROVE_FINANCE', 'PAY', 'ACTUAL', 'RELEASE', 'REVERSE_PAY', 'REVERSE_ACTUAL'
  )),
  CONSTRAINT budget_commitment_events_amount CHECK (amount_kobo >= 0)
);

SELECT app.apply_append_only_conventions('budget_commitment_events', 'entity_id');


ALTER TABLE journal_lines
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers (id),
  ADD COLUMN IF NOT EXISTS intercompany_transaction_id uuid REFERENCES intercompany_transactions (id),
  ADD COLUMN IF NOT EXISTS payable_invoice_id uuid REFERENCES payable_invoices (id),
  ADD COLUMN IF NOT EXISTS receivable_invoice_id uuid REFERENCES receivable_invoices (id);


INSERT INTO workflow_definitions (key, name, version, created_by, updated_by)
VALUES
  ('income-v1', 'Income entry approval', 1, 'system:seed', 'system:seed'),
  ('expense-v1', 'Expense entry approval', 1, 'system:seed', 'system:seed'),
  ('bill-v1', 'Vendor bill approval', 1, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO workflow_stages (
  definition_id, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days, created_by
)
SELECT d.id, 1, 'review', s.label, 'finance.expense.approve', 'ALL',
       ARRAY['APPROVE', 'REJECT'], 2, 'system:seed'
  FROM workflow_definitions d
  JOIN (VALUES
    ('income-v1', 'Income approval'),
    ('expense-v1', 'Expense approval'),
    ('bill-v1', 'Bill approval')
  ) AS s(def_key, label) ON s.def_key = d.key
ON CONFLICT (definition_id, key) DO NOTHING;


INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('income.submitted', 'notify.generic', 'system:seed'),
  ('income.approved', 'notify.generic', 'system:seed'),
  ('income.rejected', 'notify.generic', 'system:seed'),
  ('expense.submitted', 'notify.generic', 'system:seed'),
  ('expense.approved', 'notify.generic', 'system:seed'),
  ('expense.rejected', 'notify.generic', 'system:seed'),
  ('bill.submitted', 'notify.generic', 'system:seed'),
  ('bill.approved', 'notify.generic', 'system:seed'),
  ('bill.rejected', 'notify.generic', 'system:seed'),
  ('intercompany.recorded', 'notify.generic', 'system:seed'),
  ('intercompany.acknowledged', 'notify.generic', 'system:seed'),
  ('receipt.recorded', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  ('income.submitted', 'action_required', 'Income {reference} awaits approval',
    '{title} {reference} has been submitted for income approval.', true, true, 'system:seed'),
  ('income.approved', 'engine', 'Income {reference} posted',
    'Income {reference} has been approved and posted.', true, false, 'system:seed'),
  ('income.rejected', 'action_required', 'Income {reference} rejected',
    'Income {reference} was rejected. Reason: {reason}', true, true, 'system:seed'),
  ('expense.submitted', 'action_required', 'Expense {reference} awaits approval',
    '{title} {reference} has been submitted for expense approval.', true, true, 'system:seed'),
  ('expense.approved', 'engine', 'Expense {reference} posted',
    'Expense {reference} has been approved and posted.', true, false, 'system:seed'),
  ('expense.rejected', 'action_required', 'Expense {reference} rejected',
    'Expense {reference} was rejected. Reason: {reason}', true, true, 'system:seed'),
  ('bill.submitted', 'action_required', 'Bill {reference} awaits approval',
    '{title} {reference} has been submitted for bill approval.', true, true, 'system:seed'),
  ('bill.approved', 'engine', 'Bill {reference} approved',
    'Bill {reference} has been approved.', true, false, 'system:seed'),
  ('bill.rejected', 'action_required', 'Bill {reference} rejected',
    'Bill {reference} was rejected. Reason: {reason}', true, true, 'system:seed'),
  ('intercompany.recorded', 'action_required', 'Inter-company {reference} recorded',
    '{title} {reference} was recorded and awaits acknowledgement.', true, true, 'system:seed'),
  ('intercompany.acknowledged', 'engine', 'Inter-company {reference} acknowledged',
    '{title} {reference} was acknowledged by the destination Finance Head.', true, false, 'system:seed'),
  ('receipt.recorded', 'engine', 'Receipt {reference} recorded',
    'Customer receipt {reference} was allocated.', true, false, 'system:seed')
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
    'finance.budget.approve',
    'finance.income.manage',
    'finance.expense.manage',
    'finance.expense.approve',
    'finance.payables.manage',
    'finance.receivables.manage',
    'finance.intercompany.create',
    'finance.intercompany.acknowledge',
    'finance.customer.manage'
  );
$$;
