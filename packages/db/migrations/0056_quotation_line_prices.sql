-- ---------------------------------------------------------------------------
-- 0056_quotation_line_prices
-- Each vendor quotation prices every memo line. Header amount_kobo stays the
-- derived vendor total (sum of line amounts) used for the lowest-price award.
-- Header unit_price_kobo remains for quotations recorded before this change.
-- ---------------------------------------------------------------------------

CREATE TABLE procurement_quotation_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id      uuid NOT NULL REFERENCES procurement_quotations (id) ON DELETE CASCADE,
  entity_id         uuid NOT NULL REFERENCES entities (id),
  line_number       integer NOT NULL,
  unit_price_kobo   bigint NOT NULL,
  line_amount_kobo  bigint NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text NOT NULL,
  row_version       integer NOT NULL DEFAULT 1,
  CONSTRAINT procurement_quotation_lines_number_positive CHECK (line_number >= 1),
  CONSTRAINT procurement_quotation_lines_price_positive CHECK (unit_price_kobo > 0),
  CONSTRAINT procurement_quotation_lines_amount_positive CHECK (line_amount_kobo > 0),
  UNIQUE (quotation_id, line_number)
);

SELECT app.apply_mutable_conventions('procurement_quotation_lines', 'entity_id');
DROP TRIGGER IF EXISTS procurement_quotation_lines_forbid_delete ON procurement_quotation_lines;
DROP TRIGGER IF EXISTS procurement_quotation_lines_forbid_truncate ON procurement_quotation_lines;
GRANT DELETE ON procurement_quotation_lines TO nfc_app;

CREATE INDEX procurement_quotation_lines_quotation_idx
  ON procurement_quotation_lines (quotation_id, line_number);

CREATE OR REPLACE FUNCTION app.forbid_quotation_line_on_submitted_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  submitted timestamptz;
  qid uuid;
BEGIN
  qid := COALESCE(NEW.quotation_id, OLD.quotation_id);
  SELECT v.submitted_at INTO submitted
    FROM procurement_quotations q
    JOIN procurement_versions v ON v.id = q.version_id
   WHERE q.id = qid;
  IF submitted IS NOT NULL THEN
    RAISE EXCEPTION 'append-only: quotations on a submitted version cannot be changed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER procurement_quotation_lines_forbid_submitted
  BEFORE INSERT OR UPDATE OR DELETE ON procurement_quotation_lines
  FOR EACH ROW
  EXECUTE FUNCTION app.forbid_quotation_line_on_submitted_version();

-- MD approval copies the selected vendor's unit prices onto a memo that was
-- submitted with blank prices, then refreshes the frozen snapshot. The write is
-- allowed only inside the transaction that sets this flag, and only for the
-- price columns (lines and the version total) or the snapshot body.
CREATE OR REPLACE FUNCTION app.forbid_line_on_submitted_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE submitted timestamptz;
BEGIN
  SELECT submitted_at INTO submitted
    FROM procurement_versions
   WHERE id = COALESCE(NEW.version_id, OLD.version_id);
  IF submitted IS NOT NULL THEN
    IF TG_OP = 'UPDATE'
       AND current_setting('app.allow_md_price_fill', true) = 'on'
       AND (to_jsonb(NEW) - 'unit_price_kobo' - 'line_amount_kobo' - 'updated_at' - 'updated_by' - 'row_version')
           IS NOT DISTINCT FROM
           (to_jsonb(OLD) - 'unit_price_kobo' - 'line_amount_kobo' - 'updated_at' - 'updated_by' - 'row_version')
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'append-only: lines on a submitted procurement version cannot be changed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.forbid_submitted_procurement_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.submitted_at IS NOT NULL THEN
    IF TG_OP = 'UPDATE'
       AND current_setting('app.allow_md_price_fill', true) = 'on'
       AND (to_jsonb(NEW) - 'unit_price_kobo' - 'total_amount_kobo' - 'updated_at' - 'updated_by' - 'row_version')
           IS NOT DISTINCT FROM
           (to_jsonb(OLD) - 'unit_price_kobo' - 'total_amount_kobo' - 'updated_at' - 'updated_by' - 'row_version')
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'append-only: submitted procurement versions cannot be changed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.forbid_memo_snapshot_price_fill() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.allow_md_price_fill', true) = 'on'
     AND NEW.request_id IS NOT DISTINCT FROM OLD.request_id
     AND NEW.version_id IS NOT DISTINCT FROM OLD.version_id
     AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
     AND NEW.memo_template_version IS NOT DISTINCT FROM OLD.memo_template_version
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
     AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    'Table %.% does not permit UPDATE; business records are never deleted.',
    TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;

GRANT UPDATE ON procurement_memo_snapshots TO nfc_app;

DROP TRIGGER IF EXISTS procurement_memo_snapshots_forbid_update ON procurement_memo_snapshots;
CREATE TRIGGER procurement_memo_snapshots_price_fill
  BEFORE UPDATE ON procurement_memo_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION app.forbid_memo_snapshot_price_fill();
