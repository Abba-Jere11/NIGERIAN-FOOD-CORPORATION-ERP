-- ---------------------------------------------------------------------------
-- 0021_procurement_m8
--
-- Procurement 3 (M8): entity bank accounts, financial-check snapshots,
-- funding transfers, vendor payments, reversals. ED Finance review and
-- Finance Head payment become live on real PROCUREMENT subjects.
-- ---------------------------------------------------------------------------

ALTER TABLE procurement_requests
  ADD COLUMN funding_route text,
  ADD COLUMN authorized_amount_kobo bigint,
  ADD COLUMN paying_account_id uuid,
  ADD COLUMN destination_account_id uuid;

ALTER TABLE procurement_requests
  ADD CONSTRAINT procurement_requests_funding_route CHECK (
    funding_route IS NULL OR funding_route IN (
      'subsidiary_operating',
      'nfc_holding',
      'corporate_allocation'
    )
  ),
  ADD CONSTRAINT procurement_requests_authorized_non_negative CHECK (
    authorized_amount_kobo IS NULL OR authorized_amount_kobo >= 0
  );


CREATE TABLE procurement_policies (
  key            text PRIMARY KEY,
  integer_value  integer,
  description    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text NOT NULL,
  row_version    integer NOT NULL DEFAULT 1,
  CONSTRAINT procurement_policies_key_not_blank CHECK (btrim(key) <> '')
);

SELECT app.apply_mutable_conventions('procurement_policies');

ALTER TABLE procurement_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY procurement_policies_select ON procurement_policies
  FOR SELECT TO nfc_app USING (true);
CREATE POLICY procurement_policies_write ON procurement_policies
  FOR ALL TO nfc_app
  USING (app.has_permission('finance.funding.authorize'))
  WITH CHECK (app.has_permission('finance.funding.authorize'));

INSERT INTO procurement_policies (key, integer_value, description, created_by, updated_by)
VALUES (
  'duplicate_window_days',
  30,
  'Window in days for treating a later request as a possible duplicate of an earlier one.',
  'system:seed',
  'system:seed'
)
ON CONFLICT (key) DO NOTHING;


CREATE TABLE entity_bank_accounts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id              uuid NOT NULL REFERENCES entities (id),
  name                   text NOT NULL,
  bank_name              text NOT NULL,
  account_name           text NOT NULL,
  account_number         text NOT NULL,
  currency               text NOT NULL DEFAULT 'NGN',
  status                 record_status NOT NULL DEFAULT 'ACTIVE',
  recorded_balance_kobo  bigint NOT NULL DEFAULT 0,
  balance_as_of          date,
  balance_recorded_by    text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             text NOT NULL,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             text NOT NULL,
  row_version            integer NOT NULL DEFAULT 1,
  CONSTRAINT entity_bank_accounts_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT entity_bank_accounts_bank_not_blank CHECK (btrim(bank_name) <> ''),
  CONSTRAINT entity_bank_accounts_account_name_not_blank CHECK (btrim(account_name) <> ''),
  CONSTRAINT entity_bank_accounts_number_not_blank CHECK (btrim(account_number) <> ''),
  CONSTRAINT entity_bank_accounts_balance_non_negative CHECK (recorded_balance_kobo >= 0)
);

SELECT app.apply_mutable_conventions('entity_bank_accounts', 'entity_id');

CREATE UNIQUE INDEX entity_bank_accounts_number_key
  ON entity_bank_accounts (lower(btrim(bank_name)), btrim(account_number))
  WHERE status = 'ACTIVE';


CREATE TABLE entity_bank_balance_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES entity_bank_accounts (id),
  entity_id       uuid NOT NULL REFERENCES entities (id),
  balance_kobo    bigint NOT NULL,
  as_of           date NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  CONSTRAINT entity_bank_balance_events_non_negative CHECK (balance_kobo >= 0)
);

