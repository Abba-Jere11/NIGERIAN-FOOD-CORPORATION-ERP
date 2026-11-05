INSERT INTO permissions (key, description, created_by) VALUES
  ('inventory.view.consolidated', 'Switch between consolidated and individual entity inventory views.', 'system:seed')
ON CONFLICT (key) DO NOTHING;

SET session_replication_role = replica;
INSERT INTO role_permissions (role_id, permission_key, created_by)
SELECT r.id, k.key, 'system:seed'
  FROM roles r
  JOIN (VALUES
    ('inventory_officer', 'inventory.view.consolidated'),
    ('ed_operations', 'inventory.view.consolidated'),
    ('md', 'inventory.view.consolidated')
  ) AS k(role_key, key) ON k.role_key = r.key::text
ON CONFLICT DO NOTHING;
SET session_replication_role = DEFAULT;
