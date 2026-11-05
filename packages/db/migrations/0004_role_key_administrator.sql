-- ---------------------------------------------------------------------------
-- 0004_role_key_administrator
--
-- A5 now has six roles. The Administrator is a new value on the existing
-- role_key enum. ADD VALUE is isolated in its own migration because PostgreSQL
-- will not let the new label be used in the same transaction that adds it.
-- ---------------------------------------------------------------------------

ALTER TYPE role_key ADD VALUE 'administrator';
