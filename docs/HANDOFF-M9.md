# M9 — Procurement 4 (GM verification, GRN, completion)

Companion to `HANDOFF-M1.md` through `HANDOFF-M8.md`.

## What shipped

- **Paid is not completed.** Payment still leaves the request `AWAITING_DELIVERY`. The `procurement-v1` instance stays `COMPLETED`.
- **Delivery notes** (“Received? No”) are append-only. Status does not change. Reminders reuse the 2/5/7-day job pattern against `next_reminder_at`.
- **GRNs** (`GRN-…`) are append-only, idempotent, and correctable by supersede (original remains visible). Partial accepted quantity moves the request to `PARTIALLY_RECEIVED`. Filling the ordered quantity completes in the same transaction.
- **Close-short** is a linked `close-short-v1` instance (`CLOSE_SHORT` subject), not a reopened procurement workflow. Stages: ED Operations then ED Finance, reusing `procurement.approve.operations` and `procurement.review.finance`. Final approve writes `vendor_open_claims`. The GM still hits Complete so the `verified` seal is the originator’s.
- **Complete** requires accepted == ordered **or** an approved close-short, plus the category’s `required_delivery_document_set`. Applies a `verified` seal against the **frozen memo snapshot** (same M8 paid-seal lesson). Emits `procurement.completed` once.
- **Package ZIP** (generated record PDF, linked files, `manifest.json` of SHA-256 hashes and seal verification) and **Procurement Record PDF**. Close-short decisions and any **vendor open claim** are rolled into the main request timeline, record PDF, and package (`manifest.json` plus `vendor-open-claim.json` when a claim exists). Close-short-v1 mechanics stay on the linked instance; procurement surfaces mirror the outcome.
- **Seed display names** (corporate MD / ED Operations / ED Finance and YFZ GM / Finance Head): Dr. Babagana Adam, Umar Tor, Muhammad Jere, Musa Gwary, Yahuza Yahuza — re-synced on every `pnpm db:seed`.
- **Documents and access** on the request. **Reports** by status, subsidiary, vendor, category, and pending ageing.
- **Track Procurement** is derived from seals, payments, transfers and GRNs.

## Explicitly not in M9

Ledger (M10–M11). Inventory receipts (M13). EDMS folders (M15). `PR-2026-000184` stays on `workflow_demo_subjects`. No seventh role. Corporate Finance remains ED Finance.

## Permission keys

| Key | Holders |
| --- | --- |
| `procurement.verify.delivery` | GM (originator + `SAME_ENTITY`) |
| `procurement.grn.record` | GM |
| `procurement.close_short.request` | GM |
| `procurement.package.download` | anyone with procurement view except Administrator |
| `procurement.report.view` | MD, ED Operations, ED Finance (all entities); GM and Finance Head (own entity) |

Administrator holds none of these. Close-short approvals reuse the existing Operations / Finance keys.

## HTTP

- `POST /api/procurement/:id/delivery-notes`
- `POST /api/procurement/:id/receipts`
- `POST /api/procurement/:id/receipts/:grnId/supersede`
- `POST /api/procurement/:id/close-short`
- `POST /api/workflows/:id/actions` — close-short APPROVE / REJECT
- `POST /api/procurement/:id/complete`
- `GET /api/procurement/:id/package`
- `GET /api/procurement/:id/record.pdf`
- `GET /api/procurement/:id/documents`
- `GET /api/procurement/reports`

## Schema

Migration `0022_procurement_m9.sql`. Seed: `PR-2026-000193` awaiting delivery (qty 1000); `PR-2026-000194` partially received 800/1000. Counter ≥ 194. `PR-2026-000184` / `186`–`192` unchanged. UUIDs `217` / `218`.

## Domain events

`goods.received` (each GRN, outbox only — no inventory tables). `procurement.completed` (once). `procurement.close_short.requested|approved|rejected`. `procurement.delivery_reminder`.

## Deviations

- No seventh procurement status. Close-short pending is `closeShort.status = PENDING` on `PARTIALLY_RECEIVED`.
- Full GRN auto-completes (the verifying GM is the originator). Close-short approval unlocks; the GM still completes.
- Package ZIP is uncompressed STORE (no new zip dependency).

## Acceptance

| Check | Result |
| --- | --- |
| Paid ≠ completed; seeded `AWAITING_DELIVERY` stays there | Pass (`procurement-m9.test.ts`) |
| 800 then 200 completes; GRN idempotent; `goods.received` twice; `procurement.completed` once | Pass |
| Close-short needs both approvals; vendor claim written on final approve | Pass |
| Close-short rollup on PROCUREMENT timeline, package manifest, and record PDF | Pass (`procurement-m9.test.ts`) |
| DMA GM cannot GRN YFZ; Administrator refused GRN / package / reports; wrong status refused | Pass |
| Seals VALID including `verified`; package contains `manifest.json` hashes | Pass |
| Playwright: create → approve chain → pay → deliver → complete; return and reject before money moves | Pass (`procurement-m9.spec.ts`) |

## Next (M10)

Banking / treasury surfaces. Do not start ledger postings (M11) or inventory receipts (M13) from this handoff.
