-- ---------------------------------------------------------------------------
-- 0018_vendors
--
-- Vendor Master (M5). Group-wide register anchored to the NFC holding entity.
-- GMs must be able to read Active vendors without holding-entity membership,
-- so these tables use custom RLS rather than app.enable_entity_rls.
-- ---------------------------------------------------------------------------

ALTER TABLE document_upload_policies
  DROP CONSTRAINT document_upload_policies_context;
ALTER TABLE document_upload_policies
  ADD CONSTRAINT document_upload_policies_context
  CHECK (context IN ('procurement', 'edms', 'general', 'vendor_compliance'));

INSERT INTO document_upload_policies (context, max_bytes, allowed_mime_types, created_by, updated_by)
VALUES (
  'vendor_compliance',
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png'],
  'system:seed',
  'system:seed'
)
ON CONFLICT DO NOTHING;


CREATE TABLE vendor_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  label       text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT vendor_categories_key_not_blank CHECK (btrim(key) <> ''),
  CONSTRAINT vendor_categories_label_not_blank CHECK (btrim(label) <> '')
);

SELECT app.add_row_version_trigger('vendor_categories');
SELECT app.forbid_hard_delete('vendor_categories');
GRANT SELECT, INSERT, UPDATE ON vendor_categories TO nfc_app;

ALTER TABLE vendor_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendor_categories_select ON vendor_categories
  FOR SELECT TO nfc_app
  USING (true);
CREATE POLICY vendor_categories_write ON vendor_categories
  FOR ALL TO nfc_app
  USING (app.is_admin_actor() OR app.has_permission('vendor.create'))
  WITH CHECK (app.is_admin_actor() OR app.has_permission('vendor.create'));

INSERT INTO vendor_categories (key, label, sort_order, created_by, updated_by)
VALUES
  ('goods', 'Goods', 1, 'system:seed', 'system:seed'),
  ('services', 'Services', 2, 'system:seed', 'system:seed'),
  ('equipment', 'Equipment', 3, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;


CREATE TABLE vendors (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number         text NOT NULL UNIQUE,
  entity_id                uuid NOT NULL REFERENCES entities (id),
  legal_name               text NOT NULL,
  cac_registration_number  text NOT NULL,
  category_id              uuid NOT NULL REFERENCES vendor_categories (id),
  status                   text NOT NULL DEFAULT 'DRAFT',
  notes                    text,
  contacts                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  bank_name                text,
  account_name             text,
  account_number           text,
  activated_at             timestamptz,
  activated_by             text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               text NOT NULL,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               text NOT NULL,
  row_version              integer NOT NULL DEFAULT 1,
  CONSTRAINT vendors_status CHECK (
    status IN (
      'DRAFT',
      'PENDING_REVIEW',
      'ACTIVE',
      'PENDING_REVERIFICATION',
      'SUSPENDED',
      'BLACKLISTED'
    )
  ),
  CONSTRAINT vendors_legal_name_not_blank CHECK (btrim(legal_name) <> ''),
  CONSTRAINT vendors_cac_not_blank CHECK (btrim(cac_registration_number) <> '')
);

SELECT app.add_row_version_trigger('vendors');
SELECT app.forbid_hard_delete('vendors');
SELECT app.grant_mutable_table('vendors');
SELECT app.protect_reference_number('vendors');

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendors_select ON vendors
  FOR SELECT TO nfc_app
  USING (
    app.has_permission('vendor.view')
    OR app.has_permission('procurement.create')
    OR app.is_corporate_actor()
  );

CREATE POLICY vendors_insert ON vendors
  FOR INSERT TO nfc_app
  WITH CHECK (app.has_permission('vendor.create'));

CREATE POLICY vendors_update ON vendors
  FOR UPDATE TO nfc_app
  USING (
    app.has_permission('vendor.create')
    OR app.has_permission('vendor.activate')
    OR app.has_permission('vendor.suspend')
    OR app.has_permission('vendor.blacklist')
  )
  WITH CHECK (
    app.has_permission('vendor.create')
    OR app.has_permission('vendor.activate')
    OR app.has_permission('vendor.suspend')
    OR app.has_permission('vendor.blacklist')
  );

CREATE UNIQUE INDEX vendors_cac_active_key
  ON vendors (lower(btrim(cac_registration_number)))
  WHERE status <> 'BLACKLISTED';

CREATE UNIQUE INDEX vendors_bank_active_key
  ON vendors (lower(btrim(bank_name)), btrim(account_number))
  WHERE status <> 'BLACKLISTED'
    AND account_number IS NOT NULL
    AND btrim(account_number) <> '';

CREATE INDEX vendors_status_idx ON vendors (status, legal_name);


CREATE TABLE vendor_bank_account_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       uuid NOT NULL REFERENCES vendors (id),
  entity_id       uuid NOT NULL REFERENCES entities (id),
  bank_name       text NOT NULL,
  account_name    text NOT NULL,
  account_number  text NOT NULL,
  effective_at    timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

SELECT app.make_append_only('vendor_bank_account_versions');
SELECT app.grant_append_only_table('vendor_bank_account_versions');

ALTER TABLE vendor_bank_account_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendor_bank_account_versions_select ON vendor_bank_account_versions
  FOR SELECT TO nfc_app
  USING (
    app.has_permission('vendor.view')
    OR app.has_permission('procurement.create')
    OR app.is_corporate_actor()
  );
CREATE POLICY vendor_bank_account_versions_insert ON vendor_bank_account_versions
  FOR INSERT TO nfc_app
  WITH CHECK (
    app.has_permission('vendor.create')
    OR app.has_permission('vendor.activate')
  );


CREATE TABLE vendor_compliance_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        uuid NOT NULL REFERENCES vendors (id),
  entity_id        uuid NOT NULL REFERENCES entities (id),
  document_id      uuid NOT NULL REFERENCES documents (id),
  compliance_type  text NOT NULL,
  required         boolean NOT NULL DEFAULT false,
  expires_at       date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  CONSTRAINT vendor_compliance_type CHECK (
    compliance_type IN ('CAC', 'TAX_CLEARANCE', 'BANK_VERIFICATION', 'OTHER')
  )
);

