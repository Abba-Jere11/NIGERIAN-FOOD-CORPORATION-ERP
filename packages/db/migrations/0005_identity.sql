-- ---------------------------------------------------------------------------
-- 0005_identity
--
-- Users, roles, grants, sessions and the RLS split between corporate business
-- visibility and the Administrator (M2).
--
-- The Administrator is not a corporate business actor. is_corporate remains
-- the "see every subsidiary's business rows" flag. is_admin is the "manage
-- accounts, roles, entities and configuration" flag. Mixing the two would
-- either hide entities from the Administrator or leak the audit log to them.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE user_status AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- --- session readers -------------------------------------------------------

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE raw text;
BEGIN
  raw := current_setting('app.user_id', true);
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION app.is_admin_actor() RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE raw text;
BEGIN
  raw := current_setting('app.is_admin', true);
  RETURN raw IS NOT NULL AND btrim(lower(raw)) = 'true';
END $$;

COMMENT ON FUNCTION app.is_admin_actor() IS
  'True only for the Administrator. Does not grant business-row visibility.';

GRANT EXECUTE ON FUNCTION app.current_user_id() TO nfc_app;
GRANT EXECUTE ON FUNCTION app.is_admin_actor() TO nfc_app;


-- --- tighten audit_log RLS (M1 leaked rows with a null entity_id) ----------

DROP POLICY IF EXISTS audit_log_entity_scope ON audit_log;

CREATE POLICY audit_log_entity_scope ON audit_log
  FOR ALL TO nfc_app
  USING (
    CASE
      WHEN entity_id IS NULL THEN app.is_corporate_actor()
      ELSE app.can_access_entity(entity_id)
    END
  )
  WITH CHECK (
    CASE
      WHEN entity_id IS NULL THEN app.is_corporate_actor()
      ELSE app.can_access_entity(entity_id)
    END
  );

-- System and seed writes often have a null entity_id. Those still succeed when
-- the connection is the table owner (migrations/seeds). The application role
-- writing a login event with no entity uses a SECURITY DEFINER helper below.


-- --- org tables: Administrator may manage every entity ---------------------

CREATE POLICY entities_admin_scope ON entities
  FOR ALL TO nfc_app
  USING (app.is_admin_actor())
  WITH CHECK (app.is_admin_actor());

CREATE POLICY departments_admin_scope ON departments
  FOR ALL TO nfc_app
  USING (app.is_admin_actor())
  WITH CHECK (app.is_admin_actor());


-- --- permissions catalog ---------------------------------------------------

CREATE TABLE permissions (
  key         text PRIMARY KEY,
  description text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  CONSTRAINT permissions_key_format CHECK (key ~ '^[a-z][a-z0-9_.]+$')
);

COMMENT ON TABLE permissions IS
  'Named permission keys. Business logic checks these, never role names.';

SELECT app.grant_mutable_table('permissions');
-- Catalog rows are seeded, not edited in M2. Still no DELETE.

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         role_key NOT NULL UNIQUE,
  name        text NOT NULL,
  short_name  text NOT NULL,
  scope_type  scope_type NOT NULL,
  home_path   text NOT NULL,
  description text NOT NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,

  CONSTRAINT roles_home_path_format CHECK (home_path ~ '^/home/[a-z0-9-]+$')
);

SELECT app.apply_mutable_conventions('roles');

CREATE TABLE role_permissions (
  role_id         uuid NOT NULL REFERENCES roles (id),
  permission_key  text NOT NULL REFERENCES permissions (key),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  PRIMARY KEY (role_id, permission_key)
);

SELECT app.grant_mutable_table('role_permissions');
SELECT app.forbid_hard_delete('role_permissions');

CREATE TABLE role_conflicts (
  role_key_a  role_key NOT NULL,
  role_key_b  role_key NOT NULL,
  same_entity boolean NOT NULL DEFAULT true,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  PRIMARY KEY (role_key_a, role_key_b),
  CONSTRAINT role_conflicts_ordered CHECK (role_key_a < role_key_b)
);

SELECT app.grant_mutable_table('role_conflicts');
SELECT app.forbid_hard_delete('role_conflicts');


-- --- users -----------------------------------------------------------------

