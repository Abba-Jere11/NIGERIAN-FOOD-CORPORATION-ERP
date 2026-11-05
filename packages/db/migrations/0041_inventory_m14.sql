-- ---------------------------------------------------------------------------
-- 0041_inventory_m14
--
-- Inventory 2 (M14): production orders, sales orders, reservations, dispatches,
-- returns, WIP account 1410, posting rules and approval workflows.
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
    'ICT','ARI','BILL','INC','EXP','RCT','RPT','CASE','IST','ITR','IAD','CNT','DSP','SRN'
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
  ('sales.view', 'View production and sales orders within granted entities.', 'system:seed'),
  ('production.create', 'Create and start a production order.', 'system:seed'),
  ('production.complete', 'Submit a production order for completion approval.', 'system:seed'),
  ('production.approve', 'Approve a completed production order prepared by a different user.', 'system:seed'),
  ('sales.order.create', 'Create and submit a sales order.', 'system:seed'),
  ('sales.order.approve', 'Approve a sales order prepared by a different user.', 'system:seed'),
  ('sales.dispatch', 'Dispatch reserved stock on an approved sales order.', 'system:seed'),
  ('sales.invoice', 'Raise a receivables invoice for dispatched sales.', 'system:seed')
ON CONFLICT (key) DO NOTHING;

SET session_replication_role = replica;
INSERT INTO role_permissions (role_id, permission_key, created_by)
SELECT r.id, k.key, 'system:seed'
  FROM roles r
  JOIN (VALUES
    ('inventory_officer', 'sales.view'),
    ('inventory_officer', 'production.create'),
    ('inventory_officer', 'production.complete'),
    ('inventory_officer', 'sales.order.create'),
    ('inventory_officer', 'sales.dispatch'),
    ('inventory_officer', 'sales.invoice'),
    ('gm', 'sales.view'),
    ('gm', 'production.approve'),
    ('gm', 'sales.order.approve'),
    ('ed_operations', 'sales.view'),
    ('ed_operations', 'production.approve'),
    ('ed_operations', 'sales.order.approve'),
    ('md', 'sales.view')
  ) AS k(role_key, key) ON k.role_key = r.key::text
ON CONFLICT DO NOTHING;
SET session_replication_role = DEFAULT;


INSERT INTO account_templates (
  code, name, type, parent_code, normal_balance, consolidation_code, intercompany, sort_order, created_by
) VALUES
  ('1410', 'Work in progress', 'ASSET', '1400', 'DEBIT', '1410', false, 95, 'system:seed')
ON CONFLICT (code) DO NOTHING;

INSERT INTO accounts (
  entity_id, template_id, code, name, type, parent_id, normal_balance, consolidation_code,
  intercompany, created_by, updated_by
)
SELECT e.id, t.id, t.code, t.name, t.type, p.id, t.normal_balance, t.consolidation_code,
       t.intercompany, 'system:seed', 'system:seed'
  FROM entities e
  JOIN account_templates t ON t.code = '1410'
  LEFT JOIN accounts p ON p.entity_id = e.id AND p.code = t.parent_code
 WHERE EXISTS (SELECT 1 FROM accounts a WHERE a.entity_id = e.id)
ON CONFLICT (entity_id, code) DO NOTHING;


ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_source;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_source CHECK (
  source IN (
    'GRN', 'ISSUE', 'TRANSFER', 'ADJUSTMENT', 'COUNT', 'WRITE_OFF', 'REVERSE',
    'PRODUCTION', 'SALE', 'SALES_RETURN'
  )
);


ALTER TABLE inventory_posting_rules DROP CONSTRAINT IF EXISTS inventory_posting_rules_kind;
ALTER TABLE inventory_posting_rules ADD CONSTRAINT inventory_posting_rules_kind CHECK (
  movement_kind IN (
    'receipt_goods', 'receipt_equipment', 'issue', 'write_off',
    'transfer_out', 'transfer_in', 'adjustment_increase',
    'production_wip', 'production_fg', 'production_waste', 'production_overhead',
    'sales_cogs', 'sales_revenue'
  )
);

INSERT INTO inventory_posting_rules (movement_kind, debit_account_code, credit_account_code, created_by, updated_by)
VALUES
  ('production_wip', '1410', '1400', 'system:seed', 'system:seed'),
  ('production_fg', '1400', '1410', 'system:seed', 'system:seed'),
  ('production_waste', '5100', '1410', 'system:seed', 'system:seed'),
  ('production_overhead', '1410', '5200', 'system:seed', 'system:seed'),
  ('sales_cogs', '5100', '1400', 'system:seed', 'system:seed'),
  ('sales_revenue', '1220', '4100', 'system:seed', 'system:seed')
