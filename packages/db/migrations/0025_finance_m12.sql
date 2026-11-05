-- ---------------------------------------------------------------------------
-- 0025_finance_m12
--
-- Finance 3: reporting, saved parameter sets, append-only report runs.
-- Eliminations are computed at report time — no elimination journals.
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


CREATE TABLE report_parameter_sets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id),
  name            text NOT NULL,
  report_kind     text NOT NULL,
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'ACTIVE',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL,
  row_version     integer NOT NULL DEFAULT 1,
  CONSTRAINT report_parameter_sets_name CHECK (btrim(name) <> ''),
  CONSTRAINT report_parameter_sets_kind CHECK (btrim(report_kind) <> ''),
  CONSTRAINT report_parameter_sets_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

SELECT app.apply_mutable_conventions('report_parameter_sets');

ALTER TABLE report_parameter_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_parameter_sets_owner ON report_parameter_sets
  FOR ALL TO nfc_app
  USING (user_id = app.current_actor_id())
  WITH CHECK (user_id = app.current_actor_id());


CREATE TABLE report_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number  text NOT NULL,
  report_kind       text NOT NULL,
  entity_id         uuid REFERENCES entities (id),
  consolidated      boolean NOT NULL DEFAULT false,
  params            jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_hash       text NOT NULL,
  format            text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  CONSTRAINT report_runs_reference UNIQUE (reference_number),
  CONSTRAINT report_runs_kind CHECK (btrim(report_kind) <> ''),
  CONSTRAINT report_runs_hash CHECK (btrim(result_hash) <> ''),
  CONSTRAINT report_runs_format CHECK (format IN ('SCREEN', 'CSV', 'XLSX', 'PDF'))
);

SELECT app.apply_append_only_conventions('report_runs');
SELECT app.protect_reference_number('report_runs');

ALTER TABLE report_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_runs_scope ON report_runs
  FOR ALL TO nfc_app
  USING (
    (entity_id IS NOT NULL AND app.can_access_entity(entity_id))
    OR (entity_id IS NULL AND app.is_corporate_actor())
  )
  WITH CHECK (
    (entity_id IS NOT NULL AND app.can_access_entity(entity_id))
    OR (entity_id IS NULL AND app.is_corporate_actor())
  );
