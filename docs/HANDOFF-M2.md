# M2 — Identity and access

Companion to `HANDOFF-M1.md`. Six roles, one login, database-backed `can()`, PostgreSQL sessions, MFA.

## What shipped

- **Administrator** owns accounts, roles, entities and configuration. The MD no longer does.
- Real users (same eleven M1 UUIDs plus `00000000-0000-4000-8000-000000000030`).
- `nfc_session` cookie, argon2id passwords, TOTP + hashed backup codes, lockout after 10 failures, CSRF on mutating API calls when a CSRF cookie is present.
- `can()` reads `role_permissions` via the session. Services do not branch on role names.
- RLS: `app.is_corporate` is business-group visibility; `app.is_admin` is account/org management. The Administrator is not corporate, so the audit log stays closed to them. Null `audit_log.entity_id` is visible only to corporate business actors.

## Declared deviations

| Topic | Choice |
| --- | --- |
| Outbound mail | `mail_outbox` table. Reset URLs printed to the API log when `NODE_ENV=development`. SMTP waits for M3. |
| Photographs | Disk path reserved (`data/user-photographs/`, gitignored). MinIO waits for M4. |
| Sessions / rate limits | PostgreSQL tables, not Redis (Redis is M3). |
| Finance / inventory tiles | Role homes are real; procurement/finance/inventory **counts stay empty** until those modules exist. |
| HIBP | Range API with a 2s timeout. If it is down, the bundled common-password list still applies. |

## Schema

Migrations `0004_role_key_administrator.sql` (enum `ADD VALUE`), `0005_identity.sql`, then `0006`–`0009`. Application audit writes go through `app.write_audit_entry` (SECURITY DEFINER) so the Administrator can record organisation and account changes without SELECT on the business log.

Tables: `users`, `roles`, `permissions`, `role_permissions`, `role_conflicts`, `user_role_assignments`, `user_scope_grants`, `sessions`, `password_reset_tokens`, `mfa_backup_codes`, `login_attempts`, `mail_outbox`, `sensitive_fields`.

## Permission keys (seeded)

Kept from M1: `organization.view`, `organization.entity.manage`, `organization.department.manage`, `audit.view`, `audit.export`.

Admin: `admin.user.manage`, `admin.role.assign`, `admin.scope.grant`, `admin.session.revoke`, `admin.permission_log.view`, `admin.health.view`.

Forward (no HTTP routes yet): `procurement.create`, `procurement.approve.operations`, `procurement.approve.final`, `procurement.review.finance`, `finance.payment.execute`, `finance.funding.authorize`, `finance.view`, `inventory.view`, `hr.salary.view`, `vendor.bank.view`.

Default grants: see `DEFAULT_ROLE_GRANTS` in `@nfc/shared`. Administrator has none of `audit.*`, procurement, finance, inventory, `hr.salary.view`, `vendor.bank.view`. MD has no `admin.*` and no entity manage.

## HTTP

Public: `GET /health`, `GET /api/auth/csrf`, `POST /api/auth/login`, `POST /api/auth/mfa`, `POST /api/auth/forgot`, `POST /api/auth/reset`.

Auth (session): logout, change-password, MFA enrol/confirm, backup-codes (step-up), step-up, list/revoke own sessions, `GET /api/me`.

Admin: `/api/admin/users`, status, unlock, roles, grants, session revoke, `/api/admin/roles`, `/api/admin/permission-changes`.

Org/audit routes keep their permission **keys**; grants changed so MD `POST /api/entities` is 403 and Administrator `GET /api/audit` is 403.

## Web

One login: `/login` → `/login/change-password` if flagged → home when MFA is not required. When MFA is required (Administrator role or an Administrator enabled it on the account): `/login/mfa` after password if already enrolled, otherwise `/login/mfa-enrol` until enrolled → `homePath`.

Homes: `/home/gm`, `/home/ed-operations`, `/home/md`, `/home/ed-finance`, `/home/finance-head`, `/home/admin`. Gated by unique permissions, not role names.

## Seeded users

| Email | Role |
| --- | --- |
| administrator@nfc.local | Administrator |
| md@nfc.local | MD |
| ed.operations@nfc.local | ED Operations |
| ed.finance@nfc.local | ED Finance |
| gm.yfz@nfc.local … gm.nom@nfc.local | GM × 4 |
| fh.yfz@nfc.local … fh.nom@nfc.local | Finance Head × 4 |

Password: `SEED_USER_PASSWORD`. Development seed sets `must_change_password=true`, `mfa_required=false`, and does not enrol TOTP (except the seeded Administrator, who must enrol on first sign-in). An Administrator can require MFA per user under **Admin → Users**. Test database with `SEED_E2E_SKIP_MUST_CHANGE=true` sets `mfa_required=true` and enrols the fixture secret `JBSWY3DPEHPK3PXP` (`TOTP_FIXTURE_SECRET`) on all seed users.

## Environment

| Name | Notes |
| --- | --- |
| `SESSION_SECRET` | ≥32 characters. HMAC for session/reset hashes and MFA/step-up cookies. |
| `MFA_ENCRYPTION_KEY` | 64 hex chars (AES-256-GCM for TOTP secrets). |
| `SESSION_IDLE_MINUTES` | Default 30. |
| `SESSION_ABSOLUTE_HOURS` | Default 12. |
| `SEED_USER_PASSWORD` | Demo password; 12+ mixed classes. |
| `SEED_E2E_SKIP_MUST_CHANGE` | Honoured only when seeding the **test** database. |
| `HIBP_ENABLED` | Default true. |
| `WEB_ORIGIN` | Used to build password-reset URLs. |

Removed: `DEV_ACTOR_ENABLED`, `DEV_ACTOR_DEFAULT`, `x-dev-actor`.

## Assumptions

Idle 30 minutes, absolute 12 hours. Lockout 10 failures / 15 minutes. Cookies `nfc_session` (httpOnly) and `nfc_csrf`. Step-up cookie `nfc_stepup` required for `admin.role.assign`.

## Acceptance

| Check | Result |
| --- | --- |
| Six roles, Administrator owns accounts/entities, MD does not | Pass (catalog + grants + UI) |
| One login URL | Pass (`/login`) |
| `can()` from DB grants, deny by default | Pass |
| Administrator not corporate; audit hidden | Pass (RLS test) |
| YFZ Finance Head cannot see DMA audit | Pass (RLS test) |
| GM 403 on `/api/audit`; Administrator 403 on audit; MD 403 on `POST /api/entities` | Pass (Playwright HTTP) |
| Playwright: one login, six homes, MFA, lockout, revoke, permission log | Pass (`e2e/identity.spec.ts` plus org/audit/design) |
| User DELETE refused | Pass |
| Grep: no `role ===` in `apps/**` outside tests | Pass (`scripts/check-no-role-branch.mjs`) |
| SMTP | Deferred to M3 (`mail_outbox`) |
| Redis / MinIO | Deferred |
| CI on a remote | Not run here |
