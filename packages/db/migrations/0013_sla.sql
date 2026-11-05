-- ---------------------------------------------------------------------------
-- 0013_sla
--
-- Generic SLA timers on anything "pending with a person". Thresholds are
-- configuration (rule R13), not constants in application code.
-- ---------------------------------------------------------------------------

CREATE TABLE sla_thresholds (
  days         integer PRIMARY KEY CHECK (days > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL
);

GRANT SELECT ON sla_thresholds TO nfc_app;

ALTER TABLE sla_thresholds ENABLE ROW LEVEL SECURITY;
CREATE POLICY sla_thresholds_select ON sla_thresholds
  FOR SELECT TO nfc_app
  USING (true);

INSERT INTO sla_thresholds (days, created_by) VALUES
  (2, 'system:seed'),
  (5, 'system:seed'),
  (7, 'system:seed')
ON CONFLICT DO NOTHING;


CREATE TABLE workflow_holds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type       text NOT NULL,
  subject_id         uuid NOT NULL,
  reference_number   text NOT NULL,
  title              text NOT NULL,
  holder_user_id     uuid NOT NULL REFERENCES users (id),
  entity_id          uuid NOT NULL REFERENCES entities (id),
  pending_since      timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cleared')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text NOT NULL,
  row_version        integer NOT NULL DEFAULT 1
);

SELECT app.apply_mutable_conventions('workflow_holds', 'entity_id');

CREATE INDEX workflow_holds_open_idx ON workflow_holds (status, pending_since)
  WHERE status = 'open';


CREATE TABLE workflow_reminders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id         uuid NOT NULL REFERENCES workflow_holds (id),
  threshold_days  integer NOT NULL REFERENCES sla_thresholds (days),
  sent_at         timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  UNIQUE (hold_id, threshold_days)
);

SELECT app.apply_append_only_conventions('workflow_reminders');

ALTER TABLE workflow_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflow_reminders_select ON workflow_reminders
  FOR SELECT TO nfc_app
  USING (true);
CREATE POLICY workflow_reminders_insert ON workflow_reminders
  FOR INSERT TO nfc_app
  WITH CHECK (true);
