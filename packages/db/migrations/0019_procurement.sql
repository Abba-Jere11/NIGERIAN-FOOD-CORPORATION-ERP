-- ---------------------------------------------------------------------------
-- 0019_procurement
--
-- Procurement 1 (M6): structured requests, versioned drafts, frozen memo
-- snapshots, invoices, comments, lightweight budget/project reference data.
-- Approvals, funding and delivery remain M7–M9.
-- ---------------------------------------------------------------------------

CREATE TABLE procurement_categories (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                             text NOT NULL UNIQUE,
  name                            text NOT NULL,
  invoice_required                boolean NOT NULL DEFAULT true,
  stock_item                      boolean NOT NULL DEFAULT false,
  asset                           boolean NOT NULL DEFAULT false,
  required_delivery_document_set  text[] NOT NULL DEFAULT ARRAY[]::text[],
  status                          record_status NOT NULL DEFAULT 'ACTIVE',
  created_at                      timestamptz NOT NULL DEFAULT now(),
  created_by                      text NOT NULL,
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  updated_by                      text NOT NULL,
  row_version                     integer NOT NULL DEFAULT 1,
  CONSTRAINT procurement_categories_key_not_blank CHECK (btrim(key) <> ''),
  CONSTRAINT procurement_categories_name_not_blank CHECK (btrim(name) <> '')
);

SELECT app.apply_mutable_conventions('procurement_categories');

ALTER TABLE procurement_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY procurement_categories_select ON procurement_categories
  FOR SELECT TO nfc_app USING (true);
CREATE POLICY procurement_categories_write ON procurement_categories
  FOR ALL TO nfc_app
  USING (app.has_permission('finance.funding.authorize') OR app.has_permission('finance.payment.execute'))
  WITH CHECK (app.has_permission('finance.funding.authorize') OR app.has_permission('finance.payment.execute'));

INSERT INTO procurement_categories (
  key, name, invoice_required, stock_item, asset, required_delivery_document_set, created_by, updated_by
) VALUES
  ('equipment', 'Equipment', true, false, true, ARRAY['delivery_note', 'installation_certificate'], 'system:seed', 'system:seed'),
  ('goods', 'Goods', true, true, false, ARRAY['delivery_note', 'goods_received_note'], 'system:seed', 'system:seed'),
  ('services', 'Services', false, false, false, ARRAY['completion_certificate'], 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;


CREATE TABLE units_of_measure (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  status      record_status NOT NULL DEFAULT 'ACTIVE',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT units_of_measure_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT units_of_measure_name_not_blank CHECK (btrim(name) <> '')
);

SELECT app.apply_mutable_conventions('units_of_measure');

ALTER TABLE units_of_measure ENABLE ROW LEVEL SECURITY;
CREATE POLICY units_of_measure_select ON units_of_measure
  FOR SELECT TO nfc_app USING (true);
CREATE POLICY units_of_measure_write ON units_of_measure
  FOR ALL TO nfc_app
  USING (app.has_permission('finance.funding.authorize') OR app.has_permission('finance.payment.execute'))
  WITH CHECK (app.has_permission('finance.funding.authorize') OR app.has_permission('finance.payment.execute'));

INSERT INTO units_of_measure (code, name, created_by, updated_by) VALUES
  ('PCS', 'Pieces', 'system:seed', 'system:seed'),
  ('TON', 'Tonnes', 'system:seed', 'system:seed'),
  ('KG', 'Kilograms', 'system:seed', 'system:seed'),
  ('LTR', 'Litres', 'system:seed', 'system:seed'),
  ('LOT', 'Lot', 'system:seed', 'system:seed')
ON CONFLICT (code) DO NOTHING;


CREATE TABLE funding_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  label       text NOT NULL,
  status      record_status NOT NULL DEFAULT 'ACTIVE',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT funding_sources_key_not_blank CHECK (btrim(key) <> ''),
  CONSTRAINT funding_sources_label_not_blank CHECK (btrim(label) <> '')
);

SELECT app.apply_mutable_conventions('funding_sources');

ALTER TABLE funding_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY funding_sources_select ON funding_sources
  FOR SELECT TO nfc_app USING (true);
CREATE POLICY funding_sources_write ON funding_sources
  FOR ALL TO nfc_app
  USING (app.has_permission('finance.funding.authorize'))
  WITH CHECK (app.has_permission('finance.funding.authorize'));

