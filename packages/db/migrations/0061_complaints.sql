-- ---------------------------------------------------------------------------
-- 0061_complaints
--
-- Signed-in staff can contact HR. An anonymous complaint hides the submitter
-- from the HR role; the audit log still records who acted.
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
    'ORG','MIN','RSP','DEC','DISC','TRN','DEL','CMP'
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
  SELECT last_value INTO v_next FROM reference_counters WHERE kind = v_kind AND year = v_year FOR UPDATE;
  IF v_kind IN ('PR', 'GRN') THEN
    v_next := GREATEST(v_next, app.existing_max_reference(v_kind, v_year));
  END IF;
  v_next := v_next + 1;
  UPDATE reference_counters SET last_value = v_next, updated_at = clock_timestamp()
   WHERE kind = v_kind AND year = v_year;
  IF v_kind = 'VND' THEN
    RETURN v_kind || '-' || lpad(v_next::text, 6, '0');
  END IF;
  RETURN v_kind || '-' || v_year::text || '-' || lpad(v_next::text, 6, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION app.next_reference(text, integer) TO nfc_app;

CREATE TABLE hr_complaints (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number      text NOT NULL UNIQUE,
  entity_id             uuid NOT NULL REFERENCES entities (id),
  category              text NOT NULL,
  subject               text NOT NULL,
  body                  text NOT NULL,
  is_anonymous          boolean NOT NULL DEFAULT false,
  submitted_by_user_id  uuid NOT NULL REFERENCES users (id),
  status                text NOT NULL DEFAULT 'OPEN',
  assigned_to           uuid REFERENCES users (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  row_version           integer NOT NULL DEFAULT 1,
  CONSTRAINT hr_complaints_status CHECK (status IN ('OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED')),
  CONSTRAINT hr_complaints_subject CHECK (btrim(subject) <> '')
);

SELECT app.apply_mutable_conventions('hr_complaints');
ALTER TABLE hr_complaints ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app.owns_complaint(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM hr_complaints
     WHERE id = p_id AND submitted_by_user_id = app.current_user_id()
  )
$$;

GRANT EXECUTE ON FUNCTION app.owns_complaint(uuid) TO nfc_app;

CREATE POLICY hr_complaints_owner ON hr_complaints FOR SELECT TO nfc_app
  USING (app.owns_complaint(id) OR (app.has_permission('complaint.manage') AND app.can_access_entity(entity_id)));
CREATE POLICY hr_complaints_owner_update ON hr_complaints FOR UPDATE TO nfc_app
  USING (app.owns_complaint(id) OR (app.has_permission('complaint.manage') AND app.can_access_entity(entity_id)))
  WITH CHECK (app.can_access_entity(entity_id));
CREATE POLICY hr_complaints_insert ON hr_complaints FOR INSERT TO nfc_app
  WITH CHECK (
    submitted_by_user_id = app.current_user_id()
    AND app.has_permission('complaint.submit')
    AND app.can_access_entity(entity_id)
  );

REVOKE SELECT ON hr_complaints FROM nfc_app;
GRANT SELECT (
  id, reference_number, entity_id, category, subject, body, is_anonymous,
  status, assigned_to, created_at, created_by, updated_at, updated_by, row_version
) ON hr_complaints TO nfc_app;

CREATE OR REPLACE FUNCTION app.complaints_for_actor()
RETURNS TABLE (
  id uuid,
  reference_number text,
  entity_id uuid,
  category text,
  subject text,
  body text,
  is_anonymous boolean,
  submitted_by_user_id uuid,
  status text,
  assigned_to uuid,
  created_at timestamptz,
  row_version integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.reference_number, c.entity_id, c.category, c.subject, c.body, c.is_anonymous,
         CASE
           WHEN app.has_permission('complaint.manage') AND c.is_anonymous THEN NULL
           ELSE c.submitted_by_user_id
         END,
         c.status, c.assigned_to, c.created_at, c.row_version
    FROM hr_complaints c
   WHERE (app.has_permission('complaint.manage') AND app.can_access_entity(c.entity_id))
      OR c.submitted_by_user_id = app.current_user_id()
   ORDER BY c.created_at DESC
$$;

GRANT EXECUTE ON FUNCTION app.complaints_for_actor() TO nfc_app;

CREATE TABLE hr_complaint_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id  uuid NOT NULL REFERENCES hr_complaints (id),
  author_user_id uuid NOT NULL REFERENCES users (id),
  body          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  CONSTRAINT hr_complaint_messages_body CHECK (btrim(body) <> '')
);

SELECT app.apply_append_only_conventions('hr_complaint_messages');
ALTER TABLE hr_complaint_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_complaint_messages_acl ON hr_complaint_messages FOR SELECT TO nfc_app
  USING (app.owns_complaint(complaint_id) OR app.has_permission('complaint.manage'));
CREATE POLICY hr_complaint_messages_insert ON hr_complaint_messages FOR INSERT TO nfc_app
  WITH CHECK (
    author_user_id = app.current_user_id()
    AND (app.owns_complaint(complaint_id) OR app.has_permission('complaint.manage'))
  );

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  ('complaint.submitted', 'action_required', 'Complaint {reference}', '{title}', true, true, 'system:seed'),
  ('complaint.updated', 'engine', 'Complaint {reference} updated', '{title}', false, false, 'system:seed')
ON CONFLICT (type) DO NOTHING;

INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('complaint.submitted', 'notify.generic', 'system:seed'),
  ('complaint.updated', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;
