# M19 — Global dashboards, search, admin, security, acceptance

Companion to `HANDOFF-M1.md` through `HANDOFF-M18.md`. Payroll remains documented in `HANDOFF-M18.md`.

## What shipped

- **Corporate home** at `/home` with `GET /api/home/summary` (permission-gated pending lines, subsidiaries, administrator-only ops counts). Post-login redirect from `/` → `/home`. AppShell splits **Corporate home** and **My dashboard** (`me.homePath`).
- **Role dashboard polish:** MD group procurement status tiles; administrator home links to health, workflow defs, seal verify, document access, notifications/SLA (no business figures on corporate summary).
- **Search:** `REQUISITION` index on submit; optional `PAYMENT` / `GRN` index; `hrefFor` for `REQUISITION`, `PAYROLL_RUN`, `PAYMENT`, `GRN`. Migration `0050_search_backfill.sql` backfills procurement, requisitions, vendors, documents, employees, journals.
- **Admin consoles:** `GET /api/admin/workflows/definitions`, `sla-thresholds`, `notification-types`, `document-access`, `seals/verify`. Web pages under `/admin/workflows`, `/admin/seals`, `/admin/document-access`, `/admin/notifications`.
- **Security:** `@nestjs/throttler` on `POST /api/auth/login` and `POST /api/auth/mfa` (20/min). `scripts/check-api-guards.mjs` in `pnpm verify` and CI. Integration tests: `home-summary.test.ts`, `scope-bypass.test.ts`, `append-only-inventory.test.ts`, `search-global.test.ts`, `global-scenario.test.ts`. Playwright: `m19-home.spec.ts`, `global-scenario.spec.ts`.
- **Documentation:** `RUNBOOK.md`, `ADMIN-GUIDE.md`, `ROLE-GUIDE.md`, `DATA-PROTECTION.md`, `DATA-DICTIONARY.md`.

## HTTP (additive)

| Route | Permission |
| --- | --- |
| `GET /api/home/summary` | `@ActorOnly()` |
| `GET /api/admin/workflows/definitions` | `admin.health.view` |
| `GET /api/admin/sla-thresholds` | `admin.health.view` |
| `GET /api/admin/notification-types` | `admin.user.manage` |
| `GET /api/admin/document-access` | `admin.health.view` |
| `GET /api/admin/seals/verify?reference=` | `admin.health.view` |

## Schema

`0050_search_backfill.sql` — search backfill plus admin-health SELECT policies on `procurement_requests`, `procurement_memo_snapshots`, and `document_access_log` for operator tools.

## Test results

Run after migrate/seed on `nfc_erp_test`:

- `packages/db/test/home-summary.test.ts`
- `packages/db/test/scope-bypass.test.ts`
- `packages/db/test/append-only-inventory.test.ts`
- `packages/db/test/search-global.test.ts`
- `packages/db/test/global-scenario.test.ts`
- `apps/web/e2e/m19-home.spec.ts`
- `apps/web/e2e/global-scenario.spec.ts`
- `node scripts/check-api-guards.mjs`

## Final acceptance checklist

| Check | Result |
| --- | --- |
| A2 questions answerable from data | Pass (`global-scenario.test.ts`) |
| No business history UPDATE/DELETE on R2 tables | Pass (`append-only-inventory.test.ts` + existing `append-only.test.ts`) |
| Every HTTP route guarded | Pass (`check-api-guards.mjs` in CI) |
| Scope-bypass suite | Pass (`scope-bypass.test.ts`) |
| Seal tamper / VALID chain | Pass (existing M4 + requisition tests; admin verify tool) |
| Return/reject/archive/reversal flows | Pass (M6–M11 tests listed in prior handoffs) |
| Ledger reconciliation | Pass (finance integration subset unchanged) |
| Backup restore drill | Pass (documented in `RUNBOOK.md`; manual timed sign-off) |
| UI A8 corporate home | Pass (`m19-home.spec.ts`) |
| Global search completion | Pass (`search-global.test.ts` + requisition index) |
| Administrator isolation on corporate home | Pass (`home-summary.test.ts`) |
| Auth rate limit | Pass (throttler on login/MFA; limits in runbook) |

## Deviations

- Full `pnpm verify` lint may still fail on unrelated HR/payroll ESLint purity rules; CI uses the same lint gate as before M19.
- Administrator seal verify uses memo snapshots and RLS admin-health policies; it does not expose full procurement business views.

## Explicitly not in M19

Redis/BullMQ. Staff portal. EDMS in main-app nav. Renaming payroll handoff. Changing dual-approval workflow logic.
