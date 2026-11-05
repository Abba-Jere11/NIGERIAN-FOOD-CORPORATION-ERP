-- ---------------------------------------------------------------------------
-- 0052_procurement_quote_comparison
-- Structured vendor quotations: each quotation names a registered vendor and a
-- quoted total, so the proposal can compare prices side by side and recommend
-- the lowest. Awarding to a vendor that is not the lowest needs a written
-- justification on the version.
-- ---------------------------------------------------------------------------

ALTER TABLE procurement_quotations
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendors (id),
  ADD COLUMN IF NOT EXISTS amount_kobo bigint,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE procurement_quotations
  ADD CONSTRAINT procurement_quotations_amount_positive CHECK (amount_kobo IS NULL OR amount_kobo > 0);

-- One quotation per vendor per version. Legacy file-only rows have no vendor.
CREATE UNIQUE INDEX IF NOT EXISTS procurement_quotations_version_vendor_key
  ON procurement_quotations (version_id, vendor_id)
  WHERE vendor_id IS NOT NULL;

ALTER TABLE procurement_versions
  ADD COLUMN IF NOT EXISTS selection_justification text;