INSERT INTO funding_sources (key, label, created_by, updated_by) VALUES
  ('subsidiary_operating', 'Subsidiary operating account', 'system:seed', 'system:seed'),
  ('nfc_holding', 'NFC Holding Company', 'system:seed', 'system:seed'),
  ('corporate_allocation', 'Corporate allocation to subsidiary', 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;


CREATE TABLE projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities (id),
  code        text NOT NULL,
  name        text NOT NULL,
  status      record_status NOT NULL DEFAULT 'ACTIVE',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT projects_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT projects_name_not_blank CHECK (btrim(name) <> ''),
  UNIQUE (entity_id, code)
);

SELECT app.apply_mutable_conventions('projects', 'entity_id');


CREATE TABLE budget_lines (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id            uuid NOT NULL REFERENCES entities (id),
  fiscal_year          integer NOT NULL,
  code                 text NOT NULL,
  name                 text NOT NULL,
  approved_amount_kobo bigint NOT NULL,
  status               record_status NOT NULL DEFAULT 'ACTIVE',
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL,
  row_version          integer NOT NULL DEFAULT 1,
  CONSTRAINT budget_lines_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT budget_lines_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT budget_lines_year_positive CHECK (fiscal_year >= 2000),
  CONSTRAINT budget_lines_amount_non_negative CHECK (approved_amount_kobo >= 0),
  UNIQUE (entity_id, fiscal_year, code)
);

SELECT app.apply_mutable_conventions('budget_lines', 'entity_id');


CREATE TABLE procurement_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number     text NOT NULL UNIQUE,
  entity_id            uuid NOT NULL REFERENCES entities (id),
  department_id        uuid REFERENCES departments (id),
  originator_user_id   uuid NOT NULL REFERENCES users (id),
  vendor_id            uuid REFERENCES vendors (id),
  current_version      integer NOT NULL DEFAULT 1,
  status               text NOT NULL DEFAULT 'DRAFT',
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL,
  row_version          integer NOT NULL DEFAULT 1,
  CONSTRAINT procurement_requests_status CHECK (
    status IN (
      'DRAFT',
      'AWAITING_OPERATIONS',
      'AWAITING_MD',
      'AWAITING_ED_FINANCE',
      'FUNDING_PENDING',
      'AWAITING_PAYMENT',
      'PAYMENT_PROCESSING',
      'AWAITING_DELIVERY',
      'PARTIALLY_RECEIVED',
      'COMPLETED',
      'REJECTED',
      'ARCHIVED',
      'DISCARDED'
    )
  ),
  CONSTRAINT procurement_requests_version_positive CHECK (current_version >= 1)
);

SELECT app.apply_mutable_conventions('procurement_requests', 'entity_id');
SELECT app.protect_reference_number('procurement_requests');

CREATE INDEX procurement_requests_originator_idx ON procurement_requests (originator_user_id, status);
CREATE INDEX procurement_requests_vendor_idx ON procurement_requests (vendor_id, status);


CREATE TABLE procurement_versions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id               uuid NOT NULL REFERENCES procurement_requests (id),
  entity_id                uuid NOT NULL REFERENCES entities (id),
  version_number           integer NOT NULL,
  title                    text NOT NULL DEFAULT '',
  subject                  text,
  category_id              uuid REFERENCES procurement_categories (id),
  reason                   text,
  description              text,
  quantity                 integer,
  unit_id                  uuid REFERENCES units_of_measure (id),
  unit_price_kobo          bigint,
  total_amount_kobo        bigint,
  required_date            date,
  vendor_id                uuid REFERENCES vendors (id),
  delivery_location        text,
  funding_source_id        uuid REFERENCES funding_sources (id),
  budget_line_id           uuid REFERENCES budget_lines (id),
  project_id               uuid REFERENCES projects (id),
  urgency                  text NOT NULL DEFAULT 'NORMAL',
  additional_instructions  text,
  submitted_at             timestamptz,
  submit_idempotency_key   text UNIQUE,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               text NOT NULL,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               text NOT NULL,
  row_version              integer NOT NULL DEFAULT 1,
  CONSTRAINT procurement_versions_number_positive CHECK (version_number >= 1),
  CONSTRAINT procurement_versions_urgency CHECK (urgency IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  CONSTRAINT procurement_versions_quantity_positive CHECK (quantity IS NULL OR quantity > 0),
  CONSTRAINT procurement_versions_price_positive CHECK (unit_price_kobo IS NULL OR unit_price_kobo > 0),
  CONSTRAINT procurement_versions_total_positive CHECK (total_amount_kobo IS NULL OR total_amount_kobo > 0),
  UNIQUE (request_id, version_number)
);

SELECT app.add_row_version_trigger('procurement_versions');
SELECT app.forbid_hard_delete('procurement_versions');
SELECT app.grant_mutable_table('procurement_versions');
SELECT app.enable_entity_rls('procurement_versions', 'entity_id');