CREATE TABLE users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  email                citext NOT NULL,
  phone                text,
  photograph_path      text,
  status               user_status NOT NULL DEFAULT 'ACTIVE',
  primary_entity_id    uuid NOT NULL REFERENCES entities (id),
  department_id        uuid REFERENCES departments (id),
  "position"           text NOT NULL,
  password_hash        text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  mfa_secret_encrypted text,
  mfa_enrolled_at      timestamptz,
  failed_login_count   integer NOT NULL DEFAULT 0,
  locked_until         timestamptz,
  last_login_at        timestamptz,
  last_login_ip        inet,
  last_login_user_agent text,

  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL,
  row_version          integer NOT NULL DEFAULT 1,

  CONSTRAINT users_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT users_email_format CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'),
  CONSTRAINT users_row_version_positive CHECK (row_version >= 1),
  CONSTRAINT users_failed_login_nonneg CHECK (failed_login_count >= 0)
);

CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE INDEX users_primary_entity_id_idx ON users (primary_entity_id);
CREATE INDEX users_status_idx ON users (status);

SELECT app.add_row_version_trigger('users');
SELECT app.forbid_hard_delete('users');
SELECT app.grant_mutable_table('users');

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_self_or_admin ON users
  FOR ALL TO nfc_app
  USING (id = app.current_user_id() OR app.is_admin_actor())
  WITH CHECK (id = app.current_user_id() OR app.is_admin_actor());


CREATE TABLE user_role_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id),
  role_id     uuid NOT NULL REFERENCES roles (id),
  scope_type  scope_type NOT NULL,
  entity_id   uuid REFERENCES entities (id),
  status      record_status NOT NULL DEFAULT 'ACTIVE',

  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,

  CONSTRAINT user_role_assignments_scope CHECK (
    (scope_type = 'CORPORATE' AND entity_id IS NULL)
    OR (scope_type = 'ENTITY' AND entity_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX user_role_assignments_active_key
  ON user_role_assignments (user_id, role_id, COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'))
  WHERE status = 'ACTIVE';

SELECT app.apply_mutable_conventions('user_role_assignments');
ALTER TABLE user_role_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_role_assignments_self_or_admin ON user_role_assignments
  FOR ALL TO nfc_app
  USING (user_id = app.current_user_id() OR app.is_admin_actor())
  WITH CHECK (user_id = app.current_user_id() OR app.is_admin_actor());


CREATE TABLE user_scope_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id),
  entity_id   uuid NOT NULL REFERENCES entities (id),
  reason      text NOT NULL,
  granted_by  uuid NOT NULL REFERENCES users (id),
  expires_at  timestamptz,
  status      record_status NOT NULL DEFAULT 'ACTIVE',

  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,

  CONSTRAINT user_scope_grants_reason_not_blank CHECK (btrim(reason) <> '')
);

SELECT app.apply_mutable_conventions('user_scope_grants');
ALTER TABLE user_scope_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_scope_grants_self_or_admin ON user_scope_grants
  FOR ALL TO nfc_app
  USING (user_id = app.current_user_id() OR app.is_admin_actor())
  WITH CHECK (user_id = app.current_user_id() OR app.is_admin_actor());


-- --- sessions --------------------------------------------------------------

CREATE TABLE sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id),
  token_hash       text NOT NULL,
  ip_address       inet,
  user_agent       text,
  device_label     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  idle_expires_at  timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at       timestamptz,
  revoked_by       text,
  create_audit_request_id text
);

CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;

SELECT app.forbid_hard_delete('sessions');
-- Sessions are updated (last_seen, revoke) so they are mutable. No DELETE.
GRANT SELECT, INSERT, UPDATE ON sessions TO nfc_app;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sessions_self_or_admin ON sessions
  FOR ALL TO nfc_app
  USING (user_id = app.current_user_id() OR app.is_admin_actor())
  WITH CHECK (user_id = app.current_user_id() OR app.is_admin_actor());


-- Login writes a session before app.user_id is the new user. A SECURITY DEFINER
-- function inserts the row so RLS does not block the first cookie.

CREATE OR REPLACE FUNCTION app.insert_session(
  p_id uuid,
  p_user_id uuid,
  p_token_hash text,
  p_ip inet,
  p_user_agent text,
  p_device_label text,
  p_idle_expires_at timestamptz,
  p_absolute_expires_at timestamptz,
  p_request_id text
) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, app AS $$
  INSERT INTO sessions (
    id, user_id, token_hash, ip_address, user_agent, device_label,
    idle_expires_at, absolute_expires_at, create_audit_request_id
  ) VALUES (
    p_id, p_user_id, p_token_hash, p_ip, p_user_agent, p_device_label,
    p_idle_expires_at, p_absolute_expires_at, p_request_id
  );
$$;

GRANT EXECUTE ON FUNCTION app.insert_session(
  uuid, uuid, text, inet, text, text, timestamptz, timestamptz, text
) TO nfc_app;

