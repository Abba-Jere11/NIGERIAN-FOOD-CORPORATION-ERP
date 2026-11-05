-- ---------------------------------------------------------------------------
-- 0016_seals
--
-- Cryptographic seals (M4B). Append-only. No user can edit, remove or
-- regenerate a seal. Voiding a subject leaves these rows; a superseding
-- record is added instead.
-- ---------------------------------------------------------------------------

CREATE TABLE seals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number text NOT NULL UNIQUE,
  approver_id      uuid NOT NULL REFERENCES users (id),
  approver_role    text,
  entity_id        uuid NOT NULL REFERENCES entities (id),
  subject_type     text NOT NULL,
  subject_id       uuid NOT NULL,
  subject_version  integer NOT NULL,
  snapshot_hash    text NOT NULL,
  action           text NOT NULL,
  reason           text,
  payment_ref      text,
  kid              text NOT NULL,
  signature        text NOT NULL,
  signed_at        text NOT NULL,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  CONSTRAINT seals_action CHECK (action IN ('submitted', 'approved', 'rejected', 'returned', 'paid', 'verified')),
  CONSTRAINT seals_subject_version_positive CHECK (subject_version >= 1),
  CONSTRAINT seals_snapshot_hash_hex CHECK (snapshot_hash ~ '^[0-9a-f]{64}$')
);

SELECT app.apply_append_only_conventions('seals', 'entity_id');
SELECT app.protect_reference_number('seals');

CREATE INDEX seals_subject_idx ON seals (subject_type, subject_id, subject_version, occurred_at);
