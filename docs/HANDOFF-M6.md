# M6 — Procurement 1 (request, memo, invoice, submit, GM seal)

Companion to `HANDOFF-M1.md` through `HANDOFF-M5.md`.

## What shipped

- **Structured procurement requests** on the originating GM's subsidiary. Reference `PR-YYYY-NNNNNN` via `app.next_reference('PR')`. Discard sets status `DISCARDED` (no hard delete).
- **One commercial line** on `procurement_versions`. `total_amount_kobo` is stored but **never trusted from the client**; the API multiplies quantity × unit price.
- **Generated memo** from structured fields only (no free-text memo column). Live preview is HTML. Frozen PDF is `pdfkit` on the server from the same snapshot. Template version is stored with SHA-256 of the canonical JSON.
- **Invoice** is evidence (`procurement_invoices` + documents `context=procurement`). Required when the category says so. Amount mismatch and duplicate invoice number are **flags**, not 400s.
- **Submit** is one transaction: revalidate Active vendor, freeze the version, snapshot + PDF + GM `submitted` seal (badge **REQUESTED BY**), `procurement_commitment_events` OPEN with the real amount, start `procurement-v1` at **AWAITING_OPERATIONS**.
- **M4 demo path is unchanged.** `DEMO_PROCUREMENT` / milling-machine `PR-2026-000184` and `/api/workflows/demo` remain. Real requests use subject type `PROCUREMENT`.
- **Vendor history view** `vendor_procurement_history_v` now reads submitted, non-discarded requests. Duplicate invoice claims are appended on submit (flag only).

## Explicitly not in M6

ED Operations / MD approval screens, Return-for-Correction versions, Clone-as-new (M7). ED Finance funding and payment (M8). GRN / delivery (M9). Full budgeting (M10) — `budget_lines` / `projects` here are lightweight and must be migrated, not dropped.

## Permission keys

| Key | Holders |
| --- | --- |
| `procurement.create` | GM (already) |
| `procurement.edit_draft` | GM |
| `procurement.submit` | GM |
| `procurement.view` | GM, Finance Head, ED Operations, MD, ED Finance |
| `procurement.discard_draft` | GM |

Administrator holds none. `edit_draft` / `submit` / `discard_draft` also require **originator** and status `DRAFT`. List/detail: `procurement.view` or `procurement.create`. Budget/project mutations: `finance.payment.execute` (own entity) or `finance.funding.authorize` (corporate).

## HTTP

- `GET /api/procurement/categories|units|funding-sources|urgencies`
- `GET/POST /api/projects`, `GET/POST/PATCH /api/budget-lines`
- `GET/POST /api/procurement`, `GET/PATCH /api/procurement/:id`
- `POST /api/procurement/:id/invoices`, `GET/POST /api/procurement/:id/comments`
- `GET /api/procurement/:id/memo`, `GET /api/procurement/:id/memo.pdf`
- `POST /api/procurement/:id/submit`, `POST /api/procurement/:id/discard`

## Web

Nav **Procurement** gated on `procurement.view` or `procurement.create`. Routes `/procurement`, `/procurement/new`, `/procurement/:id` (form or details, memo, invoice, seal, tracker, timeline, comments). GM home shows live My Procurement counts. Lightweight `/budget-lines` for Finance Head and ED Finance.

## Schema

Migration `0019_procurement.sql`. Seed: YFZ draft `PR-2026-000186` for Musa / XYZ Limited `VND-000018`. PR counter ≥ 186 so milling-machine `PR-2026-000184` stays unique.

## Acceptance

| Check | Result |
| --- | --- |
| Suspended vendor rejected (Sahel `VND-000019`) | Pass (`procurement.test.ts`, Playwright) |
| Spoofed total ignored; server `quantity × unit_price` | Pass |
| Invoice required vs mismatch flag (does not 400) | Pass |
| Memo fields + amount in words | Pass |
| Snapshot + PDF + hash + VALID GM seal | Pass |
| Tamper snapshot → INVALID / SNAPSHOT_MISMATCH | Pass |
| Submitted version UPDATE refused | Pass |
| Double submit same version: one workflow; idempotent key returns the same row | Pass |
| Cross-entity GM 404; Administrator 403 | Pass |
| Timeline + search scoped to entity | Pass |
| M4 milling-machine / `DEMO_PROCUREMENT` still green | Pass (`m4-engine.test.ts`, `workflows.spec.ts`) |

## M6 correction (money, invoice layout, memo)

Branch `fix/m6-memo-money-invoice`. Three items only.

**Money.** Amount fields were labeled “(kobo)” and stored the typed integer as kobo, so `500000` became `₦5,000.00` and `50,000,000` became `₦500,000.00`. `MoneyInput` now treats typed digits as whole naira; kobo appears only if the user types a decimal. Conversion to integer kobo stays in the hidden field at the form/API boundary. Helper: `formatNairaInputFromKobo` (no invented `.00`). Wired on procurement unit price, invoice amount, and budget-line approved amount.

**Invoice layout.** File upload is the primary control. After a file is chosen, invoice number / date / amount collapse to one compact row beside the filename. Same fields, validation, and required-before-submit. No OCR.

**Memo.** `MEMO_TEMPLATE_VERSION` is **2**. HTML and PDF dispatch on `snapshot.templateVersion`: v1 keeps the original layout including `SEAL BLOCK`; v2 is NFC letterhead (accent `#0b4f3a`), bordered To/From/Subject/Date table, line-item table, amount in words, prayer, and stamp-style seals (REQUESTED BY applied; later stages Pending). Frozen v1 snapshots are not restyled. Seal signing and `SealBadge` are unchanged.

| Check | Result |
| --- | --- |
| Typed/pasted whole naira is not divided by 100 | Pass (`formatNairaInputFromKobo`, `MoneyInput` on all amount fields) |
| Invoice attach is file-first with a compact meta row | Pass |
| New memos use v2 letterhead + stamps; frozen v1 stays v1 | Pass (`memo-html.test.ts`) |
| Existing M6 integration + Playwright still pass | Pass (`procurement.test.ts` 5, `procurement.spec.ts` 2, `design-system.spec.ts` money cases) |

## Next (M7)

Approval UX on `/procurement/:id` for ED Operations and MD. Return-for-Correction creates a new mutable draft version. Do not convert `PR-2026-000184` off `workflow_demo_subjects`.