ON CONFLICT (movement_kind) DO NOTHING;


ALTER TABLE journals DROP CONSTRAINT IF EXISTS journals_source;
ALTER TABLE journals ADD CONSTRAINT journals_source CHECK (source IN (
  'MANUAL', 'BANK_TRANSFER', 'RECONCILIATION', 'REVERSAL',
  'PROCUREMENT_PAYMENT', 'PROCUREMENT_RECLASS', 'PROCUREMENT_RECOVERY',
  'FUNDING_TRANSFER', 'INTERCOMPANY',
  'INCOME', 'EXPENSE', 'PAYABLE', 'RECEIVABLE', 'RECEIPT',
  'INVENTORY_RECEIPT', 'INVENTORY_ISSUE', 'INVENTORY_WRITE_OFF', 'INVENTORY_ADJUSTMENT', 'INVENTORY_TRANSFER',
  'PRODUCTION_WIP', 'PRODUCTION_OUTPUT', 'PRODUCTION_WASTE', 'PRODUCTION_OVERHEAD',
  'SALES_REVENUE', 'SALES_COGS', 'SALES_RETURN'
));


CREATE TABLE production_overhead_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid NOT NULL REFERENCES entities (id),
  finished_item_id  uuid REFERENCES inventory_items (id),
  category_id       uuid REFERENCES inventory_categories (id),
  method            text NOT NULL,
  rate              numeric(18, 6) NOT NULL,
  status            record_status NOT NULL DEFAULT 'ACTIVE',
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text NOT NULL,
  row_version       integer NOT NULL DEFAULT 1,
  CONSTRAINT production_overhead_rules_method CHECK (method IN ('per_output_kobo', 'percent_of_rm')),
  CONSTRAINT production_overhead_rules_rate CHECK (rate >= 0),
  CONSTRAINT production_overhead_rules_target CHECK (finished_item_id IS NOT NULL OR category_id IS NOT NULL)
);

SELECT app.apply_mutable_conventions('production_overhead_rules', 'entity_id');


CREATE TABLE production_orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number     text NOT NULL UNIQUE,
  entity_id            uuid NOT NULL REFERENCES entities (id),
  warehouse_id         uuid NOT NULL REFERENCES warehouses (id),
  finished_item_id     uuid NOT NULL REFERENCES inventory_items (id),
  planned_output_qty   numeric(18, 4) NOT NULL,
  actual_output_qty    numeric(18, 4),
  waste_qty            numeric(18, 4) NOT NULL DEFAULT 0,
  waste_reason         text,
  yield_pct            numeric(18, 6),
  finished_batch_id    uuid REFERENCES stock_batches (id),
  produced_on          date,
  status               text NOT NULL DEFAULT 'PLANNED',
  cancel_reason        text,
  workflow_instance_id uuid REFERENCES workflow_instances (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL,
  row_version          integer NOT NULL DEFAULT 1,
  CONSTRAINT production_orders_planned CHECK (planned_output_qty > 0),
  CONSTRAINT production_orders_waste CHECK (waste_qty >= 0),
  CONSTRAINT production_orders_status CHECK (
    status IN ('PLANNED', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'COMPLETED', 'CANCELLED')
  )
);

SELECT app.apply_mutable_conventions('production_orders', 'entity_id');
SELECT app.protect_reference_number('production_orders');


CREATE TABLE production_order_inputs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES production_orders (id),
  entity_id     uuid NOT NULL REFERENCES entities (id),
  item_id       uuid NOT NULL REFERENCES inventory_items (id),
  warehouse_id  uuid NOT NULL REFERENCES warehouses (id),
  batch_id      uuid REFERENCES stock_batches (id),
  planned_qty   numeric(18, 4) NOT NULL,
  actual_qty    numeric(18, 4),
  unit_cost_kobo bigint,
  movement_id   uuid REFERENCES stock_movements (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL,
  row_version   integer NOT NULL DEFAULT 1,
  CONSTRAINT production_order_inputs_planned CHECK (planned_qty > 0)
);

SELECT app.apply_mutable_conventions('production_order_inputs', 'entity_id');


