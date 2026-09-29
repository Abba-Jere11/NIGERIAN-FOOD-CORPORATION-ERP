# Milestone Handoff Note — M1

**Milestone:** M1 — Foundation, conventions, design system, organisation and audit engine core
**Stack:** pnpm workspace · PostgreSQL 18 · NestJS 11 · Next.js 15 (App Router) · React 19 · Tailwind CSS v4 · Drizzle ORM (query layer) with hand-written SQL migrations · Vitest · Playwright

Paste this note, together with PART A and the next milestone, at the start of the M2 session.

---

## 1. Tables created

All tables live in the `public` schema. Helper functions live in the `app` schema.

| Table               | Purpose                                                      | Mutability                                    |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| `organizations`     | The group itself. One row: Nigeria Food Corporation.         | Mutable, never deleted                        |
| `entities`          | NFC Holding plus the four subsidiaries. One level deep (A4). | Mutable, never deleted, entity-scoped by `id` |
| `departments`       | Configurable department list per entity.                     | Mutable, never deleted, scoped by `entity_id` |
| `audit_log`         | Every action in the system.                                  | **Append-only**, scoped by `entity_id`        |
| `schema_migrations` | Applied migration file names and their checksums.            | Written by the migrator only                  |

### Standard columns

Mutable tables carry `id uuid` (primary key, `gen_random_uuid()`), `created_at`, `created_by`, `updated_at`, `updated_by`, `row_version integer`, and `status record_status` where a lifecycle applies.

`audit_log` deliberately carries none of `updated_at`, `updated_by` or `row_version`: it is never updated, so columns describing an update would be misleading. `occurred_at` is its creation timestamp and the actor columns are its creator.

### Enums

| Enum            | Values                                                                                                                                                                                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entity_type`   | `HOLDING`, `SUBSIDIARY`                                                                                                                                                                                                                                                                            |
| `record_status` | `ACTIVE`, `INACTIVE`                                                                                                                                                                                                                                                                               |
| `scope_type`    | `CORPORATE`, `ENTITY`                                                                                                                                                                                                                                                                              |
| `role_key`      | `gm`, `ed_operations`, `md`, `ed_finance`, `finance_head` — exactly the five roles from A5                                                                                                                                                                                                         |
| `audit_action`  | `login`, `logout`, `create`, `edit`, `approve`, `reject`, `return`, `archive`, `upload`, `download`, `payment`, `transfer`, `inventory_adjustment`, `employee_change`, `payroll_change`, `permission_change`, `account_change`, `document_access`, `document_share`, `system_configuration_change` |

The enum values are asserted identical in the SQL migration, the Drizzle schema and the shared TypeScript constants by `packages/db/src/schema.test.ts`, which needs no database. Adding an action means changing all three.

### Convention primitives available to every later milestone

Call these at the end of a migration that creates a table. They are the whole reason M2 onwards does not have to re-derive the rules.

```sql
-- Mutable business table: row_version trigger, no-delete trigger, grants,
-- and optionally the entity-scoping Row-Level Security policy.
SELECT app.apply_mutable_conventions('purchase_requisitions', 'entity_id');

