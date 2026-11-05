-- ---------------------------------------------------------------------------
-- 0055_quotation_unit_price
-- Vendor comparison captures unit price; amount_kobo remains the derived total
-- (unit_price × line quantities) used for lowest-price recommendation.
-- ---------------------------------------------------------------------------

ALTER TABLE procurement_quotations
  ADD COLUMN IF NOT EXISTS unit_price_kobo bigint;

ALTER TABLE procurement_quotations
  DROP CONSTRAINT IF EXISTS procurement_quotations_unit_price_positive;
ALTER TABLE procurement_quotations
  ADD CONSTRAINT procurement_quotations_unit_price_positive
  CHECK (unit_price_kobo IS NULL OR unit_price_kobo > 0);
