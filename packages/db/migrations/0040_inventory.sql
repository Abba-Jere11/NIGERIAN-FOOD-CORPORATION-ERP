-- ---------------------------------------------------------------------------
-- 0040_inventory
--
-- Inventory 1 (M13): categories, warehouses, items, expected stock, append-only
-- movements, issues, transfers, adjustments, counts. Stock on hand is the sum
-- of movements. GRN accepted qty becomes inventory; rejected qty does not.
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
    'ICT','ARI','BILL','INC','EXP','RCT','RPT','CASE','IST','ITR','IAD','CNT'
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


INSERT INTO permissions (key, description, created_by) VALUES
  ('inventory.item.manage', 'Create and maintain inventory items in a granted entity.', 'system:seed'),
  ('inventory.receive', 'Record inventory receipts from goods received notes.', 'system:seed'),
  ('inventory.issue', 'Issue stock to a department, production or project.', 'system:seed'),
  ('inventory.transfer', 'Transfer stock between warehouses or subsidiaries.', 'system:seed'),
  ('inventory.adjust.prepare', 'Prepare a stock adjustment or write-off with a reason.', 'system:seed'),
  ('inventory.adjust.approve', 'Approve a stock adjustment prepared by a different user.', 'system:seed'),
  ('inventory.count', 'Create and submit warehouse stock counts.', 'system:seed'),
  ('inventory.config', 'Maintain inventory categories, units and warehouses.', 'system:seed')
ON CONFLICT (key) DO NOTHING;

SET session_replication_role = replica;
INSERT INTO role_permissions (role_id, permission_key, created_by)
SELECT r.id, k.key, 'system:seed'
  FROM roles r
  JOIN (VALUES
    ('inventory_officer', 'inventory.item.manage'),
    ('inventory_officer', 'inventory.receive'),
    ('inventory_officer', 'inventory.issue'),
    ('inventory_officer', 'inventory.transfer'),
    ('inventory_officer', 'inventory.adjust.prepare'),
    ('inventory_officer', 'inventory.count'),
    ('inventory_officer', 'inventory.config'),
    ('ed_operations', 'inventory.adjust.approve'),
    ('gm', 'inventory.adjust.approve')
  ) AS k(role_key, key) ON k.role_key = r.key::text
ON CONFLICT DO NOTHING;
SET session_replication_role = DEFAULT;


INSERT INTO units_of_measure (code, name, created_by, updated_by) VALUES
  ('BAG', 'Bags', 'system:seed', 'system:seed'),
  ('HEAD', 'Head', 'system:seed', 'system:seed'),
  ('UNIT', 'Units', 'system:seed', 'system:seed')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE uom_conversions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_uom_id     uuid NOT NULL REFERENCES units_of_measure (id),
  to_uom_id       uuid NOT NULL REFERENCES units_of_measure (id),
  factor          numeric(18, 6) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL,
  row_version     integer NOT NULL DEFAULT 1,
  CONSTRAINT uom_conversions_distinct CHECK (from_uom_id <> to_uom_id),
  CONSTRAINT uom_conversions_factor CHECK (factor > 0),
  UNIQUE (from_uom_id, to_uom_id)
);

SELECT app.apply_mutable_conventions('uom_conversions');

ALTER TABLE uom_conversions ENABLE ROW LEVEL SECURITY;
CREATE POLICY uom_conversions_select ON uom_conversions
  FOR SELECT TO nfc_app USING (true);
CREATE POLICY uom_conversions_write ON uom_conversions
  FOR ALL TO nfc_app
  USING (app.has_permission('inventory.config'))
  WITH CHECK (app.has_permission('inventory.config'));


CREATE TABLE inventory_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities (id),
  key         text NOT NULL,
  name        text NOT NULL,
  status      record_status NOT NULL DEFAULT 'ACTIVE',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  UNIQUE (entity_id, key),
  CONSTRAINT inventory_categories_key_not_blank CHECK (btrim(key) <> ''),
  CONSTRAINT inventory_categories_name_not_blank CHECK (btrim(name) <> '')
);

