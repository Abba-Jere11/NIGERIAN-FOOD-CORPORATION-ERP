# M6–M9 addendum — Dual-approval requisition

Companion to `HANDOFF-M6.md` through `HANDOFF-M9.md`. This is an in-place amendment of the live procurement stack, not a new repo milestone. Global dashboards stay M19.

## What shipped

- **Display rename only.** Role key stays `inventory_officer`. Seed user `inventory@nfc.local`, `/home/inventory`, and delivery/GRN/close-short grants stay. Labels, home titles and seed position are **Procurement Manager**.
- **GM originates a need, not a priced PR.** `REQ-` requisitions have no price, vendor or invoice. Submit inserts the requisition **and** a shell `procurement_requests` row (`requisition_id` set, unpriced lines) so one `procurement-v1` instance (subject `PROCUREMENT`) covers need, proposal, finance, payment and delivery.
- **MD may approve twice.** Need-approval is `requisition.approve.need`. After the Procurement Manager submits, `subject_version` bumps, so the existing “same user cannot approve two stages of the same version” rule still holds. The second visit is `procurement.approve.final`.
- **Commitment OPEN moves to PM submit.** GM REQ submit does not `writeCommitment`. ED Finance onward, payment, delivery and GRN are unchanged.
- **ED Operations is category-gated.** `procurement_categories.operations_machinery` is true on seed `equipment` only. Services and goods skip Ops and go to MD procurement. Skip uses the payroll-style post-`nextState` override, not a new predicate column.
- **Return targets.** Need-approval returns to the GM (bump requisition version). Ops, MD procurement and ED Finance return to the Procurement Manager (bump PR version; do not reopen the approved need).
- **Memo v3** has distinct stamps: REQUESTED BY, NEED APPROVED, PREPARED BY, OPERATIONS REVIEWED (omitted when skipped), PROCUREMENT APPROVED, FINANCE APPROVED, PAID BY, DELIVERY VERIFIED. Frozen v1/v2 keep the old 6-slot mapping.

## Access

Checked with `can()`, never role names. Eight `ROLE_KEYS`. No Postgres `role_key` enum rename.

| Key | Holders |
| --- | --- |
| `requisition.create`, `requisition.edit_draft`, `requisition.submit`, `requisition.discard_draft` | GM (ENTITY) |
| `requisition.approve.need` | MD |
| `procurement.prepare`, `procurement.edit_draft`, `procurement.submit` | Procurement Manager (`inventory_officer`, CORPORATE) |
| `procurement.approve.operations` | ED Operations (only reached when `operations_machinery`) |
| `procurement.approve.final` | MD |
| `procurement.view` | GM, Procurement Manager, ED Operations, MD, ED Finance, Finance Head |

GM keeps `procurement.view` (and package/history). GM no longer priced-submits. `HOME_GATE_PERMISSION.gm` is `requisition.create`.

## HTTP (additive)

`GET/POST /api/requisitions`, `GET/PATCH /api/requisitions/:id`, `POST /api/requisitions/:id/submit|discard`, `GET /api/requisitions/:id/memo` and `memo.pdf`.

`POST /api/procurement` is PM-only (`procurement.prepare`) and requires a `NEED_APPROVED` `requisition_id`. `POST /api/procurement/:id/quotations` attaches vendor quotations on the PM draft.

Web: `/requisitions`, `/requisitions/new`, `/requisitions/:id`. Officer home tile **Need approved — prepare**. MD need-approval uses the requisition memo (no costs). MD procurement shows REQ memo + PR memo + quotes.

## Schema

Migration `0049_requisition.sql`: permissions and grants, `app.next_reference` `REQ`, `operations_machinery` on categories (true on `equipment`), `requisitions` / `requisition_versions` / `requisition_lines` / `requisition_memo_snapshots`, `procurement_requests.requisition_id` + `prepared_by_user_id`, quotation documents, statuses `AWAITING_NEED_APPROVAL` / `AWAITING_PREPARATION`, restaged `procurement-v1` (keep stage keys `ed-operations` / `md` / `ed-finance` / `finance-head`).

