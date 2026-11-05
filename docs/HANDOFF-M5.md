# M5 — Vendor Master

Companion to `HANDOFF-M1.md` through `HANDOFF-M4.md`.

## What shipped

- **Group vendor register** on the NFC holding entity (`VND` yearless references). Not subsidiary-owned.
- **Onboarding** through `vendor-onboarding-v1` (approval engine). Draft → Pending review → Active. The creator cannot activate (maker-checker).
- **Bank details** stored in `vendors` plus append-only `vendor_bank_account_versions`. A change sets `PENDING_REVERIFICATION` until a **different** user with `vendor.activate` calls `POST /api/vendors/:id/bank-details/approve`.
- **API masking:** bank fields are omitted unless `vendor.view_bank_details`. GMs can pick Active vendors without seeing account numbers.
- **Selection gate** `VendorValidationService.assertSelectable` for M6/M8. Failures append `vendor_selection_blocks`.
- **Placeholder history views** `vendor_procurement_history_v` and `vendor_payment_history_v` (zero rows). M6/M8 replace the view bodies. Duplicate invoices use append-only `vendor_invoice_claims`.
- **Search:** record type `VENDOR`, permission `vendor.view`, href `/vendors/:id`. Search-index RLS still requires `can_access_entity(NFC)`, so GMs find vendors on the register, not necessarily via search.
- **Compliance uploads:** `document_upload_policies.context = vendor_compliance`. `DocumentsService.upload` accepts that context when the actor holds `vendor.create` (GM-only `document.upload` is not required).

## Permission keys

| Key | Holders |
| --- | --- |
| `vendor.create` | ED Finance, ED Operations |
| `vendor.activate` | ED Finance, MD |
| `vendor.suspend` / `vendor.blacklist` | ED Finance, MD |
| `vendor.view` | GM, Finance Head, ED Operations, ED Finance, MD |
| `vendor.view_bank_details` | ED Finance, Finance Head |

Administrator holds none. `vendor.view_bank_details` replaced the catalog alias `vendor.bank.view`. Sensitive-field row `vendor.bank` now points at `vendor.view_bank_details`.

List/detail: `vendor.view` **or** `procurement.create`. List is **Active-only** unless the caller also holds a manage key (`vendor.create`, `vendor.activate`, `vendor.suspend`, `vendor.blacklist`).

## RLS

Custom policies, not `enable_entity_rls`. `SELECT` is allowed when `vendor.view` OR `procurement.create` OR `is_corporate_actor()`. Writes require the matching vendor.* permission. GMs therefore read Active vendors without NFC holding membership.

## HTTP

- `GET/POST /api/vendors`, `GET/PATCH /api/vendors/:id`
- `POST /api/vendors/:id/submit`
- `POST /api/vendors/:id/suspend|blacklist|reactivate`
- `POST /api/vendors/:id/compliance-documents`
- `POST /api/vendors/:id/bank-details`, `POST /api/vendors/:id/bank-details/approve`
- `GET /api/vendors/:id/history`, `GET /api/vendors/categories`
- `GET /api/vendors/validate/:id`

## Web

`/vendors`, `/vendors/new`, `/vendors/[id]` (Profile, Compliance, History, Audit). Nav gated on `vendor.view` or `vendor.create` or `vendor.activate`.

## Schema

Migration `0018_vendors.sql`. Seed: XYZ Limited `VND-000018` (Active), Sahel Logistics `VND-000019` (Suspended), Northern Sacks `VND-000020` (Draft).

## Acceptance

| Check | Result |
| --- | --- |
| Draft → Active only by a different user | Pass (`vendors.test.ts`, Playwright `vendors.spec.ts`) |
| Suspended / pending re-verification rejected by validation | Pass (`VendorValidationService` + e2e Sahel) |
| Bank change → re-verify → block until approved | Pass (`vendors.test.ts`) |
| Duplicate CAC | Pass (unique index + API conflict) |
| Bank invisible without `vendor.view_bank_details` | Pass (API + e2e GM JSON) |
| ED Finance query functions (empty spend/history) | Pass (`vendor-queries.test.ts`) |
| Audit + reason on suspend | Pass (`vendors.test.ts`) |
| Administrator has no `vendor.*` | Pass (`conflicts.test.ts`, `permissions.test.ts`) |

## Explicitly not in M5

Procurement requests (M6+), payment execution (M8), real spend/history rows, vendor selection on a PR form. M6 should call `VendorValidationService.assertSelectable` and `GET /api/vendors` (Active list).
