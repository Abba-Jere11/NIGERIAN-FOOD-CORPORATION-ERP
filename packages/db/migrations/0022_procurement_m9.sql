-- ---------------------------------------------------------------------------
-- 0022_procurement_m9
--
-- Procurement 4 (M9): GM delivery verification, GRNs, close-short workflow,
-- vendor open claims. Paid remains AWAITING_DELIVERY until verification.
-- ---------------------------------------------------------------------------

ALTER TABLE procurement_requests
  ADD COLUMN IF NOT EXISTS accepted_quantity_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS close_short_id uuid;

ALTER TABLE procurement_requests
  ADD CONSTRAINT procurement_requests_accepted_non_negative CHECK (accepted_quantity_total >= 0);


CREATE TABLE procurement_delivery_notes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid NOT NULL REFERENCES procurement_requests (id),
  version_id         uuid NOT NULL REFERENCES procurement_versions (id),
  entity_id          uuid NOT NULL REFERENCES entities (id),
  note               text NOT NULL,
  next_reminder_at   timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text NOT NULL,
  CONSTRAINT procurement_delivery_notes_note_not_blank CHECK (btrim(note) <> '')
);

SELECT app.apply_append_only_conventions('procurement_delivery_notes', 'entity_id');


CREATE TABLE procurement_goods_receipts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number        text NOT NULL UNIQUE,
  request_id              uuid NOT NULL REFERENCES procurement_requests (id),
  version_id              uuid NOT NULL REFERENCES procurement_versions (id),
  entity_id               uuid NOT NULL REFERENCES entities (id),
  received_date           date NOT NULL,
  location                text NOT NULL,
  quantity_ordered        integer NOT NULL,
  quantity_received       integer NOT NULL,
  quantity_accepted       integer NOT NULL,
  quantity_rejected       integer NOT NULL DEFAULT 0,
  reject_reason           text,
  condition_notes         text,
  idempotency_key         text NOT NULL UNIQUE,
  supersedes_id           uuid REFERENCES procurement_goods_receipts (id),
  supersede_reason        text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL,
  CONSTRAINT procurement_goods_receipts_location_not_blank CHECK (btrim(location) <> ''),
  CONSTRAINT procurement_goods_receipts_qty_ordered CHECK (quantity_ordered > 0),
  CONSTRAINT procurement_goods_receipts_qty_received CHECK (quantity_received >= 0),
  CONSTRAINT procurement_goods_receipts_qty_accepted CHECK (quantity_accepted >= 0),
  CONSTRAINT procurement_goods_receipts_qty_rejected CHECK (quantity_rejected >= 0),
  CONSTRAINT procurement_goods_receipts_qty_split CHECK (
    quantity_accepted + quantity_rejected <= quantity_received
  ),
  CONSTRAINT procurement_goods_receipts_supersede_reason CHECK (
    supersedes_id IS NULL OR btrim(coalesce(supersede_reason, '')) <> ''
  ),
  CONSTRAINT procurement_goods_receipts_reject_reason CHECK (
    quantity_rejected = 0 OR btrim(coalesce(reject_reason, '')) <> ''
  )
);

SELECT app.apply_append_only_conventions('procurement_goods_receipts', 'entity_id');
SELECT app.protect_reference_number('procurement_goods_receipts');

CREATE INDEX procurement_goods_receipts_request_idx
  ON procurement_goods_receipts (request_id, created_at);


CREATE TABLE procurement_receipt_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid NOT NULL REFERENCES entities (id),
  request_id        uuid NOT NULL REFERENCES procurement_requests (id),
  grn_id            uuid REFERENCES procurement_goods_receipts (id),
  delivery_note_id  uuid REFERENCES procurement_delivery_notes (id),
  document_id       uuid NOT NULL REFERENCES documents (id),
  kind              text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  CONSTRAINT procurement_receipt_documents_kind_not_blank CHECK (btrim(kind) <> ''),
  CONSTRAINT procurement_receipt_documents_parent CHECK (
    (grn_id IS NOT NULL AND delivery_note_id IS NULL)
    OR (grn_id IS NULL AND delivery_note_id IS NOT NULL)
  )
);

SELECT app.apply_append_only_conventions('procurement_receipt_documents', 'entity_id');


