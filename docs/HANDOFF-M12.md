# M12 — Finance 3 (reporting and consolidation)

Companion to `HANDOFF-M1.md` through `HANDOFF-M11.md`.

## What shipped

- **Statements.** Income statement (period or YTD), balance sheet as-of period end with current-year earnings so the sheet balances, cash-flow from `bank_transactions`, trial balance and general ledger. Consolidated mode rolls up by `consolidation_code`.
- **Elimination engine.** Report-time only. Posted IC pairs (both journals `POSTED`) remove `1210`/`2120`. The seeded mismatch (dest `REVERSED`) is not eliminated. Entity journals are never rewritten.
- **Management reports.** Budget vs actual, expense/revenue analysis, payables, receivables aging, procurement expenditure, subsidiary comparison, inter-company/elimination worksheet. Payroll summary is an explicit empty state until M17.
- **Traceability.** Report figures drill to ledger lines, then the journal, then the source document (PR, ICT, payable, receivable).
- **Parameters and output.** Period, year, YTD, entity/consolidated, comparison period, department/project. CSV, XLSX and PDF exports with an NFC heading. Saved parameter sets. Every run is `RPT-` and is audited (`create` on screen, `download` on export).
- **Integrity.** Unbalanced journals, orphan lines, bank/AR/AP (posted-linked), IC 1210/2120 vs posted pairs, unlinked IC lines. Inventory check is `UNAVAILABLE` (M13). Clean seed: only the known IC mismatch fails on consolidation.

## Access

`finance.view` runs entity reports. `finance.view.consolidated` is required for consolidated and subsidiary-comparison. No new permission keys. Administrator is refused. Finance Head is confined to their entity (API and RLS).

## HTTP (additive)

- `GET /api/finance/reports`
- `GET /api/finance/reports/:kind`
- `GET /api/finance/reports/:kind/export?format=csv|xlsx|pdf`
- `GET /api/finance/reports/integrity`
- `GET /api/finance/reports/eliminations`
- `GET /api/finance/reports/drill?accountCodes=`
- `GET/POST /api/finance/report-sets`, `POST .../:id/inactive`

Consolidated `GET /api/finance/trial-balance` now applies eliminations. M8 PAY/TRF contracts are unchanged. M11 dashboard tiles remain an uneliminated sum.

## Schema

Migration `0025_finance_m12.sql`. `RPT` reference kind. `report_parameter_sets` (owner RLS). `report_runs` (append-only; consolidated rows require a corporate actor). Seed UUID `341`: ED Finance saved FY 2026 consolidated income statement.

## Deviations

- Eliminations are computed, not posted.
- Cash flow is classified from bank kinds; opening/closing cash on the statement are GL `11%` balances and may differ from bank-net when seed journals have no bank line.
- AR/AP integrity compares **posted** invoices only (seed register rows without journals are ignored).
- Payroll and inventory remain empty/unavailable.

## Acceptance

| Check | Result |
| --- | --- |
| Consolidated statements = sum of entities minus posted-pair eliminations | Pass (`finance-m12.test.ts`) |
| Balance sheet balances | Pass |
| Cash-flow net equals classified bank movements | Pass |
| Drill to source in at most three clicks | Spec + journal `sourceHref` |
| Finance Head cannot run/export another entity | Pass (API) |
| Exports match on-screen values; runs logged | Pass |
| Integrity: clean checks OK; seeded mismatch detected | Pass |
| M8 / M9 / M10 / M11 suites remain green | Keep |

## Explicitly not in M12

Payroll postings (M17). Inventory movements / inventory recon figures (M13). Changing M8 PAY/TRF contracts. Posting elimination journals. M18 corporate/MD home KPI tiles. Changing M11 dashboard tile aggregation. Seventh role.

## Next (M13)

Inventory items, warehouses, stock, receipts, transfers, adjustments and counts. Do not start production/sales (M14) or payroll (M17) from this handoff.
