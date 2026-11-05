-- ---------------------------------------------------------------------------
-- 0017_workflows
--
-- Central Approval Engine (M4C). Definitions are data. The engine never
-- branches on a role name — stages name a permission key.
-- ---------------------------------------------------------------------------

CREATE TABLE workflow_definitions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  name        text NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT workflow_definitions_version_positive CHECK (version >= 1)
);

SELECT app.apply_mutable_conventions('workflow_definitions');


CREATE TABLE workflow_stages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id        uuid NOT NULL REFERENCES workflow_definitions (id),
  sort_order           integer NOT NULL,
  key                  text NOT NULL,
  label                text NOT NULL,
  required_permission  text,
  scope_resolver       text NOT NULL,
  allowed_actions      text[] NOT NULL DEFAULT ARRAY[]::text[],
  sla_days             integer,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text NOT NULL,
  CONSTRAINT workflow_stages_scope CHECK (scope_resolver IN ('SAME_ENTITY', 'CORPORATE', 'ALL')),
  CONSTRAINT workflow_stages_order_positive CHECK (sort_order >= 1),
  UNIQUE (definition_id, key),
  UNIQUE (definition_id, sort_order)
);

GRANT SELECT, INSERT, UPDATE ON workflow_stages TO nfc_app;
SELECT app.forbid_hard_delete('workflow_stages');


CREATE TABLE workflow_instances (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id           uuid NOT NULL REFERENCES workflow_definitions (id),
  subject_type            text NOT NULL,
  subject_id              uuid NOT NULL,
  subject_version         integer NOT NULL,
  entity_id               uuid NOT NULL REFERENCES entities (id),
  originator_user_id      uuid NOT NULL REFERENCES users (id),
  current_stage_id        uuid REFERENCES workflow_stages (id),
  status                  text NOT NULL,
  archived_from_stage_id  uuid REFERENCES workflow_stages (id),
  money_moved             boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              text NOT NULL,
  row_version             integer NOT NULL DEFAULT 1,
  CONSTRAINT workflow_instances_status CHECK (
    status IN ('IN_PROGRESS', 'DRAFT', 'REJECTED', 'ARCHIVED', 'COMPLETED')
  ),
  CONSTRAINT workflow_instances_version_positive CHECK (subject_version >= 1)
);

SELECT app.apply_mutable_conventions('workflow_instances', 'entity_id');

CREATE UNIQUE INDEX workflow_instances_open_subject_key
  ON workflow_instances (subject_type, subject_id)
  WHERE status IN ('IN_PROGRESS', 'DRAFT');

CREATE INDEX workflow_instances_pending_idx
  ON workflow_instances (status, current_stage_id);


CREATE TABLE workflow_actions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id        uuid NOT NULL REFERENCES workflow_instances (id),
  stage_id           uuid NOT NULL REFERENCES workflow_stages (id),
  entity_id          uuid NOT NULL REFERENCES entities (id),
  action             text NOT NULL,
  actor_id           uuid NOT NULL REFERENCES users (id),
  actor_permission   text,
  reason             text,
  previous_status    text NOT NULL,
  new_status         text NOT NULL,
  subject_version    integer NOT NULL,
  snapshot_hash      text NOT NULL,
  idempotency_key    text NOT NULL UNIQUE,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  created_by         text NOT NULL,
  CONSTRAINT workflow_actions_action CHECK (
    action IN ('APPROVE', 'REJECT', 'RETURN_FOR_CORRECTION', 'ARCHIVE', 'RESTORE')
  )
);

SELECT app.apply_append_only_conventions('workflow_actions', 'entity_id');

CREATE INDEX workflow_actions_instance_idx ON workflow_actions (instance_id, occurred_at);


CREATE TABLE workflow_demo_subjects (
  id                 uuid PRIMARY KEY,
  reference_number   text NOT NULL UNIQUE,
  entity_id          uuid NOT NULL REFERENCES entities (id),
  originator_user_id uuid NOT NULL REFERENCES users (id),
  title              text NOT NULL,
  current_version    integer NOT NULL DEFAULT 1,
  snapshot           jsonb NOT NULL,
  status             text NOT NULL DEFAULT 'DRAFT',
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text NOT NULL,
  row_version        integer NOT NULL DEFAULT 1,
  CONSTRAINT workflow_demo_subjects_version_positive CHECK (current_version >= 1)
);

SELECT app.apply_mutable_conventions('workflow_demo_subjects', 'entity_id');
SELECT app.protect_reference_number('workflow_demo_subjects');


CREATE TABLE workflow_demo_subject_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id  uuid NOT NULL REFERENCES workflow_demo_subjects (id),
  entity_id   uuid NOT NULL REFERENCES entities (id),
  version     integer NOT NULL,
  snapshot    jsonb NOT NULL,
  frozen_at   timestamptz,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_id, version)
);

SELECT app.apply_append_only_conventions('workflow_demo_subject_versions', 'entity_id');


CREATE TABLE demo_commitment_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id  uuid NOT NULL REFERENCES workflow_demo_subjects (id),
  entity_id   uuid NOT NULL REFERENCES entities (id),
  action      text NOT NULL,
  amount_kobo bigint NOT NULL DEFAULT 0,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demo_commitment_events_action CHECK (action IN ('OPEN', 'RELEASE'))
);

SELECT app.apply_append_only_conventions('demo_commitment_events', 'entity_id');


ALTER TABLE workflow_holds
  ADD COLUMN IF NOT EXISTS workflow_instance_id uuid REFERENCES workflow_instances (id);

