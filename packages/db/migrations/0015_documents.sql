-- ---------------------------------------------------------------------------
-- 0015_documents
--
-- Central Document Storage (M4A). Binary ciphertext lives in MinIO. This
-- schema holds metadata, the wrapped per-version DEK, and the access log.
-- ---------------------------------------------------------------------------

CREATE TABLE document_upload_policies (
  context             text PRIMARY KEY,
  max_bytes           bigint NOT NULL,
  allowed_mime_types  text[] NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text NOT NULL,
  row_version         integer NOT NULL DEFAULT 1,
  CONSTRAINT document_upload_policies_context CHECK (context IN ('procurement', 'edms', 'general')),
  CONSTRAINT document_upload_policies_max_bytes CHECK (max_bytes > 0)
);

SELECT app.add_row_version_trigger('document_upload_policies');
SELECT app.forbid_hard_delete('document_upload_policies');
GRANT SELECT, INSERT, UPDATE ON document_upload_policies TO nfc_app;

ALTER TABLE document_upload_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_upload_policies_select ON document_upload_policies
  FOR SELECT TO nfc_app
  USING (true);
CREATE POLICY document_upload_policies_write ON document_upload_policies
  FOR ALL TO nfc_app
  USING (app.is_admin_actor())
  WITH CHECK (app.is_admin_actor());

INSERT INTO document_upload_policies (context, max_bytes, allowed_mime_types, created_by, updated_by)
VALUES
  ('procurement', 10485760, ARRAY['application/pdf', 'image/jpeg', 'image/png'], 'system:seed', 'system:seed'),
  ('edms', 26214400, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], 'system:seed', 'system:seed'),
  ('general', 10485760, ARRAY['application/pdf', 'image/jpeg', 'image/png'], 'system:seed', 'system:seed')
ON CONFLICT DO NOTHING;


CREATE TABLE documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number   text NOT NULL UNIQUE,
  owner_type         text NOT NULL,
  owner_id           uuid,
  entity_id          uuid NOT NULL REFERENCES entities (id),
  category           text NOT NULL,
  title              text NOT NULL,
  status             text NOT NULL DEFAULT 'ACTIVE',
  current_version_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text NOT NULL,
  row_version        integer NOT NULL DEFAULT 1,
  CONSTRAINT documents_status CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT documents_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT documents_category_not_blank CHECK (btrim(category) <> '')
);

SELECT app.apply_mutable_conventions('documents', 'entity_id');
SELECT app.protect_reference_number('documents');

CREATE INDEX documents_entity_id_idx ON documents (entity_id, status);


CREATE TABLE document_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         uuid NOT NULL REFERENCES documents (id),
  entity_id           uuid NOT NULL REFERENCES entities (id),
  version_number      integer NOT NULL,
  storage_key         text NOT NULL,
  sha256              text NOT NULL,
  size_bytes          bigint NOT NULL,
  mime_type           text NOT NULL,
  original_filename   text NOT NULL,
  wrapped_key         text NOT NULL,
  iv                  bytea NOT NULL,
  auth_tag            bytea NOT NULL,
  kek_kid             text NOT NULL DEFAULT 'v1',
  uploaded_by         text NOT NULL,
  uploaded_at         timestamptz NOT NULL DEFAULT now(),
  replacement_reason  text,
  created_by          text NOT NULL,
  CONSTRAINT document_versions_version_positive CHECK (version_number >= 1),
  CONSTRAINT document_versions_size_positive CHECK (size_bytes > 0),
  CONSTRAINT document_versions_sha256_hex CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT document_versions_reason_required CHECK (
    version_number = 1
    OR (replacement_reason IS NOT NULL AND btrim(replacement_reason) <> '')
  ),
  UNIQUE (document_id, version_number)
);

SELECT app.apply_append_only_conventions('document_versions', 'entity_id');

CREATE INDEX document_versions_document_id_idx ON document_versions (document_id, version_number);

ALTER TABLE documents
  ADD CONSTRAINT documents_current_version_id_fkey
  FOREIGN KEY (current_version_id) REFERENCES document_versions (id);


CREATE TABLE document_access_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES documents (id),
  version_id   uuid NOT NULL REFERENCES document_versions (id),
  entity_id    uuid NOT NULL REFERENCES entities (id),
  actor_ref    text NOT NULL,
  action       text NOT NULL,
  ip           inet,
  user_agent   text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,
  CONSTRAINT document_access_log_action CHECK (action IN ('VIEW', 'DOWNLOAD', 'SHARE'))
);

SELECT app.apply_append_only_conventions('document_access_log', 'entity_id');

CREATE INDEX document_access_log_document_idx ON document_access_log (document_id, occurred_at DESC);
