-- ---------------------------------------------------------------------------
-- 0011_domain_events
--
-- Transactional outbox. The event row is inserted in the same transaction as
-- the business change. A trigger fans out one delivery row per subscription.
-- ---------------------------------------------------------------------------

CREATE TABLE domain_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  event_type    text NOT NULL,
  subject_type  text NOT NULL,
  subject_id    uuid,
  entity_id     uuid REFERENCES entities (id),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    text NOT NULL
);

SELECT app.apply_append_only_conventions('domain_events', 'entity_id');

CREATE INDEX domain_events_subject_idx ON domain_events (subject_type, subject_id, occurred_at);
CREATE INDEX domain_events_type_idx ON domain_events (event_type, occurred_at);


CREATE TABLE event_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   text NOT NULL,
  handler_key  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL,
  UNIQUE (event_type, handler_key)
);

GRANT SELECT, INSERT ON event_subscriptions TO nfc_app;

ALTER TABLE event_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_subscriptions_read ON event_subscriptions
  FOR SELECT TO nfc_app
  USING (true);
CREATE POLICY event_subscriptions_insert ON event_subscriptions
  FOR INSERT TO nfc_app
  WITH CHECK (true);


CREATE TABLE event_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL REFERENCES domain_events (id),
  handler_key      text NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'delivered', 'dead')),
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  processed_at     timestamptz,
  UNIQUE (event_id, handler_key)
);

GRANT SELECT, INSERT, UPDATE ON event_deliveries TO nfc_app;

ALTER TABLE event_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_deliveries_select ON event_deliveries
  FOR SELECT TO nfc_app
  USING (true);
CREATE POLICY event_deliveries_insert ON event_deliveries
  FOR INSERT TO nfc_app
  WITH CHECK (true);
CREATE POLICY event_deliveries_update ON event_deliveries
  FOR UPDATE TO nfc_app
  USING (true)
  WITH CHECK (true);

CREATE INDEX event_deliveries_due_idx ON event_deliveries (status, next_attempt_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION app.list_dead_letters(p_limit integer DEFAULT 50)
RETURNS TABLE (
  delivery_id uuid,
  event_type text,
  handler_key text,
  last_error text,
  attempts integer,
  processed_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, app AS $$
  SELECT d.id, e.event_type, d.handler_key, d.last_error, d.attempts, d.processed_at
    FROM event_deliveries d
    JOIN domain_events e ON e.id = d.event_id
   WHERE d.status = 'dead'
   ORDER BY d.processed_at DESC NULLS LAST
   LIMIT p_limit
$$;

GRANT EXECUTE ON FUNCTION app.list_dead_letters(integer) TO nfc_app;


CREATE OR REPLACE FUNCTION app.fanout_event_deliveries() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO event_deliveries (event_id, handler_key)
  SELECT NEW.id, s.handler_key
    FROM event_subscriptions s
   WHERE s.event_type = NEW.event_type
  ON CONFLICT (event_id, handler_key) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER domain_events_fanout
  AFTER INSERT ON domain_events
  FOR EACH ROW
  EXECUTE FUNCTION app.fanout_event_deliveries();


-- Registry so later modules subscribe without a migration of handler code.
-- test.fail is not subscribed by default; tests insert it when they need it.
INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('engine.record.created', 'test.echo', 'system:seed'),
  ('engine.record.created', 'notify.generic', 'system:seed'),
  ('workflow.reminder', 'notify.generic', 'system:seed'),
  ('procurement.submitted', 'finance.placeholder', 'system:seed'),
  ('goods.received', 'inventory.placeholder', 'system:seed'),
  ('procurement.completed', 'edms.placeholder', 'system:seed'),
  ('hr.payroll.ready', 'payroll.placeholder', 'system:seed')
ON CONFLICT DO NOTHING;
