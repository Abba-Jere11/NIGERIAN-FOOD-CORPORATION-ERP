-- ---------------------------------------------------------------------------
-- 0001_conventions
--
-- Database conventions for the NFC Mini ERP (M1 item 2).
--
-- Nothing in this migration creates business data. It installs the primitives
-- every later milestone relies on:
--   * the `app` schema holding helper functions
--   * append-only enforcement (rule R2)
--   * no-hard-delete enforcement (rule R3)
--   * optimistic locking via row_version (A7)
--   * Row-Level Security helpers driven by per-request session variables (R5)
--   * privilege grants for the least-privileged application role
--
-- The application connects as `nfc_app`, which is NOT the owner of these
-- tables and does NOT hold BYPASSRLS. Row-Level Security therefore applies to
-- it. Migrations and seeds connect as the owner, which bypasses RLS so that
-- bootstrap work is possible.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS app;

COMMENT ON SCHEMA app IS
  'Helper functions for append-only enforcement, optimistic locking and Row-Level Security.';


-- ---------------------------------------------------------------------------
-- Session variables set by the API on every request, inside the transaction.
--
--   app.actor_ref     - acting user uuid, or a named system actor ("system:seed")
--   app.actor_role    - the acting role key at the time of the request
--   app.entity_ids    - comma-separated uuids of entities the actor may reach
--   app.is_corporate  - 'true' when the actor has corporate (group-wide) scope
--   app.request_id    - correlation id shared with the structured logs
--
-- Every reader below is fail-closed: an unset variable yields no access, so a
-- forgotten SET LOCAL denies rows rather than leaking them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.current_actor_ref() RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE raw text;
BEGIN
  raw := current_setting('app.actor_ref', true);
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN NULL;
  END IF;
  RETURN btrim(raw);
END $$;

COMMENT ON FUNCTION app.current_actor_ref() IS
  'The acting user uuid as text, or a named system actor such as system:seed.';

CREATE OR REPLACE FUNCTION app.current_actor_id() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE raw text;
BEGIN
  raw := app.current_actor_ref();
  IF raw IS NULL OR raw LIKE 'system:%' THEN
    RETURN NULL;
  END IF;
  RETURN raw::uuid;
END $$;

CREATE OR REPLACE FUNCTION app.current_actor_role() RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE raw text;
BEGIN
  raw := current_setting('app.actor_role', true);
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN NULL;
  END IF;
  RETURN btrim(raw);
END $$;

CREATE OR REPLACE FUNCTION app.current_entity_ids() RETURNS uuid[]
LANGUAGE plpgsql STABLE AS $$
DECLARE raw text;
BEGIN
  raw := current_setting('app.entity_ids', true);
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN ARRAY[]::uuid[];
  END IF;
  RETURN string_to_array(btrim(raw), ',')::uuid[];
END $$;

CREATE OR REPLACE FUNCTION app.is_corporate_actor() RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE raw text;
BEGIN
  raw := current_setting('app.is_corporate', true);
  RETURN raw IS NOT NULL AND btrim(lower(raw)) = 'true';
END $$;

CREATE OR REPLACE FUNCTION app.current_request_id() RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE raw text;
BEGIN
  raw := current_setting('app.request_id', true);
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN NULL;
  END IF;
  RETURN btrim(raw);
END $$;

