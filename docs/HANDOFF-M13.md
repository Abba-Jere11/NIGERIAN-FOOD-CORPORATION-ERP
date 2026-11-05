# M13 — Inventory 1

Companion to `HANDOFF-M1.md` through `HANDOFF-M12.md`.

## What shipped

- **Per-entity stock.** One Inventory Officer (Hauwa, corporate) oversees every subsidiary. Opening YFZ shows YFZ items, warehouses, movements and valuation only. GM is locked to their entity; ED Operations and MD switch with the same `?scope=` bar Finance uses. No consolidated stock. Administrator stays out.
- **Master data.** Categories (seeded per subsidiary), UOM + conversions, warehouses (DMA cold-room), items with weighted-average cost, reorder levels, tracking `none | batch_lot | serial`, supplier links.
- **Expected vs on-hand.** ED Finance approval of a stock/asset PR creates `expected_stock`. On-hand is unchanged until a GRN is accepted.
- **Receipts.** Officer still records GRNs on the procurement page. Accepted qty becomes an append-only `INV-` movement; rejected/damaged qty is recorded on the GRN and is not stocked. Unmapped PR lines create an item rather than dropping stock. Supersede reverses the prior movement (new INV out) and applies the new GRN.
- **Ledger.** Each accepted GRN posts Dr 1400 (goods) or 1500 (equipment) Cr 1300 (`INVENTORY_RECEIPT`, idempotency `inv-grn:{grnId}`). Goods/equipment **complete** reclass posts only the unposted remainder so 1400 is not double-counted. Issues / write-offs / approved adjustments post Dr 5100 Cr 1400.
- **Operations.** Issues (reason + destination type). Intra-entity transfer: two movements. Inter-entity transfer: `inventory-transfer-v1` (ED Ops), in-transit until dest warehouse receipt, IC `type: 'transfer'` without banks (source Dr 1210 Cr 1400, dest Dr 1400 Cr 2120). Adjustments/write-offs: officer prepares (`inventory-adjust-v1`); GM or ED Ops approves; preparer ≠ approver. Counts: variance submits a pending adjustment.
- **Alerts.** On-hand ≤ reorder publishes `inventory.low_stock` to the officer. Home tiles are live counts.
- **Reports hub.** Inventory category is **available**, href `/inventory`. Integrity `inventory` check compares GL 1400/1500 to valued movements.

## Access

Checked with `can()`, never role names. Mutation keys sit in `APPROVAL_OR_PAYMENT_KEYS` (Administrator cannot hold them).

| Key | Holders |
| --- | --- |
| `inventory.view` | Officer (all), GM (own), ED Ops, MD |
| `inventory.item.manage`, `inventory.receive`, `inventory.issue`, `inventory.transfer`, `inventory.adjust.prepare`, `inventory.count`, `inventory.config` | Inventory Officer |
| `inventory.adjust.approve` | ED Operations (all), GM (own) |

Finance Head / ED Finance / Admin: no Inventory module. Integrity inventory check remains on Finance reports for `finance.view`.

## HTTP (additive)

- `GET /api/inventory/context`, `GET /api/inventory/kpis`, `GET /api/inventory?entityId=`
- Items, categories, warehouses, expected, movements, alerts, issues, transfers, adjustments, counts as listed on the inventory screens
- GRN payload now includes `grnId`, `lineId`, quantities, optional `warehouseId` / batch / serials

## Schema

Migration `0040_inventory.sql`. Append-only `stock_movements` (`INV`). Dual-entity RLS on `stock_transfers` like inter-company. Journal sources `INVENTORY_*`. Workflows `inventory-adjust-v1` / `inventory-transfer-v1`.

## Deviations

- Intra-entity transfers do not post GL (warehouse to warehouse, same 1400).
- Inter-company stock journals omit bank lines; dest Finance Head still acknowledges the IC row.
- Production *orders* and sales are M14; issue destination type `production` is allowed as a label only.
- SMTP is unchanged.
- Pre-M13 goods/equipment completions already posted full 1300→1400/1500. Seeded GRN layers and that historical reclass can differ; new receipts post per GRN and completion posts only the remainder. The integrity `inventory` check is live (not UNAVAILABLE).

## Acceptance

| Check | Result |
| --- | --- |
| Expected on ED Finance approve; on-hand unchanged | Pass (`inventory-m13.test.ts`) |
| GRN 800 of 1000 → 800 on-hand, 200 expected; rejected not stocked | Pass |
| Movements immutable; on-hand = sum | Pass |
| Adjustment reason + different approver | Pass |
| Count variance → pending adjustment | Pass |
| GM YFZ 403 on DMA item | Pass |
| Batch/serial required when item says so | Pass |
| Valuation vs GL integrity (not UNAVAILABLE) | Pass |
| Admin/GM cannot receive or prepare adjust | Pass |
| Playwright: officer YFZ stock + item; GM cannot open DMA; ED Ops adjustment queue | Pass (`inventory.spec.ts`) |

## Explicitly not in M13

Production orders and sales (M14). Payroll (M17). Changing SMTP. A second inventory officer. Consolidated stock.

## Next (M14)

Production and sales. Do not start payroll from this handoff.