-- History table: append-only triggers, SELECT and INSERT grants only,
-- and optionally the entity-scoping policy.
SELECT app.apply_append_only_conventions('approval_steps', 'entity_id');
```

Individual pieces, if the composite is not what you want: `app.make_append_only`, `app.forbid_hard_delete`, `app.add_row_version_trigger`, `app.enable_entity_rls`, `app.grant_mutable_table`, `app.grant_append_only_table`.

Session readers used by the Row-Level Security policies, all fail-closed: `app.current_actor_ref()`, `app.current_actor_id()`, `app.current_actor_role()`, `app.current_entity_ids()`, `app.is_corporate_actor()`, `app.current_request_id()`, `app.can_access_entity(uuid)`.

Scope resolution before Row-Level Security applies, `SECURITY DEFINER` and deliberately narrow: `app.entity_id_for_code(text)`, `app.all_entity_ids()`, `app.entity_directory()`.

### How the rules are actually enforced

| Rule                   | Mechanism                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R2 append-only         | `BEFORE UPDATE / DELETE / TRUNCATE` **statement-level** triggers, **and** no `UPDATE`/`DELETE` grant to `nfc_app`. Statement level so an UPDATE matching zero rows is still refused. |
| R3 no hard delete      | `BEFORE DELETE / TRUNCATE` triggers on business tables, **and** no `DELETE` grant to `nfc_app`.                                                                                      |
| R5 entity isolation    | Row-Level Security policies over `app.can_access_entity()`, with the application connecting as `nfc_app` — created `NOBYPASSRLS` and not the table owner.                            |
| A7 optimistic locking  | `row_version` plus `app.bump_row_version()`; callers pass the version they read in the `WHERE` clause and treat zero affected rows as a conflict.                                    |
| A4 one-level hierarchy | A `CHECK` constraint pairing `type` with `parent_entity_id`, plus the `entities_validate_parent` trigger refusing a parent that is not the holding company.                          |
| R11 mandatory reason   | A `CHECK` constraint on `audit_log` for `reject`, `return` and `archive`, plus `assertAuditEntryValid()` so the user gets a usable message first.                                    |

Migrations and seeds connect as the owner, which bypasses Row-Level Security so bootstrap is possible. `FORCE ROW LEVEL SECURITY` is deliberately **not** used, because it would make seeding impossible.

---

## 2. Endpoints

`GET /health` is `@Public()`. Everything else requires an actor. A route carrying neither `@Public()`, `@ActorOnly()` nor `@RequirePermission()` throws — the guard fails closed, so a new endpoint cannot be reachable by forgetting to protect it.

| Method  | Path                              | Permission required              |
| ------- | --------------------------------- | -------------------------------- |
| `GET`   | `/health`                         | none (public)                    |
| `GET`   | `/api/me`                         | actor only                       |
| `GET`   | `/api/dev-actors`                 | actor only — **removed in M2**   |
| `GET`   | `/api/entities`                   | `organization.view`              |
| `GET`   | `/api/entities/:id`               | `organization.view`              |
| `POST`  | `/api/entities`                   | `organization.entity.manage`     |
| `PATCH` | `/api/entities/:id`               | `organization.entity.manage`     |
| `POST`  | `/api/entities/:id/deactivate`    | `organization.entity.manage`     |
| `POST`  | `/api/entities/:id/activate`      | `organization.entity.manage`     |
| `GET`   | `/api/entities/:id/departments`   | `organization.view`              |
| `POST`  | `/api/entities/:id/departments`   | `organization.department.manage` |
| `PATCH` | `/api/departments/:id`            | `organization.department.manage` |
| `POST`  | `/api/departments/:id/deactivate` | `organization.department.manage` |
| `POST`  | `/api/departments/:id/activate`   | `organization.department.manage` |
| `GET`   | `/api/audit`                      | `audit.view`                     |
| `GET`   | `/api/audit/filters`              | `audit.view`                     |
| `GET`   | `/api/audit/export`               | `audit.export`                   |

Deactivation and activation are `POST` rather than `DELETE`, because nothing is deleted. Both require a reason.

Errors use one shape, so the interface reacts to a code rather than parsing prose:

```json
{ "error": { "code": "STALE_RECORD", "message": "…", "fieldErrors": {}, "requestId": "…" } }
```

Codes: `VALIDATION_FAILED` (400), `REASON_REQUIRED` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `STALE_RECORD` (409), `APPEND_ONLY_VIOLATION` (409).

### Web routes

| Route                  | Notes                                                                  |
| ---------------------- | ---------------------------------------------------------------------- |
| `/`                    | Home. "Waiting for you" is honestly empty until approvals exist in M6. |
| `/admin/entities`      | Entity list. Administration controls only for the MD.                  |
| `/admin/entities/[id]` | Entity detail, departments, and the entity's history.                  |
| `/audit`               | Audit viewer. Refuses any role without `audit.view`.                   |
| `/audit/export`        | Route handler that forwards the acting identity and streams the CSV.   |
| `/design`              | The design-system reference.                                           |

---

## 3. Domain events

**None are published in M1.** There is no event bus, outbox table or subscriber in this milestone, and nothing pretends otherwise.

What exists instead is the audit log, which records every mutation with its actor, subject and diff. Two pieces of groundwork are in place for when events arrive:

- `system:outbox` is already a registered system actor in the `audit_log` check constraint, so a transactional outbox worker can write audit entries under its own name without a migration.
- Every mutation already runs inside `UnitOfWork.write()`, which is the natural place to enqueue an outbox row in the same transaction as the change.

---

## 4. Permission keys

Defined in `packages/shared/src/permissions.ts`. M1 has no `roles`, `permissions` or `role_permissions` tables — those are M2 — so the mapping is a static table. **The key names and every call site stay the same when M2 replaces the lookup with database-backed grants.**

| Key                              | MD  | ED Finance | ED Operations | GM  | Finance Head |
| -------------------------------- | --- | ---------- | ------------- | --- | ------------ |
| `organization.view`              | yes | yes        | yes           | yes | yes          |
| `organization.entity.manage`     | yes | –          | –             | –   | –            |
| `organization.department.manage` | yes | –          | –             | –   | –            |
| `audit.view`                     | yes | yes        | –             | –   | –            |
| `audit.export`                   | yes | yes        | –             | –   | –            |

Enforcement is `can(actor, permissionKey, entityId?)` and `assertCan(...)` in `apps/api/src/auth/can.ts`. Both deny by default. `assertCan` distinguishes "your role does not permit this" from "you do not have access to this subsidiary", because those need different responses from the person reading them.

---

## 5. Reusable components

In `apps/web/src/components`. Every one is exhibited at `/design`; consult that page before inventing a new component.

**Shell** — `AppShell` (top bar with organisation identity, global search, notification bell, actor menu), `SideNav` (filtered by permission, though the filtering is cosmetic and every endpoint re-checks), `ActorSwitcher` (**removed in M2**).

**Surfaces** — `Surface`, `SurfaceHeader`, `PageHeader`, `DefinitionList`.

**Data** — `DataTable` (sort, filter, paginate, client CSV export, optional row links) and `Pagination` (link-based, for server-paginated lists such as the audit log).

**Status and progress** — `StatusBadge` with the shared status-to-tone vocabulary already mapped for the procurement statuses in A7; `ApprovalTracker` rendering `done` ✓, `current` ●, `pending` ○, plus `returned` ↩ and `rejected` × ready for the M6–M9 approval chains; `Timeline`.

**Forms** — `TextField`, `TextAreaField`, `SelectField`, `DateField` (all displaying server-returned field errors), `MoneyInput` (types naira, submits exact integer kobo in a hidden field, shows the amount in words live), `Button`, `ButtonLink`.

**Feedback** — `ActionDialog` (confirmation and, with `requireReason`, the rule R11 mandatory-reason flow; built on the native `<dialog>` element so focus trapping and Escape come from the browser), `Toast` via `ToastProvider` and `useToast`, `EmptyState`, `LoadingState`, `ErrorState`, `Notice`.

**Print** — `globals.css` carries an A4 print stylesheet. Mark anything that should not print with `no-print`; mark a panel that should lose its chrome with `print-surface`; mark a block that must not straddle a page break with `avoid-break`.

**Shared helpers** (`@nfc/shared`) — `parseNairaToKobo`, `formatKobo`, `amountInWords`, `formatLagosDate`, `formatLagosTime`, `formatLagosDateTime`, `daysBetween`, `computeDiff`, `buildPage`, `offsetFor`.

**Server-side plumbing** (`apps/api`) — `UnitOfWork.write()` and `.read()`, which open the transaction, publish the actor into the session variables that Row-Level Security reads, and hand the caller an `audit()` bound to that same transaction. **Use it for every mutation.** It is what makes it structurally impossible for a committed change to have no audit entry.

---

## 6. Environment variables

The repository keeps one `.env` at its root; the API and the database tooling both read it. It is gitignored and must never be committed. `.env.example` is the template.

| Variable                  | Default / example       | Notes                                                                    |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `NODE_ENV`                | `development`           | `development`, `test` or `production`.                                   |
| `PGHOST`                  | `localhost`             |                                                                          |
| `PGPORT`                  | `5432`                  |                                                                          |
| `PGUSER`                  | `postgres`              | Table owner. Used for migrations, seeds and test fixtures only.          |
| `PGPASSWORD`              | — **required**          | Validated at boot.                                                       |
| `PGDATABASE`              | `nfc_erp_dev`           |                                                                          |
| `PGDATABASE_TEST`         | `nfc_erp_test`          | Rebuilt from the migrations at the start of every integration run.       |
| `APP_DB_USER`             | `nfc_app`               | The role the API connects as. `NOBYPASSRLS`, not the owner, no `DELETE`. |
| `APP_DB_PASSWORD`         | — **required**          | Validated at boot.                                                       |
| `DATABASE_URL`            | blank                   | Optional full-URL override; otherwise built from the parts above.        |
| `DATABASE_URL_TEST`       | blank                   | Likewise, for the test database.                                         |
| `DATABASE_URL_OWNER`      | blank                   | Likewise, for the owner connection.                                      |
| `DATABASE_URL_TEST_OWNER` | blank                   | Likewise.                                                                |
| `API_PORT`                | `4000`                  |                                                                          |
| `API_HOST`                | `127.0.0.1`             |                                                                          |
| `LOG_LEVEL`               | `info`                  |                                                                          |
| `CORS_ORIGINS`            | `http://localhost:3000` | Comma-separated.                                                         |
| `DEV_ACTOR_ENABLED`       | `true`                  | **Refused at boot when `NODE_ENV=production`.** Removed in M2.           |
| `DEV_ACTOR_DEFAULT`       | `md`                    | Must name a registered demo actor. Removed in M2.                        |
| `WEB_PORT`                | `3000`                  |                                                                          |
| `NEXT_PUBLIC_API_URL`     | `http://127.0.0.1:4000` |                                                                          |

