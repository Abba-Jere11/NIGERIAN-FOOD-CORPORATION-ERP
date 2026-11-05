# M7 — Procurement 2 (Ops and MD approval, versions, escalation)

Companion to `HANDOFF-M1.md` through `HANDOFF-M6.md`.

## What shipped

- **Real `PROCUREMENT` subjects now follow the engine.** Approve / reject / return / archive / restore update `procurement_requests.status` (`AWAITING_MD`, `AWAITING_ED_FINANCE`, `DRAFT`, `REJECTED`, `ARCHIVED`).
- **Approval UX on `/procurement/:id`** for ED Operations and MD. The generic `/workflows/:id` screen remains for the M4 demo fixture.
- **Return for correction** copies the frozen version into a new editable `procurement_versions` row (`N+1`), including the invoice document pointer. Resubmit is the existing Submit button and reuses the same workflow instance.
- **Clone as new** from a `REJECTED` request creates a new `PR-*` draft linked by `cloned_from_request_id`.
- **Archive / restore** record the stage archived from. Restore is MD-only and requires a reason. After MD approve, ED Finance / Finance Head actions on real procurement are refused until M8.
- **Queues:** ED Operations and MD homes list live pending `PROCUREMENT` items (entity, amount, age). GM home shows returned drafts. Overdue rows link to `/procurement/:id`. SLA reminders at 2 / 5 / 7 days still come from the M3/M4 job.
- **M4 demo path is unchanged.** `DEMO_PROCUREMENT` / milling-machine `PR-2026-000184` stay on `workflow_demo_subjects`.

## Explicitly not in M7

ED Finance review, funding routes, Finance Head payment (M8). GRN / delivery / completion (M9). Full M18 corporate home.

## Permission keys

| Key | Holders |
| --- | --- |
| `procurement.approve.operations` | ED Operations (already) |
| `procurement.approve.final` | MD (already) |
| `procurement.reject` | ED Operations, MD |
| `procurement.return` | ED Operations, MD |
| `procurement.archive` | ED Operations, MD |
| `procurement.restore` | MD |
| `procurement.view_history` | GM, Finance Head, ED Operations, MD, ED Finance |

Administrator holds none. Runtime for approve / reject / return stays **current-stage `required_permission` + `allowed_actions`**. Archive = stage holder or `workflow.archive` / `procurement.archive`. Restore = `workflow.restore` / `procurement.restore`.

## HTTP

- `POST /api/procurement/:id/actions` `{ action, reason, rowVersion, idempotencyKey }`
- `POST /api/procurement/:id/clone`
- Existing `POST /api/procurement/:id/submit` also resubmits a returned draft
- `GET /api/procurement/:id` now includes `versions`, `lastReturnReason`, `clonedFrom*`, `archivedFrom`, `relatedHistory`, `vendorSpendToDateKobo`

## Web

`/procurement/:id` — return banner, version history, vendor spend, Ops/MD action dialogs, clone, resubmit. Role homes and `/workflows` pending use `/procurement/:id` for real requests.

## Schema

Migration `0020_procurement_m7.sql`. Seed: `PR-2026-000187` awaiting Ops, `PR-2026-000188` awaiting MD, `PR-2026-000189` returned v2, `PR-2026-000190` rejected. Counter ≥ 190. `PR-2026-000184` and `PR-2026-000186` unchanged.

## Domain events

`procurement.approved`, `procurement.rejected`, `procurement.returned`, `procurement.archived`, `procurement.awaiting_review`, `procurement.committed`, `procurement.commitment_released`.

## Deviations

- Reject / return are not independently checked as `can(procurement.reject)` at runtime; they remain stage-gated like M4. The catalog keys exist and are granted so role screens and Administrator conflict tests stay closed.
- After MD approve the workflow sits at `ed-finance` with status `AWAITING_ED_FINANCE`, but actions at that stage (and `finance-head`) are refused until M8.
- GM resubmit is `POST /api/procurement/:id/submit`, not a separate Resubmit control on `/workflows/:id` for real requests.

## Acceptance

| Check | Result |
| --- | --- |
| Full path GM → ED Operations → MD; seals VALID in order; status `AWAITING_ED_FINANCE` | Pass (`procurement-m7.test.ts`) |
| ED Ops cannot act at MD; MD cannot act at Ops; other-subsidiary GM 404; Administrator 403 | Pass |
| Reject / return / archive without reason refused; reasons stored and displayed | Pass |
| Return → GM, status `DRAFT`, version 2; version 1 frozen | Pass |
| Resubmit restarts at ED Operations; old approvals do not count; return reason visible | Pass |
| Return → resubmit → return produces version 3 | Pass |
| Reject + clone (new ref, link, draft) | Pass |
| Concurrent Ops approve: one winner | Pass |
| Archive drops from pending; restore needs reason + MD | Pass |
| SLA reminders 2 / 5 / 7 on a real hold | Pass |
| Tamper snapshot → INVALID / TAMPERED (M6 path still covers seals) | Pass (`procurement.test.ts`) |
| Timeline for every action | Pass (engine timeline + procurement href) |
| M4 milling-machine / `DEMO_PROCUREMENT` still green | Pass (`m4-engine.test.ts`, `workflows.spec.ts`) |

## Next (M8)

ED Finance review, funding route, Finance Head payment. Enable the deferred `ed-finance` / `finance-head` stages on real `PROCUREMENT` subjects.
