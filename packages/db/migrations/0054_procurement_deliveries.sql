-- ---------------------------------------------------------------------------
-- 0054_procurement_deliveries
--
-- Delivery verification per item. A delivery records what applies to the whole
-- consignment once (date, location, document type, evidence); each item on it
-- keeps its own goods received note with ordered, received, accepted and
-- rejected quantities.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.next_reference(p_kind text, p_year integer DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_kind text;
  v_year integer;
  v_next integer;
  v_allowed text[] := ARRAY[
    'REQ','PR','PAY','TRF','GRN','INV','EMP','DOC','SEAL','JNL','BUD','VND','CUS','SO','PRD','PRL','LV','VAC',
    'ICT','ARI','BILL','INC','EXP','RCT','RPT','CASE','IST','ITR','IAD','CNT','DSP','SRN',
    'ORG','MIN','RSP','DEC','DISC','TRN','DEL'
  ];
BEGIN
  v_kind := upper(btrim(p_kind));
  IF v_kind IS NULL OR v_kind = '' THEN
    RAISE EXCEPTION 'A reference kind is required.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_kind = ANY (v_allowed) THEN
    RAISE EXCEPTION 'Unknown reference kind "%".', v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_kind = 'VND' THEN
    v_year := 0;
  ELSIF p_year IS NULL OR p_year = 0 THEN
    v_year := EXTRACT(YEAR FROM timezone('Africa/Lagos', clock_timestamp()))::integer;
  ELSE
    v_year := p_year;
  END IF;

  INSERT INTO reference_counters (kind, year, last_value)
  VALUES (v_kind, v_year, 0)
  ON CONFLICT (kind, year) DO NOTHING;

  SELECT last_value INTO v_next
    FROM reference_counters
   WHERE kind = v_kind AND year = v_year
   FOR UPDATE;

  IF v_kind IN ('PR', 'GRN') THEN
    v_next := GREATEST(v_next, app.existing_max_reference(v_kind, v_year));
  END IF;

  v_next := v_next + 1;

  UPDATE reference_counters
     SET last_value = v_next,
         updated_at = clock_timestamp()
   WHERE kind = v_kind AND year = v_year;

  IF v_kind = 'VND' THEN
    RETURN v_kind || '-' || lpad(v_next::text, 6, '0');
  END IF;
  RETURN v_kind || '-' || v_year::text || '-' || lpad(v_next::text, 6, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION app.next_reference(text, integer) TO nfc_app;


CREATE TABLE procurement_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number text NOT NULL UNIQUE,
  request_id       uuid NOT NULL REFERENCES procurement_requests (id),
  version_id       uuid NOT NULL REFERENCES procurement_versions (id),
  entity_id        uuid NOT NULL REFERENCES entities (id),
  received_date    date NOT NULL,
  location         text NOT NULL,
  document_kind    text NOT NULL,
  notes            text,
  warehouse_id     uuid REFERENCES warehouses (id),
  idempotency_key  text NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  CONSTRAINT procurement_deliveries_location_not_blank CHECK (btrim(location) <> ''),
  CONSTRAINT procurement_deliveries_document_kind_not_blank CHECK (btrim(document_kind) <> '')
);

SELECT app.apply_append_only_conventions('procurement_deliveries', 'entity_id');
SELECT app.protect_reference_number('procurement_deliveries');

CREATE INDEX procurement_deliveries_request_idx
  ON procurement_deliveries (request_id, created_at);


ALTER TABLE procurement_goods_receipts
  ADD COLUMN delivery_id uuid REFERENCES procurement_deliveries (id);

CREATE INDEX procurement_goods_receipts_delivery_idx
  ON procurement_goods_receipts (delivery_id);


ALTER TABLE procurement_receipt_documents
  ADD COLUMN delivery_id uuid REFERENCES procurement_deliveries (id);

ALTER TABLE procurement_receipt_documents
  DROP CONSTRAINT procurement_receipt_documents_parent;

ALTER TABLE procurement_receipt_documents
  ADD CONSTRAINT procurement_receipt_documents_parent
  CHECK (num_nonnulls(grn_id, delivery_note_id, delivery_id) = 1);


-- Clearer wording and the {action} variable for awaiting_review.
UPDATE notification_types
   SET title_template = '{reference} is ready for funding approval',
       body_template = '{reference} is ready for your review and funding approval. {summary}'
 WHERE type = 'procurement.invoice_uploaded';

UPDATE notification_types
   SET title_template = 'Procurement {reference} needs you to {action}',
       body_template = '{title} {reference} needs you to {action}.'
 WHERE type = 'procurement.awaiting_review';

UPDATE notification_types
   SET title_template = 'Payment completed for {reference}',
       body_template = 'Payment has been completed for {title} {reference}. Please verify delivery of each item.'
 WHERE type = 'procurement.paid';

UPDATE notification_types
   SET title_template = 'Delivery still outstanding for {reference}',
       body_template = 'Procurement {reference} is still awaiting delivery. Please verify delivery of each item.'
 WHERE type = 'procurement.delivery_reminder';
