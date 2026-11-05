-- ---------------------------------------------------------------------------
-- 0010_reference_numbers
--
-- Reference-Number Engine (M3). next(kind, year) locks a per-kind, per-year
-- counter row in the caller's transaction.
--
-- Gap policy: a rolled-back allocate does not consume a number (the increment
-- lives in the same transaction). A committed number is never reused, even if
-- the business record is later discarded. Gaps are therefore expected and
-- documented, not filled.
-- ---------------------------------------------------------------------------

-- Permission keys for search RLS (fail-closed when unset).
CREATE OR REPLACE FUNCTION app.current_permission_keys() RETURNS text[]
LANGUAGE plpgsql STABLE AS $$
DECLARE raw text;
BEGIN
  raw := current_setting('app.permission_keys', true);
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN ARRAY[]::text[];
  END IF;
  RETURN string_to_array(btrim(raw), ',');
END $$;

CREATE OR REPLACE FUNCTION app.has_permission(p_key text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_key IS NOT NULL AND p_key = ANY (app.current_permission_keys());
$$;

GRANT EXECUTE ON FUNCTION app.current_permission_keys() TO nfc_app;
GRANT EXECUTE ON FUNCTION app.has_permission(text) TO nfc_app;


CREATE TABLE reference_counters (
  kind       text NOT NULL,
  year       integer NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, year),
  CONSTRAINT reference_counters_year_non_negative CHECK (year >= 0),
  CONSTRAINT reference_counters_last_value_non_negative CHECK (last_value >= 0)
);

COMMENT ON TABLE reference_counters IS
  'Per-kind, per-year sequences. year = 0 for yearless kinds such as VND.';

GRANT SELECT, INSERT, UPDATE ON reference_counters TO nfc_app;


CREATE OR REPLACE FUNCTION app.next_reference(p_kind text, p_year integer DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_kind text;
  v_year integer;
  v_next integer;
  v_allowed text[] := ARRAY[
    'PR','PAY','TRF','GRN','INV','EMP','DOC','SEAL','JNL','VND','CUS','SO','PRD','PRL','LV','VAC'
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

COMMENT ON FUNCTION app.next_reference(text, integer) IS
  'Allocates the next permanent reference in the caller''s transaction. Lock is row-level FOR UPDATE.';

GRANT EXECUTE ON FUNCTION app.next_reference(text, integer) TO nfc_app;


CREATE OR REPLACE FUNCTION app.forbid_reference_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reference_number IS DISTINCT FROM OLD.reference_number THEN
    RAISE EXCEPTION
      'Reference numbers cannot be changed after creation (rule R12).'
      USING ERRCODE = 'restrict_violation',
            HINT = 'Allocate a new record if a different number is required.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.protect_reference_number(target_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE rel_name text;
BEGIN
  SELECT relname INTO rel_name FROM pg_class WHERE oid = target_table;
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION app.forbid_reference_change()',
    rel_name || '_forbid_reference_change',
    target_table::text
  );
END $$;

GRANT EXECUTE ON FUNCTION app.protect_reference_number(regclass) TO nfc_app;


-- Fixture records so the engine can be proven without a procurement module.
CREATE TABLE engine_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid NOT NULL REFERENCES entities (id),
  kind              text NOT NULL,
  reference_number  text NOT NULL UNIQUE,
  title             text NOT NULL,
  status            record_status NOT NULL DEFAULT 'ACTIVE',
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text NOT NULL,
  row_version       integer NOT NULL DEFAULT 1
);

SELECT app.apply_mutable_conventions('engine_records', 'entity_id');
SELECT app.protect_reference_number('engine_records');

CREATE INDEX engine_records_entity_id_idx ON engine_records (entity_id);