M3 adds Redis, M4 adds MinIO. Neither is referenced yet.

### Commands

```
pnpm db:bootstrap    # create the nfc_app role and both databases
pnpm db:migrate      # apply the SQL migrations
pnpm db:seed         # seed NFC Holding and the four subsidiaries (idempotent)
pnpm db:reset        # drop and rebuild
pnpm dev             # API on 4000, web on 3000

pnpm verify          # lint, build, typecheck, test — the one gate
pnpm test:unit       # the database-free subset
pnpm test:integration# the suite that needs PostgreSQL
pnpm test:e2e        # Playwright, against the built API and web
```

---

## 7. Acceptance checklist

Recorded at the end of the M1 session. Three lines are **blocked**, not failed: the local PostgreSQL role's password is not yet known, so nothing database-backed has been executed. The tests that prove them are written and typecheck; they have not been run.

| Line                                                                                          | Result      | Evidence                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App boots, CI green, migrations and seed run from scratch.                                    | **partial** | `pnpm lint`, `pnpm build` and `pnpm typecheck` all pass. Migrations and seed have not been executed — see the blocker below. CI has never run; there is no remote.                    |
| NFC + 4 subsidiaries seeded with correct hierarchy; Nguru Oil Mills is a direct child of NFC. | **blocked** | `packages/db/test/organization.test.ts` asserts the hierarchy, and the A4 constraint and trigger refuse anything deeper. Needs the database to run.                                   |
| Departments can be added/deactivated per entity; every change writes an audit entry.          | **blocked** | `apps/web/e2e/organization.spec.ts` adds a department, deactivates it with a reason, and then finds both actions in the audit log. Needs the database and both servers.               |
| `UPDATE`/`DELETE` on `audit_log` fails at database level (tested).                            | **blocked** | `packages/db/test/append-only.test.ts` issues raw SQL as the **table owner** and asserts each statement is refused, including an UPDATE matching zero rows and TRUNCATE.              |
| Audit entry contains all fields listed in item 5.                                             | **blocked** | `packages/db/test/audit-log.test.ts` writes one entry and asserts all twenty-two stored columns, including the request provenance.                                                    |
| Every design-system component renders on `/design`; approval tracker shows ✓ ● ○.             | **pass**    | `/design` builds and renders; `apps/web/e2e/design-system.spec.ts` asserts every section and all three tracker marks, in glyphs and in the words given to a screen reader.            |
| Money helper never uses floating point (unit tests for kobo arithmetic and amount-in-words).  | **pass**    | 13 tests in `packages/shared/src/money.test.ts`, including `0.10 + 0.20` being exactly 30 kobo and exactness beyond `Number.MAX_SAFE_INTEGER`. `parseFloat` is banned by a lint rule. |

