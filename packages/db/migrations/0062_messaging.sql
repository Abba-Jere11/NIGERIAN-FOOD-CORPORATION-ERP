-- ---------------------------------------------------------------------------
-- 0062_messaging
--
-- Direct messages, named groups, and one channel per department that has a
-- head. Only members can read a conversation.
-- ---------------------------------------------------------------------------

CREATE TABLE conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL,
  entity_id     uuid REFERENCES entities (id),
  department_id uuid REFERENCES departments (id),
  title         text,
  direct_low    uuid,
  direct_high   uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL,
  row_version   integer NOT NULL DEFAULT 1,
  CONSTRAINT conversations_kind CHECK (kind IN ('DIRECT', 'GROUP', 'DEPARTMENT')),
  CONSTRAINT conversations_direct CHECK (
    (kind = 'DIRECT' AND direct_low IS NOT NULL AND direct_high IS NOT NULL AND direct_low < direct_high)
    OR (kind <> 'DIRECT' AND direct_low IS NULL AND direct_high IS NULL)
  )
);

SELECT app.apply_mutable_conventions('conversations');
CREATE UNIQUE INDEX conversations_direct_pair ON conversations (direct_low, direct_high) WHERE kind = 'DIRECT';
CREATE UNIQUE INDEX conversations_department_one ON conversations (department_id) WHERE kind = 'DEPARTMENT';

CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations (id),
  user_id         uuid NOT NULL REFERENCES users (id),
  role            text NOT NULL DEFAULT 'MEMBER',
  last_read_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT conversation_members_role CHECK (role IN ('OWNER', 'MEMBER'))
);
GRANT SELECT, INSERT, UPDATE ON conversation_members TO nfc_app;

CREATE OR REPLACE FUNCTION app.is_conversation_member(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_members
     WHERE conversation_id = p_id AND user_id = app.current_user_id()
  )
$$;

GRANT EXECUTE ON FUNCTION app.is_conversation_member(uuid) TO nfc_app;

CREATE OR REPLACE FUNCTION app.ensure_department_channel(p_department_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_entity uuid;
  v_name text;
BEGIN
  IF NOT app.has_permission('message.use') THEN
    RETURN NULL;
  END IF;
  SELECT d.entity_id, d.name INTO v_entity, v_name
    FROM departments d
   WHERE d.id = p_department_id AND d.head_employee_id IS NOT NULL;
  IF v_entity IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT id INTO v_id FROM conversations WHERE department_id = p_department_id AND kind = 'DEPARTMENT';
  IF v_id IS NULL THEN
    INSERT INTO conversations (kind, entity_id, department_id, title, created_by, updated_by)
    VALUES ('DEPARTMENT', v_entity, p_department_id, v_name, 'system:invite', 'system:invite')
    RETURNING id INTO v_id;
  END IF;
  INSERT INTO conversation_members (conversation_id, user_id, role, created_by)
  SELECT v_id, e.user_id, 'MEMBER', 'system:invite'
    FROM hr_employees e
   WHERE e.department_id = p_department_id AND e.user_id IS NOT NULL
  ON CONFLICT DO NOTHING;
  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION app.ensure_department_channel(uuid) TO nfc_app;

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversations_member ON conversations FOR SELECT TO nfc_app
  USING (app.is_conversation_member(id) OR created_by = app.current_user_id()::text);
CREATE POLICY conversations_insert ON conversations FOR INSERT TO nfc_app
  WITH CHECK (app.has_permission('message.use'));

ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversation_members_read ON conversation_members FOR SELECT TO nfc_app
  USING (app.is_conversation_member(conversation_id) OR user_id = app.current_user_id());
CREATE POLICY conversation_members_write ON conversation_members FOR INSERT TO nfc_app
  WITH CHECK (
    app.has_permission('message.use')
    AND (
      user_id = app.current_user_id()
      OR EXISTS (
        SELECT 1 FROM conversations c
         WHERE c.id = conversation_id AND c.created_by = app.current_user_id()::text
      )
    )
  );
CREATE POLICY conversation_members_read_at ON conversation_members FOR UPDATE TO nfc_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations (id),
  sender_user_id   uuid NOT NULL REFERENCES users (id),
  body             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  CONSTRAINT messages_body CHECK (btrim(body) <> '')
);

SELECT app.apply_append_only_conventions('messages');
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_read ON messages FOR SELECT TO nfc_app
  USING (app.is_conversation_member(conversation_id));
CREATE POLICY messages_insert ON messages FOR INSERT TO nfc_app
  WITH CHECK (
    sender_user_id = app.current_user_id()
    AND app.is_conversation_member(conversation_id)
  );

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES (
  'message.received', 'engine', 'New message',
  '{title}', false, false, 'system:seed'
)
ON CONFLICT (type) DO NOTHING;

INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('message.received', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;
