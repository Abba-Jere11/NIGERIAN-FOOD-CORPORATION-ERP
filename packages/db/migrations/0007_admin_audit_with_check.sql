-- ---------------------------------------------------------------------------
-- 0007_admin_audit_with_check
--
-- A separate INSERT policy was not enough: PostgreSQL still required the
-- existing FOR ALL WITH CHECK to pass. Fold Administrator identity-audit
-- writes into that policy's WITH CHECK. SELECT (USING) stays corporate/entity
-- only, so the Administrator still cannot read the business log.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS audit_log_admin_identity_write ON audit_log;
DROP POLICY IF EXISTS audit_log_entity_scope ON audit_log;

CREATE POLICY audit_log_entity_scope ON audit_log
  FOR ALL TO nfc_app
  USING (
    CASE
      WHEN entity_id IS NULL THEN app.is_corporate_actor()
      ELSE app.can_access_entity(entity_id)
    END
  )
  WITH CHECK (
    CASE
      WHEN app.is_admin_actor()
           AND action IN ('permission_change'::audit_action, 'account_change'::audit_action)
      THEN true
      WHEN entity_id IS NULL THEN app.is_corporate_actor()
      ELSE app.can_access_entity(entity_id)
    END
  );
