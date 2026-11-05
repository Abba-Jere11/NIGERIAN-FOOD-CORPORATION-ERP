-- ---------------------------------------------------------------------------
-- 0012_notifications
--
-- In-app inbox always; email is configurable per type. SMS/WhatsApp are not
-- delivered in this milestone (interfaces only in application code).
-- ---------------------------------------------------------------------------

CREATE TABLE notification_types (
  type           text PRIMARY KEY,
  category       text NOT NULL,
  title_template text NOT NULL,
  body_template  text NOT NULL,
  email_enabled  boolean NOT NULL DEFAULT true,
  mandatory      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text NOT NULL
);

GRANT SELECT ON notification_types TO nfc_app;

CREATE OR REPLACE FUNCTION app.user_email_by_id(p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, app AS $$
  SELECT email::text FROM users WHERE id = p_id
$$;

GRANT EXECUTE ON FUNCTION app.user_email_by_id(uuid) TO nfc_app;

CREATE OR REPLACE FUNCTION app.user_public_name(p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, app AS $$
  SELECT name FROM users WHERE id = p_id
$$;

GRANT EXECUTE ON FUNCTION app.user_public_name(uuid) TO nfc_app;

ALTER TABLE notification_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_types_select ON notification_types
  FOR SELECT TO nfc_app
  USING (true);


CREATE TABLE notifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id  uuid NOT NULL REFERENCES users (id),
  type               text NOT NULL REFERENCES notification_types (type),
  title              text NOT NULL,
  body               text NOT NULL,
  reference_number   text,
  href               text,
  entity_id          uuid REFERENCES entities (id),
  read_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text NOT NULL,
  row_version        integer NOT NULL DEFAULT 1
);

SELECT app.add_row_version_trigger('notifications');
SELECT app.forbid_hard_delete('notifications');
GRANT SELECT, INSERT, UPDATE ON notifications TO nfc_app;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_select ON notifications
  FOR SELECT TO nfc_app
  USING (recipient_user_id = app.current_user_id() OR app.is_admin_actor());
CREATE POLICY notifications_insert ON notifications
  FOR INSERT TO nfc_app
  WITH CHECK (true);
CREATE POLICY notifications_update ON notifications
  FOR UPDATE TO nfc_app
  USING (recipient_user_id = app.current_user_id() OR app.is_admin_actor())
  WITH CHECK (recipient_user_id = app.current_user_id() OR app.is_admin_actor());

CREATE INDEX notifications_recipient_idx ON notifications (recipient_user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (recipient_user_id)
  WHERE read_at IS NULL;


CREATE TABLE notification_preferences (
  user_id        uuid NOT NULL REFERENCES users (id),
  category       text NOT NULL,
  email_enabled  boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text NOT NULL,
  row_version    integer NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, category)
);

SELECT app.add_row_version_trigger('notification_preferences');
GRANT SELECT, INSERT, UPDATE ON notification_preferences TO nfc_app;

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_preferences_own ON notification_preferences
  FOR ALL TO nfc_app
  USING (user_id = app.current_user_id() OR app.is_admin_actor())
  WITH CHECK (user_id = app.current_user_id() OR app.is_admin_actor());


CREATE TABLE notification_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id  uuid REFERENCES notifications (id),
  channel          text NOT NULL CHECK (channel IN ('in_app', 'email')),
  status           text NOT NULL CHECK (status IN ('sent', 'logged', 'failed')),
  error            text,
  attempts         integer NOT NULL DEFAULT 1,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL
);

SELECT app.apply_append_only_conventions('notification_deliveries');

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_deliveries_select ON notification_deliveries
  FOR SELECT TO nfc_app
  USING (app.is_admin_actor());
CREATE POLICY notification_deliveries_insert ON notification_deliveries
  FOR INSERT TO nfc_app
  WITH CHECK (true);

CREATE INDEX notification_deliveries_status_idx ON notification_deliveries (status, occurred_at DESC);


INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  (
    'engine.created',
    'engine',
    'Record {reference} created',
    'A numbered record {reference} ({title}) has been created.',
    true,
    false,
    'system:seed'
  ),
  (
    'workflow.reminder',
    'action_required',
    'Reminder: {reference} is waiting',
    'Reminder: {title} {reference} has been awaiting your action for {days} days.',
    true,
    true,
    'system:seed'
  ),
  (
    'procurement.approved',
    'action_required',
    'Procurement {reference} approved',
    'Your procurement {reference} has been approved by the MD and is awaiting Finance review.',
    true,
    true,
    'system:seed'
  )
ON CONFLICT (type) DO NOTHING;