SELECT app.forbid_hard_delete('vendor_compliance_documents');
GRANT SELECT, INSERT, UPDATE ON vendor_compliance_documents TO nfc_app;

ALTER TABLE vendor_compliance_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendor_compliance_documents_select ON vendor_compliance_documents
  FOR SELECT TO nfc_app
  USING (
    app.has_permission('vendor.view')
    OR app.has_permission('procurement.create')
    OR app.is_corporate_actor()
  );
CREATE POLICY vendor_compliance_documents_write ON vendor_compliance_documents
  FOR ALL TO nfc_app
  USING (app.has_permission('vendor.create') OR app.has_permission('vendor.activate'))
  WITH CHECK (app.has_permission('vendor.create') OR app.has_permission('vendor.activate'));

CREATE INDEX vendor_compliance_vendor_idx ON vendor_compliance_documents (vendor_id, compliance_type);


CREATE TABLE vendor_invoice_claims (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id          uuid NOT NULL REFERENCES vendors (id),
  entity_id          uuid NOT NULL REFERENCES entities (id),
  invoice_number     text NOT NULL,
  procurement_ref    text,
  created_by         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_invoice_claims_number_not_blank CHECK (btrim(invoice_number) <> '')
);

SELECT app.make_append_only('vendor_invoice_claims');
SELECT app.grant_append_only_table('vendor_invoice_claims');

ALTER TABLE vendor_invoice_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendor_invoice_claims_select ON vendor_invoice_claims
  FOR SELECT TO nfc_app
  USING (
    app.has_permission('vendor.view')
    OR app.has_permission('procurement.create')
    OR app.has_permission('procurement.review.finance')
    OR app.is_corporate_actor()
  );
CREATE POLICY vendor_invoice_claims_insert ON vendor_invoice_claims
  FOR INSERT TO nfc_app
  WITH CHECK (
    app.has_permission('vendor.create')
    OR app.has_permission('procurement.create')
    OR app.has_permission('procurement.review.finance')
  );


