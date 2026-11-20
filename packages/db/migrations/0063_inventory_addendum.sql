-- ---------------------------------------------------------------------------
-- 0063_inventory_addendum
--
-- ADDENDUM-Inventory.md (M13-A, M13-B, M14 follow-on).
--
-- * Permissions: procurement.complete (GM, requester), inventory.qc.release (GM),
--   inventory.dispose.request / inventory.dispose.approve, inventory.asset.manage,
--   inventory.return.supplier. GM no longer approves adjustments or production.
-- * inventory_settings: the Lane B value threshold and the production variance
--   tolerance are seeded UNCONFIRMED with NULL values. Nothing invents figures;
--   workflows that depend on them refuse with ConfigurationRequired.
-- * The M9 GRN carries quarantined quantities, warehouse, location and batch.
-- * Procurement lines carry the Stock Register item they map to.
-- * Stock movements carry a stock status (available / quarantined / rejected).
-- * QC decisions, desk returns, fixed assets (AST-) and production formulas.
-- * New reference kinds for new transactions only. Historical ITR/IST/IAD/CNT
--   references are never renamed.
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
    'REQ','PR','PAY','TRF','GRN','INV','EMP','DOC','SEAL','JNL','BUD','VND','CUS','SO','PRD','PRL','LV','VAC',
    'ICT','ARI','BILL','INC','EXP','RCT','RPT','CASE','IST','ITR','IAD','CNT','DSP','SRN',
    'ORG','MIN','RSP','DEC','DISC','TRN','DEL','CMP',
    'ISS','STR','RET','ADJ','CON','AST','VER'
  ];
BEGIN
  v_kind := upper(btrim(p_kind));
  IF v_kind IS NULL OR v_kind = '' THEN
    RAISE EXCEPTION 'A reference kind is required.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_kind = ANY (v_allowed) THEN
    RAISE EXCEPTION 'Unknown reference kind "%".', v_kind USING ERRCODE = 'check_violation';
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


-- Permissions ---------------------------------------------------------------

INSERT INTO permissions (key, description, created_by) VALUES
  ('procurement.complete',
   'Complete a procurement as the requesting GM once every item is delivered and paid.', 'system:seed'),
  ('inventory.qc.release',
   'Release or reject quarantined stock and production output in the own subsidiary. Reason required.', 'system:seed'),
  ('inventory.dispose.request', 'Prepare a disposal or write-off for approval.', 'system:seed'),
  ('inventory.dispose.approve',
   'Approve a disposal, adjustment or over-threshold issue at the finance stage.', 'system:seed'),
  ('inventory.asset.manage', 'Register, assign, move and photograph individually tracked assets.', 'system:seed'),
  ('inventory.return.supplier', 'Return stock to the supplier from the Operations Desk.', 'system:seed')
ON CONFLICT (key) DO NOTHING;

SET session_replication_role = replica;

INSERT INTO role_permissions (role_id, permission_key, created_by)
SELECT r.id, k.key, 'system:seed'
  FROM roles r
  JOIN (VALUES
    ('gm', 'procurement.complete'),
    ('gm', 'inventory.qc.release'),
    ('gm', 'production.create'),
    ('gm', 'sales.order.create'),
    ('inventory_officer', 'inventory.dispose.request'),
    ('inventory_officer', 'inventory.asset.manage'),
    ('inventory_officer', 'inventory.return.supplier'),
    ('ed_operations', 'inventory.dispose.approve'),
    ('ed_finance', 'inventory.dispose.approve')
  ) AS k(role_key, key) ON k.role_key = r.key::text
ON CONFLICT DO NOTHING;

DELETE FROM role_permissions rp
 USING roles r
 WHERE rp.role_id = r.id
   AND (
     (r.key::text = 'gm' AND rp.permission_key IN ('inventory.adjust.approve', 'production.approve'))
     OR (r.key::text = 'inventory_officer' AND rp.permission_key IN ('production.create', 'sales.order.create'))
   );

SET session_replication_role = DEFAULT;


-- Settings (UNCONFIRMED until the client confirms figures) -----------------

