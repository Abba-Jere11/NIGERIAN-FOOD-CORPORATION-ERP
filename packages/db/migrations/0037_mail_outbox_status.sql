-- ---------------------------------------------------------------------------
-- 0037_mail_outbox_status
--
-- Report email (and other queued mail) needs queued|sent|failed. The outbox
-- stays undeletable; status may move.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS mail_outbox_forbid_update ON mail_outbox;

ALTER TABLE mail_outbox
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

ALTER TABLE mail_outbox DROP CONSTRAINT IF EXISTS mail_outbox_status;
ALTER TABLE mail_outbox
  ADD CONSTRAINT mail_outbox_status CHECK (status IN ('queued', 'sent', 'failed'));

GRANT UPDATE ON mail_outbox TO nfc_app;

CREATE POLICY mail_outbox_select_own ON mail_outbox
  FOR SELECT TO nfc_app
  USING (created_by = app.current_actor_ref());

CREATE POLICY mail_outbox_update ON mail_outbox
  FOR UPDATE TO nfc_app
  USING (app.is_admin_actor())
  WITH CHECK (app.is_admin_actor());