SELECT app.apply_mutable_conventions('inventory_categories', 'entity_id');

INSERT INTO inventory_categories (entity_id, key, name, created_by, updated_by)
SELECT e.id, c.key, c.name, 'system:seed', 'system:seed'
  FROM entities e
  JOIN (VALUES
    ('YFZ', 'raw_materials', 'Raw Materials'),
    ('YFZ', 'finished_goods', 'Finished Goods'),
    ('YFZ', 'spare_parts', 'Spare Parts'),
    ('YFZ', 'packaging', 'Packaging'),
    ('YFZ', 'equipment', 'Equipment'),
    ('YFZ', 'consumables', 'Consumables'),
    ('YFW', 'wheat', 'Wheat'),
    ('YFW', 'flour', 'Flour'),
    ('YFW', 'bran', 'Bran'),
    ('YFW', 'packaging', 'Packaging'),
    ('YFW', 'spare_parts', 'Spare Parts'),
    ('YFW', 'consumables', 'Consumables'),
    ('DMA', 'livestock', 'Livestock'),
    ('DMA', 'meat', 'Meat'),
    ('DMA', 'cold_room', 'Cold-room'),
    ('DMA', 'spare_parts', 'Spare Parts'),
    ('DMA', 'consumables', 'Consumables'),
    ('NOM', 'seeds', 'Seeds'),
    ('NOM', 'oil', 'Oil'),
    ('NOM', 'by_products', 'By-products'),
    ('NOM', 'packaging', 'Packaging'),
    ('NOM', 'spare_parts', 'Spare Parts'),
    ('NOM', 'consumables', 'Consumables')
  ) AS c(code, key, name) ON c.code = e.code
ON CONFLICT (entity_id, key) DO NOTHING;


CREATE TABLE warehouses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities (id),
  code        text NOT NULL,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'store',
  status      record_status NOT NULL DEFAULT 'ACTIVE',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  UNIQUE (entity_id, code),
  CONSTRAINT warehouses_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT warehouses_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT warehouses_kind CHECK (kind IN ('store', 'cold_room', 'yard', 'plant'))
);

SELECT app.apply_mutable_conventions('warehouses', 'entity_id');


CREATE TABLE warehouse_locations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL REFERENCES entities (id),
  warehouse_id uuid NOT NULL REFERENCES warehouses (id),
  code         text NOT NULL,
  name         text NOT NULL,
  status       record_status NOT NULL DEFAULT 'ACTIVE',
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL,
  row_version  integer NOT NULL DEFAULT 1,
  UNIQUE (warehouse_id, code),
  CONSTRAINT warehouse_locations_code_not_blank CHECK (btrim(code) <> '')
);

SELECT app.apply_mutable_conventions('warehouse_locations', 'entity_id');


CREATE TABLE inventory_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id            uuid NOT NULL REFERENCES entities (id),
  code                 text NOT NULL,
  name                 text NOT NULL,
  category_id          uuid NOT NULL REFERENCES inventory_categories (id),
  uom_id               uuid NOT NULL REFERENCES units_of_measure (id),
  default_warehouse_id uuid REFERENCES warehouses (id),
  reorder_level        numeric(18, 4) NOT NULL DEFAULT 0,
  tracking_mode        text NOT NULL DEFAULT 'none',
  cost_method          text NOT NULL DEFAULT 'weighted_average',
  asset                boolean NOT NULL DEFAULT false,
  status               record_status NOT NULL DEFAULT 'ACTIVE',
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL,
  row_version          integer NOT NULL DEFAULT 1,
  UNIQUE (entity_id, code),
  CONSTRAINT inventory_items_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT inventory_items_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT inventory_items_reorder CHECK (reorder_level >= 0),
  CONSTRAINT inventory_items_tracking CHECK (tracking_mode IN ('none', 'batch_lot', 'serial')),
  CONSTRAINT inventory_items_cost CHECK (cost_method IN ('weighted_average'))
);

SELECT app.apply_mutable_conventions('inventory_items', 'entity_id');


