-- ---------------------------------------------------------------------------
-- 0049_requisition
--
-- Dual-approval addendum on M6–M9: GM requisition (REQ-), MD need-approval,
-- Procurement Manager proposal, category-gated ED Operations. Inventory
-- Officer display name is Procurement Manager; role_key is unchanged.
-- ---------------------------------------------------------------------------

INSERT INTO permissions (key, description, created_by) VALUES
  ('requisition.create', 'Create a requisition (need only, no price) in the granted subsidiary.', 'system:seed'),
  ('requisition.edit_draft', 'Edit a draft requisition. Only the originating GM may edit.', 'system:seed'),
  ('requisition.submit', 'Submit a draft requisition for MD need-approval.', 'system:seed'),
  ('requisition.discard_draft', 'Discard a requisition that was never submitted. Only the originator may discard.', 'system:seed'),
  ('requisition.approve.need', 'Approve or return the need on a requisition before a proposal is prepared.', 'system:seed'),
  ('procurement.prepare', 'Prepare and submit the priced procurement proposal from an approved requisition.', 'system:seed')
ON CONFLICT (key) DO NOTHING;

SET session_replication_role = replica;
DELETE FROM role_permissions rp
  USING roles r
 WHERE rp.role_id = r.id
   AND r.key::text = 'gm'
   AND rp.permission_key IN ('procurement.edit_draft', 'procurement.submit', 'procurement.discard_draft');

INSERT INTO role_permissions (role_id, permission_key, created_by)
SELECT r.id, k.key, 'system:seed'
  FROM roles r
  JOIN (VALUES
    ('gm', 'requisition.create'),
    ('gm', 'requisition.edit_draft'),
    ('gm', 'requisition.submit'),
    ('gm', 'requisition.discard_draft'),
    ('md', 'requisition.approve.need'),
    ('inventory_officer', 'procurement.prepare'),
    ('inventory_officer', 'procurement.edit_draft'),
    ('inventory_officer', 'procurement.submit'),
    ('inventory_officer', 'procurement.discard_draft')
  ) AS k(role_key, key) ON k.role_key = r.key::text
ON CONFLICT DO NOTHING;
SET session_replication_role = DEFAULT;

UPDATE roles
   SET name = 'Procurement Manager',
       short_name = 'Procurement Manager',
       description = 'Prepares the procurement proposal from an approved requisition, verifies vendor delivery, records goods received and initiates shortage-closure across subsidiaries. Does not originate the need or authorize payment.',
       updated_by = 'system:seed'
 WHERE key = 'inventory_officer';

UPDATE users
   SET position = 'Procurement Manager',
       updated_by = 'system:seed'
 WHERE email = 'inventory@nfc.local';


