# ADDENDUM — Inventory (Operations Desk + Management)

Applies to M13 and M14 of `NFC_Mini_ERP_Build_Prompt.md`. Functional reference: `NFC_ERP_Smart_Inventory_Blueprint_and_Manual_v1_1.pdf`.
**Precedence: this addendum > the PDF > the master prompt's M13/M14 text.** Inspect the existing code first and report what already exists versus gaps before coding. Reuse: M9 GRN, M6 category flags, the M10–M12 ledger, the approval engine, seals, the document service. No new roles, no duplicate receipt record, no second ledger.

## 1. Principle
One append-only stock ledger; balances derive from it. Two workspaces on it: **Inventory Management** (records) and **Operations Desk** (POS-style actions). Nothing edits a balance; corrections are reversals or approved adjustments. Receiving is not a desk action: it comes from procurement.

## 2. Who does what (existing users only)
| Work | Does it | Approves |
|---|---|---|
| Stock Register, warehouses, locations, batches | Procurement Manager | none |
| Receipt and quarantine status (the M9 GRN) | Procurement Manager | none |
| QC release/reject of quarantined stock and production outputs | GM (own subsidiary) | none, reason required |
| Issue, within-subsidiary transfer, receive return, return to supplier, asset assign/move | Procurement Manager | direct-post (lane A) |
| Production order (plan) and close | GM | none, variances explained |
| Production issue, consumption, return, outputs | Procurement Manager | ED Operations only if variance exceeds tolerance |
| Dispatch against a confirmed sales order | Procurement Manager (GM creates the order, per M14) | per M14 |
| Counts | Procurement Manager | ED Operations approves the adjustment |
| Disposal/write-off, stock adjustment, asset disposal | Procurement Manager prepares | ED Operations; plus ED Finance at or above the value threshold |
| View | MD, ED Operations (all subsidiaries); GM (own); Procurement Manager (all) | |

Administrator: none. Custodians, receiving departments and department requesters are **data (name + department), not logins**. "Acknowledgement" = recipient name recorded plus optional signed-slip upload. No department-request workflow.

## 3. Operations Desk — `/inventory/desk`
- Entity-locked: the user selects ONE subsidiary (reuse the Finance entity switcher; GM locked to own). Everything on screen belongs to it.
- Layout: scan/search bar (item code, name, batch, asset ID) → action tiles → basket (item, batch or asset IDs, qty, unit, from→to) → type-specific side panel → Review (shows stock effect) → Post. One basket = one transaction type = one reference. Never mix types.
- Tiles (10): Issue Stock · Transfer Stock · Sell/Dispatch · Production Issue · Receive Return · Return to Supplier · Dispose/Write-off · Asset Assign/Move · Stock Adjustment · QC Release/Reject. Show tiles by permission.
- **Lane A, direct-post (immediate, fully audited):** issue, within-subsidiary transfer (one step, no in-transit), receive return (enters Quarantined), return to supplier, asset assign/move, production issue against an approved order, dispatch against a confirmed order, QC release/reject.
- **Lane B, approval engine (mandatory reason, seal):** disposal/write-off, stock adjustment, asset disposal, issue above the value threshold, production variance beyond tolerance. Approver: ED Operations; plus ED Finance at or above the value threshold. Threshold and tolerance live in settings (client to confirm figures).
- Inter-subsidiary stock transfers: not in this phase.

## 4. Inventory Management
Sidebar (Procurement Manager): Home · Procurement · Operations Desk · Stock Register · Balances · Warehouses & Locations · Batches · Assets · Ledger · Counts · Reports. MD/ED Operations/GM: read-only Balances, Ledger, Reports (GM own subsidiary).
Balances show: On hand · Reserved · Available · Quarantined · In production (WIP), each drilling to ledger rows.

## 5. Procurement → inventory (one record, not two)
- **The M9 GRN is the receipt.** Extend it per line: accepted / quarantined / rejected quantities with reasons, warehouse location, batch. Saving auto-posts accepted quantity (event `goods.received`); quarantined and rejected post to their statuses. No second receipt form.
- **Item mapping:** at the Procurement Manager's proposal stage, each line is mapped to a Stock Register item (create if absent). The item carries primary unit, tracking mode (quantity / batch / individual) and asset-vs-consumable. Lines whose category has neither the stock nor the asset flag (services) skip inventory.
- Stock rises at accepted receipt: not at payment, not at GM completion. GM completion (step 18) stays as the requester's independent confirmation.
- Short deliveries keep the M9 mechanism unchanged (expected next batch date, close-short, vendor claim). Rejected stock links to the vendor record.

