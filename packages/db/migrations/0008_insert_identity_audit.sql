-- ---------------------------------------------------------------------------
-- 0008_insert_identity_audit
--
-- Administrator account/grant changes must be recorded, but the actor is not
-- corporate so a plain INSERT into audit_log fails RLS. This helper writes
-- those two actions as the table owner. SELECT remains subject to RLS, so the
-- Administrator still cannot read the business log.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.insert_identity_audit(
  p_actor_user_id uuid,
  p_actor_system_name text,
  p_actor_name text,
  p_actor_role role_key,
  p_actor_scope_type scope_type,
  p_actor_scope_entity_ids uuid[],
  p_action audit_action,
  p_subject_type text,
  p_subject_id uuid,
  p_subject_label text,
  p_subject_reference_number text,
  p_entity_id uuid,
  p_old_value jsonb,
  p_new_value jsonb,
  p_reason text,
  p_ip inet,
  p_user_agent text,
  p_session_id text,
  p_request_id text
) RETURNS TABLE (id uuid, occurred_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, app AS $$
BEGIN
  IF p_action NOT IN ('permission_change'::audit_action, 'account_change'::audit_action) THEN
    RAISE EXCEPTION 'insert_identity_audit only writes permission_change and account_change'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  INSERT INTO audit_log (
    actor_user_id, actor_system_name, actor_name,
    actor_role, actor_scope_type, actor_scope_entity_ids,
    action, subject_type, subject_id, subject_label, subject_reference_number,
    entity_id, old_value, new_value, reason,
    ip_address, user_agent, session_id, request_id
  ) VALUES (
    p_actor_user_id, p_actor_system_name, p_actor_name,
    p_actor_role, p_actor_scope_type, p_actor_scope_entity_ids,
    p_action, p_subject_type, p_subject_id, p_subject_label, p_subject_reference_number,
    p_entity_id, p_old_value, p_new_value, p_reason,
    p_ip, p_user_agent, p_session_id, p_request_id
  )
  RETURNING audit_log.id, audit_log.occurred_at;
END $$;

GRANT EXECUTE ON FUNCTION app.insert_identity_audit(
  uuid, text, text, role_key, scope_type, uuid[], audit_action, text, uuid, text, text,
  uuid, jsonb, jsonb, text, inet, text, text, text
) TO nfc_app;