CREATE TABLE inventory_item_vendors (
  item_id     uuid NOT NULL REFERENCES inventory_items (id),
  vendor_id   uuid NOT NULL REFERENCES vendors (id),
  entity_id   uuid NOT NULL REFERENCES entities (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  PRIMARY KEY (item_id, vendor_id)
);

SELECT app.apply_append_only_conventions('inventory_item_vendors', 'entity_id');


CREATE TABLE expected_stock (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id             uuid NOT NULL REFERENCES entities (id),
  procurement_request_id uuid NOT NULL REFERENCES procurement_requests (id),
  procurement_line_id   uuid NOT NULL REFERENCES procurement_version_lines (id),
  item_id               uuid REFERENCES inventory_items (id),
  vendor_id             uuid REFERENCES vendors (id),
  quantity_expected     numeric(18, 4) NOT NULL,
  quantity_remaining    numeric(18, 4) NOT NULL,
  required_date         date,
  status                text NOT NULL DEFAULT 'OPEN',
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  row_version           integer NOT NULL DEFAULT 1,
  UNIQUE (procurement_line_id),
  CONSTRAINT expected_stock_qty CHECK (quantity_expected >= 0 AND quantity_remaining >= 0),
  CONSTRAINT expected_stock_status CHECK (status IN ('OPEN', 'CLOSED'))
);

SELECT app.apply_mutable_conventions('expected_stock', 'entity_id');


CREATE TABLE stock_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL REFERENCES entities (id),
  item_id      uuid NOT NULL REFERENCES inventory_items (id),
  warehouse_id uuid NOT NULL REFERENCES warehouses (id),
  batch_code   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,
  UNIQUE (item_id, warehouse_id, batch_code),
  CONSTRAINT stock_batches_code_not_blank CHECK (btrim(batch_code) <> '')
);

SELECT app.apply_append_only_conventions('stock_batches', 'entity_id');


CREATE TABLE stock_serials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL REFERENCES entities (id),
  item_id      uuid NOT NULL REFERENCES inventory_items (id),
  warehouse_id uuid NOT NULL REFERENCES warehouses (id),
  serial_code  text NOT NULL,
  status       text NOT NULL DEFAULT 'ON_HAND',
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL,
  row_version  integer NOT NULL DEFAULT 1,
  UNIQUE (item_id, serial_code),
  CONSTRAINT stock_serials_code_not_blank CHECK (btrim(serial_code) <> ''),
  CONSTRAINT stock_serials_status CHECK (status IN ('ON_HAND', 'ISSUED', 'WRITTEN_OFF', 'IN_TRANSIT'))
);

SELECT app.apply_mutable_conventions('stock_serials', 'entity_id');


CREATE TABLE stock_movements (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number       text NOT NULL UNIQUE,
  entity_id              uuid NOT NULL REFERENCES entities (id),
  item_id                uuid NOT NULL REFERENCES inventory_items (id),
  warehouse_id           uuid NOT NULL REFERENCES warehouses (id),
  location_id            uuid REFERENCES warehouse_locations (id),
  batch_id               uuid REFERENCES stock_batches (id),
  serial_id              uuid REFERENCES stock_serials (id),
  quantity_in            numeric(18, 4) NOT NULL DEFAULT 0,
  quantity_out           numeric(18, 4) NOT NULL DEFAULT 0,
  unit_cost_kobo         bigint NOT NULL,
  value_kobo             bigint NOT NULL,
  source                 text NOT NULL,
  source_id              uuid,
  procurement_request_id uuid REFERENCES procurement_requests (id),
  grn_id                 uuid REFERENCES procurement_goods_receipts (id),
  journal_id             uuid REFERENCES journals (id),
  reverses_id            uuid REFERENCES stock_movements (id),
  notes                  text,
  occurred_on            date NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             text NOT NULL,
  CONSTRAINT stock_movements_qty CHECK (
    quantity_in >= 0 AND quantity_out >= 0
    AND (quantity_in > 0) <> (quantity_out > 0)
  ),
  CONSTRAINT stock_movements_source CHECK (
    source IN ('GRN', 'ISSUE', 'TRANSFER', 'ADJUSTMENT', 'COUNT', 'WRITE_OFF', 'REVERSE')
  )
);

