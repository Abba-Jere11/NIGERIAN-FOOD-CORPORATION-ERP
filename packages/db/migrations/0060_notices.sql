-- ---------------------------------------------------------------------------
-- 0060_notices
--
-- HR publishes notices to a role, a department, or everyone. Staff read the
-- ones that match them.
-- ---------------------------------------------------------------------------

CREATE TABLE notices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid REFERENCES entities (id),
  title        text NOT NULL,
  body         text NOT NULL,
  audience     jsonb NOT NULL DEFAULT '{"all": true}'::jsonb,
  publish_at   timestamptz,
  expires_at   timestamptz,
  pinned       boolean NOT NULL DEFAULT false,
  status       text NOT NULL DEFAULT 'DRAFT',
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL,
  row_version  integer NOT NULL DEFAULT 1,
  CONSTRAINT notices_title CHECK (btrim(title) <> ''),
  CONSTRAINT notices_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'))
);

SELECT app.apply_mutable_conventions('notices');
ALTER TABLE notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY notices_manage ON notices FOR ALL TO nfc_app
  USING (app.has_permission('notice.manage'))
  WITH CHECK (app.has_permission('notice.manage'));
CREATE OR REPLACE FUNCTION app.notice_matches_actor(p_audience jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((p_audience->>'all')::boolean, false)
      OR EXISTS (
           SELECT 1
             FROM user_role_assignments a
             JOIN roles r ON r.id = a.role_id
            WHERE a.user_id = app.current_user_id()
              AND a.status = 'ACTIVE'
              AND r.key::text IN (
                SELECT jsonb_array_elements_text(coalesce(p_audience->'roles', '[]'::jsonb))
              )
         )
      OR EXISTS (
           SELECT 1 FROM users u
            WHERE u.id = app.current_user_id()
              AND u.department_id::text IN (
                SELECT jsonb_array_elements_text(coalesce(p_audience->'departmentIds', '[]'::jsonb))
              )
         )
$$;

GRANT EXECUTE ON FUNCTION app.notice_matches_actor(jsonb) TO nfc_app;

CREATE POLICY notices_read ON notices FOR SELECT TO nfc_app
  USING (
    app.has_permission('notice.view')
    AND status = 'PUBLISHED'
    AND (publish_at IS NULL OR publish_at <= now())
    AND (expires_at IS NULL OR expires_at > now())
    AND (entity_id IS NULL OR app.can_access_entity(entity_id))
    AND app.notice_matches_actor(audience)
  );

CREATE TABLE notice_reads (
  notice_id  uuid NOT NULL REFERENCES notices (id),
  user_id    uuid NOT NULL REFERENCES users (id),
  read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_id)
);
GRANT SELECT, INSERT ON notice_reads TO nfc_app;
ALTER TABLE notice_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY notice_reads_self ON notice_reads FOR ALL TO nfc_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES (
  'notice.published', 'engine', '{title}',
  'A notice has been published.', false, false, 'system:seed'
)
ON CONFLICT (type) DO NOTHING;

INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('notice.published', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;
