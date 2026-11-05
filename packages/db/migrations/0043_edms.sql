-- ---------------------------------------------------------------------------
-- 0043_edms
--
-- M15 Document Portal: subsidiary-first folders (links, not copies), shares,
-- retention/legal hold, optional document approval, and the procurement
-- auto-file handler.
-- ---------------------------------------------------------------------------

INSERT INTO permissions (key, description, created_by) VALUES
  ('edms.portal.access', 'Enter the Document Portal. Does not imply viewing business files.', 'system:seed'),
  ('edms.view', 'View documents and folders in the Document Portal within granted entities.', 'system:seed'),
  ('edms.upload', 'Upload a document into an EDMS folder in a granted entity.', 'system:seed'),
  ('edms.version.replace', 'Replace an EDMS document, creating a new version with a reason.', 'system:seed'),
  ('edms.archive', 'Archive an EDMS document into the Archived tree.', 'system:seed'),
  ('edms.share', 'Share an EDMS document with a named user or role.', 'system:seed'),
  ('edms.approve', 'Approve an EDMS document that requires category approval.', 'system:seed'),
  ('edms.manage_categories', 'Maintain EDMS categories and tags.', 'system:seed'),
  ('edms.manage_retention', 'Maintain EDMS retention policies and legal holds.', 'system:seed'),
  ('edms.refile', 'Re-file a document into another subsidiary with a recorded reason.', 'system:seed')
ON CONFLICT (key) DO NOTHING;

SET session_replication_role = replica;
INSERT INTO role_permissions (role_id, permission_key, created_by)
SELECT r.id, k.key, 'system:seed'
  FROM roles r
  JOIN (VALUES
    ('md', 'edms.portal.access'),
    ('md', 'edms.view'),
    ('md', 'edms.upload'),
    ('md', 'edms.version.replace'),
    ('md', 'edms.archive'),
    ('md', 'edms.share'),
    ('md', 'edms.approve'),
    ('md', 'edms.refile'),
    ('ed_finance', 'edms.portal.access'),
    ('ed_finance', 'edms.view'),
    ('ed_finance', 'edms.upload'),
    ('ed_finance', 'edms.version.replace'),
    ('ed_finance', 'edms.archive'),
    ('ed_finance', 'edms.share'),
    ('ed_operations', 'edms.portal.access'),
    ('ed_operations', 'edms.view'),
    ('ed_operations', 'edms.upload'),
    ('ed_operations', 'edms.approve'),
    ('administrator', 'edms.portal.access'),
    ('administrator', 'edms.manage_categories'),
    ('administrator', 'edms.manage_retention')
  ) AS k(role_key, key) ON k.role_key = r.key::text
ON CONFLICT DO NOTHING;
SET session_replication_role = DEFAULT;


ALTER TABLE document_access_log DROP CONSTRAINT document_access_log_action;
ALTER TABLE document_access_log
  ADD CONSTRAINT document_access_log_action CHECK (action IN ('VIEW', 'DOWNLOAD', 'SHARE', 'ARCHIVE'));

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS confidentiality text NOT NULL DEFAULT 'INTERNAL',
  ADD COLUMN IF NOT EXISTS category_id uuid,
  ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retention_review_on date;

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_confidentiality;
ALTER TABLE documents
  ADD CONSTRAINT documents_confidentiality CHECK (confidentiality IN ('INTERNAL', 'RESTRICTED', 'CONFIDENTIAL'));


CREATE TABLE edms_categories (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                 text NOT NULL UNIQUE,
  name                text NOT NULL,
  module              text NOT NULL,
  retain_years        integer NOT NULL DEFAULT 7,
  requires_approval   boolean NOT NULL DEFAULT false,
  confidentiality     text NOT NULL DEFAULT 'INTERNAL',
  status              text NOT NULL DEFAULT 'ACTIVE',
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text NOT NULL,
  row_version         integer NOT NULL DEFAULT 1,
  CONSTRAINT edms_categories_module CHECK (module IN ('procurement', 'finance', 'hr', 'inventory', 'administrative')),
  CONSTRAINT edms_categories_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT edms_categories_confidentiality CHECK (confidentiality IN ('INTERNAL', 'RESTRICTED', 'CONFIDENTIAL')),
  CONSTRAINT edms_categories_retain CHECK (retain_years >= 1),
  CONSTRAINT edms_categories_name_not_blank CHECK (btrim(name) <> '')
);

