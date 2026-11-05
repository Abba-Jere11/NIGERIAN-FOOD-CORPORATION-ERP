-- ---------------------------------------------------------------------------
-- 0047_hr_disciplinary_visible
--
-- Workflow GET/APPROVE must load a DISC- subject for HR (originator) and MD
-- (hr.disciplinary.approve) without depending on a USING expression that
-- SELECTs the inserting row. Follow the confidential-cases pattern:
-- SECURITY DEFINER helpers, then policies that call them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.hr_disciplinary_visible(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM hr_disciplinary_cases c
     WHERE c.id = p_id
       AND (
         app.has_permission('hr.disciplinary.view')
         OR app.has_permission('hr.disciplinary.approve')
         OR c.created_by = app.current_actor_ref()
         OR EXISTS (
           SELECT 1 FROM hr_disciplinary_access a
            WHERE a.case_id = c.id AND a.user_id = app.current_actor_id()
         )
       )
  );
$$;

REVOKE ALL ON FUNCTION app.hr_disciplinary_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.hr_disciplinary_visible(uuid) TO nfc_app;

CREATE OR REPLACE FUNCTION app.hr_disciplinary_workflow_subject(p_id uuid)
RETURNS TABLE (
  id uuid,
  reference_number text,
  entity_id uuid,
  originator_user_id text,
  title text,
  current_version integer,
  snapshot jsonb,
  row_version integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id,
         c.reference_number,
         c.entity_id,
         c.created_by,
         c.reference_number,
         1,
         jsonb_build_object('reference', c.reference_number),
         c.row_version
    FROM hr_disciplinary_cases c
   WHERE c.id = p_id
     AND app.hr_disciplinary_visible(p_id);
$$;

REVOKE ALL ON FUNCTION app.hr_disciplinary_workflow_subject(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.hr_disciplinary_workflow_subject(uuid) TO nfc_app;

DROP POLICY IF EXISTS hr_disc_select ON hr_disciplinary_cases;
CREATE POLICY hr_disc_select ON hr_disciplinary_cases FOR SELECT TO nfc_app
  USING (
    app.has_permission('hr.disciplinary.view')
    OR app.has_permission('hr.disciplinary.approve')
    OR created_by = app.current_actor_ref()
    OR app.hr_disciplinary_has_access(id)
  );

DROP POLICY IF EXISTS hr_disc_update ON hr_disciplinary_cases;
CREATE POLICY hr_disc_update ON hr_disciplinary_cases FOR UPDATE TO nfc_app
  USING (
    app.has_permission('hr.disciplinary.manage')
    OR app.has_permission('hr.disciplinary.approve')
    OR app.hr_disciplinary_has_access(id)
  )
  WITH CHECK (
    app.has_permission('hr.disciplinary.manage')
    OR app.has_permission('hr.disciplinary.approve')
    OR app.hr_disciplinary_has_access(id)
  );
