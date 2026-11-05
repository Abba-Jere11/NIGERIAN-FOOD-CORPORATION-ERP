-- ---------------------------------------------------------------------------
-- 0038_confidential_case_acl
--
-- Cases, access and comments policies referenced each other and recursed.
-- Helpers are SECURITY DEFINER and only read the *other* table. Owner and
-- assignee checks stay on the row so INSERT … RETURNING can pass USING.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.confidential_case_has_access(p_case_id uuid, p_kinds text[] DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM confidential_case_access a
     WHERE a.case_id = p_case_id
       AND a.user_id = app.current_actor_id()
       AND (p_kinds IS NULL OR a.kind = ANY (p_kinds))
  );
$$;

CREATE OR REPLACE FUNCTION app.confidential_case_owned(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM confidential_cases c
     WHERE c.id = p_case_id
       AND (
         c.created_by = app.current_actor_ref()
         OR c.assigned_user_id = app.current_actor_id()
       )
  );
$$;

REVOKE ALL ON FUNCTION app.confidential_case_has_access(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.confidential_case_owned(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.confidential_case_has_access(uuid, text[]) TO nfc_app;
GRANT EXECUTE ON FUNCTION app.confidential_case_owned(uuid) TO nfc_app;

DROP POLICY IF EXISTS confidential_cases_acl ON confidential_cases;
DROP POLICY IF EXISTS confidential_cases_select ON confidential_cases;
DROP POLICY IF EXISTS confidential_cases_insert ON confidential_cases;
DROP POLICY IF EXISTS confidential_cases_update ON confidential_cases;

CREATE POLICY confidential_cases_select ON confidential_cases
  FOR SELECT TO nfc_app
  USING (
    created_by = app.current_actor_ref()
    OR assigned_user_id = app.current_actor_id()
    OR app.confidential_case_has_access(id)
  );
CREATE POLICY confidential_cases_insert ON confidential_cases
  FOR INSERT TO nfc_app
  WITH CHECK (created_by = app.current_actor_ref());
CREATE POLICY confidential_cases_update ON confidential_cases
  FOR UPDATE TO nfc_app
  USING (
    created_by = app.current_actor_ref()
    OR assigned_user_id = app.current_actor_id()
    OR app.confidential_case_has_access(id)
  )
  WITH CHECK (
    created_by = app.current_actor_ref()
    OR assigned_user_id = app.current_actor_id()
    OR app.confidential_case_has_access(id, ARRAY['ASSIGNEE', 'GRANT'])
  );

DROP POLICY IF EXISTS confidential_case_access_acl ON confidential_case_access;
DROP POLICY IF EXISTS confidential_case_access_select ON confidential_case_access;
DROP POLICY IF EXISTS confidential_case_access_insert ON confidential_case_access;

CREATE POLICY confidential_case_access_select ON confidential_case_access
  FOR SELECT TO nfc_app
  USING (
    user_id = app.current_actor_id()
    OR created_by = app.current_actor_ref()
    OR app.confidential_case_owned(case_id)
  );
CREATE POLICY confidential_case_access_insert ON confidential_case_access
  FOR INSERT TO nfc_app
  WITH CHECK (
    created_by = app.current_actor_ref()
    AND (
      app.confidential_case_owned(case_id)
      OR app.confidential_case_has_access(case_id, ARRAY['ASSIGNEE', 'GRANT'])
    )
  );

DROP POLICY IF EXISTS confidential_case_comments_acl ON confidential_case_comments;
DROP POLICY IF EXISTS confidential_case_comments_select ON confidential_case_comments;
DROP POLICY IF EXISTS confidential_case_comments_insert ON confidential_case_comments;

CREATE POLICY confidential_case_comments_select ON confidential_case_comments
  FOR SELECT TO nfc_app
  USING (
    created_by = app.current_actor_ref()
    OR app.confidential_case_owned(case_id)
    OR app.confidential_case_has_access(case_id)
  );
CREATE POLICY confidential_case_comments_insert ON confidential_case_comments
  FOR INSERT TO nfc_app
  WITH CHECK (
    created_by = app.current_actor_ref()
    AND (
      app.confidential_case_owned(case_id)
      OR app.confidential_case_has_access(case_id)
    )
  );