CREATE TABLE procurement_close_short_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id              uuid NOT NULL REFERENCES procurement_requests (id),
  entity_id               uuid NOT NULL REFERENCES entities (id),
  outstanding_quantity    integer NOT NULL,
  outstanding_amount_kobo bigint NOT NULL,
  reason                  text NOT NULL,
  status                  text NOT NULL DEFAULT 'PENDING',
  workflow_instance_id    uuid REFERENCES workflow_instances (id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              text NOT NULL,
  row_version             integer NOT NULL DEFAULT 1,
  CONSTRAINT procurement_close_short_qty CHECK (outstanding_quantity > 0),
  CONSTRAINT procurement_close_short_amount CHECK (outstanding_amount_kobo >= 0),
  CONSTRAINT procurement_close_short_reason CHECK (btrim(reason) <> ''),
  CONSTRAINT procurement_close_short_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
);

SELECT app.apply_mutable_conventions('procurement_close_short_requests', 'entity_id');

CREATE UNIQUE INDEX procurement_close_short_one_pending
  ON procurement_close_short_requests (request_id)
  WHERE status = 'PENDING';

ALTER TABLE procurement_requests
  ADD CONSTRAINT procurement_requests_close_short_fk
    FOREIGN KEY (close_short_id) REFERENCES procurement_close_short_requests (id);


CREATE TABLE vendor_open_claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       uuid NOT NULL REFERENCES vendors (id),
  entity_id       uuid NOT NULL REFERENCES entities (id),
  request_id      uuid NOT NULL REFERENCES procurement_requests (id),
  close_short_id  uuid NOT NULL REFERENCES procurement_close_short_requests (id),
  quantity        integer NOT NULL,
  amount_kobo     bigint NOT NULL,
  reason          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  CONSTRAINT vendor_open_claims_qty CHECK (quantity > 0),
  CONSTRAINT vendor_open_claims_amount CHECK (amount_kobo >= 0),
  CONSTRAINT vendor_open_claims_reason CHECK (btrim(reason) <> '')
);

SELECT app.apply_append_only_conventions('vendor_open_claims', 'entity_id');

CREATE UNIQUE INDEX vendor_open_claims_close_short_key
  ON vendor_open_claims (close_short_id);


INSERT INTO workflow_definitions (key, name, version, created_by, updated_by)
VALUES ('close-short-v1', 'Close-short of outstanding delivery', 1, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO workflow_stages (
  definition_id, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days, created_by
)
SELECT d.id, s.sort_order, s.key, s.label, s.required_permission, s.scope_resolver, s.allowed_actions, s.sla_days, 'system:seed'
  FROM workflow_definitions d
  JOIN (VALUES
    ('close-short-v1', 1, 'ed-operations', 'ED Operations', 'procurement.approve.operations', 'ALL',
      ARRAY['APPROVE', 'REJECT'], 2),
    ('close-short-v1', 2, 'ed-finance', 'ED Finance', 'procurement.review.finance', 'ALL',
      ARRAY['APPROVE', 'REJECT'], 2)
  ) AS s(def_key, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days)
    ON s.def_key = d.key
ON CONFLICT (definition_id, key) DO NOTHING;


INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('goods.received', 'notify.generic', 'system:seed'),
  ('procurement.completed', 'notify.generic', 'system:seed'),
  ('procurement.close_short.requested', 'notify.generic', 'system:seed'),
  ('procurement.close_short.approved', 'notify.generic', 'system:seed'),
  ('procurement.close_short.rejected', 'notify.generic', 'system:seed'),
  ('procurement.delivery_reminder', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  (
    'goods.received',
    'engine',
    'Goods received for {reference}',
    'A Goods Received Note has been recorded for {reference}.',
    false,
    false,
    'system:seed'
  ),
  (
    'procurement.completed',
    'engine',
    'Procurement completed: {reference}',
    'Procurement {reference} has been completed after delivery verification.',
    true,
    false,
    'system:seed'
  ),
  (
    'procurement.close_short.requested',
    'action_required',
    'Close-short requested for {reference}',
    'The GM has requested to close the outstanding balance on {reference}.',
    true,
    true,
    'system:seed'
  ),
  (
    'procurement.delivery_reminder',
    'action_required',
    'Delivery still outstanding for {reference}',
    'Procurement {reference} is still awaiting delivery verification.',
    true,
    true,
    'system:seed'
  ),
  (
    'procurement.close_short.approved',
    'action_required',
    'Close-short approved for {reference}',
    'The outstanding balance on {reference} may now be closed. Complete the request to apply the verified seal.',
    true,
    true,
    'system:seed'
  ),
  (
    'procurement.close_short.rejected',
    'action_required',
    'Close-short rejected for {reference}',
    'The close-short request for {reference} was rejected. Record the remainder or submit again.',
    true,
    true,
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
    'finance.funding.transfer.record'
  );
$$;
