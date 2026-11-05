-- ---------------------------------------------------------------------------
-- 0033_payment_execution
--
-- Partial vendor payments are allowed. The one-active-payment unique index
-- blocked a second COMPLETED row on the same version.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS procurement_payments_one_active;
