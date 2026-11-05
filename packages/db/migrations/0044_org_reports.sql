-- ---------------------------------------------------------------------------
-- 0044_org_reports
--
-- Organisational correspondence: reports to the MD, optional CC, forwarding
-- events, official minutes, responses, management decisions and external mail.
-- Access is an ACL, not entity-wide corporate visibility. Administrator has
-- template configuration only. There is no HOD role.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.next_reference(p_kind text, p_year integer DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_kind text;
  v_year integer;
  v_next integer;
  v_allowed text[] := ARRAY[
    'PR','PAY','TRF','GRN','INV','EMP','DOC','SEAL','JNL','BUD','VND','CUS','SO','PRD','PRL','LV','VAC',
    'ICT','ARI','BILL','INC','EXP','RCT','RPT','CASE','IST','ITR','IAD','CNT','DSP','SRN',
    'ORG','MIN','RSP','DEC'
  ];
BEGIN
  v_kind := upper(btrim(p_kind));
  IF v_kind IS NULL OR v_kind = '' THEN
    RAISE EXCEPTION 'A reference kind is required.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_kind = ANY (v_allowed) THEN
    RAISE EXCEPTION 'Unknown reference kind "%".', v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_kind = 'VND' THEN
    v_year := 0;
  ELSIF p_year IS NULL OR p_year = 0 THEN
    v_year := EXTRACT(YEAR FROM timezone('Africa/Lagos', clock_timestamp()))::integer;
  ELSE
    v_year := p_year;
  END IF;

  INSERT INTO reference_counters (kind, year, last_value)
  VALUES (v_kind, v_year, 0)
  ON CONFLICT (kind, year) DO NOTHING;

  SELECT last_value INTO v_next
    FROM reference_counters
   WHERE kind = v_kind AND year = v_year
   FOR UPDATE;

  IF v_kind IN ('PR', 'GRN') THEN
    v_next := GREATEST(v_next, app.existing_max_reference(v_kind, v_year));
  END IF;

  v_next := v_next + 1;

  UPDATE reference_counters
     SET last_value = v_next,
         updated_at = clock_timestamp()
   WHERE kind = v_kind AND year = v_year;

  IF v_kind = 'VND' THEN
    RETURN v_kind || '-' || lpad(v_next::text, 6, '0');
  END IF;
  RETURN v_kind || '-' || v_year::text || '-' || lpad(v_next::text, 6, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION app.next_reference(text, integer) TO nfc_app;


CREATE TABLE org_report_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                   text NOT NULL UNIQUE,
  title                 text NOT NULL,
  kind                  text NOT NULL,
  required_permission   text NOT NULL,
  available             boolean NOT NULL DEFAULT true,
  sort_order            integer NOT NULL DEFAULT 100,
  acknowledgement_default boolean NOT NULL DEFAULT false,
  fields                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  row_version           integer NOT NULL DEFAULT 1,
  CONSTRAINT org_report_templates_key CHECK (btrim(key) <> ''),
  CONSTRAINT org_report_templates_title CHECK (btrim(title) <> ''),
  CONSTRAINT org_report_templates_kind CHECK (kind IN ('general', 'specialist'))
);

SELECT app.add_row_version_trigger('org_report_templates');
SELECT app.forbid_hard_delete('org_report_templates');
SELECT app.grant_mutable_table('org_report_templates');

ALTER TABLE org_report_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_report_templates_select ON org_report_templates
  FOR SELECT TO nfc_app USING (true);
CREATE POLICY org_report_templates_insert ON org_report_templates
  FOR INSERT TO nfc_app WITH CHECK (app.is_admin_actor());
CREATE POLICY org_report_templates_update ON org_report_templates
  FOR UPDATE TO nfc_app USING (app.is_admin_actor()) WITH CHECK (app.is_admin_actor());


CREATE TABLE org_reports (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number      text NOT NULL UNIQUE,
  template_id           uuid NOT NULL REFERENCES org_report_templates (id),
  entity_id             uuid NOT NULL REFERENCES entities (id),
  title                 text NOT NULL,
  body                  text NOT NULL,
  observations          text,
  reporting_period      text,
  report_date           date NOT NULL DEFAULT (timezone('Africa/Lagos', now()))::date,
  status                text NOT NULL DEFAULT 'DRAFT',
  sender_user_id        uuid NOT NULL REFERENCES users (id),
  to_user_id            uuid REFERENCES users (id),
  current_revision_id   uuid,
  submitted_at          timestamptz,
  closed_at             timestamptz,
  archived_at           timestamptz,
  intended_cc_user_ids  uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  idempotency_key       text UNIQUE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text NOT NULL,
  row_version           integer NOT NULL DEFAULT 1,
  CONSTRAINT org_reports_title CHECK (btrim(title) <> ''),
  CONSTRAINT org_reports_body CHECK (btrim(body) <> ''),
  CONSTRAINT org_reports_status CHECK (status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CLOSED', 'ARCHIVED'))
);

SELECT app.add_row_version_trigger('org_reports');
SELECT app.forbid_hard_delete('org_reports');
SELECT app.grant_mutable_table('org_reports');


CREATE TABLE org_report_revisions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     uuid NOT NULL REFERENCES org_reports (id),
  entity_id     uuid NOT NULL REFERENCES entities (id),
  title         text NOT NULL,
  body          text NOT NULL,
  observations  text,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  CONSTRAINT org_report_revisions_title CHECK (btrim(title) <> ''),
  CONSTRAINT org_report_revisions_body CHECK (btrim(body) <> '')
);

SELECT app.grant_append_only_table('org_report_revisions');
SELECT app.forbid_hard_delete('org_report_revisions');

ALTER TABLE org_reports
  ADD CONSTRAINT org_reports_current_revision_fk
  FOREIGN KEY (current_revision_id) REFERENCES org_report_revisions (id);


CREATE TABLE org_report_forwards (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id               uuid NOT NULL REFERENCES org_reports (id),
  entity_id               uuid NOT NULL REFERENCES entities (id),
  note                    text,
  document_revision_id    uuid REFERENCES org_report_revisions (id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL
);

SELECT app.grant_append_only_table('org_report_forwards');
SELECT app.forbid_hard_delete('org_report_forwards');


CREATE TABLE org_report_recipients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         uuid NOT NULL REFERENCES org_reports (id),
  entity_id         uuid NOT NULL REFERENCES entities (id),
  user_id           uuid NOT NULL REFERENCES users (id),
  kind              text NOT NULL,
  source_event_id   uuid REFERENCES org_report_forwards (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  CONSTRAINT org_report_recipients_kind CHECK (kind IN ('TO', 'CC', 'FORWARD')),
  UNIQUE (report_id, user_id, kind, source_event_id)
);

SELECT app.grant_append_only_table('org_report_recipients');
SELECT app.forbid_hard_delete('org_report_recipients');


CREATE TABLE org_report_access (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     uuid NOT NULL REFERENCES org_reports (id),
  entity_id     uuid NOT NULL REFERENCES entities (id),
  user_id       uuid NOT NULL REFERENCES users (id),
  kind          text NOT NULL,
  revoked_at    timestamptz,
  revoked_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL,
  row_version   integer NOT NULL DEFAULT 1,
  CONSTRAINT org_report_access_kind CHECK (kind IN ('OWNER', 'TO', 'CC', 'FORWARD', 'MINUTE_TO', 'MINUTE_CC')),
  UNIQUE (report_id, user_id, kind)
);

SELECT app.add_row_version_trigger('org_report_access');
SELECT app.forbid_hard_delete('org_report_access');
SELECT app.grant_mutable_table('org_report_access');


CREATE TABLE org_minutes (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number          text NOT NULL UNIQUE,
  source_report_id          uuid NOT NULL REFERENCES org_reports (id),
  entity_id                 uuid NOT NULL REFERENCES entities (id),
  subject                   text NOT NULL,
  instruction               text NOT NULL,
  expected_outcome          text,
  due_at                    timestamptz,
  response_required         boolean NOT NULL DEFAULT true,
  acknowledgement_required  boolean NOT NULL DEFAULT false,
  priority                  text NOT NULL DEFAULT 'NORMAL',
  status                    text NOT NULL DEFAULT 'DRAFT',
  issuer_user_id            uuid NOT NULL REFERENCES users (id),
  to_user_id                uuid REFERENCES users (id),
  issued_at                 timestamptz,
  completed_at              timestamptz,
  last_reminded_at          timestamptz,
  issued_revision_id        uuid REFERENCES org_report_revisions (id),
  idempotency_key           text UNIQUE,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                text NOT NULL,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                text NOT NULL,
  row_version               integer NOT NULL DEFAULT 1,
  CONSTRAINT org_minutes_subject CHECK (btrim(subject) <> ''),
  CONSTRAINT org_minutes_instruction CHECK (btrim(instruction) <> ''),
  CONSTRAINT org_minutes_priority CHECK (priority IN ('LOW', 'NORMAL', 'HIGH')),
  CONSTRAINT org_minutes_status CHECK (status IN (
    'DRAFT', 'ISSUED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESPONSE_SUBMITTED',
    'FURTHER_ACTION_REQUIRED', 'COMPLETED', 'REOPENED'
  ))
);

SELECT app.add_row_version_trigger('org_minutes');
SELECT app.forbid_hard_delete('org_minutes');
SELECT app.grant_mutable_table('org_minutes');


CREATE TABLE org_minute_recipients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  minute_id     uuid NOT NULL REFERENCES org_minutes (id),
  entity_id     uuid NOT NULL REFERENCES entities (id),
  user_id       uuid NOT NULL REFERENCES users (id),
  kind          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  CONSTRAINT org_minute_recipients_kind CHECK (kind IN ('TO', 'CC')),
  UNIQUE (minute_id, user_id, kind)
);

SELECT app.grant_append_only_table('org_minute_recipients');
SELECT app.forbid_hard_delete('org_minute_recipients');


CREATE TABLE org_minute_responses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number  text NOT NULL UNIQUE,
  minute_id         uuid NOT NULL REFERENCES org_minutes (id),
  entity_id         uuid NOT NULL REFERENCES entities (id),
  subject           text NOT NULL,
  body              text NOT NULL,
  outcome           text,
  status            text NOT NULL DEFAULT 'DRAFT',
  submitted_at      timestamptz,
  reviewed_at       timestamptz,
  review_note       text,
  idempotency_key   text UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text NOT NULL,
  row_version       integer NOT NULL DEFAULT 1,
  CONSTRAINT org_minute_responses_subject CHECK (btrim(subject) <> ''),
  CONSTRAINT org_minute_responses_body CHECK (btrim(body) <> ''),
  CONSTRAINT org_minute_responses_status CHECK (status IN (
    'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'FURTHER_ACTION_REQUIRED', 'ACCEPTED'
  ))
);