CREATE TABLE vendor_selection_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id   uuid NOT NULL REFERENCES vendors (id),
  entity_id   uuid NOT NULL REFERENCES entities (id),
  actor_ref   text NOT NULL,
  reason      text NOT NULL,
  context     text NOT NULL,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_selection_blocks_reason_not_blank CHECK (btrim(reason) <> '')
);

SELECT app.make_append_only('vendor_selection_blocks');
SELECT app.grant_append_only_table('vendor_selection_blocks');

ALTER TABLE vendor_selection_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendor_selection_blocks_select ON vendor_selection_blocks
  FOR SELECT TO nfc_app
  USING (
    app.has_permission('vendor.view')
    OR app.has_permission('procurement.create')
    OR app.is_corporate_actor()
  );
CREATE POLICY vendor_selection_blocks_insert ON vendor_selection_blocks
  FOR INSERT TO nfc_app
  WITH CHECK (
    app.has_permission('vendor.view')
    OR app.has_permission('procurement.create')
    OR app.has_permission('vendor.activate')
  );


-- Placeholder history. M6/M8 replace the view bodies when real tables exist.
CREATE VIEW vendor_procurement_history_v AS
SELECT
  NULL::uuid AS vendor_id,
  NULL::text AS reference_number,
  NULL::text AS title,
  NULL::text AS status,
  NULL::uuid AS entity_id,
  NULL::text AS entity_code,
  NULL::timestamptz AS occurred_at
WHERE false;

CREATE VIEW vendor_payment_history_v AS
SELECT
  NULL::uuid AS vendor_id,
  NULL::text AS reference_number,
  NULL::bigint AS amount_kobo,
  NULL::uuid AS entity_id,
  NULL::text AS entity_code,
  NULL::timestamptz AS paid_at
WHERE false;

GRANT SELECT ON vendor_procurement_history_v TO nfc_app;
GRANT SELECT ON vendor_payment_history_v TO nfc_app;


INSERT INTO workflow_definitions (key, name, version, created_by, updated_by)
VALUES ('vendor-onboarding-v1', 'Vendor onboarding', 1, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO workflow_stages (
  definition_id, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days, created_by
)
SELECT d.id, s.sort_order, s.key, s.label, s.required_permission, s.scope_resolver, s.allowed_actions, s.sla_days, 'system:seed'
  FROM workflow_definitions d
  JOIN (VALUES
    ('vendor-onboarding-v1', 1, 'submission', 'Submission', NULL, 'ALL', ARRAY[]::text[], NULL),
    ('vendor-onboarding-v1', 2, 'activation', 'Activation', 'vendor.activate', 'ALL',
      ARRAY['APPROVE', 'REJECT', 'RETURN_FOR_CORRECTION', 'ARCHIVE'], 2)
  ) AS s(def_key, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days)
    ON s.def_key = d.key
ON CONFLICT (definition_id, key) DO NOTHING;


INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('vendor.submitted', 'notify.generic', 'system:seed'),
  ('vendor.activated', 'notify.generic', 'system:seed'),
  ('vendor.rejected', 'notify.generic', 'system:seed'),
  ('vendor.suspended', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  (
    'vendor.submitted',
    'action_required',
    'Vendor {reference} awaiting activation',
    '{title} {reference} was submitted for onboarding review.',
    true,
    true,
    'system:seed'
  ),
  (
    'vendor.activated',
    'engine',
    'Vendor {reference} is Active',
    '{title} {reference} is now Active and may be selected for procurement.',
    true,
    false,
    'system:seed'
  ),
  (
    'vendor.rejected',
    'action_required',
    'Vendor {reference} returned',
    '{title} {reference} was rejected or returned. Reason: {reason}',
    true,
    true,
    'system:seed'
  ),
  (
    'vendor.suspended',
    'action_required',
    'Vendor {reference} status changed',
    '{title} {reference} was {reason}',
    true,
    true,
    'system:seed'
  )
ON CONFLICT (type) DO NOTHING;
