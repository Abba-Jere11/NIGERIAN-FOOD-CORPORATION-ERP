-- ---------------------------------------------------------------------------
-- 0050_search_backfill
-- Idempotent search_index backfill for rows missing index entries (M19).
-- ---------------------------------------------------------------------------

CREATE POLICY procurement_requests_admin_health_select ON procurement_requests
  FOR SELECT TO nfc_app
  USING (app.has_permission('admin.health.view'));

CREATE POLICY procurement_memo_snapshots_admin_health_select ON procurement_memo_snapshots
  FOR SELECT TO nfc_app
  USING (app.has_permission('admin.health.view'));

CREATE POLICY document_access_log_admin_health_select ON document_access_log
  FOR SELECT TO nfc_app
  USING (app.has_permission('admin.health.view'));

INSERT INTO search_index (record_type, record_id, reference_number, title, searchable_text, entity_id, permission_key, updated_at)
SELECT 'PROCUREMENT', r.id, r.reference_number, v.title,
       coalesce(r.reference_number, '') || ' ' || coalesce(v.title, '') || ' ' || coalesce(e.code, ''),
       r.entity_id, 'procurement.view', now()
  FROM procurement_requests r
  JOIN procurement_versions v ON v.request_id = r.id AND v.version_number = r.current_version
  JOIN entities e ON e.id = r.entity_id
 WHERE NOT EXISTS (
   SELECT 1 FROM search_index si WHERE si.record_type = 'PROCUREMENT' AND si.record_id = r.id
 )
ON CONFLICT (record_type, record_id) DO NOTHING;

INSERT INTO search_index (record_type, record_id, reference_number, title, searchable_text, entity_id, permission_key, updated_at)
SELECT 'REQUISITION', q.id, q.reference_number, v.title,
       coalesce(q.reference_number, '') || ' ' || coalesce(v.title, '') || ' ' || coalesce(e.code, ''),
       q.entity_id, 'requisition.create', now()
  FROM requisitions q
  JOIN requisition_versions v ON v.requisition_id = q.id AND v.version_number = q.current_version
  JOIN entities e ON e.id = q.entity_id
 WHERE q.status NOT IN ('DISCARDED')
   AND NOT EXISTS (
   SELECT 1 FROM search_index si WHERE si.record_type = 'REQUISITION' AND si.record_id = q.id
 )
ON CONFLICT (record_type, record_id) DO NOTHING;

INSERT INTO search_index (record_type, record_id, reference_number, title, searchable_text, entity_id, permission_key, updated_at)
SELECT 'VENDOR', v.id, v.reference_number, v.legal_name,
       coalesce(v.reference_number, '') || ' ' || coalesce(v.legal_name, ''),
       v.entity_id, 'vendor.view', now()
  FROM vendors v
 WHERE NOT EXISTS (
   SELECT 1 FROM search_index si WHERE si.record_type = 'VENDOR' AND si.record_id = v.id
 )
ON CONFLICT (record_type, record_id) DO NOTHING;

INSERT INTO search_index (record_type, record_id, reference_number, title, searchable_text, entity_id, permission_key, updated_at)
SELECT 'DOCUMENT', d.id, d.reference_number, d.title,
       coalesce(d.reference_number, '') || ' ' || coalesce(d.title, ''),
       d.entity_id, 'document.view', now()
  FROM documents d
 WHERE d.status = 'ACTIVE'
   AND NOT EXISTS (
   SELECT 1 FROM search_index si WHERE si.record_type = 'DOCUMENT' AND si.record_id = d.id
 )
ON CONFLICT (record_type, record_id) DO NOTHING;

INSERT INTO search_index (record_type, record_id, reference_number, title, searchable_text, entity_id, permission_key, updated_at)
SELECT 'EMPLOYEE', emp.id, emp.reference_number, trim(emp.first_name || ' ' || emp.last_name),
       coalesce(emp.reference_number, '') || ' ' || coalesce(trim(emp.first_name || ' ' || emp.last_name), ''),
       emp.entity_id, 'hr.employee.view', now()
  FROM hr_employees emp
 WHERE emp.status NOT IN ('TERMINATED', 'RESIGNED')
   AND NOT EXISTS (
   SELECT 1 FROM search_index si WHERE si.record_type = 'EMPLOYEE' AND si.record_id = emp.id
 )
ON CONFLICT (record_type, record_id) DO NOTHING;

INSERT INTO search_index (record_type, record_id, reference_number, title, searchable_text, entity_id, permission_key, updated_at)
SELECT 'JOURNAL', j.id, j.reference_number, j.narration,
       coalesce(j.reference_number, '') || ' ' || coalesce(j.narration, ''),
       j.entity_id, 'finance.view', now()
  FROM journals j
 WHERE j.status IN ('POSTED', 'PENDING_APPROVAL')
   AND NOT EXISTS (
   SELECT 1 FROM search_index si WHERE si.record_type = 'JOURNAL' AND si.record_id = j.id
 )
ON CONFLICT (record_type, record_id) DO NOTHING;