SELECT app.add_row_version_trigger('org_minute_responses');
SELECT app.forbid_hard_delete('org_minute_responses');
SELECT app.grant_mutable_table('org_minute_responses');


CREATE TABLE org_decisions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number  text NOT NULL UNIQUE,
  report_id         uuid NOT NULL REFERENCES org_reports (id),
  minute_id         uuid REFERENCES org_minutes (id),
  entity_id         uuid NOT NULL REFERENCES entities (id),
  subject           text NOT NULL,
  body              text NOT NULL,
  decided_at        timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  CONSTRAINT org_decisions_subject CHECK (btrim(subject) <> ''),
  CONSTRAINT org_decisions_body CHECK (btrim(body) <> '')
);

SELECT app.grant_append_only_table('org_decisions');
SELECT app.forbid_hard_delete('org_decisions');


CREATE TABLE org_external_correspondence (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id           uuid NOT NULL REFERENCES org_reports (id),
  entity_id           uuid NOT NULL REFERENCES entities (id),
  recipient_email     text NOT NULL,
  subject             text NOT NULL,
  body                text NOT NULL,
  sender_identity     text NOT NULL,
  document_revision_id uuid REFERENCES org_report_revisions (id),
  mail_outbox_id      uuid,
  provider_status     text NOT NULL DEFAULT 'queued',
  last_error          text,
  idempotency_key     text UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text NOT NULL,
  row_version         integer NOT NULL DEFAULT 1,
  CONSTRAINT org_external_correspondence_email CHECK (btrim(recipient_email) <> ''),
  CONSTRAINT org_external_correspondence_subject CHECK (btrim(subject) <> ''),
  CONSTRAINT org_external_correspondence_status CHECK (provider_status IN ('queued', 'submitted', 'failed'))
);

