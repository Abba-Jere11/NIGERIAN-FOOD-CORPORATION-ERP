# M11 — Finance 2 (AR, AP, inter-company, procurement GL)

Companion to `HANDOFF-M1.md` through `HANDOFF-M10.md`.

## What shipped

- **Customers and receivables.** `CUS-` register, invoiced and cash income (`INC-` / `income-v1`), `ARI-` invoices, `RCT-` receipts with allocations, aging (`Current`, `1–30`, `31–60`, `61–90`, `90+`) and a per-customer statement.
- **Expenses and payables.** Operating expenses (`EXP-` / `expense-v1`) post Dr category / Cr `2110` or bank. Non-procurement bills (`BILL-` / `bill-v1`) and procurement payment rows share one payable register. Overdue is computed on read from due date and unpaid remainder. Vendor payment execution stays M8 `POST /api/procurement/:id/payments`.
- **Inter-company.** One `intercompany_transactions` header (`ICT-`, or reused `TRF-` for M8 funding). Mirrored journals: source Dr `1210` / Cr cash, dest Dr cash / Cr `2120`. Destination Finance Head acknowledges. Mismatch when either journal is not `POSTED`. Consolidation elimination is M12.
- **Procurement → GL.** System journals auto-post (`JournalsService.postSystemInTx`, no `journal-v1`). PAY: Dr `1300` / Cr bank, `bank_transactions` `PAYMENT`, `budget_commitment_events` `PAY`. Completion reclass: goods `1400`, equipment `1500`, services `5220` / Cr `1300`, `ACTUAL`. Payment reversal posts a reversing journal and `REVERSE_PAY`. M8 PAY/TRF HTTP contracts are unchanged.
- **Commitments.** `procurement_commitment_events` OPEN/RELEASE is unchanged (`available = approved − net OPEN/RELEASE`). Append-only `budget_commitment_events` records `COMMIT`, `APPROVE_FINANCE`, `PAY`, `ACTUAL`, `RELEASE`.
- **Funding check.** Primary figure is the posted GL balance of the paying entity’s mapped cash account. `recorded_balance_kobo` is still shown. No “(pre-ledger)” copy.
- **Dashboards.** `/finance/dashboard` only — ED Finance consolidated + four subsidiary cards; Finance Head and GM entity-only (GM read-only). Tiles: Total Budget, Utilization, Cash Position, Revenue, Expenditure, Outstanding Payables, Outstanding Receivables, Inter-company Transfers, Procurement Commitments, Profit/Loss. No Payroll tile. M10 home queues stay; GM/MD/Admin homes do not gain these KPI tiles (M18).
- **Search.** `hrefFor` for `CUSTOMER`, `AR_INVOICE`, `RECEIPT`, `BILL`, `INCOME`, `EXPENSE`, `INTERCOMPANY`.

## Maker-checker

| Book | Prepares | Approves |
| --- | --- | --- |
| Subsidiary income / expense / bill | Finance Head (own) or ED Finance | ED Finance (`finance.expense.approve`) |
| NFC Holding income / expense / bill | ED Finance | MD (`finance.expense.approve`) |

Originator cannot approve. System PAY / TRF / ICT / receipt / reclass / reversal journals skip maker-checker.

## Permission keys

| Key | ED Finance | MD | Finance Head | GM | Admin / ED Ops |
| --- | --- | --- | --- | --- | --- |
| `finance.income.manage` | all | — | own | — | — |
| `finance.expense.manage` | all | — | own | — | — |
| `finance.expense.approve` | all | yes (Holding) | — | — | — |
| `finance.payables.manage` | all | — | own | — | — |
| `finance.receivables.manage` | all | — | own | — | — |
| `finance.intercompany.create` | all | — | — | — | — |
| `finance.intercompany.acknowledge` | — | — | dest entity | — | — |
| `finance.customer.manage` | all | — | own | — | — |
| `finance.dashboard.consolidated` | yes | yes (view) | — | — | — |
| `finance.dashboard.entity` | yes | yes (view) | own | own (read-only) | — |

Manage / approve / IC keys are in `APPROVAL_OR_PAYMENT_KEYS`. Administrator receives none. Dashboard view keys are not approval-or-payment.

## HTTP (additive)

- `GET/POST /api/finance/customers`, `GET .../customers/:id/statement`
- Income / expense list, get, create, submit; approval via `POST /api/workflows/:id/actions`
- `GET /api/finance/receivables`, `.../aging`, `POST /api/finance/receipts`
- Payables list/get/create/submit
- `GET/POST /api/finance/intercompany`, `GET .../mismatches`, `POST .../:id/acknowledge`
- `GET /api/finance/dashboard?entityId=`

M8 `POST /api/procurement/:id/payments` and funding-transfer routes keep the same request/response fields.

## Schema

Migration `0024_finance_m11.sql`. New COA `1220`, `4110`, `5230`–`5260`. Journal sources and bank kinds widened. Config: `income_categories`, `expense_categories`, `category_posting_rules`. Seed UUIDs `331`–`339`: YFZ customer + aging AR, overdue `BILL-`, opening cash journals matching recorded bank balances (so the GL funding check stays solvent after the ₦100m IC), ₦100m `TRF-2026-000901` NFC→YFZ, mismatch fixture with dest journal `REVERSED`, GL backfill for paid M9 PRs.

## Domain events

`income|expense|bill.submitted|approved|rejected`. `intercompany.recorded|acknowledged`. `receipt.recorded`. Existing `procurement.paid|completed` now also write ledger side-effects.

## Deviations

- Income, expense and bill share the `finance.expense.approve` stage permission (single-stage `*-v1`). Holding still needs MD as the second user.
- Payable `OVERDUE` is a read-time flag, not a persisted status, except when a later payment or schedule job updates `UNPAID` / `PART_PAID` / `PAID`.
- Procurement payables are a register of the payment; the GL remains prepayment (`1300`) until completion reclass. No M13 stock movements.

## Acceptance

| Check | Result |
| --- | --- |
| ₦20m COMMIT, RETURN RELEASE, ₦22m recommit on YFZ-CAPEX | Pass (`finance-m11.test.ts`) |
| PAY posts balanced Dr 1300 / Cr bank, linked to PR/vendor | Pass |
| Completion reclass Dr 5220 / Cr 1300 for services; `ACTUAL` event | Pass |
| ₦100m linked IC both journals POSTED; mismatch after dest REVERSED | Pass |
| Aging buckets Current / 1–30 / 31–60 / 61–90 / 90+ | Pass |
| Seeded YFZ bill is overdue | Pass |
| YFZ Finance Head cannot read DMA customers or DMA dashboard | Pass |
| Administrator denied customers / income / dashboard | Pass |
| Preparer cannot approve own expense; ED Finance posts it | Pass |
| Funding check summary uses ledger + recorded, not “(pre-ledger)” | Pass |
| M8 / M9 / M10 suites remain green | Keep (`procurement-m8`, `procurement-m9`, `finance-m10`) |
| Playwright: dashboard tiles, customers/AR, IC, `/finance/dashboard` isolation | Spec added (`apps/web/e2e/finance-m11.spec.ts`) |

## Explicitly not in M11

Financial statements and IC eliminations (M12). Payroll postings and Payroll tile (M17). Inventory receipts/movements (M13). Changing M8 PAY/TRF request/response fields. Seventh role. M18 corporate/MD KPI home.

## Next (M12)

Statements and consolidation eliminations. Do not start payroll (M17), inventory (M13) or M18 homes from this handoff.
