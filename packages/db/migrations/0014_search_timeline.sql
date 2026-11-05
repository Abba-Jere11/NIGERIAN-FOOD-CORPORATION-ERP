-- ---------------------------------------------------------------------------
-- 0014_search_timeline
--
-- Global search index (modules register rows) and a generic timeline.
-- PostgreSQL FTS plus trigram matching (pg_trgm from 0001).
-- ---------------------------------------------------------------------------

CREATE TABLE search_index (
  record_type       text NOT NULL,
  record_id         uuid NOT NULL,
  reference_number  text,
  title             text NOT NULL,
  searchable_text   text NOT NULL,
  entity_id         uuid NOT NULL REFERENCES entities (id),
  permission_key    text NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (record_type, record_id)
);

ALTER TABLE search_index
  ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
      to_tsvector(
        'simple',
        coalesce(reference_number, '') || ' ' || title || ' ' || searchable_text
      )
    ) STORED;

CREATE INDEX search_index_vector_idx ON search_index USING gin (search_vector);
CREATE INDEX search_index_trgm_ref_idx ON search_index USING gin (reference_number gin_trgm_ops);
CREATE INDEX search_index_trgm_title_idx ON search_index USING gin (title gin_trgm_ops);
CREATE INDEX search_index_trgm_text_idx ON search_index USING gin (searchable_text gin_trgm_ops);

GRANT SELECT, INSERT, UPDATE ON search_index TO nfc_app;

ALTER TABLE search_index ENABLE ROW LEVEL SECURITY;
CREATE POLICY search_index_read ON search_index
  FOR SELECT TO nfc_app
  USING (app.can_access_entity(entity_id) AND app.has_permission(permission_key));
CREATE POLICY search_index_write ON search_index
  FOR INSERT TO nfc_app
  WITH CHECK (app.can_access_entity(entity_id));
CREATE POLICY search_index_update ON search_index
  FOR UPDATE TO nfc_app
  USING (app.can_access_entity(entity_id))
  WITH CHECK (app.can_access_entity(entity_id));


CREATE OR REPLACE FUNCTION app.upsert_search_index(
  p_record_type      text,
  p_record_id        uuid,
  p_reference_number text,
  p_title            text,
  p_searchable_text  text,
  p_entity_id        uuid,
  p_permission_key   text
) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO search_index (
    record_type, record_id, reference_number, title, searchable_text, entity_id, permission_key, updated_at
  ) VALUES (
    p_record_type, p_record_id, p_reference_number, p_title, p_searchable_text, p_entity_id, p_permission_key, now()
  )
  ON CONFLICT (record_type, record_id) DO UPDATE
    SET reference_number = EXCLUDED.reference_number,
        title = EXCLUDED.title,
        searchable_text = EXCLUDED.searchable_text,
        entity_id = EXCLUDED.entity_id,
        permission_key = EXCLUDED.permission_key,
        updated_at = now();
$$;

GRANT EXECUTE ON FUNCTION app.upsert_search_index(text, uuid, text, text, text, uuid, text) TO nfc_app;


CREATE TABLE timeline_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type  text NOT NULL,
  subject_id    uuid NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_ref     text NOT NULL,
  actor_name    text NOT NULL,
  event_text    text NOT NULL,
  href          text,
  entity_id     uuid REFERENCES entities (id),
  created_by    text NOT NULL
);

SELECT app.apply_append_only_conventions('timeline_events', 'entity_id');

CREATE INDEX timeline_events_subject_idx ON timeline_events (subject_type, subject_id, occurred_at);
