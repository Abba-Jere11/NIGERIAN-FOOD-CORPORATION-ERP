# M10 — Finance 1 (chart, ledger, banking, budgeting)

Companion to `HANDOFF-M1.md` through `HANDOFF-M9.md`.

## What shipped

- **Fiscal calendar** per entity: year 2026, twelve monthly periods, `OPEN` / `CLOSED` / `LOCKED`. ED Finance closes a period; posting is refused unless the period is `OPEN`.
- **Chart of accounts** from a global NFC template, copied to NFC, YFZ, YFW, DMA and NOM. Deactivate only. An account with journal lines cannot change type. Intercompany codes exist (`1210`, `2120`) but M10 does not post IC journals.
- **Manual journals** (`JNL-YYYY-NNNNNN`) with maker-checker (`journal-v1`). Drafts may be edited by the preparer. `PENDING_APPROVAL` and `POSTED` must balance (database trigger). Posted headers and lines cannot be edited or deleted. Correction is a reversal journal plus a new journal; both remain visible. Seals on `APPROVE`.
- **No procurement GL postings.** `procurement_payments` and `funding_transfer_records` stay off-ledger (M11). M8 funding still uses `entity_bank_accounts.recorded_balance_kobo`.
- **Banking** extends M8: nullable `gl_account_id` on `entity_bank_accounts` (seeded cash map). Same-entity transfers create two bank transactions and a `BANK_TRANSFER` journal when both accounts are mapped. CSV and XLSX statement import with column mapping. Matches are mutable so unmatch can set `unmatched_at` with a reason and audit. Report: matched / unmatched.
- **Versioned budgets** (`BUD-YYYY-NNNNNN`) wrap existing `budget_lines`. Proposed amounts live on `budget_version_lines` so a pending version cannot inflate M8 availability. Approval writes live `approved_amount_kobo`. `available` stays `approved − net commitments`. Paid/actual is a procurement-payments preview only.
- **Consolidation** is a sum with no eliminations. MD and ED Finance switch Consolidated vs NFC / YFZ / YFW / DMA / NOM.
- **Homes** show live finance queues (pending journals, pending budgets, unreconciled lines), not M18 KPI tiles. `/budget-lines` redirects to `/finance/budgets`.

## Maker-checker

| Book | Prepares | Approves |
| --- | --- | --- |
| Subsidiary journal / budget | Finance Head (own) or ED Finance | ED Finance |
| NFC Holding journal / budget | ED Finance | MD (`finance.journal.approve` / `finance.budget.approve`) |

Originator cannot approve. Administrator and ED Operations hold none of the M10 keys. GM has `finance.view` and `finance.budget.view` only (M11 adds `finance.dashboard.entity` for read-only entity KPIs).

## Permission keys

| Key | Holders |
| --- | --- |
| `finance.view` | already: MD, ED Finance, GM, Finance Head |
| `finance.view.consolidated` | MD, ED Finance |
| `finance.coa.manage` | ED Finance |
| `finance.journal.prepare` | ED Finance (all), Finance Head (own) |
| `finance.journal.approve` | ED Finance (all), MD |
| `finance.period.close` | ED Finance |
| `finance.bank.manage` | ED Finance (alongside existing `finance.bank_account.manage`) |
| `finance.reconcile` | ED Finance (all), Finance Head (own) |
| `finance.budget.prepare` | ED Finance (all), Finance Head (own) |
| `finance.budget.approve` | ED Finance (all), MD |
| `finance.budget.view` | MD, ED Finance, Finance Head, GM |

Existing `finance.bank_account.view|manage` HTTP contracts are unchanged.

## HTTP

- `GET /api/finance/context` — visible entities + `canConsolidate`
- `GET /api/finance/queues` — pending journals/budgets, unreconciled count
- Fiscal years + `POST /api/finance/periods/:id/close`
- COA list/create/update/deactivate/copy-template
- Journals list/get/create/update/submit/reverse; approval via `POST /api/workflows/:id/actions`
- `GET /api/finance/trial-balance?entityId|consolidated&periodId`
- `GET /api/finance/ledger?accountId&periodId`
- Bank transfers, statement import, reconcile/unmatch, reconciliation report
- Budgets list/get/create version/submit (utilization and variance on the get view)

## Schema

Migration `0023_finance_m10.sql`. Seed: FY 2026 all five entities; COA copy; bank GL map; approved 2026 budgets wrapping `{CODE}-CAPEX` (`YFZ-CAPEX` id unchanged); NFC Holding draft `BUD-2026-000005`; posted `JNL-2026-000001` and pending `JNL-2026-000002` on YFZ; YFZ statement with unmatched lines. UUIDs `301` / `302` / `311` / `321`.

## Domain events

`journal.submitted|approved|rejected`. `budget.submitted|approved|rejected`.

## Deviations

- Draft journals are rejected as unbalanced in the service (acceptance). The database trigger enforces balance only on `PENDING_APPROVAL` and `POSTED`.
- Statement XLSX is parsed server-side from the ZIP/XML, without a SheetJS dependency.
- Paid/actual on budgets reads `procurement_payments` as a display preview. They go fully live in M11.

## Acceptance

| Check | Result |
| --- | --- |
| Unbalanced journal cannot be saved (service + DB on PENDING) | Pass (`finance-m10.test.ts`) |
| Posted journal cannot be edited or deleted (trigger) | Pass |
| Correction = reversal + new journal, both visible | Pass |
| Preparer cannot approve own journal; NFC Holding needs MD | Pass |
| Posting to a closed period fails | Pass |
| Trial balance balances per entity and consolidated | Pass |
| YFZ Finance Head cannot view DMA ledger/bank/budget; ED Finance can switch | Pass |
| Reconciliation marks matches and lists unreconciled | Pass |
| M6 budget lines migrated; `YFZ-CAPEX` intact | Pass |
| Budget variance and approved-vs-actual compute from seed; pending version does not change live amounts | Pass |
| Playwright smoke: journals, COA, trial balance, redirect, queues | Spec added (`apps/web/e2e/finance-m10.spec.ts`). Re-run against a freshly started API/web on the test database (ports 3000/4000 must not be an older build). |

## Explicitly not in M10

Payables, receivables, inter-subsidiary journals, procurement-to-GL postings (M11). Management reports (M12). Inventory (M13). Full A8b consolidated finance KPI tiles (M18). Seventh role. Changing M8 payment/transfer HTTP contracts.

## Next (M11)

Post procurement `PAY` / `TRF` into the ledger. Do not start inventory receipts (M13) or M18 tiles from this handoff.