CREATE TABLE production_order_outputs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES production_orders (id),
  entity_id     uuid NOT NULL REFERENCES entities (id),
  item_id       uuid NOT NULL REFERENCES inventory_items (id),
  warehouse_id  uuid NOT NULL REFERENCES warehouses (id),
  batch_id      uuid REFERENCES stock_batches (id),
  planned_qty   numeric(18, 4) NOT NULL,
  actual_qty    numeric(18, 4),
  unit_cost_kobo bigint,
  movement_id   uuid REFERENCES stock_movements (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL,
  row_version   integer NOT NULL DEFAULT 1,
  CONSTRAINT production_order_outputs_planned CHECK (planned_qty > 0)
);

SELECT app.apply_mutable_conventions('production_order_outputs', 'entity_id');


CREATE TABLE production_batch_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid NOT NULL REFERENCES entities (id),
  order_id          uuid NOT NULL REFERENCES production_orders (id),
  finished_batch_id uuid NOT NULL REFERENCES stock_batches (id),
  raw_batch_id      uuid NOT NULL REFERENCES stock_batches (id),
  quantity          numeric(18, 4) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  CONSTRAINT production_batch_links_qty CHECK (quantity > 0)
);

SELECT app.apply_append_only_conventions('production_batch_links', 'entity_id');


CREATE TABLE sales_orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number     text NOT NULL UNIQUE,
  entity_id            uuid NOT NULL REFERENCES entities (id),
  customer_id          uuid NOT NULL REFERENCES customers (id),
  terms                text,
  due_on               date,
  occurred_on          date NOT NULL,
  status               text NOT NULL DEFAULT 'DRAFT',
  cancel_reason        text,
  receivable_invoice_id uuid REFERENCES receivable_invoices (id),
  workflow_instance_id uuid REFERENCES workflow_instances (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL,
  row_version          integer NOT NULL DEFAULT 1,
  CONSTRAINT sales_orders_status CHECK (
    status IN (
      'DRAFT', 'AWAITING_APPROVAL', 'RESERVED', 'PART_DISPATCHED',
      'DISPATCHED', 'INVOICED', 'CANCELLED', 'RETURNED'
    )
  )
);

SELECT app.apply_mutable_conventions('sales_orders', 'entity_id');
SELECT app.protect_reference_number('sales_orders');


CREATE TABLE sales_order_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES sales_orders (id),
  entity_id        uuid NOT NULL REFERENCES entities (id),
  item_id          uuid NOT NULL REFERENCES inventory_items (id),
  warehouse_id     uuid NOT NULL REFERENCES warehouses (id),
  quantity         numeric(18, 4) NOT NULL,
  unit_price_kobo  bigint NOT NULL,
  reserved_qty     numeric(18, 4) NOT NULL DEFAULT 0,
  dispatched_qty   numeric(18, 4) NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL,
  row_version      integer NOT NULL DEFAULT 1,
  CONSTRAINT sales_order_lines_qty CHECK (quantity > 0),
  CONSTRAINT sales_order_lines_price CHECK (unit_price_kobo >= 0),
  CONSTRAINT sales_order_lines_reserved CHECK (reserved_qty >= 0 AND dispatched_qty >= 0)
);

SELECT app.apply_mutable_conventions('sales_order_lines', 'entity_id');


CREATE TABLE stock_reservations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id          uuid NOT NULL REFERENCES entities (id),
  sales_order_line_id uuid NOT NULL REFERENCES sales_order_lines (id),
  item_id            uuid NOT NULL REFERENCES inventory_items (id),
  warehouse_id       uuid NOT NULL REFERENCES warehouses (id),
  batch_id           uuid REFERENCES stock_batches (id),
  quantity           numeric(18, 4) NOT NULL,
  status             text NOT NULL DEFAULT 'OPEN',
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text NOT NULL,
  row_version        integer NOT NULL DEFAULT 1,
  CONSTRAINT stock_reservations_qty CHECK (quantity > 0),
  CONSTRAINT stock_reservations_status CHECK (status IN ('OPEN', 'RELEASED'))
);

SELECT app.apply_mutable_conventions('stock_reservations', 'entity_id');

CREATE UNIQUE INDEX stock_reservations_open_line_wh_batch
  ON stock_reservations (
    sales_order_line_id,
    warehouse_id,
    coalesce(batch_id, '00000000-0000-0000-0000-000000000000')
  )
  WHERE status = 'OPEN';