-- Looking up a session by token hash happens before user_id is in the session
-- variables, so it also has to be SECURITY DEFINER and deliberately narrow.

CREATE OR REPLACE FUNCTION app.session_by_token_hash(p_hash text)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  idle_expires_at timestamptz,
  absolute_expires_at timestamptz,
  revoked_at timestamptz,
  ip_address inet,
  user_agent text,
  device_label text,
  last_seen_at timestamptz
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, app AS $$
  SELECT s.id, s.user_id, s.idle_expires_at, s.absolute_expires_at, s.revoked_at,
         s.ip_address, s.user_agent, s.device_label, s.last_seen_at
    FROM sessions s
   WHERE s.token_hash = p_hash;
$$;

GRANT EXECUTE ON FUNCTION app.session_by_token_hash(text) TO nfc_app;

CREATE OR REPLACE FUNCTION app.touch_session(p_id uuid, p_idle_expires_at timestamptz)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, app AS $$
  UPDATE sessions
     SET last_seen_at = now(), idle_expires_at = p_idle_expires_at
   WHERE id = p_id AND revoked_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION app.touch_session(uuid, timestamptz) TO nfc_app;

CREATE OR REPLACE FUNCTION app.revoke_session(p_id uuid, p_revoked_by text)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, app AS $$
  UPDATE sessions
     SET revoked_at = now(), revoked_by = p_revoked_by
   WHERE id = p_id AND revoked_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION app.revoke_session(uuid, text) TO nfc_app;


-- Auth writes (password check, lockout, last login) happen before RLS context.

