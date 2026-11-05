-- ---------------------------------------------------------------------------
-- 0035_shortage_override_grant
--
-- Existing databases already have 0034 applied. Seed is insert-only, so the
-- MD grant for the new key is written here as well as in DEFAULT_ROLE_GRANTS.
-- ---------------------------------------------------------------------------

INSERT INTO permissions (key, description, created_by)
VALUES (
  'procurement.shortage.override',
  'Correct a locked second-batch delivery date. Requires a recorded reason.',
  'system:seed'
)
ON CONFLICT (key) DO NOTHING;

SET session_replication_role = replica;
INSERT INTO role_permissions (role_id, permission_key, created_by)
SELECT r.id, 'procurement.shortage.override', 'system:seed'
  FROM roles r
 WHERE r.key = 'md'
ON CONFLICT DO NOTHING;
SET session_replication_role = DEFAULT;