**99 unit tests pass** across `@nfc/shared` (53), `@nfc/api` (35) and `@nfc/db` (11). Lint, build and typecheck are clean across the workspace.

### The one blocker

`PGPASSWORD` in the root `.env` is still `CHANGEME`. The local PostgreSQL 18 cluster uses `scram-sha-256` for every connection type, so a password is genuinely required; there is no `pgpass.conf` and no trust rule.

Once it is filled in:

```
pnpm db:bootstrap && pnpm db:migrate && pnpm db:seed
pnpm test            # unit and integration
pnpm test:e2e        # Playwright
```

Until then `pnpm test:integration` fails with a message naming the cause and the variables to fix, rather than skipping quietly. A skipped test that proves R2, R3 and R5 would be worse than a failing one.

---

## 8. Deviations from the prompt

Declared under rule A9. Each one names what was done instead and when it is resolved.

1. **PostgreSQL 18, not 16.** It is what was already running locally. No feature used here differs between the two.

2. **Drizzle, not Prisma.** M1 depends on raw SQL triggers, Row-Level Security policies, privilege grants and transaction-scoped `SET LOCAL` session variables. Migrations are hand-written SQL and are the source of truth; Drizzle is the typed query layer that follows them. Prisma would have needed an escape hatch for nearly every one of those.

