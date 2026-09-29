-- ---------------------------------------------------------------------------
-- 0002_organization
--
-- The organisation structure (M1 item 3) and departments (M1 item 4).
--
-- A4: Nigeria Food Corporation is the holding company and all four
-- subsidiaries are its direct children. Nguru Oil Mills is a sibling of Yobe
-- Fertilizer, not a child of it. That is enforced here by trigger, not left to
-- application code.
--
-- Neither entities nor departments can ever be hard-deleted (rule R3); they are
-- moved to status INACTIVE instead.
-- ---------------------------------------------------------------------------

CREATE TYPE entity_type AS ENUM ('HOLDING', 'SUBSIDIARY');
CREATE TYPE record_status AS ENUM ('ACTIVE', 'INACTIVE');


-- --- organizations ---------------------------------------------------------

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  name        text NOT NULL,
  legal_name  text NOT NULL,
  status      record_status NOT NULL DEFAULT 'ACTIVE',

  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,

  CONSTRAINT organizations_code_key UNIQUE (code),
  CONSTRAINT organizations_code_format CHECK (code ~ '^[A-Z0-9]{2,10}$'),
  CONSTRAINT organizations_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT organizations_row_version_positive CHECK (row_version >= 1)
);

COMMENT ON TABLE organizations IS 'The holding group itself. One row: Nigeria Food Corporation.';

SELECT app.apply_mutable_conventions('organizations');


-- --- entities --------------------------------------------------------------

CREATE TABLE entities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id),
  parent_entity_id uuid REFERENCES entities (id),
  code             text NOT NULL,
  name             text NOT NULL,
  legal_name       text NOT NULL,
  type             entity_type NOT NULL,
  status           record_status NOT NULL DEFAULT 'ACTIVE',

  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL,
  row_version      integer NOT NULL DEFAULT 1,

  CONSTRAINT entities_code_key UNIQUE (code),
  CONSTRAINT entities_code_format CHECK (code ~ '^[A-Z0-9]{2,10}$'),
  CONSTRAINT entities_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT entities_legal_name_not_blank CHECK (btrim(legal_name) <> ''),
  CONSTRAINT entities_not_own_parent CHECK (parent_entity_id IS DISTINCT FROM id),
  CONSTRAINT entities_row_version_positive CHECK (row_version >= 1),
  -- A4: the holding company sits at the root; every subsidiary has a parent.
  CONSTRAINT entities_parent_matches_type CHECK (
    (type = 'HOLDING' AND parent_entity_id IS NULL)
    OR (type = 'SUBSIDIARY' AND parent_entity_id IS NOT NULL)
  )
);

COMMENT ON TABLE entities IS
  'NFC Holding plus the four subsidiaries. Subsidiaries are direct children of the holding company (A4).';

CREATE INDEX entities_parent_entity_id_idx ON entities (parent_entity_id);
CREATE INDEX entities_organization_id_idx ON entities (organization_id);

-- A subsidiary's parent must be the holding company. This keeps the hierarchy
-- exactly one level deep, so no subsidiary can end up beneath another.
CREATE OR REPLACE FUNCTION app.validate_entity_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_type entity_type;
BEGIN
  IF NEW.parent_entity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT type INTO parent_type FROM entities WHERE id = NEW.parent_entity_id;

  IF parent_type IS NULL THEN
    RAISE EXCEPTION 'Parent entity % does not exist', NEW.parent_entity_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF parent_type <> 'HOLDING' THEN
    RAISE EXCEPTION
      'A subsidiary must be a direct child of the holding company, but % is a %',
      NEW.parent_entity_id, parent_type
      USING ERRCODE = 'check_violation',
            HINT = 'A4: all four subsidiaries are direct children of Nigeria Food Corporation.';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER entities_validate_parent
  BEFORE INSERT OR UPDATE OF parent_entity_id, type ON entities
  FOR EACH ROW EXECUTE FUNCTION app.validate_entity_parent();

-- An entity is scoped by its own id: a subsidiary user sees their own entity.
SELECT app.apply_mutable_conventions('entities', 'id');


-- --- departments -----------------------------------------------------------

CREATE TABLE departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities (id),
  name        text NOT NULL,
  code        text,
  description text,
  status      record_status NOT NULL DEFAULT 'ACTIVE',

  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,

  CONSTRAINT departments_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT departments_row_version_positive CHECK (row_version >= 1)
);

COMMENT ON TABLE departments IS
  'Configurable department list per entity (M1 item 4). Deactivated, never deleted.';

-- Department names are unique per entity, case-insensitively, so "Finance" and
-- "finance" cannot both exist inside one subsidiary.
CREATE UNIQUE INDEX departments_entity_name_key ON departments (entity_id, lower(name));
CREATE INDEX departments_entity_id_idx ON departments (entity_id);
CREATE INDEX departments_status_idx ON departments (status);

SELECT app.apply_mutable_conventions('departments', 'entity_id');


-- --- scope resolution ------------------------------------------------------
--
-- Resolving which entities an actor may reach is a chicken-and-egg problem: the
-- answer is needed before the session variables that Row-Level Security reads
-- can be set. These two narrow lookups are SECURITY DEFINER so they can answer
-- it, and they expose nothing beyond entity identifiers.

CREATE OR REPLACE FUNCTION app.entity_id_for_code(entity_code text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, app AS $$
  SELECT id FROM entities WHERE code = entity_code;
$$;

COMMENT ON FUNCTION app.entity_id_for_code(text) IS
  'Resolves an entity code to its id before session scope is established. Deliberately narrow.';

CREATE OR REPLACE FUNCTION app.all_entity_ids() RETURNS uuid[]
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, app AS $$
  SELECT coalesce(array_agg(id ORDER BY code), ARRAY[]::uuid[]) FROM entities;
$$;

COMMENT ON FUNCTION app.all_entity_ids() IS
  'The full entity set, used to build the scope of a corporate actor.';

CREATE OR REPLACE FUNCTION app.entity_directory()
RETURNS TABLE (id uuid, code text, name text, type entity_type, status record_status)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, app AS $$
  SELECT e.id, e.code, e.name, e.type, e.status FROM entities e ORDER BY e.code;
$$;

COMMENT ON FUNCTION app.entity_directory() IS
  'Entity identifiers and codes only, used to build an actor scope before Row-Level Security applies.';

GRANT EXECUTE ON FUNCTION app.entity_id_for_code(text) TO nfc_app;
GRANT EXECUTE ON FUNCTION app.all_entity_ids() TO nfc_app;
GRANT EXECUTE ON FUNCTION app.entity_directory() TO nfc_app;