CREATE OR REPLACE FUNCTION app.user_auth_row(p_email citext)
RETURNS TABLE (
  id uuid,
  name text,
  email citext,
  status user_status,
  password_hash text,
  must_change_password boolean,
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
         u.mfa_secret_encrypted, u.mfa_enrolled_at, u.failed_login_count, u.locked_until,
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
         u.mfa_secret_encrypted, u.mfa_enrolled_at, u.failed_login_count, u.locked_until,
         u.primary_entity_id, u."position", u.row_version
    FROM users u
   WHERE u.id = p_id;
$$;

GRANT EXECUTE ON FUNCTION app.user_auth_row_by_id(uuid) TO nfc_app;

CREATE OR REPLACE FUNCTION app.record_login_failure(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, app AS $$
BEGIN
  UPDATE users
     SET failed_login_count = failed_login_count + 1,
         locked_until = CASE
           WHEN failed_login_count + 1 >= 10 THEN now() + interval '15 minutes'
           ELSE locked_until
         END,
         updated_by = 'system:auth'
   WHERE id = p_id;
END $$;

GRANT EXECUTE ON FUNCTION app.record_login_failure(uuid) TO nfc_app;

CREATE OR REPLACE FUNCTION app.record_login_success(
  p_id uuid,
  p_ip inet,
  p_user_agent text
) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, app AS $$
  UPDATE users
     SET failed_login_count = 0,
         locked_until = NULL,
         last_login_at = now(),
         last_login_ip = p_ip,
         last_login_user_agent = p_user_agent,
         updated_by = 'system:auth'
   WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION app.record_login_success(uuid, inet, text) TO nfc_app;


-- Login audit rows have a user actor but often no entity. nfc_app cannot insert
-- those under the tightened audit policy, so a narrow helper writes them.

CREATE OR REPLACE FUNCTION app.insert_auth_audit(
  p_actor_user_id uuid,
  p_actor_name text,
  p_actor_role role_key,
  p_actor_scope_type scope_type,
  p_actor_scope_entity_ids uuid[],
  p_action audit_action,
  p_subject_type text,
  p_subject_id uuid,
  p_subject_label text,
  p_ip inet,
  p_user_agent text,
  p_session_id text,
  p_request_id text,
  p_new_value jsonb
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER
SET search_path = public, app AS $$
  INSERT INTO audit_log (
    actor_user_id, actor_name, actor_role, actor_scope_type, actor_scope_entity_ids,
    action, subject_type, subject_id, subject_label,
    ip_address, user_agent, session_id, request_id, new_value
  ) VALUES (
    p_actor_user_id, p_actor_name, p_actor_role, p_actor_scope_type, p_actor_scope_entity_ids,
    p_action, p_subject_type, p_subject_id, p_subject_label,
    p_ip, p_user_agent, p_session_id, p_request_id, p_new_value
  )
  RETURNING id;
$$;

GRANT EXECUTE ON FUNCTION app.insert_auth_audit(
  uuid, text, role_key, scope_type, uuid[], audit_action, text, uuid, text,
  inet, text, text, text, jsonb
) TO nfc_app;


-- Permission-change log for the Administrator, without opening audit_log.

CREATE OR REPLACE FUNCTION app.admin_permission_changes(p_limit integer, p_offset integer)
RETURNS TABLE (
  id uuid,
  occurred_at timestamptz,
  actor_name text,
  actor_role role_key,
  action audit_action,
  subject_type text,
  subject_id uuid,
  subject_label text,
  old_value jsonb,
  new_value jsonb,
  reason text
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, app AS $$
BEGIN
  IF NOT app.is_admin_actor() THEN
    RAISE EXCEPTION 'Administrator permission is required to read the permission-change log'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    SELECT a.id, a.occurred_at, a.actor_name, a.actor_role, a.action,
           a.subject_type, a.subject_id, a.subject_label, a.old_value, a.new_value, a.reason
      FROM audit_log a
     WHERE a.action IN ('permission_change', 'account_change')
     ORDER BY a.occurred_at DESC, a.id DESC
     LIMIT p_limit OFFSET p_offset;
END $$;

GRANT EXECUTE ON FUNCTION app.admin_permission_changes(integer, integer) TO nfc_app;


-- --- tokens, MFA backup, rate limit, mail ----------------------------------

CREATE TABLE password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id),
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  request_id  text
);

CREATE UNIQUE INDEX password_reset_tokens_hash_key ON password_reset_tokens (token_hash);
SELECT app.forbid_hard_delete('password_reset_tokens');
GRANT SELECT, INSERT, UPDATE ON password_reset_tokens TO nfc_app;


CREATE TABLE mfa_backup_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id),
  code_hash   text NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mfa_backup_codes_user_id_idx ON mfa_backup_codes (user_id);
SELECT app.forbid_hard_delete('mfa_backup_codes');
GRANT SELECT, INSERT, UPDATE ON mfa_backup_codes TO nfc_app;

CREATE OR REPLACE FUNCTION app.replace_mfa_backup_codes(p_user_id uuid, p_hashes text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, app AS $$
DECLARE h text;
BEGIN
  -- Cannot DELETE (R3). Mark unused codes as used so they cannot be replayed,
  -- then insert the new set.
  UPDATE mfa_backup_codes SET used_at = now() WHERE user_id = p_user_id AND used_at IS NULL;
  FOREACH h IN ARRAY p_hashes LOOP
    INSERT INTO mfa_backup_codes (user_id, code_hash) VALUES (p_user_id, h);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION app.replace_mfa_backup_codes(uuid, text[]) TO nfc_app;


CREATE TABLE login_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       citext,
  ip_address  inet,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  success     boolean NOT NULL,
  reason      text
);

CREATE INDEX login_attempts_email_time_idx ON login_attempts (email, attempted_at DESC);
CREATE INDEX login_attempts_ip_time_idx ON login_attempts (ip_address, attempted_at DESC);
SELECT app.forbid_hard_delete('login_attempts');
GRANT SELECT, INSERT ON login_attempts TO nfc_app;


CREATE TABLE mail_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL,
  recipient   citext NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  payload     jsonb,
  created_by  text NOT NULL
);

SELECT app.apply_append_only_conventions('mail_outbox');
ALTER TABLE mail_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY mail_outbox_insert ON mail_outbox
  FOR INSERT TO nfc_app
  WITH CHECK (true);

CREATE POLICY mail_outbox_select ON mail_outbox
  FOR SELECT TO nfc_app
  USING (app.is_admin_actor());

-- Auth flows that run before app.user_id is set (reset, enrolment) go through
-- these helpers so Row-Level Security on users does not block them.

CREATE OR REPLACE FUNCTION app.update_password(
  p_id uuid,
  p_hash text,
  p_must_change boolean
) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, app AS $$
  UPDATE users
     SET password_hash = p_hash,
         must_change_password = p_must_change,
         failed_login_count = 0,
         locked_until = NULL,
         updated_by = 'system:auth'
   WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION app.update_password(uuid, text, boolean) TO nfc_app;

CREATE OR REPLACE FUNCTION app.set_mfa_secret(p_id uuid, p_encrypted text)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, app AS $$
  UPDATE users
     SET mfa_secret_encrypted = p_encrypted,
         mfa_enrolled_at = now(),
         updated_by = 'system:auth'
   WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION app.set_mfa_secret(uuid, text) TO nfc_app;

