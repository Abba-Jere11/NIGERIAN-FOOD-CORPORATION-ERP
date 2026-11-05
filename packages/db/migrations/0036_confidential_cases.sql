-- ---------------------------------------------------------------------------
-- 0036_confidential_cases
--
-- Restricted case register. Access is an ACL, not entity-wide corporate
-- visibility. Assigning a handler is distinct from granting extra access.
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
    'ICT','ARI','BILL','INC','EXP','RCT','RPT','CASE'
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


CREATE TABLE confidential_cases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number  text NOT NULL UNIQUE,
  entity_id         uuid NOT NULL REFERENCES entities (id),
  title             text NOT NULL,
  body              text NOT NULL,
  status            text NOT NULL DEFAULT 'OPEN',
  assigned_user_id  uuid REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text NOT NULL,
  row_version       integer NOT NULL DEFAULT 1,
  CONSTRAINT confidential_cases_title CHECK (btrim(title) <> ''),
  CONSTRAINT confidential_cases_body CHECK (btrim(body) <> ''),
  CONSTRAINT confidential_cases_status CHECK (status IN ('OPEN', 'IN_PROGRESS', 'CLOSED'))
);

SELECT app.add_row_version_trigger('confidential_cases');
SELECT app.forbid_hard_delete('confidential_cases');
SELECT app.grant_mutable_table('confidential_cases');

CREATE TABLE confidential_case_access (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES confidential_cases (id),
  entity_id   uuid NOT NULL REFERENCES entities (id),
  user_id     uuid NOT NULL REFERENCES users (id),
  kind        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  CONSTRAINT confidential_case_access_kind CHECK (kind IN ('ASSIGNEE', 'GRANT', 'CC')),
  UNIQUE (case_id, user_id, kind)
);

SELECT app.grant_append_only_table('confidential_case_access');
ALTER TABLE confidential_case_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY confidential_case_access_acl ON confidential_case_access
  FOR ALL TO nfc_app
  USING (
    user_id = app.current_actor_id()
    OR created_by = app.current_actor_ref()
    OR EXISTS (
      SELECT 1 FROM confidential_cases c
       WHERE c.id = confidential_case_access.case_id
         AND (
           c.created_by = app.current_actor_ref()
           OR c.assigned_user_id = app.current_actor_id()
         )
    )
  )
  WITH CHECK (true);


CREATE TABLE confidential_case_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES confidential_cases (id),
  entity_id   uuid NOT NULL REFERENCES entities (id),
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  CONSTRAINT confidential_case_comments_body CHECK (btrim(body) <> '')
);

SELECT app.grant_append_only_table('confidential_case_comments');
ALTER TABLE confidential_case_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY confidential_case_comments_acl ON confidential_case_comments
  FOR ALL TO nfc_app
  USING (
    created_by = app.current_actor_ref()
    OR EXISTS (
      SELECT 1 FROM confidential_cases c
       WHERE c.id = confidential_case_comments.case_id
         AND (
           c.created_by = app.current_actor_ref()
           OR c.assigned_user_id = app.current_actor_id()
           OR EXISTS (
             SELECT 1 FROM confidential_case_access a
              WHERE a.case_id = c.id AND a.user_id = app.current_actor_id()
           )
         )
    )
  )
  WITH CHECK (true);


ALTER TABLE confidential_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY confidential_cases_acl ON confidential_cases
  FOR ALL TO nfc_app
  USING (
    created_by = app.current_actor_ref()
    OR assigned_user_id = app.current_actor_id()
    OR EXISTS (
      SELECT 1 FROM confidential_case_access a
       WHERE a.case_id = confidential_cases.id
         AND a.user_id = app.current_actor_id()
    )
  )
  WITH CHECK (
    created_by = app.current_actor_ref()
    OR assigned_user_id = app.current_actor_id()
    OR EXISTS (
      SELECT 1 FROM confidential_case_access a
       WHERE a.case_id = confidential_cases.id
         AND a.user_id = app.current_actor_id()
         AND a.kind IN ('ASSIGNEE', 'GRANT')
    )
  );


CREATE OR REPLACE FUNCTION app.confidential_case_directory()
RETURNS TABLE (id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.name
    FROM users u
   WHERE u.status = 'ACTIVE'
     AND NOT EXISTS (
       SELECT 1
         FROM user_role_assignments a
         JOIN roles r ON r.id = a.role_id
        WHERE a.user_id = u.id AND r.key = 'administrator'
     )
   ORDER BY u.name
$$;

REVOKE ALL ON FUNCTION app.confidential_case_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.confidential_case_directory() TO nfc_app;


INSERT INTO permissions (key, description, created_by)
VALUES
  ('cases.view', 'View confidential cases the actor is allowed to see.', 'system:seed'),
  ('cases.create', 'Open a confidential case.', 'system:seed'),
  ('cases.assign', 'Assign a handler on a confidential case.', 'system:seed'),
  ('cases.grant', 'Grant extra access on a confidential case.', 'system:seed'),
  ('cases.close', 'Close a confidential case.', 'system:seed'),
  ('reports.email', 'Queue a report summary to an email address. Does not grant access.', 'system:seed')
ON CONFLICT (key) DO NOTHING;

SET session_replication_role = replica;
INSERT INTO role_permissions (role_id, permission_key, created_by)
SELECT r.id, p.permission_key, 'system:seed'
  FROM roles r
  CROSS JOIN (VALUES
    ('cases.view'),
    ('cases.create'),
    ('cases.assign'),
    ('cases.grant'),
    ('cases.close')
  ) AS p(permission_key)
 WHERE r.key IN ('md', 'ed_operations', 'ed_finance')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key, created_by)
SELECT r.id, 'reports.email', 'system:seed'
  FROM roles r
 WHERE r.key = 'md'
ON CONFLICT DO NOTHING;
SET session_replication_role = DEFAULT;
