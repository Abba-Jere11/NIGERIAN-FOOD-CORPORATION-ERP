# M3 — Reference numbers, domain events, notifications, search

Companion to `HANDOFF-M1.md` and `HANDOFF-M2.md`. Central engines every later module registers with.

## What shipped

- **Reference-Number Engine:** `app.next_reference(kind, year)` locks a `reference_counters` row in the caller’s transaction. Formats from A7 (`PR-2026-000184`, `VND-000018` yearless). Frozen after insert (`app.forbid_reference_change`). Admin read-only counters.
- **Transactional outbox:** `domain_events` written in `UnitOfWork.write`. Trigger fans out `event_deliveries`. Dispatcher uses `FOR UPDATE SKIP LOCKED`, per-subject ordering, retries, dead-letter. Subscription registry includes placeholders for Finance, Inventory, EDMS and Payroll.
- **Notifications:** in-app inbox, templates, preferences (mandatory categories cannot disable email), delivery log. Email goes to existing `mail_outbox`; SMTP is optional.
- **Escalation:** `sla_thresholds` 2/5/7 days, `workflow_holds`, unique `workflow_reminders`. Overdue Workflows for `oversight.overdue.view` (MD, ED Operations, ED Finance).
- **Search + timeline:** `search_index` (FTS + trigram/ILIKE) filtered by entity RLS and `app.has_permission`. `timeline_events` append-only; existing `Timeline` UI.
- **Jobs:** in-process PostgreSQL poller. No Redis, no BullMQ.

## Gap policy

A rolled-back allocate does not consume a number. A committed number is never reused if the record is later discarded. Gaps are expected.

## Declared deviations

| Topic | Choice |
| --- | --- |
| Redis + BullMQ (A6) | PostgreSQL `SKIP LOCKED` poller inside the API (`JOBS_ENABLED`). |
| SMTP | Optional. Unset → store on `mail_outbox` and log in development (same as M2). |
| SMS / WhatsApp | TypeScript interfaces only (`UnimplementedSmsSender`). |
| Business records to search | Fixture `PROCUREMENT` rows (YFZ/DMA “XYZ Limited”) and `engine_records`. Later modules call `app.upsert_search_index`. |

## Schema

Migrations `0010`–`0014`. Tables: `reference_counters`, `engine_records`, `domain_events`, `event_subscriptions`, `event_deliveries`, `notification_types`, `notifications`, `notification_preferences`, `notification_deliveries`, `sla_thresholds`, `workflow_holds`, `workflow_reminders`, `search_index`, `timeline_events`.

Session variable `app.permission_keys` drives search RLS.

## Permission keys

New: `oversight.overdue.view` — MD, ED Operations, ED Finance. Administrator does not hold it.

## HTTP

- `POST /api/engine/records`, `GET /api/engine/records/:id`
- `GET /api/admin/reference-counters`, `GET /api/admin/ops`, `POST /api/jobs/run`
- `GET/PATCH /api/notifications…`, unread-count, read/unread
- `GET /api/search?q=`, `GET /api/timeline?subjectType&subjectId`
- `GET /api/workflows/overdue`

## Web

Header search → `/search`. Bell → `/notifications`. `/workflows/overdue`, `/timeline`, `/engine/[id]`. Admin health shows dead letters and counters.

## Environment

`JOBS_ENABLED` (default true). Optional `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.

## Acceptance

| Check | Result |
| --- | --- |
| 100 parallel unique sequential refs | Pass (`engines.test.ts` + Playwright) |
| Reference update fails at DB | Pass |
| Event only if TX commits | Pass |
| Retry → dead-letter; idempotent redelivery | Pass |
| In-app + email logged; read/unread | Pass (Playwright + mail_outbox) |
| One reminder per 2/5/7 threshold; unique | Pass |
| Search scoped to two GMs | Pass |
| Timeline order + actor + time | Pass |
| SMTP / Redis | Deferred as above |