-- The single scoping predicate. A Yobe Fertilizer user can never satisfy it
-- for a Damaturu row (rule R5).
CREATE OR REPLACE FUNCTION app.can_access_entity(target uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT target IS NULL
      OR app.is_corporate_actor()
      OR target = ANY (app.current_entity_ids());
$$;

COMMENT ON FUNCTION app.can_access_entity(uuid) IS
  'Rule R5: corporate actors reach every entity; entity-scoped actors reach only their granted entities.';


-- ---------------------------------------------------------------------------
-- Append-only enforcement (rule R2).
--
-- Triggers are STATEMENT level on purpose: an UPDATE that matches no rows must
-- still be refused, so that no code path can believe an edit was permitted.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.forbid_update_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Table %.% is append-only; % is forbidden.',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Rule R2: add a new correcting or superseding record instead of changing history.';
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION app.make_append_only(target_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE rel_name text;
BEGIN
  SELECT relname INTO rel_name FROM pg_class WHERE oid = target_table;

  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_update_delete()',
    rel_name || '_forbid_update', target_table::text);

  EXECUTE format(
    'CREATE TRIGGER %I BEFORE DELETE ON %s FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_update_delete()',
    rel_name || '_forbid_delete', target_table::text);

  EXECUTE format(
    'CREATE TRIGGER %I BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_update_delete()',
    rel_name || '_forbid_truncate', target_table::text);
END $$;

COMMENT ON FUNCTION app.make_append_only(regclass) IS
  'Rule R2: refuses UPDATE, DELETE and TRUNCATE on history tables at the database level.';


-- ---------------------------------------------------------------------------
-- No hard deletion of business data (rule R3).
--
-- Mutable business tables accept UPDATE, so a record can move to an Inactive,
-- Archived, Voided or Discarded status, but the row itself can never leave.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Table %.% does not permit %; business records are never deleted.',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Rule R3: change the status to Inactive, Archived, Voided or Discarded instead.';
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION app.forbid_hard_delete(target_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE rel_name text;
BEGIN
  SELECT relname INTO rel_name FROM pg_class WHERE oid = target_table;

  EXECUTE format(
    'CREATE TRIGGER %I BEFORE DELETE ON %s FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_delete()',
    rel_name || '_forbid_delete', target_table::text);

  EXECUTE format(
    'CREATE TRIGGER %I BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_delete()',
    rel_name || '_forbid_truncate', target_table::text);
END $$;


-- ---------------------------------------------------------------------------
-- Optimistic locking (A7).
--
-- Every mutable table carries `row_version`. The trigger increments it and
-- stamps updated_at on each UPDATE; callers pass the version they read in the
-- WHERE clause, so a stale write affects zero rows and is detected.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.bump_row_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.add_row_version_trigger(target_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE rel_name text;
BEGIN
  SELECT relname INTO rel_name FROM pg_class WHERE oid = target_table;

  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION app.bump_row_version()',
    rel_name || '_bump_row_version', target_table::text);
END $$;


-- ---------------------------------------------------------------------------
-- Row-Level Security template (rule R5).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.enable_entity_rls(
  target_table  regclass,
  entity_column text DEFAULT 'entity_id'
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE rel_name text;
BEGIN
  SELECT relname INTO rel_name FROM pg_class WHERE oid = target_table;

  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target_table::text);

  EXECUTE format(
    'CREATE POLICY %I ON %s FOR ALL TO nfc_app USING (app.can_access_entity(%I)) WITH CHECK (app.can_access_entity(%I))',
    rel_name || '_entity_scope', target_table::text, entity_column, entity_column);
END $$;

COMMENT ON FUNCTION app.enable_entity_rls(regclass, text) IS
  'Applies the standard entity-scoping policy to an entity-scoped table for the nfc_app role.';


-- ---------------------------------------------------------------------------
-- Privileges for the application role.
--
-- `nfc_app` is never granted DELETE on business tables, so rule R3 holds even
-- if application code contains a bug. Append-only tables get INSERT and SELECT
-- only, so rule R2 is enforced by privilege as well as by trigger.
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO nfc_app;
GRANT USAGE ON SCHEMA app TO nfc_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO nfc_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO nfc_app;

CREATE OR REPLACE FUNCTION app.grant_mutable_table(target_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %s TO nfc_app', target_table::text);
END $$;

CREATE OR REPLACE FUNCTION app.grant_append_only_table(target_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('GRANT SELECT, INSERT ON %s TO nfc_app', target_table::text);
END $$;


-- ---------------------------------------------------------------------------
-- Convenience: apply the full mutable-table convention set in one call.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.apply_mutable_conventions(
  target_table  regclass,
  entity_column text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.add_row_version_trigger(target_table);
  PERFORM app.forbid_hard_delete(target_table);
  PERFORM app.grant_mutable_table(target_table);
  IF entity_column IS NOT NULL THEN
    PERFORM app.enable_entity_rls(target_table, entity_column);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app.apply_append_only_conventions(
  target_table  regclass,
  entity_column text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.make_append_only(target_table);
  PERFORM app.grant_append_only_table(target_table);
  IF entity_column IS NOT NULL THEN
    PERFORM app.enable_entity_rls(target_table, entity_column);
  END IF;
END $$;
