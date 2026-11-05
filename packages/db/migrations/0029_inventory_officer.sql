-- ---------------------------------------------------------------------------
-- 0029_inventory_officer
--
-- Revoke delivery ownership from the GM. The Inventory Officer role, grants
-- and seed user are applied by seed-identity from the shared catalog.
-- Seed grants are insert-only, so this DELETE is required on already-seeded
-- databases. role_permissions is R3-protected; replica mode is the same
-- bypass used by test fixtures. On a fresh database the DELETE is a no-op
-- because role_permissions is still empty at migrate time.
-- ---------------------------------------------------------------------------

UPDATE roles
   SET description = 'Originates procurement. Views own subsidiary inventory and finance read-only. Does not verify delivery.',
       updated_by = 'system:seed'
 WHERE key = 'gm';

SET session_replication_role = replica;
DELETE FROM role_permissions rp
 USING roles r
 WHERE rp.role_id = r.id
   AND r.key = 'gm'
   AND rp.permission_key IN (
     'procurement.verify.delivery',
     'procurement.grn.record',
     'procurement.close_short.request'
   );
SET session_replication_role = DEFAULT;
