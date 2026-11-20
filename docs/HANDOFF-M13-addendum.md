# M13 / M14 — Inventory addendum

Companion to `HANDOFF-M9.md`, `HANDOFF-M13.md` and `HANDOFF-M14.md`. Where those documents disagree with this one, this one wins. Authority order for the rules below: `ADDENDUM-Inventory.md`, then the PDF, then the master build prompt.

## Settled decisions

- **GRN by the Procurement Manager, completion by the GM.** The Procurement Manager records one GRN per delivery (`procurement.grn.record`) with accepted, quarantined and rejected quantities. When every item is delivered and paid the request moves to `AWAITING_COMPLETION` and the requesting GM is notified (`procurement.awaiting_completion`). Only that GM can complete (`procurement.complete`, originator-only). The Administrator holds neither key.
- **Completion posts no inventory or GL for goods and equipment.** Stock and the inventory journal are posted at each GRN. Completion keeps the M9 package and the `verified` seal, closes the workflow, and reclasses service lines only. After MD quotation price-fill refreshes the frozen memo, earlier seals (`prepared`, `operations_reviewed`) may show `SNAPSHOT_MISMATCH`; seals from MD approval onward (`procurement_approved`, `approved`, `paid`, `verified`) remain `VALID`.
- **Expected is a forecast.** "Expected (forecast)" is derived from approved stock/asset procurement lines less GRN accepted + quarantined quantity. It never writes a balance. The legacy `expected_stock` table and the `inventory.apply_expected` handler are retained but no longer read or written by the API.
- **Five buckets.** On hand (physical, any status), Reserved, Available (released less reserved), Quarantined, WIP. Rejected stock is shown separately and is never available.
- **QC by the GM.** `inventory.qc.release` (GM, own subsidiary). Release moves stock Quarantined to Available; reject moves it to Rejected. A reason is required. QC decisions are recorded in the inventory audit trail and on the item timeline only. They add no stamp to the procurement memo.
- **Inter-subsidiary transfers are disabled** for new records. Existing inter-entity transfers remain visible read-only. Intra-entity store transfers use `STR-`.
- **New prefixes for new records only:** `ISS` (issue), `STR` (store transfer), `RET` (return), `ADJ` (adjustment / disposal), `VER` (count), `AST` (asset), plus existing `GRN`, `PRD`. Historical references are unchanged.

## Settings that must be confirmed by the client

`inventory_settings` holds two values. Both are seeded **UNCONFIRMED with a NULL value**. No working default exists in code, seed or migration; do not add one.

| Key | Used for |
| --- | --- |
| `lane_b_value_threshold_kobo` | Disposals, adjustments and over-threshold issues. |
| `production_variance_tolerance_bps` | Production output that differs from the plan. |

While a value is unconfirmed, the dependent workflow returns `CONFIGURATION_REQUIRED` (HTTP 409):

- Disposals and count adjustments cannot be prepared.
- Production output with a non-zero variance cannot be recorded. Zero-variance output completes normally.
- Issues post on Lane A (immediately). **Business decision pending:** once a threshold is confirmed, an issue at or above it goes to approval instead. Until then no issue is held, whatever its value.

Confirming a value is a database change with `status = 'CONFIRMED'`, `value_numeric`, `confirmed_by` and `confirmed_at` (enforced by a check constraint). Integration tests confirm a fixture value inside `withConfirmedInventorySetting` and restore UNCONFIRMED afterwards.

## Procurement changes

- Stock (`goods`) and asset (`equipment`) lines must be mapped to a Stock Register item before submission: choose an item or "create from this line". Service lines are not mapped. `submit` refuses unmapped lines ("Map item N … to a Stock Register item before submitting.").
- GRN posting: accepted quantity goes to Available, quarantined quantity to Quarantined (reason required), rejected quantity is vendor history only and is not stocked. The journal (`inv-grn:{grnId}`, source `INVENTORY_RECEIPT`) debits stock or assets and credits prepayment 1300 up to the amount prepaid, then AP 2110 for the rest (pay-after-delivery). Budget ACTUAL is written per GRN, proportionally.
- Delivered quantity for completion counts accepted + quarantined.

## Operations Desk

`/inventory/desk` shows tiles by permission. Actions:

| Action | Who | Lane |
| --- | --- | --- |
| Issue (`ISS-`), recipient name optional | Procurement Manager | A, or approval above a confirmed threshold |
| Store transfer (`STR-`), same subsidiary | Procurement Manager | A |
| Receive return / return to supplier (`RET-`) | Procurement Manager | A; received returns enter Quarantined |
| Count (`VER-`) | Procurement Manager | Completion is evidence only |
| Adjustment from a completed count (`ADJ-`) | Procurement Manager prepares; ED Ops approves; ED Finance too at or above the threshold | B |
| Disposal / damage / expiry with evidence (`ADJ-`) | Same as adjustment | B |
| QC release / reject | GM | Audit trail only |
| Asset register, assign, move, photo, request disposal (`AST-`) | Procurement Manager | Disposal is B |

Adjustments can only be prepared from a completed count, once per count, with lines that match the recorded variances.

## Production (M14)

- The GM creates orders (`production.create`), optionally from a versioned formula (`/inventory/production/formulas`). The Procurement Manager issues materials and records output (`production.complete`).
- Output always enters Quarantined and is released by the GM through QC.
- Zero variance completes immediately. A non-zero variance needs the confirmed tolerance; within tolerance it completes, beyond it the order goes to ED Operations.
- The GM closes a completed order; a note is required when there is variance or waste.
- Sales orders are created by the GM; dispatch and invoicing stay with the Procurement Manager. Sales returns enter Quarantined.

## Assets and scanning

- Asset photos are stored through the document service (JPEG/PNG, same subsidiary) and streamed via `GET /api/inventory/assets/:id/photo`; the web app proxies it at `/inventory/assets/:id/photo`.
- `/inventory/scan` looks up an asset reference or serial (with its photo), an item code or a batch. A small scanner icon in the ERP and EDMS top bars links to it for users with `inventory.view`.

## Interface wording

User-facing "My …" labels were removed (for example "Reports", "Requests this month", "Workspace", "Dashboard"). Routes such as `/me` and `/org-reports/mine` are unchanged.

## Tests

- `packages/db/test/inventory-m13.test.ts`: mapping before submit, forecast, one GRN with quarantine and GL, GM-only QC without a memo stamp, Lane A issue, threshold-gated issue / adjustment / disposal, count-only adjustment, asset photo and scan, role refusals.
- `packages/db/test/inventory-m14.test.ts`: quarantined production output and GM release, variance gating and escalation, close note, GM-created sales orders, quarantined returns.
- Procurement suites (M4, M9, requisition, M11, global scenario) now show the GRN leaving the request at `AWAITING_COMPLETION` and the GM completing it.
- `packages/shared/src/permissions.test.ts`: the GRN / completion / QC / production split.
