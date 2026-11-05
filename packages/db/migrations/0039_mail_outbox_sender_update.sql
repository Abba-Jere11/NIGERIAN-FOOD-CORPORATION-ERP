-- ---------------------------------------------------------------------------
-- 0039_mail_outbox_sender_update
--
-- MD report share marks a queued row sent|failed after SMTP. Jobs still use
-- the system:outbox admin actor; the sender must be able to update their row.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS mail_outbox_update ON mail_outbox;

CREATE POLICY mail_outbox_update ON mail_outbox
  FOR UPDATE TO nfc_app
  USING (app.is_admin_actor() OR created_by = app.current_actor_ref())
  WITH CHECK (app.is_admin_actor() OR created_by = app.current_actor_ref());
