-- ---------------------------------------------------------------------------
-- 0028_role_key_inventory_officer
--
-- A5 now has seven roles. Inventory Officer is a new value on the existing
-- role_key enum. ADD VALUE is isolated in its own migration because PostgreSQL
-- will not let the new label be used in the same transaction that adds it.
-- ---------------------------------------------------------------------------

ALTER TYPE role_key ADD VALUE 'inventory_officer';