CREATE TABLE sales_dispatches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number text NOT NULL UNIQUE,
  entity_id        uuid NOT NULL REFERENCES entities (id),
  sales_order_id   uuid NOT NULL REFERENCES sales_orders (id),
  vehicle          text,
  driver           text,
  destination      text NOT NULL,
  document_id      uuid REFERENCES documents (id),
  status           text NOT NULL DEFAULT 'DISPATCHED',
  occurred_on      date NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL,
  row_version      integer NOT NULL DEFAULT 1,
  CONSTRAINT sales_dispatches_destination CHECK (btrim(destination) <> ''),
  CONSTRAINT sales_dispatches_status CHECK (status IN ('DISPATCHED', 'REVERSED'))
);

SELECT app.apply_mutable_conventions('sales_dispatches', 'entity_id');
SELECT app.protect_reference_number('sales_dispatches');


CREATE TABLE sales_dispatch_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id    uuid NOT NULL REFERENCES sales_dispatches (id),
  entity_id      uuid NOT NULL REFERENCES entities (id),
  order_line_id  uuid NOT NULL REFERENCES sales_order_lines (id),
  item_id        uuid NOT NULL REFERENCES inventory_items (id),
  warehouse_id   uuid NOT NULL REFERENCES warehouses (id),
  batch_id       uuid REFERENCES stock_batches (id),
  quantity       numeric(18, 4) NOT NULL,
  unit_cost_kobo bigint NOT NULL,
  movement_id    uuid REFERENCES stock_movements (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text NOT NULL,
  CONSTRAINT sales_dispatch_lines_qty CHECK (quantity > 0)
);

SELECT app.apply_append_only_conventions('sales_dispatch_lines', 'entity_id');


CREATE TABLE sales_returns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number text NOT NULL UNIQUE,
  entity_id        uuid NOT NULL REFERENCES entities (id),
  sales_order_id   uuid NOT NULL REFERENCES sales_orders (id),
  dispatch_id      uuid REFERENCES sales_dispatches (id),
  reason           text NOT NULL,
  status           text NOT NULL DEFAULT 'POSTED',
  occurred_on      date NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL,
  row_version      integer NOT NULL DEFAULT 1,
  CONSTRAINT sales_returns_reason CHECK (btrim(reason) <> ''),
  CONSTRAINT sales_returns_status CHECK (status IN ('POSTED', 'VOIDED'))
);

SELECT app.apply_mutable_conventions('sales_returns', 'entity_id');
SELECT app.protect_reference_number('sales_returns');


CREATE TABLE sales_return_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id        uuid NOT NULL REFERENCES sales_returns (id),
  entity_id        uuid NOT NULL REFERENCES entities (id),
  dispatch_line_id uuid REFERENCES sales_dispatch_lines (id),
  item_id          uuid NOT NULL REFERENCES inventory_items (id),
  warehouse_id     uuid NOT NULL REFERENCES warehouses (id),
  quantity         numeric(18, 4) NOT NULL,
  unit_cost_kobo   bigint NOT NULL,
  movement_id      uuid REFERENCES stock_movements (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  CONSTRAINT sales_return_lines_qty CHECK (quantity > 0)
);

SELECT app.apply_append_only_conventions('sales_return_lines', 'entity_id');


ALTER TABLE receivable_invoices
  ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES sales_orders (id);


INSERT INTO workflow_definitions (key, name, version, created_by, updated_by)
VALUES
  ('production-complete-v1', 'Production completion approval', 1, 'system:seed', 'system:seed'),
  ('sales-order-v1', 'Sales order approval', 1, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO workflow_stages (
  definition_id, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days, created_by
)
SELECT d.id, 1, 'review', s.label, s.perm, 'ALL',
       ARRAY['APPROVE', 'REJECT'], 2, 'system:seed'
  FROM workflow_definitions d
  JOIN (VALUES
    ('production-complete-v1', 'Production approval', 'production.approve'),
    ('sales-order-v1', 'Sales order approval', 'sales.order.approve')
  ) AS s(def_key, label, perm) ON s.def_key = d.key
ON CONFLICT (definition_id, key) DO NOTHING;


INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('production.submitted', 'notify.generic', 'system:seed'),
  ('sales.order.submitted', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  ('production.submitted', 'action_required', 'Production {reference} awaits approval',
   '{title} needs completion approval. {summary}', false, true, 'system:seed'),
  ('sales.order.submitted', 'action_required', 'Sales order {reference} awaits approval',
   '{title} needs approval before reservation. {summary}', false, true, 'system:seed')
ON CONFLICT (type) DO NOTHING;
