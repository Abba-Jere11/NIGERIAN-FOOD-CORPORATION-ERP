-- ---------------------------------------------------------------------------
-- 0027_payment_proof_nullable
--
-- ED Finance / Finance Head can mark a procurement paid using the vendor bank
-- details and funding paying account. Payment proof is optional evidence.
-- ---------------------------------------------------------------------------

ALTER TABLE procurement_payments
  ALTER COLUMN proof_document_id DROP NOT NULL;
