-- ---------------------------------------------------------------------------
-- 0031_payment_timing
--
-- GM proposed vs MD final payment timing, separate from funding_route.
-- Existing in-flight (non-draft) rows match today's pay-then-deliver path.
-- ---------------------------------------------------------------------------

ALTER TABLE procurement_requests
  ADD COLUMN proposed_payment_timing text,
  ADD COLUMN final_payment_timing text,
  ADD COLUMN final_payment_timing_set_at timestamptz,
  ADD COLUMN final_payment_timing_set_by text,
  ADD COLUMN timing_change_pending_ack boolean NOT NULL DEFAULT false;

ALTER TABLE procurement_requests
  ADD CONSTRAINT procurement_requests_proposed_payment_timing CHECK (
    proposed_payment_timing IS NULL
    OR proposed_payment_timing IN ('before_delivery', 'after_delivery')
  ),
  ADD CONSTRAINT procurement_requests_final_payment_timing CHECK (
    final_payment_timing IS NULL
    OR final_payment_timing IN ('before_delivery', 'after_delivery')
  );

UPDATE procurement_requests
   SET proposed_payment_timing = 'before_delivery',
       final_payment_timing = 'before_delivery',
       final_payment_timing_set_at = coalesce(updated_at, now()),
       final_payment_timing_set_by = 'system:seed'
 WHERE status NOT IN ('DRAFT', 'DISCARDED')
   AND proposed_payment_timing IS NULL;