CREATE OR REPLACE FUNCTION app.next_reference(p_kind text, p_year integer DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_kind text;
  v_year integer;
  v_next integer;
  v_allowed text[] := ARRAY[
    'REQ','PR','PAY','TRF','GRN','INV','EMP','DOC','SEAL','JNL','BUD','VND','CUS','SO','PRD','PRL','LV','VAC',
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


ALTER TABLE procurement_categories
  ADD COLUMN IF NOT EXISTS operations_machinery boolean NOT NULL DEFAULT false;

UPDATE procurement_categories
   SET operations_machinery = true, updated_by = 'system:seed'
 WHERE key = 'equipment';


ALTER TABLE procurement_requests
  ADD COLUMN IF NOT EXISTS requisition_id uuid,
  ADD COLUMN IF NOT EXISTS prepared_by_user_id uuid REFERENCES users (id);

ALTER TABLE procurement_requests
  DROP CONSTRAINT IF EXISTS procurement_requests_status;

ALTER TABLE procurement_requests
  ADD CONSTRAINT procurement_requests_status CHECK (
    status IN (
      'DRAFT',
      'AWAITING_NEED_APPROVAL',
      'AWAITING_PREPARATION',
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
  );

ALTER TABLE procurement_requests
  DROP CONSTRAINT IF EXISTS procurement_requests_archived_status;

ALTER TABLE procurement_requests
  ADD CONSTRAINT procurement_requests_archived_status CHECK (
    archived_from_status IS NULL OR archived_from_status IN (
      'DRAFT',
      'AWAITING_NEED_APPROVAL',
      'AWAITING_PREPARATION',
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
  );

ALTER TABLE procurement_versions
  ADD COLUMN IF NOT EXISTS price_comparison text,
  ADD COLUMN IF NOT EXISTS recommendation text;


CREATE TABLE requisitions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number     text NOT NULL UNIQUE,
  entity_id            uuid NOT NULL REFERENCES entities (id),
  department_id        uuid REFERENCES departments (id),
  originator_user_id   uuid NOT NULL REFERENCES users (id),
  current_version      integer NOT NULL DEFAULT 1,
  status               text NOT NULL DEFAULT 'DRAFT',
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL,
  row_version          integer NOT NULL DEFAULT 1,
  CONSTRAINT requisitions_status CHECK (
    status IN (
      'DRAFT',
      'SUBMITTED',
      'NEED_APPROVED',
      'RETURNED',
      'REJECTED',
      'ARCHIVED',
      'DISCARDED'
    )
  ),
  CONSTRAINT requisitions_version_positive CHECK (current_version >= 1)
);

SELECT app.apply_mutable_conventions('requisitions', 'entity_id');
SELECT app.protect_reference_number('requisitions');

CREATE INDEX requisitions_originator_idx ON requisitions (originator_user_id, status);

ALTER TABLE procurement_requests
  ADD CONSTRAINT procurement_requests_requisition_fk
  FOREIGN KEY (requisition_id) REFERENCES requisitions (id);

CREATE UNIQUE INDEX procurement_requests_requisition_uidx
  ON procurement_requests (requisition_id)
  WHERE requisition_id IS NOT NULL;


CREATE TABLE requisition_versions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id           uuid NOT NULL REFERENCES requisitions (id),
  entity_id                uuid NOT NULL REFERENCES entities (id),
  version_number           integer NOT NULL,
  title                    text NOT NULL DEFAULT '',
  background               text,
  justification            text,
  prayer                   text,
  category_id              uuid REFERENCES procurement_categories (id),
  required_date            date,
  urgency                  text NOT NULL DEFAULT 'NORMAL',
  delivery_location        text,
  submitted_at             timestamptz,
  submit_idempotency_key   text UNIQUE,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               text NOT NULL,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               text NOT NULL,
  row_version              integer NOT NULL DEFAULT 1,
  CONSTRAINT requisition_versions_number_positive CHECK (version_number >= 1),
  CONSTRAINT requisition_versions_urgency CHECK (urgency IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  UNIQUE (requisition_id, version_number)
);

SELECT app.add_row_version_trigger('requisition_versions');
SELECT app.forbid_hard_delete('requisition_versions');
SELECT app.grant_mutable_table('requisition_versions');
SELECT app.enable_entity_rls('requisition_versions', 'entity_id');

CREATE OR REPLACE FUNCTION app.forbid_submitted_requisition_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'append-only: submitted requisition versions cannot be changed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER requisition_versions_forbid_submitted
  BEFORE UPDATE OR DELETE ON requisition_versions
  FOR EACH ROW
  EXECUTE FUNCTION app.forbid_submitted_requisition_version();


CREATE TABLE requisition_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id       uuid NOT NULL REFERENCES requisition_versions (id),
  entity_id        uuid NOT NULL REFERENCES entities (id),
  line_number      integer NOT NULL,
  description      text NOT NULL DEFAULT '',
  quantity         integer NOT NULL,
  unit_id          uuid REFERENCES units_of_measure (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL,
  row_version      integer NOT NULL DEFAULT 1,
  CONSTRAINT requisition_lines_number_positive CHECK (line_number >= 1),
  CONSTRAINT requisition_lines_quantity_positive CHECK (quantity > 0),
  UNIQUE (version_id, line_number)
);

SELECT app.apply_mutable_conventions('requisition_lines', 'entity_id');
DROP TRIGGER IF EXISTS requisition_lines_forbid_delete ON requisition_lines;
DROP TRIGGER IF EXISTS requisition_lines_forbid_truncate ON requisition_lines;
GRANT DELETE ON requisition_lines TO nfc_app;


CREATE TABLE requisition_memo_snapshots (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id         uuid NOT NULL REFERENCES requisitions (id),
  version_id             uuid NOT NULL REFERENCES requisition_versions (id),
  entity_id              uuid NOT NULL REFERENCES entities (id),
  memo_template_version  integer NOT NULL,
  canonical_json         jsonb NOT NULL,
  memo_snapshot_hash     text NOT NULL,
  pdf_document_id        uuid REFERENCES documents (id),
  pdf_hash               text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             text NOT NULL,
  UNIQUE (version_id)
);

SELECT app.apply_append_only_conventions('requisition_memo_snapshots', 'entity_id');


CREATE TABLE procurement_quotations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid NOT NULL REFERENCES procurement_requests (id),
  version_id       uuid NOT NULL REFERENCES procurement_versions (id),
  entity_id        uuid NOT NULL REFERENCES entities (id),
  document_id      uuid NOT NULL REFERENCES documents (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL,
  row_version      integer NOT NULL DEFAULT 1
);

SELECT app.apply_mutable_conventions('procurement_quotations', 'entity_id');
DROP TRIGGER IF EXISTS procurement_quotations_forbid_delete ON procurement_quotations;
DROP TRIGGER IF EXISTS procurement_quotations_forbid_truncate ON procurement_quotations;
GRANT DELETE ON procurement_quotations TO nfc_app;

CREATE OR REPLACE FUNCTION app.forbid_quotation_on_submitted_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE submitted timestamptz;
BEGIN
  SELECT submitted_at INTO submitted
    FROM procurement_versions
   WHERE id = COALESCE(NEW.version_id, OLD.version_id);
  IF submitted IS NOT NULL THEN
    RAISE EXCEPTION 'append-only: quotations on a submitted version cannot be changed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER procurement_quotations_forbid_submitted
  BEFORE INSERT OR UPDATE OR DELETE ON procurement_quotations
  FOR EACH ROW
  EXECUTE FUNCTION app.forbid_quotation_on_submitted_version();


ALTER TABLE seals DROP CONSTRAINT IF EXISTS seals_action;
ALTER TABLE seals
  ADD CONSTRAINT seals_action CHECK (action IN (
    'submitted',
    'need_approved',
    'prepared',
    'operations_reviewed',
    'procurement_approved',
    'approved',
    'rejected',
    'returned',
    'paid',
    'verified'
  ));


UPDATE workflow_definitions
   SET version = 2, updated_by = 'system:seed'
 WHERE key = 'procurement-v1';

UPDATE workflow_stages s
   SET sort_order = s.sort_order + 10
  FROM workflow_definitions d
 WHERE s.definition_id = d.id AND d.key = 'procurement-v1';

UPDATE workflow_stages s
   SET sort_order = CASE s.key
     WHEN 'gm-submission' THEN 1
     WHEN 'ed-operations' THEN 4
     WHEN 'md' THEN 5
     WHEN 'ed-finance' THEN 6
     WHEN 'finance-head' THEN 7
     ELSE s.sort_order
   END
  FROM workflow_definitions d
 WHERE s.definition_id = d.id AND d.key = 'procurement-v1';

INSERT INTO workflow_stages (
  definition_id, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days, created_by
)
SELECT d.id, s.sort_order, s.key, s.label, s.required_permission, s.scope_resolver, s.allowed_actions, s.sla_days, 'system:seed'
  FROM workflow_definitions d
  JOIN (VALUES
    (2, 'need-approval', 'Need approval', 'requisition.approve.need', 'ALL',
      ARRAY['APPROVE', 'REJECT', 'RETURN_FOR_CORRECTION', 'ARCHIVE'], 2),
    (3, 'prepared', 'Procurement proposal', NULL::text, 'ALL',
      ARRAY[]::text[], NULL)
  ) AS s(sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days)
    ON d.key = 'procurement-v1'
ON CONFLICT (definition_id, key) DO NOTHING;


INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('requisition.submitted', 'notify.generic', 'system:seed'),
  ('requisition.need_approved', 'notify.generic', 'system:seed'),
  ('procurement.prepared', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  (
    'requisition.submitted',
    'action_required',
    'Requisition {reference} awaiting need approval',
    '{title} {reference} was submitted for MD need-approval.',
    true,
    true,
    'system:seed'
  ),
  (
    'requisition.need_approved',
    'action_required',
    'Requisition {reference} need-approved — prepare proposal',
    '{title} {reference} was need-approved. Prepare the procurement proposal.',
    true,
    true,
    'system:seed'
  ),
  (
    'procurement.prepared',
    'action_required',
    'Procurement {reference} awaiting review',
    '{title} {reference} was prepared and is ready for approval.',
    true,
    true,
    'system:seed'
  )
ON CONFLICT (type) DO NOTHING;

DROP POLICY IF EXISTS vendor_invoice_claims_insert ON vendor_invoice_claims;
CREATE POLICY vendor_invoice_claims_insert ON vendor_invoice_claims
  FOR INSERT TO nfc_app
  WITH CHECK (
    app.has_permission('vendor.create')
    OR app.has_permission('procurement.create')
    OR app.has_permission('procurement.prepare')
    OR app.has_permission('procurement.review.finance')
  );
