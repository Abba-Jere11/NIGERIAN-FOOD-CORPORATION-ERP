-- Inventory completeness: structured batch dates, receive-return issue links,
-- and a configurable (unconfirmed) near-expiry warning. Additive only.

-- Batch manufacturing / expiry ------------------------------------------------

ALTER TABLE stock_batches
  ADD COLUMN manufactured_on date,
  ADD COLUMN expires_on date;

ALTER TABLE stock_batches
  ADD CONSTRAINT stock_batches_dates CHECK (
    expires_on IS NULL OR manufactured_on IS NULL OR expires_on >= manufactured_on
  );

COMMENT ON COLUMN stock_batches.manufactured_on IS
  'Optional manufacturing date. Required only when the item is used with dated batches.';
COMMENT ON COLUMN stock_batches.expires_on IS
  'Optional expiry date. Expired AVAILABLE batches cannot be issued, dispatched or consumed in production.';

-- Identity columns stay append-only; date columns may be filled in later.
CREATE OR REPLACE FUNCTION app.stock_batches_allow_date_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.item_id IS DISTINCT FROM OLD.item_id
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.batch_code IS DISTINCT FROM OLD.batch_code
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'stock_batches does not permit changing identity columns.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stock_batches_forbid_update ON stock_batches;
CREATE TRIGGER stock_batches_forbid_update
  BEFORE UPDATE ON stock_batches
  FOR EACH ROW EXECUTE FUNCTION app.stock_batches_allow_date_update();

GRANT UPDATE (manufactured_on, expires_on) ON stock_batches TO nfc_app;

-- Backfill only unambiguous dates that belong to that batch.
-- 1) exp=YYYY-MM-DD / mfg=YYYY-MM-DD on that batch's own movement notes.
-- 2) EXPYYYYMMDD in that batch's own batch_code (expiry only).
-- Skip exp=none. Do not invent dates. Keep identity (AST refs, batch codes) unchanged.

ALTER TABLE stock_batches DISABLE TRIGGER stock_batches_forbid_update;

UPDATE stock_batches b
   SET manufactured_on = x.mfg,
       expires_on = CASE
         WHEN x.exp IS NOT NULL AND (x.mfg IS NULL OR x.exp >= x.mfg) THEN x.exp
         ELSE NULL
       END
  FROM (
    SELECT DISTINCT ON (m.batch_id)
           m.batch_id,
           CASE
             WHEN m.notes ~ 'mfg=[0-9]{4}-[0-9]{2}-[0-9]{2}'
             THEN (regexp_match(m.notes, 'mfg=([0-9]{4}-[0-9]{2}-[0-9]{2})'))[1]::date
           END AS mfg,
           CASE
             WHEN m.notes ~ 'exp=[0-9]{4}-[0-9]{2}-[0-9]{2}'
             THEN (regexp_match(m.notes, 'exp=([0-9]{4}-[0-9]{2}-[0-9]{2})'))[1]::date
           END AS exp
      FROM stock_movements m
     WHERE m.batch_id IS NOT NULL
       AND m.notes IS NOT NULL
       AND (
         m.notes ~ 'mfg=[0-9]{4}-[0-9]{2}-[0-9]{2}'
         OR m.notes ~ 'exp=[0-9]{4}-[0-9]{2}-[0-9]{2}'
       )
     ORDER BY m.batch_id, m.created_at
  ) x
 WHERE b.id = x.batch_id
   AND b.manufactured_on IS NULL
   AND b.expires_on IS NULL;

UPDATE stock_batches b
   SET expires_on = to_date((regexp_match(b.batch_code, 'EXP([0-9]{8})'))[1], 'YYYYMMDD')
 WHERE b.expires_on IS NULL
   AND b.batch_code ~ 'EXP[0-9]{8}'
   AND (
     b.manufactured_on IS NULL
     OR to_date((regexp_match(b.batch_code, 'EXP([0-9]{8})'))[1], 'YYYYMMDD') >= b.manufactured_on
   );

ALTER TABLE stock_batches ENABLE TRIGGER stock_batches_forbid_update;

-- Receive-return issue linkage (nullable; historical rows stay unlinked) ------

ALTER TABLE stock_return_lines
  ADD COLUMN issue_id uuid REFERENCES stock_issues (id),
  ADD COLUMN issue_line_id uuid REFERENCES stock_issue_lines (id);

CREATE INDEX stock_return_lines_issue_idx ON stock_return_lines (issue_line_id)
  WHERE issue_line_id IS NOT NULL;

-- Near-expiry window: UNCONFIRMED until the client sets a number. Expired
-- (expires_on < current_date) is always identified. Near-expiry listing uses
-- this setting only when CONFIRMED. Not a company policy default.

INSERT INTO inventory_settings (key, description, unit, status, value_numeric, created_by, updated_by) VALUES
  ('expiry_warning_days',
   'Days before expiry at which stock is listed as approaching expiry. Client to confirm. Expired stock is identified from the stored expiry date regardless.',
   'days', 'UNCONFIRMED', NULL, 'system:migration', 'system:migration')
ON CONFLICT (key) DO NOTHING;
