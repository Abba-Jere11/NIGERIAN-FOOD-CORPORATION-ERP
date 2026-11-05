-- ---------------------------------------------------------------------------
-- 0057_role_key_staff
--
-- Staff is a ninth role, and invited people wait in PENDING_APPROVAL until HR
-- approves access. ADD VALUE cannot be used in the same transaction that
-- inserts the new label, so this file only extends the enums.
-- ---------------------------------------------------------------------------

ALTER TYPE role_key ADD VALUE 'staff';
ALTER TYPE user_status ADD VALUE 'PENDING_APPROVAL';
