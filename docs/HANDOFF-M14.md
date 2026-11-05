# M14 — Inventory 2: production and sales

Companion to `HANDOFF-M1.md` through `HANDOFF-M13.md`.

## What shipped

- **Production orders (`PRD`).** Inventory Officer plans inputs and finished output, starts the order (raw issue → WIP 1410), then submits completion. GM (own) or ED Operations (all) approve. Waste, overhead and finished-goods receipt post on approve. Yield is actual / planned output. Batch links run both ways. Cancel from Planned or In Progress reverses consume movements and the WIP journal. Completed orders are not cancelled.
- **Sales orders (`SO`).** Officer drafts against an M11 customer. Approval reserves available stock (`on-hand − reserved`). Dispatch (`DSP`) issues `SALE` movements and releases the reservation. Invoice inserts an `ARI` (`sales_order_id` set) and posts revenue (Dr 1220 Cr 4100) plus COGS (Dr 5100 Cr 1400). Finance Head collects payment with the existing M11 receipt API. Cancel before dispatch; after dispatch use a sales return (`SRN`) with reversing movements and journals.
- **Available-to-sell.** Issues, transfers, adjustments and new reservations all fail when reserved qty would be oversold.
- **Ledger.** Account **1410 Work in progress**. Integrity compares GL 1400 + 1500 + 1410 to valued movements plus open WIP. Completed orders leave 1410 clear for that order.
- **One Inventory Officer.** Hauwa still operates every subsidiary with `?scope=`. Sidebar stays Inventory. Finance Head / ED Finance / Administrator stay out of production and sales screens.

## Access

Checked with `can()`, never role names. Mutation keys sit in `APPROVAL_OR_PAYMENT_KEYS`.

| Key | Holders |
| --- | --- |
| `sales.view` | Officer (all), GM (own), ED Ops, MD |
| `production.create`, `production.complete` | Inventory Officer |
| `production.approve` | ED Operations (all), GM (own). Preparer ≠ approver |
| `sales.order.create`, `sales.dispatch`, `sales.invoice` | Inventory Officer |
| `sales.order.approve` | ED Operations (all), GM (own). Preparer ≠ approver |

## HTTP (additive)

- `GET/POST /api/inventory/production`, start / complete / cancel
- `GET/POST /api/inventory/sales`, customers / dispatches / invoices, submit / cancel / dispatch / invoice / return
- Item detail includes reserved qty, produced-from, consumed-in and sold-on
- `/api/inventory/kpis` adds open production orders and reserved sales lines

## Schema

Migration `0041_inventory_m14.sql`. Workflows `production-complete-v1` and `sales-order-v1`. Journal sources `PRODUCTION_*` and `SALES_*`. Movement sources `PRODUCTION`, `SALE`, `SALES_RETURN`.

## Deviations

- Waste is valued as a share of RM consumed: `rmValue * wasteQty / (actualOutput + wasteQty)`.
- Unpaid AR invoices on return are settled by a reversing `SALES_RETURN` journal and `allocated_kobo = amount` (status `PAID`). Posted journal lines are not updated.
- SMTP is unchanged. No EDMS portal. No payroll.

## Acceptance

| Check | Result |
| --- | --- |
| Consume RM → FG batch + waste + yield; 1410 clears | Pass (`inventory-m14.test.ts`) |
| Batch trace finished → raw and raw → finished | Pass |
| Reserve then second SO cannot oversell; dispatch reduces on-hand and reservation | Pass |
| Invoice creates ARI; M11 receipt clears it; income 4100 and COGS 5100 posted | Pass |
| Return/cancel keep originals and link reversing INV + journals | Pass |
| GM YFZ 403 on DMA PRD/SO | Pass |
| Admin/GM cannot create production or dispatch | Pass |
| Officer cannot approve own complete/SO (R14) | Pass |
| Playwright: officer YFW production + YFZ sales; GM cannot open DMA sales; ED Ops production queue | Pass (`inventory-m14.spec.ts`) |

## Explicitly not in M14

EDMS portal (M15). Payroll (M17). Changing SMTP. A second inventory officer. Consolidated stock.

## Next (M15)

EDMS portal. Do not start payroll from this handoff.
