-- ---------------------------------------------------------------------------
-- 0003_audit_log
--
-- The audit engine core (M1 item 5).
--
-- Every mutation anywhere in the system writes one row here, in the same
-- transaction as the change itself. The table is append-only at the database
-- level (rule R2) and the application role holds no UPDATE or DELETE privilege
-- on it, so history cannot be rewritten by any code path.
--
-- Note on conventions: append-only history tables do not carry the mutable
-- standard columns (updated_at, updated_by, row_version). `occurred_at` is the
-- creation timestamp and the actor columns are the creator.
-- ---------------------------------------------------------------------------

CREATE TYPE scope_type AS ENUM ('CORPORATE', 'ENTITY');

-- The five roles from A5. No others exist anywhere in the system.
CREATE TYPE role_key AS ENUM ('gm', 'ed_operations', 'md', 'ed_finance', 'finance_head');

-- The audit action vocabulary, verbatim from the plan.
CREATE TYPE audit_action AS ENUM (
  'login',
  'logout',
  'create',
  'edit',
  'approve',
  'reject',
  'return',
  'archive',
  'upload',
  'download',
  'payment',
  'transfer',
  'inventory_adjustment',
  'employee_change',
  'payroll_change',
  'permission_change',
  'account_change',
  'document_access',
  'document_share',
  'system_configuration_change'
);

CREATE TABLE audit_log (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- When, always stored in UTC.
  occurred_at              timestamptz NOT NULL DEFAULT now(),

  -- Who: either a user, or a named system actor. Never anonymous (rule R1).
  actor_user_id            uuid,
  actor_system_name        text,
  actor_ref                text GENERATED ALWAYS AS
                             (COALESCE(actor_user_id::text, actor_system_name)) STORED,
  actor_name               text,

  -- The role and entity scope the actor held at the time of the action, kept
  -- here so a later role change cannot rewrite the meaning of past entries.
  actor_role               role_key,
  actor_scope_type         scope_type,
  actor_scope_entity_ids   uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],

  -- What happened.
  action                   audit_action NOT NULL,
  subject_type             text NOT NULL,
  subject_id               uuid,
  subject_label            text,
  -- Populated from M3 onwards, once the Reference-Number Engine exists.
  subject_reference_number text,

  -- Where it happened.
  entity_id                uuid REFERENCES entities (id),

  -- The change itself, as a field-level diff.
  old_value                jsonb,
  new_value                jsonb,

  -- Why. Mandatory for the actions listed in rule R11, enforced below.
  reason                   text,

  -- Request provenance.
  ip_address               inet,
  user_agent               text,
  session_id               text,
  request_id               text,

  CONSTRAINT audit_log_actor_exactly_one
    CHECK (num_nonnulls(actor_user_id, actor_system_name) = 1),

  -- Background and bootstrap processes act as a named system actor (rule R1).
  CONSTRAINT audit_log_system_actor_registered
    CHECK (actor_system_name IS NULL
           OR actor_system_name IN ('system:seed', 'system:escalation', 'system:outbox')),

  -- A user actor always has a role and scope recorded; a system actor has neither.
  CONSTRAINT audit_log_user_actor_has_role
    CHECK ((actor_user_id IS NULL) OR (actor_role IS NOT NULL AND actor_scope_type IS NOT NULL)),

  CONSTRAINT audit_log_subject_type_not_blank CHECK (btrim(subject_type) <> ''),

  -- Rule R11: these actions are meaningless without a stored explanation.
  CONSTRAINT audit_log_reason_required
    CHECK (
      action NOT IN ('reject', 'return', 'archive')
      OR (reason IS NOT NULL AND btrim(reason) <> '')
    )
);

COMMENT ON TABLE audit_log IS
  'Append-only record of every action in the system (M1 item 5). Never updated, never deleted.';
COMMENT ON COLUMN audit_log.subject_reference_number IS
  'Permanent reference such as PR-2026-000184. Populated from M3, when the Reference-Number Engine exists.';
COMMENT ON COLUMN audit_log.actor_scope_entity_ids IS
  'The entities the actor could reach at the time of the action.';

CREATE INDEX audit_log_occurred_at_idx ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_actor_ref_idx ON audit_log (actor_ref, occurred_at DESC);
CREATE INDEX audit_log_action_idx ON audit_log (action, occurred_at DESC);
CREATE INDEX audit_log_subject_idx ON audit_log (subject_type, subject_id);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_id, occurred_at DESC);
CREATE INDEX audit_log_request_id_idx ON audit_log (request_id);
CREATE INDEX audit_log_reference_idx ON audit_log (subject_reference_number)
  WHERE subject_reference_number IS NOT NULL;

-- Rule R2 plus rule R5: append-only, and scoped by entity.
SELECT app.apply_append_only_conventions('audit_log', 'entity_id');
