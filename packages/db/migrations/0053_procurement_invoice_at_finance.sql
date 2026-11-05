-- ---------------------------------------------------------------------------
-- 0053_procurement_invoice_at_finance
-- The vendor invoice is requested at the ED Finance stage instead of during
-- proposal preparation. The Procurement Manager uploads it to the existing
-- record while the request waits at ED Finance; it must come from the
-- approved vendor, and an amount that differs from the approved total needs
-- the MD to approve the variance before ED Finance can continue.
-- ---------------------------------------------------------------------------

ALTER TABLE procurement_invoices
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendors (id);

-- The backfill only records which vendor issued invoices already on file, so
-- the submitted-version guard is lifted for this one statement.
ALTER TABLE procurement_invoices DISABLE TRIGGER procurement_invoices_forbid_submitted;
UPDATE procurement_invoices inv
   SET vendor_id = coalesce(r.vendor_id, v.vendor_id)
  FROM procurement_requests r
  JOIN procurement_versions v ON v.request_id = r.id
 WHERE inv.request_id = r.id
   AND inv.version_id = v.id
   AND inv.vendor_id IS NULL;
ALTER TABLE procurement_invoices ENABLE TRIGGER procurement_invoices_forbid_submitted;

-- Submitted versions stay frozen, except that the invoice may be added or
-- replaced while the request waits at ED Finance and no finance decision has
-- been recorded for that version.
CREATE OR REPLACE FUNCTION app.forbid_invoice_on_submitted_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE submitted timestamptz;
        version uuid;
        request_status text;
        decided boolean;
BEGIN
  version := COALESCE(NEW.version_id, OLD.version_id);
  SELECT v.submitted_at, r.status
    INTO submitted, request_status
    FROM procurement_versions v
    JOIN procurement_requests r ON r.id = v.request_id
   WHERE v.id = version;
  IF submitted IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM procurement_financial_reviews f WHERE f.version_id = version) INTO decided;
    IF TG_OP = 'DELETE' OR request_status IS DISTINCT FROM 'AWAITING_ED_FINANCE' OR decided THEN
      RAISE EXCEPTION 'append-only: invoices on a submitted version cannot be changed'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;


CREATE TABLE procurement_invoice_variances (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id            uuid NOT NULL REFERENCES procurement_requests (id),
  version_id            uuid NOT NULL REFERENCES procurement_versions (id),
  invoice_id            uuid NOT NULL REFERENCES procurement_invoices (id),
  entity_id             uuid NOT NULL REFERENCES entities (id),
  approved_amount_kobo  bigint NOT NULL,
  invoice_amount_kobo   bigint NOT NULL,
  invoice_number        text NOT NULL,
  status                text NOT NULL DEFAULT 'PENDING',
  decided_by            text,
  decided_at            timestamptz,
  reason                text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  row_version           integer NOT NULL DEFAULT 1,
  CONSTRAINT procurement_invoice_variances_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
  CONSTRAINT procurement_invoice_variances_amounts CHECK (approved_amount_kobo >= 0 AND invoice_amount_kobo > 0),
  CONSTRAINT procurement_invoice_variances_decision CHECK (
    (status IN ('PENDING', 'SUPERSEDED')) OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT procurement_invoice_variances_reject_reason CHECK (
    status <> 'REJECTED' OR (reason IS NOT NULL AND btrim(reason) <> '')
  )
);

CREATE INDEX procurement_invoice_variances_request_idx
  ON procurement_invoice_variances (request_id, created_at DESC);

SELECT app.apply_mutable_conventions('procurement_invoice_variances', 'entity_id');


INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('procurement.invoice_requested', 'notify.generic', 'system:seed'),
  ('procurement.invoice_uploaded', 'notify.generic', 'system:seed'),
  ('procurement.invoice_variance', 'notify.generic', 'system:seed'),
  ('procurement.invoice_variance_rejected', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  (
    'procurement.invoice_requested',
    'action_required',
    'Upload the vendor invoice for {reference}',
    '{title} {reference} is awaiting ED Finance. Upload the invoice from {summary} so Finance can continue.',
    true,
    true,
    'system:seed'
  ),
  (
    'procurement.invoice_uploaded',
    'action_required',
    'Invoice uploaded for {reference}',
    'The vendor invoice for {title} {reference} is attached. {summary}',
    true,
    true,
    'system:seed'
  ),
  (
    'procurement.invoice_variance',
    'action_required',
    'Invoice for {reference} differs from the approved amount',
    'The invoice for {title} {reference} differs from the amount you approved. {summary} Your approval is needed before ED Finance can continue.',
    true,
    true,
    'system:seed'
  ),
  (
    'procurement.invoice_variance_rejected',
    'action_required',
    'Invoice variance rejected for {reference}',
    'The MD rejected the invoice amount for {title} {reference}. Reason: {reason} Upload a corrected invoice.',
    true,
    true,
    'system:seed'
  )
ON CONFLICT (type) DO NOTHING;