3. **No users, login or roles — bridged by a dev-only actor context.** Those are M2 and are listed under "Not in this milestone", yet M1 still requires MD-only administration screens and an audit viewer limited to the MD and ED Finance. Rather than fake those restrictions in the interface, the API resolves one of eleven fixed demo actors from an `x-dev-actor` header, builds the same `ActorContext` that M2 will build from a real session, and enforces role and scope against it server-side. The bridge is `DEV_ACTORS` in `@nfc/shared`, `ActorService`, `ActorGuard`, the `/api/dev-actors` endpoint and the `ActorSwitcher` component. **It refuses to operate with `DEV_ACTOR_ENABLED=false`, and the process refuses to boot with it enabled in production.** M2 deletes it wholesale and seeds real users carrying the same identifiers, so audit history stays continuous.

4. **`audit_log.subject_reference_number` is nullable and currently always null.** The Reference-Number Engine is M3. The column, its partial index and the CSV export column already exist, so M3 populates it without a migration.

5. **The global search box and the notification bell are inert placeholders.** Global search and the notification engine are M3. They are rendered disabled, labelled "available from M3", with a tooltip saying so, rather than appearing to work.

6. **Redis and MinIO are not provisioned.** They arrive with M3 and M4. Nothing references them.

7. **No domain events are published.** See section 3.

8. **The CI workflow is committed but has never executed.** There is no git remote yet, so nothing has run it. `pnpm verify` performs the same lint, build, typecheck and test steps locally, and the workflow adds only the PostgreSQL 18 service container and the Playwright browser install.

9. **Time format fixed for the whole system.** Stored in UTC, displayed in Africa/Lagos as `DD/MM/YYYY HH:mm` on a 24-hour clock. Africa/Lagos has never observed daylight saving, so the offset is a constant `+01:00`, which is what the audit date filters rely on.

10. **Drift corrected while writing the tests.** The SQL migration and the Drizzle schema had `payroll_change` and `employee_change` in the opposite order to the plan's vocabulary. The migration had never been applied to any database, so `0003_audit_log.sql` was corrected in place rather than superseded. The parity test that found it now runs without a database.
