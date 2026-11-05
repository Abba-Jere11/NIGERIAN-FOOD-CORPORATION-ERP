# M15 — EDMS Document Portal

Companion to `HANDOFF-M1.md` through `HANDOFF-M14.md`.

## What shipped

- **Gated portal at `/edms`.** Same Next app, distinct `(edms)` shell (no Modules sidebar). Same session cookie and `/api/auth/login`. Unauthenticated `/edms/*` goes to `/edms/login` (heading **Document Portal**). Authenticated users without `edms.portal.access` see **You do not have access to the Document Portal** — not a failed login.
- **No eighth role.** MD, ED Finance and ED Operations enter the portal and may `edms.view` subsidiaries. Administrator enters for category/tag/retention admin only — not `edms.view` on procurement/finance/inventory files. GM, Finance Head and Inventory Officer keep inline M4 viewing on `/documents/[id]`.
- **Folders hold links**, not copies: `edms_folder_items` → `documents.id`. Entity on a folder is immutable; MD re-files a document with a recorded reason via `app.refile_document`.
- **Auto-file on `procurement.completed`.** Handler `edms.file_procurement` (was `edms.placeholder`) writes `Active / Procurement / {year} / {subject}` with slots 01–09. Existing memo/invoice/funding/proof/delivery files are linked. Slots 03, 08 and 09 are generated PDFs. Timeline: **EDMS archive generated.** Actor `system:edms`. Running twice is a no-op.
- **Main ERP.** Documents is removed from the Modules nav. `/documents` remains for M4 inline use. **View in EDMS** on a procurement appears only when the actor has `edms.portal.access` and a package folder exists.

## Access

Checked with `can()`, never role names. Mutation keys that file or share sit in `APPROVAL_OR_PAYMENT_KEYS`. `edms.portal.access` and `edms.manage_*` do not.

| Key | Holders |
| --- | --- |
| `edms.portal.access` | MD, ED Finance, ED Operations, Administrator |
| `edms.view` | MD, ED Finance, ED Operations (entity-scoped) |
| `edms.upload` | MD, ED Finance, ED Operations |
| `edms.version.replace` | MD, ED Finance |
| `edms.archive` | MD, ED Finance |
| `edms.share` | MD, ED Finance |
| `edms.approve` | MD, ED Operations |
| `edms.refile` | MD |
| `edms.manage_categories`, `edms.manage_retention` | Administrator |

## HTTP (additive)

- `GET /api/edms/access` — `{ allowed }` from `edms.portal.access` (`@ActorOnly`)
- `GET /api/edms/gateway` — entities the actor can `edms.view` (Administrator: empty list + `admin: true`)
- `GET /api/edms/tree`, `GET /api/edms/folders/:id`, `GET /api/edms/documents/:id`
- `GET /api/edms/packages?procurementId=`, `GET /api/edms/search`
- `POST /api/edms/upload`, versions, archive, share, legal-hold, refile
- Admin: categories, tags, legal-hold queue
- Downloads stay `GET /api/documents/:id/download`

## Schema

Migration `0043_edms.sql`. Workflow `edms-document-v1`. Outbox handler `edms.file_procurement`. Seed `seed-m15.ts` files historical COMPLETED PRs and `PR-2026-000195` (YFZ mill bag archive fixture).

## Deviations

- Seed backfill links folders only; generated 03/08/09 PDFs are produced by `fileProcurementInTx` (jobs / tests), not by SQL seed (no Nest/encryption in the seed CLI).
- Optional category approval (`requires_approval` → `edms-document-v1`) is implemented; auto-filed procurement slots skip it.
- Related employee / project on document detail are null placeholders for M16.

## Acceptance

| Check | Result |
| --- | --- |
| Complete YFZ request → Active/Procurement/year/subject + slots 03/08/09 | Pass (`edms.test.ts`) |
| Backfill twice = one folder | Pass |
| GM without portal 403 on `/api/edms/*` except `GET /access` `{ allowed: false }` | Pass |
| Administrator 403 on `edms.view` document body | Pass |
| Replace → v2 + reason; share audited; legal hold blocks archive | Pass |
| Re-file without reason 400 | Pass |
| Playwright: EDMS absent from Modules; MD gateway five spaces then folders; GM denied copy; GM no View in EDMS; MD has the link; inline memo still works for GM | Pass (`edms.spec.ts`) |

## Explicitly not in M15

HR/Finance-specific document workflows. External share URLs. Auto-deletion. A second password. Changing SMTP. Payroll (M17).

## Next (M16)

HR record workflows. Do not start payroll from this handoff.