SELECT app.apply_append_only_conventions('entity_bank_balance_events', 'entity_id');


CREATE TABLE procurement_financial_reviews (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id              uuid NOT NULL REFERENCES procurement_requests (id),
  version_id              uuid NOT NULL REFERENCES procurement_versions (id),
  entity_id               uuid NOT NULL REFERENCES entities (id),
  checks                  jsonb NOT NULL,
  checklist_acknowledged  boolean NOT NULL,
  override_reason         text,
  funding_route           text NOT NULL,
  source_account_id       uuid REFERENCES entity_bank_accounts (id),
  destination_account_id  uuid REFERENCES entity_bank_accounts (id),
  authorized_amount_kobo  bigint NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL,
  CONSTRAINT procurement_financial_reviews_route CHECK (
    funding_route IN ('subsidiary_operating', 'nfc_holding', 'corporate_allocation')
  ),
  CONSTRAINT procurement_financial_reviews_amount CHECK (authorized_amount_kobo >= 0),
  CONSTRAINT procurement_financial_reviews_override CHECK (
    override_reason IS NULL OR btrim(override_reason) <> ''
  )
);

SELECT app.apply_append_only_conventions('procurement_financial_reviews', 'entity_id');


CREATE TABLE funding_transfer_records (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number        text NOT NULL UNIQUE,
  request_id              uuid NOT NULL REFERENCES procurement_requests (id),
  entity_id               uuid NOT NULL REFERENCES entities (id),
  source_entity_id        uuid NOT NULL REFERENCES entities (id),
  source_account_id       uuid NOT NULL REFERENCES entity_bank_accounts (id),
  destination_entity_id   uuid NOT NULL REFERENCES entities (id),
  destination_account_id  uuid NOT NULL REFERENCES entity_bank_accounts (id),
  amount_kobo             bigint NOT NULL,
  purpose                 text NOT NULL,
  transfer_date           date NOT NULL,
  transfer_method         text NOT NULL,
  bank_reference          text NOT NULL,
  proof_document_id       uuid NOT NULL REFERENCES documents (id),
  status                  text NOT NULL DEFAULT 'RECORDED',
  reversed_transfer_id    uuid REFERENCES funding_transfer_records (id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL,
  CONSTRAINT funding_transfer_records_status CHECK (status IN ('RECORDED', 'REVERSED')),
  CONSTRAINT funding_transfer_records_amount_positive CHECK (amount_kobo > 0),
  CONSTRAINT funding_transfer_records_purpose_not_blank CHECK (btrim(purpose) <> ''),
  CONSTRAINT funding_transfer_records_method_not_blank CHECK (btrim(transfer_method) <> ''),
  CONSTRAINT funding_transfer_records_bank_ref_not_blank CHECK (btrim(bank_reference) <> '')
);

SELECT app.apply_append_only_conventions('funding_transfer_records', 'entity_id');
SELECT app.protect_reference_number('funding_transfer_records');

CREATE UNIQUE INDEX funding_transfer_records_bank_ref_key
  ON funding_transfer_records (source_account_id, lower(btrim(bank_reference)))
  WHERE reversed_transfer_id IS NULL;


CREATE TABLE procurement_payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number   text NOT NULL UNIQUE,
  request_id         uuid NOT NULL REFERENCES procurement_requests (id),
  version_id         uuid NOT NULL REFERENCES procurement_versions (id),
  entity_id          uuid NOT NULL REFERENCES entities (id),
  vendor_id          uuid NOT NULL REFERENCES vendors (id),
  paying_account_id  uuid NOT NULL REFERENCES entity_bank_accounts (id),
  amount_kobo        bigint NOT NULL,
  method             text NOT NULL,
  bank_reference     text NOT NULL,
  payment_date       date NOT NULL,
  proof_document_id  uuid NOT NULL REFERENCES documents (id),
  status             text NOT NULL DEFAULT 'COMPLETED',
  idempotency_key    text NOT NULL UNIQUE,
  reversed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text NOT NULL,
  row_version        integer NOT NULL DEFAULT 1,
  CONSTRAINT procurement_payments_status CHECK (status IN ('DRAFT', 'PROCESSING', 'COMPLETED')),
  CONSTRAINT procurement_payments_amount_positive CHECK (amount_kobo > 0),
  CONSTRAINT procurement_payments_method_not_blank CHECK (btrim(method) <> ''),
  CONSTRAINT procurement_payments_bank_ref_not_blank CHECK (btrim(bank_reference) <> '')
);