SELECT app.apply_append_only_conventions('stock_movements', 'entity_id');
SELECT app.protect_reference_number('stock_movements');

CREATE INDEX stock_movements_item_idx ON stock_movements (item_id, warehouse_id, created_at);
CREATE INDEX stock_movements_grn_idx ON stock_movements (grn_id);


CREATE TABLE stock_issues (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number text NOT NULL UNIQUE,
  entity_id        uuid NOT NULL REFERENCES entities (id),
  warehouse_id     uuid NOT NULL REFERENCES warehouses (id),
  destination_type text NOT NULL,
  destination_id   uuid,
  destination_label text,
  reason           text NOT NULL,
  status           text NOT NULL DEFAULT 'POSTED',
  occurred_on      date NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL,
  row_version      integer NOT NULL DEFAULT 1,
  CONSTRAINT stock_issues_reason CHECK (btrim(reason) <> ''),
  CONSTRAINT stock_issues_dest CHECK (destination_type IN ('department', 'production', 'project')),
  CONSTRAINT stock_issues_status CHECK (status IN ('POSTED', 'VOIDED'))
);

SELECT app.apply_mutable_conventions('stock_issues', 'entity_id');
SELECT app.protect_reference_number('stock_issues');

CREATE TABLE stock_issue_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id    uuid NOT NULL REFERENCES stock_issues (id),
  entity_id   uuid NOT NULL REFERENCES entities (id),
  item_id     uuid NOT NULL REFERENCES inventory_items (id),
  quantity    numeric(18, 4) NOT NULL,
  batch_id    uuid REFERENCES stock_batches (id),
  serial_id   uuid REFERENCES stock_serials (id),
  movement_id uuid REFERENCES stock_movements (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  CONSTRAINT stock_issue_lines_qty CHECK (quantity > 0)
);

SELECT app.apply_append_only_conventions('stock_issue_lines', 'entity_id');


CREATE TABLE stock_transfers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number     text NOT NULL UNIQUE,
  source_entity_id     uuid NOT NULL REFERENCES entities (id),
  destination_entity_id uuid NOT NULL REFERENCES entities (id),
  source_warehouse_id  uuid NOT NULL REFERENCES warehouses (id),
  dest_warehouse_id    uuid REFERENCES warehouses (id),
  status               text NOT NULL DEFAULT 'DRAFT',
  reason               text NOT NULL,
  intercompany_id      uuid REFERENCES intercompany_transactions (id),
  occurred_on          date NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL,
  row_version          integer NOT NULL DEFAULT 1,
  CONSTRAINT stock_transfers_reason CHECK (btrim(reason) <> ''),
  CONSTRAINT stock_transfers_status CHECK (
    status IN ('DRAFT', 'PENDING_APPROVAL', 'IN_TRANSIT', 'RECEIVED', 'REJECTED')
  )
);

SELECT app.apply_mutable_conventions('stock_transfers');
SELECT app.protect_reference_number('stock_transfers');

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_transfers_entity_access ON stock_transfers
  FOR ALL TO nfc_app
  USING (
    app.can_access_entity(source_entity_id)
    OR app.can_access_entity(destination_entity_id)
  )
  WITH CHECK (
    app.can_access_entity(source_entity_id)
    OR app.can_access_entity(destination_entity_id)
  );

CREATE TABLE stock_transfer_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES stock_transfers (id),
  entity_id   uuid NOT NULL REFERENCES entities (id),
  item_id     uuid NOT NULL REFERENCES inventory_items (id),
  dest_item_id uuid REFERENCES inventory_items (id),
  quantity    numeric(18, 4) NOT NULL,
  batch_id    uuid REFERENCES stock_batches (id),
  serial_id   uuid REFERENCES stock_serials (id),
  out_movement_id uuid REFERENCES stock_movements (id),
  in_movement_id  uuid REFERENCES stock_movements (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT stock_transfer_lines_qty CHECK (quantity > 0)
);

