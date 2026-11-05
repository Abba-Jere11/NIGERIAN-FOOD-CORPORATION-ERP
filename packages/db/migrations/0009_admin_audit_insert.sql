-- ---------------------------------------------------------------------------
-- 0009_write_audit_entry
--
-- Every application audit write goes through this helper. The Administrator
-- is not corporate, so a direct INSERT fails RLS even when they are allowed
-- to make the change. SELECT remains subject to RLS.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.write_audit_entry(
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
LANGUAGE sql SECURITY DEFINER
SET search_path = public, app AS $$
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
$$;

GRANT EXECUTE ON FUNCTION app.write_audit_entry(
  uuid, text, text, role_key, scope_type, uuid[], audit_action, text, uuid, text, text,
  uuid, jsonb, jsonb, text, inet, text, text, text
) TO nfc_app;
