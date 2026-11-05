-- ---------------------------------------------------------------------------
-- 0006_admin_identity_audit
--
-- The Administrator is not corporate, so the tightened audit_log policy blocks
-- their INSERT of account_change / permission_change rows. They still must not
-- SELECT business audit rows; reading those actions goes through
-- app.admin_permission_changes (SECURITY DEFINER).
-- ---------------------------------------------------------------------------

CREATE POLICY audit_log_admin_identity_write ON audit_log
  FOR INSERT TO nfc_app
  WITH CHECK (
    app.is_admin_actor()
    AND action IN ('permission_change', 'account_change')
  );

COMMENT ON POLICY audit_log_admin_identity_write ON audit_log IS
  'Administrator may record account and grant changes. They still cannot read the business audit log.';