SELECT app.add_row_version_trigger('edms_categories');
SELECT app.forbid_hard_delete('edms_categories');
GRANT SELECT, INSERT, UPDATE ON edms_categories TO nfc_app;
ALTER TABLE edms_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY edms_categories_select ON edms_categories
  FOR SELECT TO nfc_app USING (true);
CREATE POLICY edms_categories_write ON edms_categories
  FOR ALL TO nfc_app
  USING (app.has_permission('edms.manage_categories'))
  WITH CHECK (app.has_permission('edms.manage_categories'));

INSERT INTO edms_categories (key, name, module, retain_years, created_by, updated_by) VALUES
  ('procurement_package', 'Procurement package', 'procurement', 10, 'system:seed', 'system:seed'),
  ('finance_record', 'Finance record', 'finance', 7, 'system:seed', 'system:seed'),
  ('hr_record', 'HR record', 'hr', 7, 'system:seed', 'system:seed'),
  ('inventory_record', 'Inventory record', 'inventory', 7, 'system:seed', 'system:seed'),
  ('administrative', 'Administrative', 'administrative', 7, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE documents
  ADD CONSTRAINT documents_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES edms_categories (id);


CREATE TABLE edms_tags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL UNIQUE,
  name         text NOT NULL,
  status       text NOT NULL DEFAULT 'ACTIVE',
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL,
  row_version  integer NOT NULL DEFAULT 1,
  CONSTRAINT edms_tags_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT edms_tags_name_not_blank CHECK (btrim(name) <> '')
);

SELECT app.add_row_version_trigger('edms_tags');
SELECT app.forbid_hard_delete('edms_tags');
GRANT SELECT, INSERT, UPDATE ON edms_tags TO nfc_app;
ALTER TABLE edms_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY edms_tags_select ON edms_tags
  FOR SELECT TO nfc_app USING (true);
CREATE POLICY edms_tags_write ON edms_tags
  FOR ALL TO nfc_app
  USING (app.has_permission('edms.manage_categories'))
  WITH CHECK (app.has_permission('edms.manage_categories'));


CREATE TABLE edms_folders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL REFERENCES entities (id),
  parent_id     uuid REFERENCES edms_folders (id),
  name          text NOT NULL,
  kind          text NOT NULL,
  status        text NOT NULL DEFAULT 'ACTIVE',
  source_type   text,
  source_id     uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL,
  row_version   integer NOT NULL DEFAULT 1,
  CONSTRAINT edms_folders_kind CHECK (kind IN ('space', 'module', 'year', 'package', 'slot', 'user')),
  CONSTRAINT edms_folders_status CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT edms_folders_name_not_blank CHECK (btrim(name) <> '')
);

SELECT app.apply_mutable_conventions('edms_folders', 'entity_id');

CREATE UNIQUE INDEX edms_folders_root_name_idx
  ON edms_folders (entity_id, name) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX edms_folders_child_name_idx
  ON edms_folders (entity_id, parent_id, name) WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX edms_folders_package_source_idx
  ON edms_folders (source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app.forbid_edms_folder_entity_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entity_id IS DISTINCT FROM OLD.entity_id THEN
    RAISE EXCEPTION 'An EDMS folder cannot move between subsidiaries.'
      USING ERRCODE = 'restrict_violation',
            HINT = 'Re-file the document with a recorded reason instead.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER edms_folders_forbid_entity_change
  BEFORE UPDATE ON edms_folders
  FOR EACH ROW
  EXECUTE FUNCTION app.forbid_edms_folder_entity_change();


CREATE TABLE edms_folder_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id     uuid NOT NULL REFERENCES edms_folders (id),
  document_id   uuid NOT NULL REFERENCES documents (id),
  entity_id     uuid NOT NULL REFERENCES entities (id),
  slot          text,
  listed        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL,
  row_version   integer NOT NULL DEFAULT 1,
  CONSTRAINT edms_folder_items_slot CHECK (slot IS NULL OR slot ~ '^[0-9]{2}$'),
  UNIQUE (folder_id, document_id)
);