SELECT app.apply_mutable_conventions('procurement_payments', 'entity_id');
SELECT app.protect_reference_number('procurement_payments');

CREATE UNIQUE INDEX procurement_payments_one_active
  ON procurement_payments (request_id, version_id)
  WHERE status = 'COMPLETED' AND reversed_at IS NULL;

CREATE UNIQUE INDEX procurement_payments_bank_ref_key
  ON procurement_payments (paying_account_id, lower(btrim(bank_reference)))
  WHERE status IN ('PROCESSING', 'COMPLETED') AND reversed_at IS NULL;


CREATE TABLE procurement_payment_reversals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id            uuid NOT NULL REFERENCES procurement_payments (id),
  request_id            uuid NOT NULL REFERENCES procurement_requests (id),
  entity_id             uuid NOT NULL REFERENCES entities (id),
  reason                text NOT NULL,
  requested_by          text NOT NULL,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  approved_by           text,
  approved_at           timestamptz,
  replacement_payment_id uuid REFERENCES procurement_payments (id),
  status                text NOT NULL DEFAULT 'PENDING',
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  CONSTRAINT procurement_payment_reversals_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT procurement_payment_reversals_status CHECK (status IN ('PENDING', 'APPROVED', 'REFUSED'))
);

SELECT app.apply_append_only_conventions('procurement_payment_reversals', 'entity_id');


ALTER TABLE procurement_requests
  ADD CONSTRAINT procurement_requests_paying_account_fk
    FOREIGN KEY (paying_account_id) REFERENCES entity_bank_accounts (id),
  ADD CONSTRAINT procurement_requests_destination_account_fk
    FOREIGN KEY (destination_account_id) REFERENCES entity_bank_accounts (id);


CREATE OR REPLACE VIEW vendor_payment_history_v AS
SELECT
  p.vendor_id,
  p.reference_number,
  p.amount_kobo,
  p.entity_id,
  e.code AS entity_code,
  (p.payment_date::timestamptz) AS paid_at
  FROM procurement_payments p
  JOIN entities e ON e.id = p.entity_id
 WHERE p.status = 'COMPLETED'
   AND p.reversed_at IS NULL;

GRANT SELECT ON vendor_payment_history_v TO nfc_app;


INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('procurement.paid', 'notify.generic', 'system:seed'),
  ('procurement.funds_allocated', 'notify.generic', 'system:seed'),
  ('inventory.expected_stock.requested', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  (
    'procurement.paid',
    'action_required',
    'Payment completed for {reference}',
    'Payment has been completed. Procurement {reference} is awaiting delivery verification.',
    true,
    true,
    'system:seed'
  ),
  (
    'procurement.funds_allocated',
    'action_required',
    'Funds allocated for {reference}',
    'Funds have been allocated for {reference}. Vendor payment is pending.',
    true,
    true,
    'system:seed'
  ),
  (
    'inventory.expected_stock.requested',
    'engine',
    'Expected stock requested for {reference}',
    'ED Finance approved a stock or asset procurement {reference}. Incoming stock is created in Inventory (M13).',
    false,
    false,
    'system:seed'
  )
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
    'finance.payment.execute',
    'finance.payment.execute.corporate',
    'finance.payment.reverse.request',
    'finance.payment.reverse.approve',
    'finance.funding.authorize',
    'finance.funding.transfer.record'
  );
$$;