SELECT app.apply_mutable_conventions('stock_transfer_lines', 'entity_id');


CREATE TABLE stock_adjustments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number text NOT NULL UNIQUE,
  entity_id        uuid NOT NULL REFERENCES entities (id),
  warehouse_id     uuid NOT NULL REFERENCES warehouses (id),
  kind             text NOT NULL,
  reason           text NOT NULL,
  evidence_document_id uuid REFERENCES documents (id),
  status           text NOT NULL DEFAULT 'PENDING_APPROVAL',
  occurred_on      date NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL,
  row_version      integer NOT NULL DEFAULT 1,
  CONSTRAINT stock_adjustments_reason CHECK (btrim(reason) <> ''),
  CONSTRAINT stock_adjustments_kind CHECK (kind IN ('increase', 'decrease', 'damaged', 'expired', 'count_variance')),
  CONSTRAINT stock_adjustments_status CHECK (status IN ('PENDING_APPROVAL', 'POSTED', 'REJECTED'))
);

SELECT app.apply_mutable_conventions('stock_adjustments', 'entity_id');
SELECT app.protect_reference_number('stock_adjustments');

CREATE TABLE stock_adjustment_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id uuid NOT NULL REFERENCES stock_adjustments (id),
  entity_id     uuid NOT NULL REFERENCES entities (id),
  item_id       uuid NOT NULL REFERENCES inventory_items (id),
  quantity      numeric(18, 4) NOT NULL,
  batch_id      uuid REFERENCES stock_batches (id),
  serial_id     uuid REFERENCES stock_serials (id),
  movement_id   uuid REFERENCES stock_movements (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL,
  row_version   integer NOT NULL DEFAULT 1,
  CONSTRAINT stock_adjustment_lines_qty CHECK (quantity <> 0)
);

SELECT app.apply_mutable_conventions('stock_adjustment_lines', 'entity_id');


CREATE TABLE stock_counts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number text NOT NULL UNIQUE,
  entity_id        uuid NOT NULL REFERENCES entities (id),
  warehouse_id     uuid NOT NULL REFERENCES warehouses (id),
  mode             text NOT NULL,
  status           text NOT NULL DEFAULT 'OPEN',
  counted_on       date NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL,
  row_version      integer NOT NULL DEFAULT 1,
  CONSTRAINT stock_counts_mode CHECK (mode IN ('blind', 'guided')),
  CONSTRAINT stock_counts_status CHECK (status IN ('OPEN', 'SUBMITTED', 'POSTED'))
);

SELECT app.apply_mutable_conventions('stock_counts', 'entity_id');
SELECT app.protect_reference_number('stock_counts');

CREATE TABLE stock_count_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id     uuid NOT NULL REFERENCES stock_counts (id),
  entity_id    uuid NOT NULL REFERENCES entities (id),
  item_id      uuid NOT NULL REFERENCES inventory_items (id),
  system_qty   numeric(18, 4) NOT NULL,
  counted_qty  numeric(18, 4),
  variance_qty numeric(18, 4),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL,
  row_version  integer NOT NULL DEFAULT 1
);

SELECT app.apply_mutable_conventions('stock_count_lines', 'entity_id');


CREATE TABLE inventory_posting_rules (
  movement_kind          text PRIMARY KEY,
  debit_account_code     text NOT NULL,
  credit_account_code    text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             text NOT NULL,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             text NOT NULL,
  row_version            integer NOT NULL DEFAULT 1,
  CONSTRAINT inventory_posting_rules_kind CHECK (
    movement_kind IN (
      'receipt_goods', 'receipt_equipment', 'issue', 'write_off',
      'transfer_out', 'transfer_in', 'adjustment_increase'
    )
  )
);

SELECT app.apply_mutable_conventions('inventory_posting_rules');

ALTER TABLE inventory_posting_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_posting_rules_select ON inventory_posting_rules
  FOR SELECT TO nfc_app USING (true);