## 6. Units
Primary unit per item (bags, pieces, litres…) is what users transact in. Optional secondary measurement (e.g. weight) is captured only where needed and never silently converts. Replace M13's "unit conversions" wording. Never add unlike units together. Production variance = actual vs formula expected output per configured input quantity, each in its own unit.

## 7. Production (M14)
Versioned formula (inputs, expected outputs/by-products, tolerance %). Order → reserve → issue (WIP) → actual consumption → return unused → outputs. **Outputs post as Quarantined (pending QC) immediately** and become available only when the GM releases them. Loss is recorded in the subsidiary's own process measure. Cost: materials + packaging to the main product; by-products at zero; labour/overheads excluded until ED Finance sets a policy.

## 8. Sales / dispatch (M14)
Order (customers/prices from M11) → reserve → Desk dispatch posts stock out → AR invoice via M11. Stock falls only on posted dispatch. Customer return enters Quarantined.

## 9. Fixed assets (M13-B)
Individually tracked items create one asset record per unit (`AST-…`): entity, department, location, custodian (name), condition, GRN/PR link, serial. Assign/move/dispose add history rows, never edits. QR label generation and print now; camera scanning later (browsers need HTTPS for camera). No depreciation in this phase; flag to client.

## 10. Counts (verification) — new, there is no existing count process
Scoped by entity/warehouse/location/item/batch; blind-count option; variance → explanation → ED Operations approval → posted adjustment. A count is evidence; an adjustment is a separate approved event. Adjustment can only start from a completed count.

## 11. Finance postings (existing ledger)
- **Accepted receipt (goods/assets):** Dr inventory (1400 goods / 1500 equipment) / Cr prepayment (paid before) or payable (not yet paid), per GRN = accepted qty × approved unit price. This **replaces the M11 completion reclass for goods and assets**, and the budget `ACTUAL` event moves with it. Services keep the completion reclass. GM completion posts nothing to inventory.
- Valuation: weighted average (FEFO selection for perishables). Dispatch: Dr cost of sales / Cr inventory. Write-off/adjustment: loss/gain on approval. Within-subsidiary transfers: no posting.

## 12. Intelligence (rules, not AI; nothing automatic)
Reorder level = average daily use × lead time + safety stock, compared with available + approved incoming. Days of cover. Production variance and count-discrepancy flags. Abnormal consumption vs rolling average. Supplier performance (shortages, rejections, lateness). Near-expiry and slow-moving. Every alert shows its numbers and may pre-fill a requisition draft for the GM. Nothing orders, posts or adjusts by itself. Forecasting later.

## 13. References and permissions
- References follow A7 (six digits): GRN-, ISS-, **STR-** for stock transfers (never `TRF-`, used by funding transfers), RET-, DSP-, ADJ-, CON-, PRD-, AST-, VER-.
- Reuse the key names already in the master prompt's M13/M14 (`inventory.*`, `production.*`, `sales.*`). Procurement Manager holds the operator keys (replaces Inventory Officer). Add only: `inventory.qc.release` (GM), `inventory.dispose.request` / `inventory.dispose.approve`, `inventory.asset.manage`, `inventory.return.supplier`. Approve keys: ED Operations (+ ED Finance at threshold).

## 14. Build order (no renumbering)
- **M13-A:** item register and line mapping, warehouses/locations/batches/statuses, ledger and balances, GRN extension with quarantine and auto-post and finance posting, Desk (issue, transfer, receive return, return to supplier, dispose, adjust, QC release), counts, reorder alerts.
- **M13-B:** individually tracked assets.
- **M14:** production and sales/dispatch.
- **After M18:** camera/mobile scanning, offline, weighbridge, cold-room, forecasting, inter-subsidiary transfers.

## 15. Acceptance
PDF §19.1 tests 1–12 (test 12 uses our permission model), plus:
- [ ] One GRN per delivery event; no second receipt form exists.
- [ ] A stock/asset line cannot be submitted without an item mapping; services lines skip inventory.
- [ ] Stock and GL inventory value both change at accepted receipt, per GRN for partial deliveries; GM completion posts nothing to inventory.
- [ ] Lane A actions post immediately; disposal, adjustment and over-threshold issue refuse to post until approved.
- [ ] An adjustment cannot start except from a completed count.
- [ ] GM cannot use PM desk actions; PM cannot QC-release; Administrator refused everywhere (direct API).
- [ ] Production outputs appear Quarantined and are unavailable until the GM releases them.
- [ ] Stock transfers carry STR- references.

**Cursor:** Plan mode first. Branch from HEAD. Report existing-vs-gap table before coding. Keep M6–M12 tests green. Write a handoff note.
