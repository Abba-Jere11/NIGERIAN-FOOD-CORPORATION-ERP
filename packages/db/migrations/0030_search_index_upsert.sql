-- ---------------------------------------------------------------------------
-- 0030_search_index_upsert
--
-- INSERT ... ON CONFLICT applies SELECT RLS policies as WITH CHECK on the new
-- row so the command cannot probe invisible keys. Completing a delivery now
-- posts a PROCUREMENT_RECLASS journal (permission_key finance.view) as the
-- Inventory Officer, who must not hold finance.view. Split UPDATE-then-INSERT
-- so indexing only needs the write policies (entity access), not the read
-- permission of the indexed record.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.upsert_search_index(
  p_record_type      text,
  p_record_id        uuid,
  p_reference_number text,
  p_title            text,
  p_searchable_text  text,
  p_entity_id        uuid,
  p_permission_key   text
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE search_index
     SET reference_number = p_reference_number,
         title = p_title,
         searchable_text = p_searchable_text,
         entity_id = p_entity_id,
         permission_key = p_permission_key,
         updated_at = now()
   WHERE record_type = p_record_type
     AND record_id = p_record_id;
  IF FOUND THEN
    RETURN;
  END IF;
  BEGIN
    INSERT INTO search_index (
      record_type, record_id, reference_number, title, searchable_text, entity_id, permission_key, updated_at
    ) VALUES (
      p_record_type, p_record_id, p_reference_number, p_title, p_searchable_text, p_entity_id, p_permission_key, now()
    );
  EXCEPTION
    WHEN unique_violation THEN
      UPDATE search_index
         SET reference_number = p_reference_number,
             title = p_title,
             searchable_text = p_searchable_text,
             entity_id = p_entity_id,
             permission_key = p_permission_key,
             updated_at = now()
       WHERE record_type = p_record_type
         AND record_id = p_record_id;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION app.upsert_search_index(text, uuid, text, text, text, uuid, text) TO nfc_app;