CREATE POLICY inventory_posting_rules_write ON inventory_posting_rules
  FOR ALL TO nfc_app
  USING (app.has_permission('inventory.config'))
  WITH CHECK (app.has_permission('inventory.config'));

INSERT INTO inventory_posting_rules (movement_kind, debit_account_code, credit_account_code, created_by, updated_by)
VALUES
  ('receipt_goods', '1400', '1300', 'system:seed', 'system:seed'),
  ('receipt_equipment', '1500', '1300', 'system:seed', 'system:seed'),
  ('issue', '5100', '1400', 'system:seed', 'system:seed'),
  ('write_off', '5100', '1400', 'system:seed', 'system:seed'),
  ('transfer_out', '1210', '1400', 'system:seed', 'system:seed'),
  ('transfer_in', '1400', '2120', 'system:seed', 'system:seed'),
  ('adjustment_increase', '1400', '5100', 'system:seed', 'system:seed')
ON CONFLICT (movement_kind) DO NOTHING;


ALTER TABLE journals DROP CONSTRAINT IF EXISTS journals_source;
ALTER TABLE journals ADD CONSTRAINT journals_source CHECK (source IN (
  'MANUAL', 'BANK_TRANSFER', 'RECONCILIATION', 'REVERSAL',
  'PROCUREMENT_PAYMENT', 'PROCUREMENT_RECLASS', 'PROCUREMENT_RECOVERY',
  'FUNDING_TRANSFER', 'INTERCOMPANY',
  'INCOME', 'EXPENSE', 'PAYABLE', 'RECEIVABLE', 'RECEIPT',
  'INVENTORY_RECEIPT', 'INVENTORY_ISSUE', 'INVENTORY_WRITE_OFF', 'INVENTORY_ADJUSTMENT', 'INVENTORY_TRANSFER'
));

ALTER TABLE journal_lines
  ADD COLUMN IF NOT EXISTS inventory_movement_id uuid REFERENCES stock_movements (id);

ALTER TABLE intercompany_transactions
  ALTER COLUMN source_bank_account_id DROP NOT NULL,
  ALTER COLUMN dest_bank_account_id DROP NOT NULL;


INSERT INTO workflow_definitions (key, name, version, created_by, updated_by)
VALUES
  ('inventory-adjust-v1', 'Inventory adjustment approval', 1, 'system:seed', 'system:seed'),
  ('inventory-transfer-v1', 'Inter-entity stock transfer approval', 1, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO workflow_stages (
  definition_id, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days, created_by
)
SELECT d.id, 1, 'review', s.label, s.perm, 'ALL',
       ARRAY['APPROVE', 'REJECT'], 2, 'system:seed'
  FROM workflow_definitions d
  JOIN (VALUES
    ('inventory-adjust-v1', 'Adjustment approval', 'inventory.adjust.approve'),
    ('inventory-transfer-v1', 'Transfer approval', 'procurement.approve.operations')
  ) AS s(def_key, label, perm) ON s.def_key = d.key
ON CONFLICT (definition_id, key) DO NOTHING;


UPDATE event_subscriptions
   SET handler_key = 'inventory.apply_receipt'
 WHERE event_type = 'goods.received' AND handler_key = 'inventory.placeholder';

INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('inventory.expected_stock.requested', 'inventory.apply_expected', 'system:seed'),
  ('inventory.low_stock', 'notify.generic', 'system:seed'),
  ('inventory.adjustment.submitted', 'notify.generic', 'system:seed'),
  ('inventory.transfer.submitted', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  ('inventory.low_stock', 'action_required', 'Low stock: {title}',
   '{title} ({reference}) is at or below reorder level. {summary}', false, true, 'system:seed'),
  ('inventory.adjustment.submitted', 'action_required', 'Stock adjustment {reference} awaits approval',
   '{title} needs approval. {summary}', false, true, 'system:seed'),
  ('inventory.transfer.submitted', 'action_required', 'Stock transfer {reference} awaits approval',
   '{title} needs approval. {summary}', false, true, 'system:seed')
ON CONFLICT (type) DO NOTHING;