SELECT app.add_row_version_trigger('org_external_correspondence');
SELECT app.forbid_hard_delete('org_external_correspondence');
SELECT app.grant_mutable_table('org_external_correspondence');


CREATE OR REPLACE FUNCTION app.org_report_has_access(p_report_id uuid, p_kinds text[] DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM org_report_access a
     WHERE a.report_id = p_report_id
       AND a.user_id = app.current_actor_id()
       AND a.revoked_at IS NULL
       AND (p_kinds IS NULL OR a.kind = ANY (p_kinds))
  );
$$;

CREATE OR REPLACE FUNCTION app.org_minute_visible(p_minute_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM org_minutes m
     WHERE m.id = p_minute_id
       AND (
         m.created_by = app.current_actor_ref()
         OR m.issuer_user_id = app.current_actor_id()
         OR m.to_user_id = app.current_actor_id()
         OR EXISTS (
           SELECT 1 FROM org_minute_recipients r
            WHERE r.minute_id = m.id AND r.user_id = app.current_actor_id()
         )
       )
  );
$$;

CREATE OR REPLACE FUNCTION app.org_report_document_accessible(p_owner_type text, p_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_owner_type = 'org_report' THEN app.org_report_has_access(p_owner_id)
    WHEN p_owner_type = 'org_minute' THEN EXISTS (
      SELECT 1 FROM org_minutes m
       WHERE m.id = p_owner_id
         AND (app.org_minute_visible(m.id) OR app.org_report_has_access(m.source_report_id))
    )
    WHEN p_owner_type = 'org_response' THEN EXISTS (
      SELECT 1 FROM org_minute_responses s
      JOIN org_minutes m ON m.id = s.minute_id
       WHERE s.id = p_owner_id
         AND (app.org_minute_visible(m.id) OR app.org_report_has_access(m.source_report_id))
    )
    WHEN p_owner_type = 'org_decision' THEN EXISTS (
      SELECT 1 FROM org_decisions d
       WHERE d.id = p_owner_id AND app.org_report_has_access(d.report_id)
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION app.org_report_managing_director()
RETURNS TABLE (id uuid, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.name
    FROM users u
    JOIN user_role_assignments a ON a.user_id = u.id
    JOIN roles r ON r.id = a.role_id
   WHERE u.status = 'ACTIVE' AND r.key = 'md'
   ORDER BY u.name
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.org_report_directory()
RETURNS TABLE (id uuid, name text, job_title text, entity_code text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT u.id, u.name, u.position, e.code
    FROM users u
    JOIN user_role_assignments a ON a.user_id = u.id
    JOIN roles r ON r.id = a.role_id
    LEFT JOIN entities e ON e.id = a.entity_id
   WHERE u.status = 'ACTIVE'
     AND r.key <> 'administrator'
     AND (
       app.is_corporate_actor()
       OR a.scope_type = 'CORPORATE'
       OR a.entity_id = ANY (app.current_entity_ids())
     )
   ORDER BY u.name
$$;

REVOKE ALL ON FUNCTION app.org_report_has_access(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.org_minute_visible(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.org_report_document_accessible(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.org_report_managing_director() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.org_report_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.org_report_has_access(uuid, text[]) TO nfc_app;
GRANT EXECUTE ON FUNCTION app.org_minute_visible(uuid) TO nfc_app;
GRANT EXECUTE ON FUNCTION app.org_report_document_accessible(text, uuid) TO nfc_app;
GRANT EXECUTE ON FUNCTION app.org_report_managing_director() TO nfc_app;
GRANT EXECUTE ON FUNCTION app.org_report_directory() TO nfc_app;


ALTER TABLE org_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_reports_select ON org_reports
  FOR SELECT TO nfc_app
  USING (created_by = app.current_actor_ref() OR app.org_report_has_access(id));
CREATE POLICY org_reports_insert ON org_reports
  FOR INSERT TO nfc_app
  WITH CHECK (created_by = app.current_actor_ref());
CREATE POLICY org_reports_update ON org_reports
  FOR UPDATE TO nfc_app
  USING (
    created_by = app.current_actor_ref()
    OR app.org_report_has_access(id, ARRAY['OWNER', 'TO'])
  )
  WITH CHECK (
    created_by = app.current_actor_ref()
    OR app.org_report_has_access(id, ARRAY['OWNER', 'TO'])
  );

ALTER TABLE org_report_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_report_revisions_select ON org_report_revisions
  FOR SELECT TO nfc_app
  USING (created_by = app.current_actor_ref() OR app.org_report_has_access(report_id));
CREATE POLICY org_report_revisions_insert ON org_report_revisions
  FOR INSERT TO nfc_app
  WITH CHECK (
    created_by = app.current_actor_ref()
    AND (app.org_report_has_access(report_id, ARRAY['OWNER', 'TO']) OR created_by = app.current_actor_ref())
  );

ALTER TABLE org_report_forwards ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_report_forwards_select ON org_report_forwards
  FOR SELECT TO nfc_app
  USING (created_by = app.current_actor_ref() OR app.org_report_has_access(report_id));
CREATE POLICY org_report_forwards_insert ON org_report_forwards
  FOR INSERT TO nfc_app
  WITH CHECK (created_by = app.current_actor_ref() AND app.org_report_has_access(report_id, ARRAY['TO', 'OWNER']));

ALTER TABLE org_report_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_report_recipients_select ON org_report_recipients
  FOR SELECT TO nfc_app
  USING (user_id = app.current_actor_id() OR created_by = app.current_actor_ref() OR app.org_report_has_access(report_id));
CREATE POLICY org_report_recipients_insert ON org_report_recipients
  FOR INSERT TO nfc_app
  WITH CHECK (created_by = app.current_actor_ref());

ALTER TABLE org_report_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_report_access_select ON org_report_access
  FOR SELECT TO nfc_app
  USING (user_id = app.current_actor_id() OR created_by = app.current_actor_ref() OR app.org_report_has_access(report_id));
CREATE POLICY org_report_access_insert ON org_report_access
  FOR INSERT TO nfc_app
  WITH CHECK (created_by = app.current_actor_ref());
CREATE POLICY org_report_access_update ON org_report_access
  FOR UPDATE TO nfc_app
  USING (created_by = app.current_actor_ref() OR app.org_report_has_access(report_id, ARRAY['OWNER', 'TO']))
  WITH CHECK (created_by = app.current_actor_ref() OR app.org_report_has_access(report_id, ARRAY['OWNER', 'TO']));

ALTER TABLE org_minutes ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_minutes_select ON org_minutes
  FOR SELECT TO nfc_app
  USING (
    created_by = app.current_actor_ref()
    OR issuer_user_id = app.current_actor_id()
    OR to_user_id = app.current_actor_id()
    OR EXISTS (
      SELECT 1 FROM org_minute_recipients r
       WHERE r.minute_id = org_minutes.id AND r.user_id = app.current_actor_id()
    )
  );
CREATE POLICY org_minutes_insert ON org_minutes
  FOR INSERT TO nfc_app
  WITH CHECK (created_by = app.current_actor_ref());
CREATE POLICY org_minutes_update ON org_minutes
  FOR UPDATE TO nfc_app
  USING (
    created_by = app.current_actor_ref()
    OR issuer_user_id = app.current_actor_id()
    OR to_user_id = app.current_actor_id()
  )
  WITH CHECK (
    created_by = app.current_actor_ref()
    OR issuer_user_id = app.current_actor_id()
    OR to_user_id = app.current_actor_id()
  );

ALTER TABLE org_minute_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_minute_recipients_select ON org_minute_recipients
  FOR SELECT TO nfc_app
  USING (user_id = app.current_actor_id() OR app.org_minute_visible(minute_id));
CREATE POLICY org_minute_recipients_insert ON org_minute_recipients
  FOR INSERT TO nfc_app
  WITH CHECK (created_by = app.current_actor_ref());

ALTER TABLE org_minute_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_minute_responses_select ON org_minute_responses
  FOR SELECT TO nfc_app
  USING (created_by = app.current_actor_ref() OR app.org_minute_visible(minute_id));
CREATE POLICY org_minute_responses_insert ON org_minute_responses
  FOR INSERT TO nfc_app
  WITH CHECK (created_by = app.current_actor_ref() AND app.org_minute_visible(minute_id));
CREATE POLICY org_minute_responses_update ON org_minute_responses
  FOR UPDATE TO nfc_app
  USING (created_by = app.current_actor_ref() OR app.org_minute_visible(minute_id))
  WITH CHECK (created_by = app.current_actor_ref() OR app.org_minute_visible(minute_id));

ALTER TABLE org_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_decisions_select ON org_decisions
  FOR SELECT TO nfc_app
  USING (created_by = app.current_actor_ref() OR app.org_report_has_access(report_id));
CREATE POLICY org_decisions_insert ON org_decisions
  FOR INSERT TO nfc_app
  WITH CHECK (created_by = app.current_actor_ref() AND app.org_report_has_access(report_id, ARRAY['TO', 'OWNER']));

ALTER TABLE org_external_correspondence ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_external_correspondence_select ON org_external_correspondence
  FOR SELECT TO nfc_app
  USING (created_by = app.current_actor_ref() OR app.org_report_has_access(report_id, ARRAY['TO', 'OWNER']));
CREATE POLICY org_external_correspondence_insert ON org_external_correspondence
  FOR INSERT TO nfc_app
  WITH CHECK (created_by = app.current_actor_ref() AND app.org_report_has_access(report_id, ARRAY['TO', 'OWNER']));
CREATE POLICY org_external_correspondence_update ON org_external_correspondence
  FOR UPDATE TO nfc_app
  USING (created_by = app.current_actor_ref())
  WITH CHECK (created_by = app.current_actor_ref());


INSERT INTO permissions (key, description, created_by)
VALUES
  ('org_report.create', 'Create an official organisational report within granted scope.', 'system:seed'),
  ('org_report.submit', 'Submit an official organisational report to the Managing Director.', 'system:seed'),
  ('org_report.view', 'View official reports the actor is allowed to see.', 'system:seed'),
  ('org_report.forward', 'Forward an official report to additional authorised recipients.', 'system:seed'),
  ('org_report.minute.issue', 'Issue an official minute assigning work on a report.', 'system:seed'),
  ('org_report.minute.respond', 'Submit a response to an official minute assigned to the actor.', 'system:seed'),
  ('org_report.minute.review', 'Review responses to official minutes and complete or return them.', 'system:seed'),
  ('org_report.decide', 'Record a management decision linked to an official report.', 'system:seed'),
  ('org_report.email', 'Send a permitted official report to an external email address.', 'system:seed'),
  ('org_report.close', 'Close or archive an official report.', 'system:seed'),
  ('org_report.template.manage', 'Maintain official report templates. Does not grant document access.', 'system:seed')
ON CONFLICT (key) DO NOTHING;

SET session_replication_role = replica;
INSERT INTO role_permissions (role_id, permission_key, created_by)
SELECT r.id, p.permission_key, 'system:seed'
  FROM roles r
  CROSS JOIN (VALUES
    ('org_report.create'),
    ('org_report.submit'),
    ('org_report.view'),
    ('org_report.minute.respond')
  ) AS p(permission_key)
 WHERE r.key IN ('gm', 'ed_operations', 'md', 'ed_finance', 'finance_head', 'inventory_officer')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key, created_by)
SELECT r.id, p.permission_key, 'system:seed'
  FROM roles r
  CROSS JOIN (VALUES
    ('org_report.forward'),
    ('org_report.minute.issue'),
    ('org_report.minute.review'),
    ('org_report.decide'),
    ('org_report.email'),
    ('org_report.close')
  ) AS p(permission_key)
 WHERE r.key = 'md'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key, created_by)
SELECT r.id, 'org_report.template.manage', 'system:seed'
  FROM roles r
 WHERE r.key = 'administrator'
ON CONFLICT DO NOTHING;
SET session_replication_role = DEFAULT;


INSERT INTO org_report_templates (
  key, title, kind, required_permission, available, sort_order, acknowledgement_default, created_by, updated_by
) VALUES
  ('general', 'General Report', 'general', 'org_report.create', true, 10, false, 'system:seed', 'system:seed'),
  ('weekly_progress', 'Weekly Progress Report', 'general', 'org_report.create', true, 20, false, 'system:seed', 'system:seed'),
  ('performance', 'Performance Report', 'general', 'org_report.create', true, 30, false, 'system:seed', 'system:seed'),
  ('handover', 'Transitional / Handover Report', 'general', 'org_report.create', true, 40, false, 'system:seed', 'system:seed'),
  ('operational', 'Operational Update', 'general', 'org_report.create', true, 50, false, 'system:seed', 'system:seed'),
  ('observation', 'General Observation', 'general', 'org_report.create', true, 60, false, 'system:seed', 'system:seed'),
  ('issue_attention', 'Issue Requiring Management Attention', 'general', 'org_report.create', true, 70, false, 'system:seed', 'system:seed'),
  ('financial', 'Financial Report', 'specialist', 'finance.view', true, 80, false, 'system:seed', 'system:seed'),
  ('inventory', 'Inventory Report', 'specialist', 'inventory.view', true, 90, false, 'system:seed', 'system:seed'),
  ('procurement', 'Procurement Report', 'specialist', 'procurement.view', true, 100, false, 'system:seed', 'system:seed'),
  ('hr_staff', 'HR / Staff Report', 'specialist', 'hr.salary.view', false, 110, false, 'system:seed', 'system:seed'),
  ('payroll', 'Payroll Report', 'specialist', 'hr.salary.view', false, 120, false, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;


INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('org_report.submitted', 'notify.generic', 'system:seed'),
  ('org_report.forwarded', 'notify.generic', 'system:seed'),
  ('org_report.minute.issued', 'notify.generic', 'system:seed'),
  ('org_report.minute.due', 'notify.generic', 'system:seed'),
  ('org_report.response.submitted', 'notify.generic', 'system:seed'),
  ('org_report.response.returned', 'notify.generic', 'system:seed'),
  ('org_report.minute.completed', 'notify.generic', 'system:seed'),
  ('org_report.decision.recorded', 'notify.generic', 'system:seed'),
  ('org_report.email.completed', 'notify.generic', 'system:seed'),
  ('org_report.email.failed', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  (
    'org_report.submitted',
    'action_required',
    'Official report {reference} submitted',
    'An official report {reference} ({title}) has been submitted to the Managing Director.',
    true,
    true,
    'system:seed'
  ),
  (
    'org_report.forwarded',
    'information',
    'Official report {reference} forwarded',
    'An official report {reference} ({title}) has been forwarded to you for information.',
    true,
    false,
    'system:seed'
  ),
  (
    'org_report.minute.issued',
    'action_required',
    'Official minute {reference} issued',
    'An official minute {reference} ({title}) has been issued and requires your attention.',
    true,
    true,
    'system:seed'
  ),
  (
    'org_report.minute.due',
    'action_required',
    'Reminder: official minute {reference} is due',
    'Official minute {reference} ({title}) is approaching or past its due date.',
    true,
    true,
    'system:seed'
  ),
  (
    'org_report.response.submitted',
    'action_required',
    'Response submitted on {reference}',
    'A response has been submitted on official minute {reference} ({title}).',
    true,
    true,
    'system:seed'
  ),
  (
    'org_report.response.returned',
    'action_required',
    'Further action required on {reference}',
    'Further action has been requested on official minute {reference} ({title}).',
    true,
    true,
    'system:seed'
  ),
  (
    'org_report.minute.completed',
    'information',
    'Official minute {reference} completed',
    'Official minute {reference} ({title}) has been completed.',
    true,
    false,
    'system:seed'
  ),
  (
    'org_report.decision.recorded',
    'information',
    'Management decision {reference} recorded',
    'A management decision {reference} ({title}) has been recorded.',
    true,
    false,
    'system:seed'
  ),
  (
    'org_report.email.completed',
    'information',
    'External correspondence {reference} submitted',
    'External correspondence for {reference} ({title}) was submitted to the mail provider.',
    true,
    false,
    'system:seed'
  ),
  (
    'org_report.email.failed',
    'action_required',
    'External correspondence {reference} failed',
    'External correspondence for {reference} ({title}) could not be sent.',
    true,
    true,
    'system:seed'
  )
ON CONFLICT (type) DO NOTHING;