CREATE TABLE inventory_settings (
  key            text PRIMARY KEY,
  description    text NOT NULL,
  unit           text NOT NULL,
  status         text NOT NULL DEFAULT 'UNCONFIRMED',
  value_numeric  bigint,
  confirmed_by   text,
  confirmed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text NOT NULL,
  row_version    integer NOT NULL DEFAULT 1,
  CONSTRAINT inventory_settings_status CHECK (status IN ('UNCONFIRMED', 'CONFIRMED')),
  CONSTRAINT inventory_settings_value CHECK (
    (status = 'UNCONFIRMED' AND value_numeric IS NULL)
    OR (status = 'CONFIRMED' AND value_numeric IS NOT NULL AND value_numeric >= 0
        AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
  )
);

SELECT app.apply_mutable_conventions('inventory_settings');

ALTER TABLE inventory_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_settings_select ON inventory_settings
  FOR SELECT TO nfc_app USING (true);

INSERT INTO inventory_settings (key, description, unit, status, value_numeric, created_by, updated_by) VALUES
  ('lane_b_value_threshold_kobo',
   'Value at or above which disposals, adjustments and issues also need ED Finance approval. Client to confirm.',
   'kobo', 'UNCONFIRMED', NULL, 'system:seed', 'system:seed'),
  ('production_variance_tolerance_bps',
   'Production output variance beyond which ED Operations must approve. Client to confirm.',
   'basis_points', 'UNCONFIRMED', NULL, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;


-- GRN extension -------------------------------------------------------------

ALTER TABLE procurement_goods_receipts
  ADD COLUMN quantity_quarantined integer NOT NULL DEFAULT 0,
  ADD COLUMN quarantine_reason    text,
  ADD COLUMN warehouse_id         uuid REFERENCES warehouses (id),
  ADD COLUMN location_id          uuid REFERENCES warehouse_locations (id),
  ADD COLUMN batch_code           text;

ALTER TABLE procurement_goods_receipts DROP CONSTRAINT procurement_goods_receipts_qty_split;
ALTER TABLE procurement_goods_receipts ADD CONSTRAINT procurement_goods_receipts_qty_split CHECK (
  quantity_accepted + quantity_quarantined + quantity_rejected <= quantity_received
);
ALTER TABLE procurement_goods_receipts ADD CONSTRAINT procurement_goods_receipts_qty_quarantined CHECK (
  quantity_quarantined >= 0
);
ALTER TABLE procurement_goods_receipts ADD CONSTRAINT procurement_goods_receipts_quarantine_reason CHECK (
  quantity_quarantined = 0 OR btrim(coalesce(quarantine_reason, '')) <> ''
);


-- Completion is the requesting GM's step: delivered and paid requests wait here.

ALTER TABLE procurement_requests DROP CONSTRAINT IF EXISTS procurement_requests_status;
ALTER TABLE procurement_requests ADD CONSTRAINT procurement_requests_status CHECK (
  status IN (
    'DRAFT', 'AWAITING_NEED_APPROVAL', 'AWAITING_PREPARATION', 'AWAITING_OPERATIONS', 'AWAITING_MD',
    'AWAITING_ED_FINANCE', 'FUNDING_PENDING', 'AWAITING_PAYMENT', 'PAYMENT_PROCESSING', 'AWAITING_DELIVERY',
    'PARTIALLY_RECEIVED', 'AWAITING_COMPLETION', 'COMPLETED', 'REJECTED', 'ARCHIVED', 'DISCARDED'
  )
);

ALTER TABLE procurement_requests DROP CONSTRAINT IF EXISTS procurement_requests_archived_status;
ALTER TABLE procurement_requests ADD CONSTRAINT procurement_requests_archived_status CHECK (
  archived_from_status IS NULL OR archived_from_status IN (
    'DRAFT', 'AWAITING_NEED_APPROVAL', 'AWAITING_PREPARATION', 'AWAITING_OPERATIONS', 'AWAITING_MD',
    'AWAITING_ED_FINANCE', 'FUNDING_PENDING', 'AWAITING_PAYMENT', 'PAYMENT_PROCESSING', 'AWAITING_DELIVERY',
    'PARTIALLY_RECEIVED', 'AWAITING_COMPLETION', 'COMPLETED', 'REJECTED', 'ARCHIVED', 'DISCARDED'
  )
);


-- Line mapping --------------------------------------------------------------

ALTER TABLE procurement_version_lines
  ADD COLUMN inventory_item_id uuid REFERENCES inventory_items (id);

CREATE INDEX procurement_version_lines_item_idx ON procurement_version_lines (inventory_item_id);


-- Stock status on the one ledger -------------------------------------------

ALTER TABLE stock_movements
  ADD COLUMN stock_status text NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_stock_status CHECK (
  stock_status IN ('AVAILABLE', 'QUARANTINED', 'REJECTED')
);

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_source;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_source CHECK (
  source IN (
    'GRN', 'ISSUE', 'TRANSFER', 'ADJUSTMENT', 'COUNT', 'WRITE_OFF', 'REVERSE',
    'PRODUCTION', 'SALE', 'SALES_RETURN',
    'QC', 'RETURN_IN', 'RETURN_SUPPLIER', 'DISPOSAL'
  )
);

CREATE INDEX stock_movements_status_idx ON stock_movements (item_id, warehouse_id, stock_status);

ALTER TABLE inventory_posting_rules DROP CONSTRAINT IF EXISTS inventory_posting_rules_kind;
ALTER TABLE inventory_posting_rules ADD CONSTRAINT inventory_posting_rules_kind CHECK (
  movement_kind IN (
    'receipt_goods', 'receipt_equipment', 'issue', 'write_off',
    'transfer_out', 'transfer_in', 'adjustment_increase',
    'production_wip', 'production_fg', 'production_waste', 'production_overhead',
    'sales_cogs', 'sales_revenue',
    'return_supplier', 'write_off_equipment'
  )
);

INSERT INTO inventory_posting_rules (movement_kind, debit_account_code, credit_account_code, created_by, updated_by)
VALUES
  ('return_supplier', '1300', '1400', 'system:seed', 'system:seed'),
  ('write_off_equipment', '5100', '1500', 'system:seed', 'system:seed')
ON CONFLICT (movement_kind) DO NOTHING;

ALTER TABLE journals DROP CONSTRAINT IF EXISTS journals_source;
ALTER TABLE journals ADD CONSTRAINT journals_source CHECK (source IN (
  'MANUAL', 'BANK_TRANSFER', 'RECONCILIATION', 'REVERSAL',
  'PROCUREMENT_PAYMENT', 'PROCUREMENT_RECLASS', 'PROCUREMENT_RECOVERY',
  'FUNDING_TRANSFER', 'INTERCOMPANY',
  'INCOME', 'EXPENSE', 'PAYABLE', 'RECEIVABLE', 'RECEIPT',
  'INVENTORY_RECEIPT', 'INVENTORY_ISSUE', 'INVENTORY_WRITE_OFF', 'INVENTORY_ADJUSTMENT', 'INVENTORY_TRANSFER',
  'INVENTORY_RETURN',
  'PRODUCTION_WIP', 'PRODUCTION_OUTPUT', 'PRODUCTION_WASTE', 'PRODUCTION_OVERHEAD',
  'SALES_REVENUE', 'SALES_COGS', 'SALES_RETURN',
  'PAYROLL'
));


-- QC decisions (inventory audit only; no procurement memo seal) -------------

CREATE TABLE stock_qc_decisions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id              uuid NOT NULL REFERENCES entities (id),
  item_id                uuid NOT NULL REFERENCES inventory_items (id),
  warehouse_id           uuid NOT NULL REFERENCES warehouses (id),
  batch_id               uuid REFERENCES stock_batches (id),
  serial_id              uuid REFERENCES stock_serials (id),
  grn_id                 uuid REFERENCES procurement_goods_receipts (id),
  procurement_request_id uuid REFERENCES procurement_requests (id),
  production_order_id    uuid REFERENCES production_orders (id),
  return_id              uuid,
  decision               text NOT NULL,
  quantity               numeric(18, 4) NOT NULL,
  reason                 text NOT NULL,
  document_id            uuid REFERENCES documents (id),
  out_movement_id        uuid NOT NULL REFERENCES stock_movements (id),
  in_movement_id         uuid NOT NULL REFERENCES stock_movements (id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             text NOT NULL,
  CONSTRAINT stock_qc_decisions_decision CHECK (decision IN ('RELEASE', 'REJECT')),
  CONSTRAINT stock_qc_decisions_qty CHECK (quantity > 0),
  CONSTRAINT stock_qc_decisions_reason CHECK (btrim(reason) <> '')
);

SELECT app.apply_append_only_conventions('stock_qc_decisions', 'entity_id');
CREATE INDEX stock_qc_decisions_item_idx ON stock_qc_decisions (item_id, created_at);
CREATE INDEX stock_qc_decisions_grn_idx ON stock_qc_decisions (grn_id);


-- Desk returns (RET-) -------------------------------------------------------

CREATE TABLE stock_returns (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number       text NOT NULL UNIQUE,
  entity_id              uuid NOT NULL REFERENCES entities (id),
  warehouse_id           uuid NOT NULL REFERENCES warehouses (id),
  kind                   text NOT NULL,
  vendor_id              uuid REFERENCES vendors (id),
  grn_id                 uuid REFERENCES procurement_goods_receipts (id),
  procurement_request_id uuid REFERENCES procurement_requests (id),
  returned_by_name       text,
  department_label       text,
  reason                 text NOT NULL,
  occurred_on            date NOT NULL,
  idempotency_key        text UNIQUE,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             text NOT NULL,
  CONSTRAINT stock_returns_kind CHECK (kind IN ('RECEIVE_RETURN', 'SUPPLIER_RETURN')),
  CONSTRAINT stock_returns_reason CHECK (btrim(reason) <> ''),
  CONSTRAINT stock_returns_vendor CHECK (kind <> 'SUPPLIER_RETURN' OR vendor_id IS NOT NULL)
);

SELECT app.apply_append_only_conventions('stock_returns', 'entity_id');
SELECT app.protect_reference_number('stock_returns');

CREATE TABLE stock_return_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id    uuid NOT NULL REFERENCES stock_returns (id),
  entity_id    uuid NOT NULL REFERENCES entities (id),
  item_id      uuid NOT NULL REFERENCES inventory_items (id),
  quantity     numeric(18, 4) NOT NULL,
  batch_id     uuid REFERENCES stock_batches (id),
  serial_id    uuid REFERENCES stock_serials (id),
  from_status  text,
  movement_id  uuid NOT NULL REFERENCES stock_movements (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,
  CONSTRAINT stock_return_lines_qty CHECK (quantity > 0),
  CONSTRAINT stock_return_lines_from_status CHECK (
    from_status IS NULL OR from_status IN ('AVAILABLE', 'QUARANTINED', 'REJECTED')
  )
);

SELECT app.apply_append_only_conventions('stock_return_lines', 'entity_id');


-- Issues: idempotency, Lane B approval for over-threshold issues ------------

ALTER TABLE stock_issues
  ADD COLUMN value_kobo           bigint,
  ADD COLUMN recipient_name       text,
  ADD COLUMN idempotency_key      text UNIQUE,
  ADD COLUMN workflow_instance_id uuid REFERENCES workflow_instances (id);

ALTER TABLE stock_issues DROP CONSTRAINT stock_issues_status;
ALTER TABLE stock_issues ADD CONSTRAINT stock_issues_status CHECK (
  status IN ('POSTED', 'VOIDED', 'PENDING_APPROVAL', 'REJECTED')
);

ALTER TABLE stock_issue_lines ADD COLUMN unit_cost_kobo bigint;


-- Transfers: idempotency for desk posts -------------------------------------

ALTER TABLE stock_transfers ADD COLUMN idempotency_key text UNIQUE;


-- Counts: completed evidence; adjustments start only from a completed count --

ALTER TABLE stock_counts DROP CONSTRAINT stock_counts_status;
ALTER TABLE stock_counts ADD CONSTRAINT stock_counts_status CHECK (
  status IN ('OPEN', 'SUBMITTED', 'POSTED', 'COMPLETED')
);
ALTER TABLE stock_counts
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN completed_by text;

ALTER TABLE stock_count_lines ADD COLUMN explanation text;

ALTER TABLE stock_adjustments
  ADD COLUMN count_id         uuid REFERENCES stock_counts (id),
  ADD COLUMN asset_id         uuid,
  ADD COLUMN value_kobo       bigint,
  ADD COLUMN requires_finance boolean NOT NULL DEFAULT false,
  ADD COLUMN idempotency_key  text UNIQUE;

ALTER TABLE stock_adjustments DROP CONSTRAINT stock_adjustments_kind;
ALTER TABLE stock_adjustments ADD CONSTRAINT stock_adjustments_kind CHECK (
  kind IN ('increase', 'decrease', 'damaged', 'expired', 'count_variance', 'disposal', 'asset_disposal')
);

-- NOT VALID: historical count_variance rows predate the count link.
ALTER TABLE stock_adjustments ADD CONSTRAINT stock_adjustments_count_link CHECK (
  kind NOT IN ('increase', 'decrease', 'count_variance') OR count_id IS NOT NULL
) NOT VALID;

ALTER TABLE stock_adjustment_lines
  ADD COLUMN stock_status text NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE stock_adjustment_lines ADD CONSTRAINT stock_adjustment_lines_stock_status CHECK (
  stock_status IN ('AVAILABLE', 'QUARANTINED', 'REJECTED')
);


-- Fixed assets (M13-B, AST-) ------------------------------------------------

CREATE TABLE fixed_assets (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number       text NOT NULL UNIQUE,
  entity_id              uuid NOT NULL REFERENCES entities (id),
  item_id                uuid NOT NULL REFERENCES inventory_items (id),
  serial_id              uuid REFERENCES stock_serials (id),
  serial_code            text,
  grn_id                 uuid REFERENCES procurement_goods_receipts (id),
  procurement_request_id uuid REFERENCES procurement_requests (id),
  warehouse_id           uuid REFERENCES warehouses (id),
  location_label         text,
  department_id          uuid REFERENCES departments (id),
  department_label       text,
  custodian_name         text,
  condition              text NOT NULL DEFAULT 'good',
  status                 text NOT NULL DEFAULT 'IN_STORE',
  cost_kobo              bigint NOT NULL DEFAULT 0,
  acquired_on            date,
  photo_document_id      uuid REFERENCES documents (id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             text NOT NULL,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             text NOT NULL,
  row_version            integer NOT NULL DEFAULT 1,
  CONSTRAINT fixed_assets_condition CHECK (condition IN ('new', 'good', 'fair', 'poor', 'damaged')),
  CONSTRAINT fixed_assets_status CHECK (status IN ('IN_STORE', 'IN_SERVICE', 'DISPOSAL_PENDING', 'DISPOSED'))
);

SELECT app.apply_mutable_conventions('fixed_assets', 'entity_id');
SELECT app.protect_reference_number('fixed_assets');
CREATE INDEX fixed_assets_item_idx ON fixed_assets (item_id);
CREATE UNIQUE INDEX fixed_assets_serial_uidx ON fixed_assets (serial_id) WHERE serial_id IS NOT NULL;

ALTER TABLE stock_adjustments
  ADD CONSTRAINT stock_adjustments_asset_fk FOREIGN KEY (asset_id) REFERENCES fixed_assets (id);

CREATE TABLE fixed_asset_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id           uuid NOT NULL REFERENCES fixed_assets (id),
  entity_id          uuid NOT NULL REFERENCES entities (id),
  kind               text NOT NULL,
  department_id      uuid REFERENCES departments (id),
  department_label   text,
  location_label     text,
  custodian_name     text,
  condition          text,
  reason             text,
  document_id        uuid REFERENCES documents (id),
  adjustment_id      uuid REFERENCES stock_adjustments (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text NOT NULL,
  CONSTRAINT fixed_asset_events_kind CHECK (
    kind IN ('REGISTERED', 'ASSIGNED', 'MOVED', 'PHOTO', 'DISPOSAL_REQUESTED', 'DISPOSED', 'DISPOSAL_REJECTED')
  )
);

SELECT app.apply_append_only_conventions('fixed_asset_events', 'entity_id');
CREATE INDEX fixed_asset_events_asset_idx ON fixed_asset_events (asset_id, created_at);


-- Production formulas (M14) -------------------------------------------------

CREATE TABLE production_formulas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid NOT NULL REFERENCES entities (id),
  code              text NOT NULL,
  name              text NOT NULL,
  version           integer NOT NULL DEFAULT 1,
  finished_item_id  uuid NOT NULL REFERENCES inventory_items (id),
  base_output_qty   numeric(18, 4) NOT NULL,
  tolerance_bps     integer,
  status            text NOT NULL DEFAULT 'ACTIVE',
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text NOT NULL,
  row_version       integer NOT NULL DEFAULT 1,
  UNIQUE (entity_id, code, version),
  CONSTRAINT production_formulas_code CHECK (btrim(code) <> ''),
  CONSTRAINT production_formulas_output CHECK (base_output_qty > 0),
  CONSTRAINT production_formulas_tolerance CHECK (tolerance_bps IS NULL OR tolerance_bps >= 0),
  CONSTRAINT production_formulas_status CHECK (status IN ('ACTIVE', 'RETIRED'))
);

SELECT app.apply_mutable_conventions('production_formulas', 'entity_id');

CREATE TABLE production_formula_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_id  uuid NOT NULL REFERENCES production_formulas (id),
  entity_id   uuid NOT NULL REFERENCES entities (id),
  item_id     uuid NOT NULL REFERENCES inventory_items (id),
  line_kind   text NOT NULL,
  quantity    numeric(18, 4) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  CONSTRAINT production_formula_lines_kind CHECK (line_kind IN ('INPUT', 'BY_PRODUCT')),
  CONSTRAINT production_formula_lines_qty CHECK (quantity > 0)
);

SELECT app.apply_append_only_conventions('production_formula_lines', 'entity_id');

ALTER TABLE production_orders
  ADD COLUMN formula_id   uuid REFERENCES production_formulas (id),
  ADD COLUMN variance_bps integer,
  ADD COLUMN close_note   text,
  ADD COLUMN closed_at    timestamptz,
  ADD COLUMN closed_by    text;

ALTER TABLE production_orders DROP CONSTRAINT IF EXISTS production_orders_status;
ALTER TABLE production_orders ADD CONSTRAINT production_orders_status CHECK (
  status IN ('PLANNED', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'COMPLETED', 'CANCELLED', 'CLOSED')
);


-- Workflows -----------------------------------------------------------------

INSERT INTO workflow_definitions (key, name, version, created_by, updated_by)
VALUES
  ('inventory-adjust-finance-v1', 'Inventory adjustment approval (ED Finance gate)', 1, 'system:seed', 'system:seed'),
  ('inventory-issue-v1', 'Over-threshold stock issue approval', 1, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO workflow_stages (
  definition_id, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days, created_by
)
SELECT d.id, s.sort_order, s.stage_key, s.label, s.perm, 'ALL',
       ARRAY['APPROVE', 'REJECT'], 2, 'system:seed'
  FROM workflow_definitions d
  JOIN (VALUES
    ('inventory-adjust-finance-v1', 1, 'review', 'ED Operations approval', 'inventory.adjust.approve'),
    ('inventory-adjust-finance-v1', 2, 'finance', 'ED Finance approval', 'inventory.dispose.approve'),
    ('inventory-issue-v1', 1, 'review', 'ED Operations approval', 'inventory.adjust.approve'),
    ('inventory-issue-v1', 2, 'finance', 'ED Finance approval', 'inventory.dispose.approve')
  ) AS s(def_key, sort_order, stage_key, label, perm) ON s.def_key = d.key
ON CONFLICT (definition_id, key) DO NOTHING;


-- Expected stock is a forecast only; finance approval no longer writes it. ---

DELETE FROM event_subscriptions
 WHERE event_type = 'inventory.expected_stock.requested' AND handler_key = 'inventory.apply_expected';

INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('inventory.qc.pending', 'notify.generic', 'system:seed'),
  ('procurement.awaiting_completion', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  ('inventory.qc.pending', 'engine', 'Quarantined stock awaits QC: {title}',
   '{title} ({reference}) is quarantined pending QC release. {summary}', false, true, 'system:seed'),
  ('procurement.awaiting_completion', 'engine', 'Ready to complete: {reference}',
   '{title} ({reference}) is delivered and paid. Confirm delivery to complete it.', true, true, 'system:seed')
ON CONFLICT (type) DO NOTHING;

UPDATE notification_types
   SET body_template = 'You can now sign in to the Workspace.'
 WHERE type = 'hr.invite.approved' AND body_template = 'You can now sign in to My workspace.';

UPDATE permissions
   SET description = 'Open the Workspace when the account is linked to an employee.'
 WHERE key = 'self.workspace' AND description = 'Open My workspace when the account is linked to an employee.';
