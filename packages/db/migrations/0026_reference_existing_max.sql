-- ---------------------------------------------------------------------------
-- 0026_reference_existing_max
--
-- Seeds (and nextFreeReference) can occupy PR/GRN numbers without a matching
-- next_reference call, then skip the GREATEST bump on alreadyPresent. Live
-- allocate then emits a number that already exists and INSERT 23505s on
-- procurement_requests.reference_number.
--
-- Catch the counters up from rows that already exist, then make allocate
-- raise last_value to that max (bypassing RLS) before incrementing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.existing_max_reference(p_kind text, p_year integer)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_kind text := upper(btrim(p_kind));
  v_max integer := 0;
BEGIN
  IF v_kind = 'PR' THEN
    SELECT coalesce(max(substring(reference_number from 9)::int), 0)
      INTO v_max
      FROM procurement_requests
     WHERE reference_number ~ ('^PR-' || p_year::text || '-[0-9]{6}$');
  ELSIF v_kind = 'GRN' THEN
    SELECT coalesce(max(substring(reference_number from 10)::int), 0)
      INTO v_max
      FROM procurement_goods_receipts
     WHERE reference_number ~ ('^GRN-' || p_year::text || '-[0-9]{6}$');
  END IF;
  RETURN v_max;
END;
$$;

COMMENT ON FUNCTION app.existing_max_reference(text, integer) IS
  'Highest suffix already stored for a kind/year. SECURITY DEFINER so a subsidiary actor cannot miss another entity''s numbers on the global counter.';

REVOKE ALL ON FUNCTION app.existing_max_reference(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.existing_max_reference(text, integer) TO nfc_app;


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
    'ICT','ARI','BILL','INC','EXP','RCT','RPT'
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

COMMENT ON FUNCTION app.next_reference(text, integer) IS
  'Allocates the next permanent reference in the caller''s transaction. Lock is row-level FOR UPDATE. PR and GRN skip suffixes already stored on their tables.';

GRANT EXECUTE ON FUNCTION app.next_reference(text, integer) TO nfc_app;


INSERT INTO reference_counters (kind, year, last_value)
SELECT 'PR', y, n
FROM (
  SELECT substring(reference_number from 4 for 4)::int AS y,
         max(substring(reference_number from 9)::int) AS n
    FROM procurement_requests
   WHERE reference_number ~ '^PR-[0-9]{4}-[0-9]{6}$'
   GROUP BY 1
) s
ON CONFLICT (kind, year) DO UPDATE
  SET last_value = GREATEST(reference_counters.last_value, EXCLUDED.last_value),
      updated_at = clock_timestamp();

INSERT INTO reference_counters (kind, year, last_value)
SELECT 'GRN', y, n
FROM (
  SELECT substring(reference_number from 5 for 4)::int AS y,
         max(substring(reference_number from 10)::int) AS n
    FROM procurement_goods_receipts
   WHERE reference_number ~ '^GRN-[0-9]{4}-[0-9]{6}$'
   GROUP BY 1
) s
ON CONFLICT (kind, year) DO UPDATE
  SET last_value = GREATEST(reference_counters.last_value, EXCLUDED.last_value),
      updated_at = clock_timestamp();