CREATE OR REPLACE FUNCTION app.forbid_submitted_procurement_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'append-only: submitted procurement versions cannot be changed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER procurement_versions_forbid_submitted
  BEFORE UPDATE OR DELETE ON procurement_versions
  FOR EACH ROW
  EXECUTE FUNCTION app.forbid_submitted_procurement_version();


CREATE TABLE procurement_memo_snapshots (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id             uuid NOT NULL REFERENCES procurement_requests (id),
  version_id             uuid NOT NULL REFERENCES procurement_versions (id),
  entity_id              uuid NOT NULL REFERENCES entities (id),
  memo_template_version  integer NOT NULL,
  canonical_json         jsonb NOT NULL,
  memo_snapshot_hash     text NOT NULL,
  pdf_document_id        uuid REFERENCES documents (id),
  pdf_hash               text NOT NULL,
  budget_available_kobo  bigint NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             text NOT NULL,
  UNIQUE (version_id)
);

SELECT app.apply_append_only_conventions('procurement_memo_snapshots', 'entity_id');


CREATE TABLE procurement_invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid NOT NULL REFERENCES procurement_requests (id),
  version_id       uuid NOT NULL REFERENCES procurement_versions (id),
  entity_id        uuid NOT NULL REFERENCES entities (id),
  document_id      uuid NOT NULL REFERENCES documents (id),
  invoice_number   text NOT NULL,
  invoice_date     date NOT NULL,
  amount_kobo      bigint NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL,
  row_version      integer NOT NULL DEFAULT 1,
  CONSTRAINT procurement_invoices_number_not_blank CHECK (btrim(invoice_number) <> ''),
  CONSTRAINT procurement_invoices_amount_positive CHECK (amount_kobo > 0),
  UNIQUE (version_id)
);

SELECT app.add_row_version_trigger('procurement_invoices');
SELECT app.forbid_hard_delete('procurement_invoices');
SELECT app.grant_mutable_table('procurement_invoices');
SELECT app.enable_entity_rls('procurement_invoices', 'entity_id');

CREATE OR REPLACE FUNCTION app.forbid_invoice_on_submitted_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE submitted timestamptz;
        version uuid;
BEGIN
  version := COALESCE(NEW.version_id, OLD.version_id);
  SELECT submitted_at INTO submitted FROM procurement_versions WHERE id = version;
  IF submitted IS NOT NULL THEN
    RAISE EXCEPTION 'append-only: invoices on a submitted version cannot be changed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER procurement_invoices_forbid_submitted
  BEFORE INSERT OR UPDATE OR DELETE ON procurement_invoices
  FOR EACH ROW
  EXECUTE FUNCTION app.forbid_invoice_on_submitted_version();


CREATE TABLE procurement_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES procurement_requests (id),
  entity_id   uuid NOT NULL REFERENCES entities (id),
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  CONSTRAINT procurement_comments_body_not_blank CHECK (btrim(body) <> '')
);

SELECT app.apply_append_only_conventions('procurement_comments', 'entity_id');


CREATE TABLE procurement_commitment_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL REFERENCES procurement_requests (id),
  entity_id       uuid NOT NULL REFERENCES entities (id),
  budget_line_id  uuid REFERENCES budget_lines (id),
  action          text NOT NULL,
  amount_kobo     bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  CONSTRAINT procurement_commitment_events_action CHECK (action IN ('OPEN', 'RELEASE')),
  CONSTRAINT procurement_commitment_events_amount_non_negative CHECK (amount_kobo >= 0)
);

SELECT app.apply_append_only_conventions('procurement_commitment_events', 'entity_id');


CREATE OR REPLACE VIEW vendor_procurement_history_v AS
SELECT
  r.vendor_id,
  r.reference_number,
  v.title,
  r.status,
  r.entity_id,
  e.code AS entity_code,
  coalesce(v.submitted_at, r.created_at) AS occurred_at
FROM procurement_requests r
JOIN procurement_versions v
  ON v.request_id = r.id AND v.version_number = r.current_version
JOIN entities e ON e.id = r.entity_id
WHERE r.vendor_id IS NOT NULL
  AND r.status NOT IN ('DRAFT', 'DISCARDED');

GRANT SELECT ON vendor_procurement_history_v TO nfc_app;


INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('procurement.submitted', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  (
    'procurement.submitted',
    'action_required',
    'Procurement {reference} awaiting operations review',
    '{title} {reference} was submitted by the originating GM.',
    true,
    true,
    'system:seed'
  )
ON CONFLICT (type) DO NOTHING;
