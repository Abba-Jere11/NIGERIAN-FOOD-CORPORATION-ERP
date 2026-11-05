# M8 — Procurement 3 (ED Finance review, funding, payment)

Companion to `HANDOFF-M1.md` through `HANDOFF-M7.md`.

## What shipped

- **`ed-finance` and `finance-head` are live** on real `PROCUREMENT` subjects. The M7 deferral is gone.
- **Financial checks** are computed from live queries (amount, budget, vendor, history, recorded bank balance, duplicate request, cross-subsidiary invoice, invoice match, responsibility, open commitments). Approving stores an append-only snapshot. A FAIL requires an override reason and checklist acknowledgement.
- **Funding routes** (A10.5): A subsidiary operating → Finance Head pays; B NFC Holding pays (ED Finance); C corporate allocation → ED Finance records `TRF-…`, then the subsidiary Finance Head pays. There is no seventh “Corporate Finance” role.
- **Entity bank accounts** with recorded balances (pre-ledger; M10/M11 replace this). Account numbers are masked unless `finance.bank_account.view` is held.
- **Payments** (`PAY-…`) lock to the authorized amount, unique bank reference per account, idempotency key, vendor must stay Active. Completion sets `AWAITING_DELIVERY`, applies a `paid` seal, notifies the GM.
- **After money has moved** (a recorded transfer or a completed payment), Reject / Return / Archive are refused.
- **Payment correction:** request (Finance Head) + approve (ED Finance) appends a reversal, keeps the original visible, and re-opens `AWAITING_PAYMENT` for a replacement.

## Explicitly not in M8

Ledger postings and budget accounting (M11). GRN / delivery / `verified` seal (M9). Full banking (M10). M18 consolidated finance tiles.

## Permission keys

| Key | Holders |
| --- | --- |
| `procurement.review.finance` | ED Finance (already; not renamed) |
| `finance.funding.authorize` | ED Finance (already) |
| `finance.funding.transfer.record` | ED Finance |
| `finance.payment.execute` | Finance Head (own subsidiary); ED Finance still holds the catalog key but `SAME_ENTITY` blocks them at Finance Head |
| `finance.payment.execute.corporate` | ED Finance (route B) |
| `finance.payment.reverse.request` | Finance Head |
| `finance.payment.reverse.approve` | ED Finance |
| `finance.bank_account.view` | ED Finance, Finance Head |
| `finance.bank_account.manage` | ED Finance |
| `document.upload` | also granted to ED Finance and Finance Head for proof files |

Administrator holds none of the approval/payment keys.

## HTTP

- `GET /api/procurement/:id/financial-checks`
- `POST /api/procurement/:id/actions` — finance approve adds `fundingRoute`, account ids, `checklistAcknowledged`, `overrideReason`
- `POST /api/funding-transfers` (multipart proof)
- `POST /api/procurement/:id/payments` (multipart proof)
- `POST /api/procurement/:id/payments/:paymentId/reverse-request|reverse-approve`
- `GET/POST /api/bank-accounts`, `PATCH /api/bank-accounts/:id`

## Schema

Migration `0021_procurement_m8.sql`. Seed: bank accounts per entity; `PR-2026-000191` awaiting ED Finance; `PR-2026-000192` (YFW) shares invoice `INV-SEED-CROSS-001` with 191. Counter ≥ 192. `PR-2026-000184` / `186`–`190` unchanged.

## Domain events

`procurement.paid`, `procurement.funds_allocated`, `inventory.expected_stock.requested` (outbox only; inventory tables wait for M13).

## Deviations

- Runtime approve/reject/return stay stage-gated. Catalog keys exist for role screens and Administrator conflict tests.
- Payment is not workflow `APPROVE` at `finance-head`; it is `POST .../payments`. Workflow `APPROVE` at that stage is refused.
- Route B stays on the `ed-finance` stage until payment (ED Finance is the payer).
- Recorded bank balance is the funding-sufficiency input until the ledger exists.

## Acceptance

| Check | Result |
| --- | --- |
| All 8A checks return real results from seeded data, including duplicate invoice across subsidiaries and vendor history | Pass (`procurement-m8.test.ts`) |
| Approving over a FAIL demands an override reason; snapshot stored | Pass |
| Route C: TRF fields + reference + proof; route A skips transfer; route B paid by ED Finance only | Pass |
| Finance Head of subsidiary X cannot pay subsidiary Y (API) | Pass (RLS returns 404; Administrator is 403) |
| Payment amount ≠ authorized rejected; duplicate bank reference / double-click → one payment | Pass |
| Suspending the vendor after MD approval blocks payment | Pass |
| Payment completion → `AWAITING_DELIVERY`, `paid` seal, GM notified | Pass |
| After a payment exists, Reject/Return/Archive refused | Pass |
| Payment correction produces a reversal + original remains visible | Pass |
| Seal chain GM / Ops / MD / ED Finance / paid VALID | Pass |
| Playwright smoke: ED Finance route A + YFZ Finance Head pay; DMA Finance Head refused | Pass (`procurement-m8.spec.ts`) |

## Next (M9)

GM delivery verification, GRN, completion, expected-stock conversion, dashboards.