CREATE OR REPLACE FUNCTION app.unlock_user(p_id uuid, p_by text)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, app AS $$
  UPDATE users
     SET locked_until = NULL,
         failed_login_count = 0,
         updated_by = p_by
   WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION app.unlock_user(uuid, text) TO nfc_app;

CREATE OR REPLACE FUNCTION app.try_consume_backup_code(p_user_id uuid, p_hash text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, app AS $$
DECLARE updated integer;
BEGIN
  UPDATE mfa_backup_codes
     SET used_at = now()
   WHERE user_id = p_user_id
     AND code_hash = p_hash
     AND used_at IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated = 1;
END $$;

GRANT EXECUTE ON FUNCTION app.try_consume_backup_code(uuid, text) TO nfc_app;

CREATE OR REPLACE FUNCTION app.reset_token_user(p_hash text)
RETURNS TABLE (user_id uuid, expires_at timestamptz, used_at timestamptz, id uuid)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, app AS $$
  SELECT t.user_id, t.expires_at, t.used_at, t.id
    FROM password_reset_tokens t
   WHERE t.token_hash = p_hash;
$$;

GRANT EXECUTE ON FUNCTION app.reset_token_user(text) TO nfc_app;

CREATE OR REPLACE FUNCTION app.mark_reset_token_used(p_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, app AS $$
  UPDATE password_reset_tokens SET used_at = now() WHERE id = p_id AND used_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION app.mark_reset_token_used(uuid) TO nfc_app;


CREATE TABLE sensitive_fields (
  field_key      text PRIMARY KEY,
  permission_key text NOT NULL REFERENCES permissions (key),
  description    text NOT NULL
);

SELECT app.grant_mutable_table('sensitive_fields');
SELECT app.forbid_hard_delete('sensitive_fields');


-- Grants on roles/permissions catalogs so login can resolve can() before admin RLS.

CREATE OR REPLACE FUNCTION app.permissions_for_user(p_user_id uuid)
RETURNS TABLE (permission_key text)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, app AS $$
  SELECT DISTINCT rp.permission_key
    FROM user_role_assignments ura
    JOIN role_permissions rp ON rp.role_id = ura.role_id
   WHERE ura.user_id = p_user_id
     AND ura.status = 'ACTIVE';
$$;

GRANT EXECUTE ON FUNCTION app.permissions_for_user(uuid) TO nfc_app;

CREATE OR REPLACE FUNCTION app.assignments_for_user(p_user_id uuid)
RETURNS TABLE (
  role_key role_key,
  scope_type scope_type,
  entity_id uuid,
  home_path text
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, app AS $$
  SELECT r.key, ura.scope_type, ura.entity_id, r.home_path
    FROM user_role_assignments ura
    JOIN roles r ON r.id = ura.role_id
   WHERE ura.user_id = p_user_id
     AND ura.status = 'ACTIVE';
$$;

GRANT EXECUTE ON FUNCTION app.assignments_for_user(uuid) TO nfc_app;

CREATE OR REPLACE FUNCTION app.scope_grants_for_user(p_user_id uuid)
RETURNS TABLE (entity_id uuid)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, app AS $$
  SELECT g.entity_id
    FROM user_scope_grants g
   WHERE g.user_id = p_user_id
     AND g.status = 'ACTIVE'
     AND (g.expires_at IS NULL OR g.expires_at > now());
$$;

GRANT EXECUTE ON FUNCTION app.scope_grants_for_user(uuid) TO nfc_app;

CREATE OR REPLACE FUNCTION app.role_conflicts()
RETURNS TABLE (role_key_a role_key, role_key_b role_key, same_entity boolean)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, app AS $$
  SELECT c.role_key_a, c.role_key_b, c.same_entity FROM role_conflicts c;
$$;

GRANT EXECUTE ON FUNCTION app.role_conflicts() TO nfc_app;

CREATE OR REPLACE FUNCTION app.role_id_for_key(p_key role_key)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, app AS $$
  SELECT id FROM roles WHERE key = p_key;
$$;

GRANT EXECUTE ON FUNCTION app.role_id_for_key(role_key) TO nfc_app;

CREATE OR REPLACE FUNCTION app.permission_is_approval_or_payment(p_key text)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_key IN (
    'procurement.approve.operations',
    'procurement.approve.final',
    'procurement.review.finance',
    'finance.payment.execute',
    'finance.funding.authorize'
  );
$$;

GRANT EXECUTE ON FUNCTION app.permission_is_approval_or_payment(text) TO nfc_app;