CREATE INDEX IF NOT EXISTS workflow_holds_instance_idx
  ON workflow_holds (workflow_instance_id)
  WHERE workflow_instance_id IS NOT NULL;


CREATE OR REPLACE FUNCTION app.users_holding_permission(
  p_key text,
  p_entity_id uuid,
  p_scope text
)
RETURNS TABLE (user_id uuid, user_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT DISTINCT u.id, u.name
    FROM users u
    JOIN user_role_assignments a ON a.user_id = u.id AND a.status = 'ACTIVE'
    JOIN role_permissions rp ON rp.role_id = a.role_id AND rp.permission_key = p_key
   WHERE u.status = 'ACTIVE'
     AND (
       (p_scope = 'ALL' AND (a.scope_type = 'CORPORATE' OR a.entity_id = p_entity_id))
       OR (p_scope = 'SAME_ENTITY' AND a.scope_type = 'ENTITY' AND a.entity_id = p_entity_id)
       OR (p_scope = 'CORPORATE' AND a.scope_type = 'CORPORATE')
     )
$$;

GRANT EXECUTE ON FUNCTION app.users_holding_permission(text, uuid, text) TO nfc_app;


-- procurement-v1 (worked example) and dummy-v1 (generic suite).
INSERT INTO workflow_definitions (key, name, version, created_by, updated_by)
VALUES
  ('procurement-v1', 'Procurement approval chain', 1, 'system:seed', 'system:seed'),
  ('dummy-v1', 'Dummy three-stage approval', 1, 'system:seed', 'system:seed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO workflow_stages (
  definition_id, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days, created_by
)
SELECT d.id, s.sort_order, s.key, s.label, s.required_permission, s.scope_resolver, s.allowed_actions, s.sla_days, 'system:seed'
  FROM workflow_definitions d
  JOIN (VALUES
    ('procurement-v1', 1, 'gm-submission', 'GM submission', NULL, 'SAME_ENTITY', ARRAY[]::text[], NULL),
    ('procurement-v1', 2, 'ed-operations', 'ED Operations', 'procurement.approve.operations', 'ALL',
      ARRAY['APPROVE', 'REJECT', 'RETURN_FOR_CORRECTION', 'ARCHIVE'], 2),
    ('procurement-v1', 3, 'md', 'Managing Director', 'procurement.approve.final', 'ALL',
      ARRAY['APPROVE', 'REJECT', 'RETURN_FOR_CORRECTION', 'ARCHIVE'], 2),
    ('procurement-v1', 4, 'ed-finance', 'ED Finance', 'procurement.review.finance', 'ALL',
      ARRAY['APPROVE', 'REJECT', 'RETURN_FOR_CORRECTION', 'ARCHIVE'], 2),
    ('procurement-v1', 5, 'finance-head', 'Finance Head', 'finance.payment.execute', 'SAME_ENTITY',
      ARRAY['APPROVE', 'REJECT', 'RETURN_FOR_CORRECTION', 'ARCHIVE'], 2),
    ('dummy-v1', 1, 'reviewer-a', 'Reviewer A', 'procurement.approve.operations', 'ALL',
      ARRAY['APPROVE', 'REJECT', 'RETURN_FOR_CORRECTION', 'ARCHIVE'], 2),
    ('dummy-v1', 2, 'reviewer-b', 'Reviewer B', 'procurement.approve.final', 'ALL',
      ARRAY['APPROVE', 'REJECT', 'RETURN_FOR_CORRECTION', 'ARCHIVE'], 2),
    ('dummy-v1', 3, 'reviewer-c', 'Reviewer C', 'procurement.review.finance', 'ALL',
      ARRAY['APPROVE', 'REJECT', 'RETURN_FOR_CORRECTION', 'ARCHIVE'], 2)
  ) AS s(def_key, sort_order, key, label, required_permission, scope_resolver, allowed_actions, sla_days)
    ON s.def_key = d.key
ON CONFLICT (definition_id, key) DO NOTHING;


INSERT INTO event_subscriptions (event_type, handler_key, created_by) VALUES
  ('procurement.approved', 'notify.generic', 'system:seed'),
  ('procurement.rejected', 'notify.generic', 'system:seed'),
  ('procurement.returned', 'notify.generic', 'system:seed'),
  ('procurement.archived', 'notify.generic', 'system:seed'),
  ('document.uploaded', 'notify.generic', 'system:seed'),
  ('seal.tampered', 'notify.generic', 'system:seed')
ON CONFLICT DO NOTHING;

INSERT INTO notification_types (type, category, title_template, body_template, email_enabled, mandatory, created_by)
VALUES
  (
    'procurement.rejected',
    'action_required',
    'Procurement {reference} rejected',
    '{title} {reference} was rejected. Reason: {reason}',
    true,
    true,
    'system:seed'
  ),
  (
    'procurement.returned',
    'action_required',
    'Procurement {reference} returned',
    '{title} {reference} was returned for correction. Reason: {reason}',
    true,
    true,
    'system:seed'
  ),
  (
    'procurement.archived',
    'action_required',
    'Procurement {reference} archived',
    '{title} {reference} was archived. Reason: {reason}',
    true,
    true,
    'system:seed'
  ),
  (
    'document.uploaded',
    'engine',
    'Document {reference} uploaded',
    'A document {reference} ({title}) was stored.',
    true,
    false,
    'system:seed'
  ),
  (
    'seal.tampered',
    'action_required',
    'Seal verification failed on {reference}',
    'A seal on {title} {reference} failed verification.',
    true,
    true,
    'system:seed'
  )
ON CONFLICT (type) DO NOTHING;
