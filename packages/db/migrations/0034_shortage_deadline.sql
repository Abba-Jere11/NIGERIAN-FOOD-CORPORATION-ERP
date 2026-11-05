-- ---------------------------------------------------------------------------
-- 0034_shortage_deadline
--
-- Per-line second-batch dates (version lines are frozen after submit), a
-- single recovery identity for vendor claim + receivable, and the journal
-- source used when prepaid undelivered value is reclassified 1300 → 1220.
-- ---------------------------------------------------------------------------

CREATE TABLE procurement_shortage_deadlines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES procurement_requests (id),
  line_id     uuid NOT NULL REFERENCES procurement_version_lines (id),
  entity_id   uuid NOT NULL REFERENCES entities (id),
  due_on      date NOT NULL,
  set_at      timestamptz NOT NULL DEFAULT now(),
  set_by      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  UNIQUE (line_id)
);

SELECT app.apply_mutable_conventions('procurement_shortage_deadlines', 'entity_id');

CREATE INDEX procurement_shortage_deadlines_request_idx
  ON procurement_shortage_deadlines (request_id);


CREATE TABLE procurement_recoveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid NOT NULL REFERENCES entities (id),
  request_id      uuid NOT NULL REFERENCES procurement_requests (id),
  close_short_id  uuid NOT NULL REFERENCES procurement_close_short_requests (id),
  vendor_id       uuid NOT NULL REFERENCES vendors (id),
  amount_kobo     bigint NOT NULL,
  status          text NOT NULL DEFAULT 'OPEN',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL,
  row_version     integer NOT NULL DEFAULT 1,
  CONSTRAINT procurement_recoveries_amount CHECK (amount_kobo > 0),
  CONSTRAINT procurement_recoveries_status CHECK (status IN ('OPEN', 'SETTLED')),
  UNIQUE (close_short_id)
);

SELECT app.apply_mutable_conventions('procurement_recoveries', 'entity_id');


ALTER TABLE vendor_open_claims
  ADD COLUMN recovery_id uuid REFERENCES procurement_recoveries (id);

CREATE UNIQUE INDEX vendor_open_claims_recovery_key
  ON vendor_open_claims (recovery_id)
  WHERE recovery_id IS NOT NULL;


ALTER TABLE receivable_invoices
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE receivable_invoices
  ADD COLUMN vendor_id uuid REFERENCES vendors (id);

ALTER TABLE receivable_invoices
  ADD COLUMN recovery_id uuid REFERENCES procurement_recoveries (id);

ALTER TABLE receivable_invoices
  ADD CONSTRAINT receivable_invoices_party CHECK (
    (customer_id IS NOT NULL AND recovery_id IS NULL)
    OR (customer_id IS NULL AND recovery_id IS NOT NULL AND vendor_id IS NOT NULL)
  );

CREATE UNIQUE INDEX receivable_invoices_recovery_key
  ON receivable_invoices (recovery_id)
  WHERE recovery_id IS NOT NULL;


ALTER TABLE receipts
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE receipts
  ADD COLUMN vendor_id uuid REFERENCES vendors (id);

ALTER TABLE receipts
  ADD COLUMN recovery_id uuid REFERENCES procurement_recoveries (id);

ALTER TABLE receipts
  ADD CONSTRAINT receipts_party CHECK (
    (customer_id IS NOT NULL AND recovery_id IS NULL)
    OR (customer_id IS NULL AND recovery_id IS NOT NULL AND vendor_id IS NOT NULL)
  );


ALTER TABLE journals DROP CONSTRAINT journals_source;
ALTER TABLE journals ADD CONSTRAINT journals_source CHECK (source IN (
  'MANUAL', 'BANK_TRANSFER', 'RECONCILIATION', 'REVERSAL',
  'PROCUREMENT_PAYMENT', 'PROCUREMENT_RECLASS', 'PROCUREMENT_RECOVERY',
  'FUNDING_TRANSFER', 'INTERCOMPANY',
  'INCOME', 'EXPENSE', 'PAYABLE', 'RECEIVABLE', 'RECEIPT'
));