SELECT app.apply_mutable_conventions('edms_folder_items', 'entity_id');
CREATE INDEX edms_folder_items_document_idx ON edms_folder_items (document_id);


CREATE TABLE edms_document_tags (
  document_id  uuid NOT NULL REFERENCES documents (id),
  tag_id       uuid NOT NULL REFERENCES edms_tags (id),
  entity_id    uuid NOT NULL REFERENCES entities (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,
  PRIMARY KEY (document_id, tag_id)
);

SELECT app.apply_append_only_conventions('edms_document_tags', 'entity_id');


CREATE TABLE edms_shares (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      uuid NOT NULL REFERENCES documents (id),
  entity_id        uuid NOT NULL REFERENCES entities (id),
  grantee_user_id  uuid REFERENCES users (id),
  grantee_role     role_key,
  expires_at       timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL,
  row_version      integer NOT NULL DEFAULT 1,
  CONSTRAINT edms_shares_grantee CHECK (
    (grantee_user_id IS NOT NULL AND grantee_role IS NULL)
    OR (grantee_user_id IS NULL AND grantee_role IS NOT NULL)
  )
);

SELECT app.apply_mutable_conventions('edms_shares', 'entity_id');
CREATE INDEX edms_shares_document_idx ON edms_shares (document_id) WHERE revoked_at IS NULL;


CREATE TABLE edms_legal_holds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid REFERENCES documents (id),
  folder_id    uuid REFERENCES edms_folders (id),
  entity_id    uuid NOT NULL REFERENCES entities (id),
  reason       text NOT NULL,
  placed_by    text NOT NULL,
  released_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL,
  row_version  integer NOT NULL DEFAULT 1,
  CONSTRAINT edms_legal_holds_target CHECK (document_id IS NOT NULL OR folder_id IS NOT NULL),
  CONSTRAINT edms_legal_holds_reason CHECK (btrim(reason) <> '')
);

SELECT app.apply_mutable_conventions('edms_legal_holds', 'entity_id');


