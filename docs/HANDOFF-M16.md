# M16 — Organisational Reporting System

Companion to `HANDOFF-M1.md` through `HANDOFF-M15.md`.

## What shipped

- **Official correspondence at `/org-reports`.** Distinct from the existing `/reports` hub (operational/finance/inventory views). Nav label **Official reports**; existing Reports stays **Operational and financial reports**.
- **Reports go to the Managing Director.** Optional CC is read-only. Forwarding shares a copy and does not assign work. Official minutes (`MIN-`) assign work. Responses (`RSP-`) are append-only. Management decisions (`DEC-`) are a separate linked record. References use `ORG` so they do not collide with finance `RPT` runs.
- **ACL + RLS**, copied from confidential cases and kept in separate tables. Kinds: `OWNER` | `TO` | `CC` | `FORWARD` | `MINUTE_TO` | `MINUTE_CC`. Viewing, search, preview, download and APIs all re-check ACL. Correspondence search is a dedicated API; confidential bodies are not written to global `search_index`.
- **Seven roles only.** No HOD role, menu, workflow or template. Administrator holds `org_report.template.manage` only — no confidential view, minutes, decisions or external send. HR/payroll templates are seeded `available=false` and gated on stub `hr.salary.view`.
- **Reminders** for issued minute due dates run on the existing 5s PostgreSQL jobs poller (deduped, not an escalation). External send uses `mail_outbox` + SMTP and the configured `SMTP_FROM` identity. Provider status is `queued` | `submitted` | `failed` and never implies “read”.

## Access

Checked with `can()`, never role names. MD mutation keys sit in `APPROVAL_OR_PAYMENT_KEYS`. `org_report.template.manage` is admin-scoped like `edms.manage_*`.

| Key | Holders |
| --- | --- |
| `org_report.create`, `org_report.submit`, `org_report.view`, `org_report.minute.respond` | GM, ED Operations, MD, ED Finance, Finance Head, Inventory Officer |
| `org_report.forward`, `org_report.minute.issue`, `org_report.minute.review`, `org_report.decide`, `org_report.email`, `org_report.close` | MD |
| `org_report.template.manage` | Administrator |

CC never grants mutate/forward/issue/email. Specialist create also requires the template permission (`finance.view`, `inventory.view`, `procurement.view`, or stub `hr.salary.view`).

## HTTP (additive)

- `GET /api/org-reports/dashboard`, `templates`, `directory`, `search`, `inbox`
- `POST /api/org-reports`, `PATCH /:id` (draft only), `POST /:id/submit`, `amend`, `forward`, `close`, `revoke-access`
- Minutes: `POST /:id/minutes`, `POST /minutes/:id/issue`, `acknowledge`, `progress`, `responses`, `review`
- `POST /:id/decisions`, `POST /:id/email`
- PDFs: `GET /:id/pdf`, `/minutes/:id/pdf`, `/responses/:id/pdf`
- Admin: `PATCH /templates/:id`

Attachments use existing `DocumentsService` with `owner_type` `org_report` | `org_minute` | `org_response` | `org_decision`. Issued owners cannot replace silently.

## Schema

Migration `0044_org_reports.sql`. Append-only issued snapshots; `app.forbid_hard_delete`; `row_version`; SECURITY DEFINER helpers `app.org_report_has_access`, `app.org_minute_visible`, `app.org_report_directory`, `app.org_report_managing_director`. Templates seeded in the migration (no `seed-m16.ts`).

## Deviations

- Display examples `RPT-XXXX` / `MIN-XXXX` stay the idea; stored kinds are `ORG` / `MIN` / `RSP` / `DEC`.
- Draft CC is stored as `intended_cc_user_ids` until submit, so original To/CC rows are written once and never rewritten by forwarding.
- Opening a submitted report as MD marks it `UNDER_REVIEW` in a separate write after a read, so CC/FORWARD recipients are not blocked by `FOR UPDATE` RLS.
- HR remains M17; payroll remains M18.

## Test results

- `packages/db/test/org-reports.test.ts` — 8 passed (the 15 Stage 20 scenarios)
- `apps/web/e2e/org-reports.spec.ts` — 4 passed (nav, GM submit UI, API correspondence flow, admin templates only)
- `apps/api/src/auth/can.test.ts` — GM can create general reports; administrator cannot issue minutes; no HOD role

## Acceptance

| Check | Result |
| --- | --- |
| General report, no CC → MD can open; nobody else | Pass (`org-reports.test.ts`, `org-reports.spec.ts`) |
| CC ED Operations → read-only; no MD powers | Pass |
| Financial org-report needs `finance.view`; DMA GM cannot open YFZ | Pass |
| MD forward → extra recipient can read; original header intact | Pass |
| Forward without minute → not shown as assignee | Pass |
| Minute to Finance Head, CC original sender, unique `MIN-` | Pass |
| Response with further action keeps prior responses; accept completes | Pass |
| Management decision stored separately (`DEC-`) | Pass |
| Cross-subsidiary direct access denied | Pass |
| No HOD role, menu, workflow or template; HR/payroll unavailable | Pass |
| CC-only user without `org_report.email` cannot send | Pass |
| History shows submit, forward, minute, response, decision | Pass |
| Retry create/submit with the same idempotency key does not duplicate | Pass |
| PATCH on issued report rejected; amendment is a new revision | Pass |
| After ACL revoke, notification href / GET is denied | Pass |

## Remaining issues

None blocking. Empty optional fields on the create form are omitted from the JSON body so a submit without a report date is valid.

## Explicitly not in M16

HR records, payroll, an HOD stage, merging with `/reports` or `reports.email`, dumping confidential bodies into `search_index`, Redis/BullMQ, a second login or document store.

## Next (M17)

HR record workflows. Do not start payroll from this handoff (payroll stays M18).
