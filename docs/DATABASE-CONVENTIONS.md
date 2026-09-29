# Database conventions

These conventions are installed by `packages/db/migrations/0001_conventions.sql` and apply to every
table added in any later milestone. They exist so that the guarantees in the build plan hold at the
database level, not merely in application code.

## Source of truth

Hand-written SQL under `packages/db/migrations/` is authoritative. Drizzle definitions in
`packages/db/src/schema.ts` mirror it for the query layer. Triggers, Row-Level Security policies and
privilege grants cannot be expressed in the ORM, and those are precisely the mechanisms the plan
depends on, so the SQL leads and the TypeScript follows.

An integration test compares the PostgreSQL enum labels against both the Drizzle schema and the
shared TypeScript constants, so the three cannot drift apart unnoticed.

Applied migrations are immutable. The runner records a SHA-256 checksum of each file and refuses to
proceed if an already-applied file has changed. Corrections are made by adding a new migration.

## Naming

| Thing | Convention | Example |
| --- | --- | --- |
| Table | plural, `snake_case` | `procurement_requests` |
| Column | `snake_case` | `memo_snapshot_hash` |
| Primary key | `id`, `uuid`, `gen_random_uuid()` | |
| Foreign key | `<singular_referent>_id` | `entity_id`, `parent_entity_id` |
| Index | `<table>_<columns>_idx` | `audit_log_occurred_at_idx` |
| Unique index | `<table>_<columns>_key` | `departments_entity_name_key` |
| Check constraint | `<table>_<rule>` | `entities_parent_matches_type` |
| Trigger | `<table>_<purpose>` | `entities_validate_parent` |
| Enum type | singular, `snake_case` | `entity_type`, `audit_action` |
| Helper function | `app.<verb>_<noun>()` | `app.can_access_entity()` |

TypeScript uses `camelCase` and Drizzle is configured with `casing: 'snake_case'`, so the mapping is
automatic and no column aliases are needed.

## Standard columns

Every **mutable** table carries:

```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
created_at  timestamptz NOT NULL DEFAULT now(),
created_by  text NOT NULL,
updated_at  timestamptz NOT NULL DEFAULT now(),
updated_by  text NOT NULL,
row_version integer NOT NULL DEFAULT 1
```

`created_by` and `updated_by` hold either a user uuid as text or a named system actor such as
`system:seed`, because background jobs act as a named actor and never anonymously (rule R1).

**Append-only** tables do not carry `updated_at`, `updated_by` or `row_version`, since nothing about
them can be updated. Their own timestamp and actor columns record creation. `audit_log` uses
`occurred_at` plus the actor columns for this purpose.

Entity-scoped tables additionally carry `entity_id uuid`, referencing `entities`.

## Append-only enforcement (rule R2)

`SELECT app.apply_append_only_conventions('table_name', 'entity_id')` does three things: installs
refusal triggers for `UPDATE`, `DELETE` and `TRUNCATE`, grants the application role `SELECT` and
`INSERT` only, and applies the entity-scoping policy.

The triggers are **statement level**, not row level. An `UPDATE` that matches no rows is still
refused, so no code path can conclude that editing history was permitted.

Tables that must be append-only as later milestones add them: `audit_log`, workflow actions, seals,
memo snapshots, procurement version snapshots, document versions, document access log, journal
lines, stock movements, payment records, transfer records and commitment events.

## No hard deletion (rule R3)

`SELECT app.apply_mutable_conventions('table_name', 'entity_id')` installs the `row_version` trigger,
refuses `DELETE` and `TRUNCATE`, grants `SELECT, INSERT, UPDATE`, and applies entity scoping.

Business records leave active use through a status change - `INACTIVE`, `ARCHIVED`, `VOIDED`,
`DISCARDED` - never by deletion. The application role is granted no `DELETE` privilege on any
business table, so this survives an application bug as well as a missing check.

## Optimistic locking (A7)

`app.bump_row_version()` increments `row_version` and stamps `updated_at` on every `UPDATE`.
Callers pass the version they read in the `WHERE` clause:

```sql
UPDATE departments SET name = $1, updated_by = $2
 WHERE id = $3 AND row_version = $4
```

Zero affected rows means someone else changed the record first, which the API reports as
`STALE_RECORD` rather than overwriting the other change. State transitions additionally take a row
lock with `SELECT ... FOR UPDATE` inside the transaction (rule R10).

## Entity isolation (rule R5)

Isolation is enforced in the database, not only in application code.

The API connects as `nfc_app`, created `NOBYPASSRLS` and not the owner of any table, so Row-Level
Security genuinely applies to it. Migrations, seeds and test fixtures connect as the owner, which
bypasses RLS so bootstrap work is possible.

Each request opens a transaction and publishes the actor into transaction-scoped session variables:

| Variable | Meaning |
| --- | --- |
| `app.actor_ref` | acting user uuid, or a named system actor |
| `app.actor_role` | the role key held at the time of the request |
| `app.entity_ids` | comma-separated uuids the actor may reach |
| `app.is_corporate` | `true` for group-wide scope |
| `app.request_id` | correlation id shared with the structured logs |

`set_config(..., true)` scopes these to the transaction, so a value cannot leak to the next request
that borrows the same pooled connection.

Policies are built from one predicate:

```sql
app.can_access_entity(target uuid) -- corporate, or target is in app.entity_ids
```

Every reader is **fail-closed**: an unset session variable yields no access. A forgotten `SET`
returns zero rows instead of leaking them.

Resolving an actor's scope is a chicken-and-egg problem, because the answer is what RLS will then
enforce. Two narrow `SECURITY DEFINER` functions answer it and expose nothing else:
`app.entity_directory()` and `app.entity_id_for_code()`.

## Money and time

Money is an integer number of kobo stored in `bigint`, never a float and never `numeric` with a
scale. Formatting, parsing and amount-in-words live in `@nfc/shared`, and `parseFloat` is banned by
lint rule.

Timestamps are `timestamptz` stored in UTC. Every connection runs with `SET TIME ZONE 'UTC'`.
Conversion to Africa/Lagos happens in the presentation layer, using `DD/MM/YYYY HH:mm` on a 24-hour
clock everywhere.

## Adding a table in a later milestone

1. Write a new numbered migration; never edit an applied one.
2. Include the standard column set for its kind, mutable or append-only.
3. Add `entity_id` if the table is subsidiary-scoped.
4. Call `app.apply_mutable_conventions(...)` or `app.apply_append_only_conventions(...)`.
5. Add the indexes the queries need, including any partial index for a nullable lookup column.
6. Mirror the table in `packages/db/src/schema.ts`.
7. Add the negative tests: wrong entity returns nothing, and forbidden operations are refused.