Pre-existing PRs keep `requisition_id` NULL. M4 demo `DEMO_PROCUREMENT` / `PR-2026-000184` is untouched. Seed adds `REQ-2026-000001` (`YFZ_REQUISITION_DRAFT_ID`); `PR-2026-000186` remains a GM-visible shell/list fixture and is not GM-submitted.

## Workflows

One `procurement-v1` instance, subject `PROCUREMENT`.

| Stage | Permission | Seal |
| --- | --- | --- |
| GM REQ submit | — | `submitted` |
| `need-approval` | `requisition.approve.need` | `need_approved` |
| PM prepare-submit | `procurement.prepare` (not workflow APPROVE) | `prepared` + commitment OPEN; skip Ops unless `operations_machinery` |
| `ed-operations` | `procurement.approve.operations` | `operations_reviewed` |
| `md` | `procurement.approve.final` | `procurement_approved` |
| `ed-finance` / payment / complete | unchanged | `approved` / `paid` / `verified` |

## Test results

- `packages/db/test/procurement-requisition.test.ts` — section 12
- `packages/db/test/procurement.test.ts` / `procurement-m7.test.ts` / `procurement-lines.test.ts` — retargeted `REQ → MD need → PR (PM) → optional Ops → MD`
- `packages/shared/src/permissions.test.ts` / `apps/api/src/auth/can.test.ts` — GM `requisition.create`; officer `procurement.prepare`; GM no priced submit
- Playwright `apps/web/e2e/procurement-requisition.spec.ts`, `procurement.spec.ts`, `procurement-m7.spec.ts`, prefix of `procurement-m9.spec.ts`
- Regression: `procurement-m8.test.ts` / `procurement-m9.test.ts` from seeded `PR-2026-000191` / `193` / `194` (`requisition_id` NULL allowed); `procurement-m8.spec.ts` finance pay; M9 delivery/GRN still `inventory@nfc.local`; `m4-engine.test.ts` / `workflows.spec.ts` demo (still starts at `ed-operations`)

Commands:

```
pnpm --filter @nfc/db test:integration
pnpm --filter @nfc/shared test
pnpm --filter @nfc/web test:e2e -- procurement-requisition.spec.ts procurement.spec.ts procurement-m7.spec.ts procurement-m8.spec.ts procurement-m9.spec.ts
```

## Acceptance (section 12)

| Check | Result |
| --- | --- |
| No price/vendor/invoice on a requisition DTO; GM cannot `POST /api/procurement` | Pass (`procurement-requisition.test.ts`, Playwright) |
| MD need memo has no naira / amount-in-words | Pass |
| Shell PR autofills title, background, justification, qty; prices stay 0 until PM | Pass |
| Commitment OPEN on PM submit only (not on GM REQ submit or MD need) | Pass |
| Services skip ED Operations (`AWAITING_MD`); equipment hits Ops | Pass |
| Need-approval return → GM (REQ v2); Ops/MD return → PM without reopening need | Pass |
| VALID 7-seal chain (skip Ops) and 8-seal chain (hit Ops) on v3 memos | Pass |

## Deviations

- **RoleKey kept** as `inventory_officer` (no `ALTER TYPE`, no eighth-role change).
- **Shell PR** on GM REQ submit so payment/delivery/seal subject ids stay `PROCUREMENT`.
- **ED Finance return author is the Procurement Manager**, so GM is not asked to edit prices they cannot see. Funding/payment/delivery otherwise unchanged.
- **Prepared stage** uses `procurement.prepare` with empty `allowed_actions` so holds/notify work without a workflow APPROVE.
- Legacy PRs (`requisition_id` NULL) still start at `ed-operations` from `startProcurementInTx`.
- **M4 `DEMO_PROCUREMENT`** still enters `procurement-v1` at `ed-operations`, skipping need-approval and prepare.
- GM still holds unused `procurement.create` in the grant catalog; the create service requires `procurement.prepare` and a need-approved requisition.

## Remaining issues

None blocking. A staff portal and global corporate home stay out of scope (repo M19).

## Explicitly not in this addendum

A ninth role. Renaming the Postgres `role_key` enum. A new milestone number. Changing M4 `DEMO_PROCUREMENT`. A new classification system beyond seed `equipment.operations_machinery = true`.