INSERT INTO workflow_definitions (key, name, version, created_by, updated_by)
VALUES ('edms-document-v1', 'EDMS document approval', 1, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO workflow_stages (
  definition_id, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days, created_by
)
SELECT d.id, 1, 'approver', 'Document approval', 'edms.approve', 'CORPORATE',
       ARRAY['APPROVE', 'REJECT', 'RETURN_FOR_CORRECTION'], 5, 'system:seed'
  FROM workflow_definitions d
 WHERE d.key = 'edms-document-v1'
   AND NOT EXISTS (
     SELECT 1 FROM workflow_stages s WHERE s.definition_id = d.id AND s.key = 'approver'
   );


CREATE OR REPLACE FUNCTION app.seed_edms_entity_folders(p_entity uuid, p_actor text)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_active uuid;
  v_archived uuid;
  v_module text;
BEGIN
  INSERT INTO edms_folders (entity_id, parent_id, name, kind, created_by, updated_by)
  VALUES (p_entity, NULL, 'Active', 'space', p_actor, p_actor)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_active;
  IF v_active IS NULL THEN
    SELECT id INTO v_active FROM edms_folders WHERE entity_id = p_entity AND parent_id IS NULL AND name = 'Active';
  END IF;

  INSERT INTO edms_folders (entity_id, parent_id, name, kind, created_by, updated_by)
  VALUES (p_entity, NULL, 'Archived', 'space', p_actor, p_actor)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_archived;
  IF v_archived IS NULL THEN
    SELECT id INTO v_archived FROM edms_folders WHERE entity_id = p_entity AND parent_id IS NULL AND name = 'Archived';
  END IF;

  FOREACH v_module IN ARRAY ARRAY['Procurement', 'Finance', 'HR', 'Inventory', 'Administrative']
  LOOP
    INSERT INTO edms_folders (entity_id, parent_id, name, kind, created_by, updated_by)
    VALUES (p_entity, v_active, v_module, 'module', p_actor, p_actor)
    ON CONFLICT DO NOTHING;
    INSERT INTO edms_folders (entity_id, parent_id, name, kind, status, created_by, updated_by)
    VALUES (p_entity, v_archived, v_module, 'module', 'ARCHIVED', p_actor, p_actor)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

DO $$
DECLARE rec record;
BEGIN
  FOR rec IN SELECT id FROM entities WHERE status = 'ACTIVE'
  LOOP
    PERFORM app.seed_edms_entity_folders(rec.id, 'system:seed');
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION app.seed_edms_entity_folders(uuid, text) TO nfc_app;


CREATE INDEX edms_folder_items_slot_idx
  ON edms_folder_items (folder_id, slot) WHERE slot IS NOT NULL;

-- Administrator is never corporate, so entity RLS would hide subsidiary files
-- from retention work. These extra policies let manage_retention reach rows
-- without granting edms.view (GET /api/edms/documents still 403s via can()).
CREATE POLICY documents_retention_admin ON documents FOR ALL TO nfc_app
  USING (app.has_permission('edms.manage_retention'))
  WITH CHECK (app.has_permission('edms.manage_retention'));
CREATE POLICY document_versions_retention_admin ON document_versions FOR SELECT TO nfc_app
  USING (app.has_permission('edms.manage_retention'));
CREATE POLICY document_access_log_retention_admin ON document_access_log FOR SELECT TO nfc_app
  USING (app.has_permission('edms.manage_retention'));
CREATE POLICY edms_legal_holds_retention_admin ON edms_legal_holds FOR ALL TO nfc_app
  USING (app.has_permission('edms.manage_retention'))
  WITH CHECK (app.has_permission('edms.manage_retention'));
CREATE POLICY edms_folder_items_retention_admin ON edms_folder_items FOR SELECT TO nfc_app
  USING (app.has_permission('edms.manage_retention'));
CREATE POLICY edms_folders_retention_admin ON edms_folders FOR SELECT TO nfc_app
  USING (app.has_permission('edms.manage_retention'));


CREATE OR REPLACE FUNCTION app.refile_document(
  p_document uuid,
  p_dest_entity uuid,
  p_folder uuid,
  p_reason text,
  p_actor text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_src uuid;
  v_folder_entity uuid;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to re-file a document.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT entity_id INTO v_src FROM documents WHERE id = p_document;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'That document was not found.';
  END IF;
  IF v_src = p_dest_entity THEN
    RAISE EXCEPTION 'The document is already in that subsidiary.';
  END IF;

  SELECT entity_id INTO v_folder_entity FROM edms_folders WHERE id = p_folder;
  IF v_folder_entity IS NULL OR v_folder_entity IS DISTINCT FROM p_dest_entity THEN
    RAISE EXCEPTION 'The destination folder does not belong to that subsidiary.';
  END IF;

  UPDATE documents
     SET entity_id = p_dest_entity, updated_by = p_actor
   WHERE id = p_document;
  UPDATE document_versions
     SET entity_id = p_dest_entity
   WHERE document_id = p_document;
  UPDATE edms_folder_items
     SET folder_id = p_folder, entity_id = p_dest_entity, updated_by = p_actor
   WHERE document_id = p_document;
END $$;

GRANT EXECUTE ON FUNCTION app.refile_document(uuid, uuid, uuid, text, text) TO nfc_app;

CREATE OR REPLACE FUNCTION app.edms_user_directory()
RETURNS TABLE (id uuid, name text, email citext)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.name, u.email FROM users u WHERE u.status = 'ACTIVE' ORDER BY u.name;
$$;

GRANT EXECUTE ON FUNCTION app.edms_user_directory() TO nfc_app;


UPDATE event_subscriptions
   SET handler_key = 'edms.file_procurement'
 WHERE event_type = 'procurement.completed' AND handler_key = 'edms.placeholder';

INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('procurement.completed', 'edms.file_procurement', 'system:seed')
ON CONFLICT DO NOTHING;
