-- ---------------------------------------------------------------------------
-- 0032_procurement_lines
--
-- One request / one vendor / many commercial lines. Existing versions become
-- line 1. GRNs gain an optional line_id so receipts can be recorded per line.
-- ---------------------------------------------------------------------------

CREATE TABLE procurement_version_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id        uuid NOT NULL REFERENCES procurement_versions (id),
  entity_id         uuid NOT NULL REFERENCES entities (id),
  line_number       integer NOT NULL,
  description       text NOT NULL DEFAULT '',
  category_id       uuid REFERENCES procurement_categories (id),
  quantity          integer,
  unit_id           uuid REFERENCES units_of_measure (id),
  unit_price_kobo   bigint,
  line_amount_kobo  bigint,
  budget_line_id    uuid REFERENCES budget_lines (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text NOT NULL,
  row_version       integer NOT NULL DEFAULT 1,
  CONSTRAINT procurement_version_lines_number_positive CHECK (line_number >= 1),
  CONSTRAINT procurement_version_lines_quantity_positive CHECK (quantity IS NULL OR quantity > 0),
  CONSTRAINT procurement_version_lines_price_positive CHECK (unit_price_kobo IS NULL OR unit_price_kobo > 0),
  CONSTRAINT procurement_version_lines_amount_positive CHECK (line_amount_kobo IS NULL OR line_amount_kobo > 0),
  UNIQUE (version_id, line_number)
);

SELECT app.apply_mutable_conventions('procurement_version_lines', 'entity_id');

-- Drafts may add/remove lines. Submitted versions are frozen below.
DROP TRIGGER IF EXISTS procurement_version_lines_forbid_delete ON procurement_version_lines;
DROP TRIGGER IF EXISTS procurement_version_lines_forbid_truncate ON procurement_version_lines;
GRANT DELETE ON procurement_version_lines TO nfc_app;

CREATE INDEX procurement_version_lines_version_idx
  ON procurement_version_lines (version_id, line_number);

INSERT INTO procurement_version_lines (
  version_id, entity_id, line_number, description, category_id, quantity, unit_id,
  unit_price_kobo, line_amount_kobo, budget_line_id, created_by, updated_by
)
SELECT v.id, v.entity_id, 1, coalesce(nullif(btrim(v.description), ''), v.title),
       v.category_id, v.quantity, v.unit_id, v.unit_price_kobo,
       coalesce(v.total_amount_kobo, CASE
         WHEN v.quantity IS NOT NULL AND v.unit_price_kobo IS NOT NULL
         THEN v.quantity * v.unit_price_kobo
         ELSE NULL
       END),
       v.budget_line_id, v.created_by, v.updated_by
  FROM procurement_versions v
 WHERE v.category_id IS NOT NULL
    OR v.quantity IS NOT NULL
    OR v.unit_price_kobo IS NOT NULL
    OR v.budget_line_id IS NOT NULL
ON CONFLICT (version_id, line_number) DO NOTHING;

ALTER TABLE procurement_goods_receipts
  ADD COLUMN line_id uuid REFERENCES procurement_version_lines (id);

-- Receipts are append-only; disable the R2 trigger only for this one-time backfill.
ALTER TABLE procurement_goods_receipts DISABLE TRIGGER procurement_goods_receipts_forbid_update;
UPDATE procurement_goods_receipts g
   SET line_id = l.id
  FROM procurement_version_lines l
 WHERE l.version_id = g.version_id
   AND l.line_number = 1
   AND g.line_id IS NULL;
ALTER TABLE procurement_goods_receipts ENABLE TRIGGER procurement_goods_receipts_forbid_update;

CREATE OR REPLACE FUNCTION app.forbid_line_on_submitted_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE submitted timestamptz;
BEGIN
  SELECT submitted_at INTO submitted
    FROM procurement_versions
   WHERE id = COALESCE(NEW.version_id, OLD.version_id);
  IF submitted IS NOT NULL THEN
    RAISE EXCEPTION 'append-only: lines on a submitted procurement version cannot be changed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER procurement_version_lines_forbid_submitted
  BEFORE INSERT OR UPDATE OR DELETE ON procurement_version_lines
  FOR EACH ROW
  EXECUTE FUNCTION app.forbid_line_on_submitted_version();
