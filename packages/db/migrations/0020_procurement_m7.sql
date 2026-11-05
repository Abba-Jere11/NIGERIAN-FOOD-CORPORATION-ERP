-- ---------------------------------------------------------------------------
-- 0020_procurement_m7
--
-- Procurement 2 (M7): clone lineage, archive provenance, commitment events,
-- and stage-aware notification types. Approval runtime stays in the M4 engine.
-- ---------------------------------------------------------------------------

ALTER TABLE procurement_requests
  ADD COLUMN cloned_from_request_id uuid REFERENCES procurement_requests (id),
  ADD COLUMN archived_from_status text,
  ADD COLUMN archived_from_stage_key text;

ALTER TABLE procurement_requests
  ADD CONSTRAINT procurement_requests_archived_status CHECK (
    archived_from_status IS NULL OR archived_from_status IN (
      'DRAFT',
      'AWAITING_OPERATIONS',
      'AWAITING_MD',
      'AWAITING_ED_FINANCE',
      'FUNDING_PENDING',
      'AWAITING_PAYMENT',
      'PAYMENT_PROCESSING',
      'AWAITING_DELIVERY',
      'PARTIALLY_RECEIVED',
      'COMPLETED',
      'REJECTED',
      'ARCHIVED',
      'DISCARDED'
    )
  );

CREATE INDEX procurement_requests_cloned_from_idx
  ON procurement_requests (cloned_from_request_id)
  WHERE cloned_from_request_id IS NOT NULL;


INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('procurement.committed', 'notify.generic', 'system:seed'),
  ('procurement.commitment_released', 'notify.generic', 'system:seed'),
  ('procurement.awaiting_review', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  (
    'procurement.awaiting_review',
    'action_required',
    'Procurement {reference} awaiting {stage}',
    '{title} {reference} is waiting for {stage}.',
    true,
    true,
    'system:seed'
  ),
  (
    'procurement.committed',
    'engine',
    'Commitment opened for {reference}',
    'A budget commitment was opened for {title} {reference}.',
    false,
    false,
    'system:seed'
  ),
  (
    'procurement.commitment_released',
    'engine',
    'Commitment released for {reference}',
    'The budget commitment for {title} {reference} was released.',
    false,
    false,
    'system:seed'
  )
ON CONFLICT (type) DO NOTHING;

UPDATE notification_types
   SET body_template = 'Your procurement {reference} {summary}'
 WHERE type = 'procurement.approved'
   AND body_template = 'Your procurement {reference} has been approved by the MD and is awaiting Finance review.';

CREATE OR REPLACE FUNCTION app.permission_is_approval_or_payment(p_key text)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_key IN (
    'procurement.approve.operations',
    'procurement.approve.final',
    'procurement.reject',
    'procurement.return',
    'procurement.archive',
    'procurement.restore',
    'procurement.review.finance',
    'finance.payment.execute',
    'finance.funding.authorize'
  );
$$;
