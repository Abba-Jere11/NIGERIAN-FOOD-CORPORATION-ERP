-- ---------------------------------------------------------------------------
-- 0051_mfa_policy
-- Optional MFA: admin toggles per user; default off.
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_required boolean NOT NULL DEFAULT false;

DROP FUNCTION IF EXISTS app.user_auth_row(citext);
DROP FUNCTION IF EXISTS app.user_auth_row_by_id(uuid);

CREATE OR REPLACE FUNCTION app.user_auth_row(p_email citext)
RETURNS TABLE (
  id uuid,
  name text,
  email citext,
  status user_status,
  password_hash text,
  must_change_password boolean,
  mfa_required boolean,
  mfa_secret_encrypted text,
  mfa_enrolled_at timestamptz,
  failed_login_count integer,
  locked_until timestamptz,
  primary_entity_id uuid,
  "position" text,
  row_version integer
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, app AS $$
  SELECT u.id, u.name, u.email, u.status, u.password_hash, u.must_change_password,
         u.mfa_required, u.mfa_secret_encrypted, u.mfa_enrolled_at, u.failed_login_count, u.locked_until,
         u.primary_entity_id, u."position", u.row_version
    FROM users u
   WHERE u.email = p_email;
$$;

GRANT EXECUTE ON FUNCTION app.user_auth_row(citext) TO nfc_app;

CREATE OR REPLACE FUNCTION app.user_auth_row_by_id(p_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  email citext,
  status user_status,
  password_hash text,
  must_change_password boolean,
  mfa_required boolean,
  mfa_secret_encrypted text,
  mfa_enrolled_at timestamptz,
  failed_login_count integer,
  locked_until timestamptz,
  primary_entity_id uuid,
  "position" text,
  row_version integer
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, app AS $$
  SELECT u.id, u.name, u.email, u.status, u.password_hash, u.must_change_password,
         u.mfa_required, u.mfa_secret_encrypted, u.mfa_enrolled_at, u.failed_login_count, u.locked_until,
         u.primary_entity_id, u."position", u.row_version
    FROM users u
   WHERE u.id = p_id;
$$;

GRANT EXECUTE ON FUNCTION app.user_auth_row_by_id(uuid) TO nfc_app;

CREATE OR REPLACE FUNCTION app.clear_mfa(p_id uuid, p_by text)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, app AS $$
  UPDATE users
     SET mfa_secret_encrypted = NULL,
         mfa_enrolled_at = NULL,
         updated_by = p_by
   WHERE id = p_id;
  UPDATE mfa_backup_codes
     SET used_at = now()
   WHERE user_id = p_id AND used_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION app.clear_mfa(uuid, text) TO nfc_app;

CREATE OR REPLACE FUNCTION app.set_mfa_required(p_id uuid, p_required boolean, p_by text)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, app AS $$
  UPDATE users
     SET mfa_required = p_required,
         updated_by = p_by
   WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION app.set_mfa_required(uuid, boolean, text) TO nfc_app;
