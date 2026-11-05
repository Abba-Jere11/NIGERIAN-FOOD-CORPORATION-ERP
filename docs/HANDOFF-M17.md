# M17 — HR 1 People System

Companion to `HANDOFF-M1.md` through `HANDOFF-M16.md`. The pasted brief still titled this M16; official reports already occupy M16, so this is **M17**. Payroll stays M18.

## What shipped

- **Eighth role: HR Officer** (`hr@nfc.local`, corporate, `/home/hr`). Centralised across all four subsidiaries. Administrator holds none of the `hr.*` keys. There is no Payroll Officer and no employee login portal.
- **Employee master (`EMP-`).** Records, not accounts. Org chart Entity → Department → optional Unit → Position → Employee. Invalid combinations are rejected server-side. Sensitive bank/pay/personal contact fields are stripped unless `hr.view_sensitive`. Creating a record also creates an EDMS HR **user** folder.
- **Employment changes** (`hr-change-v1`): promotion, transfer, confirmation, termination, resignation. Assignment history is append-only.
- **Recruitment:** vacancy (`VAC-`) → applicant → interview → offer PDF → onboarding checklist → `EMP-` + EDMS folder. Vacancy and offer reuse `hr-change-v1`.
- **Leave** (`LV-`, `hr-leave-v1`): types, entitlements, HR single-stage approval, balances, group calendar, public holidays, cancellation by reversal + reason.
- **Attendance:** manual entry, CSV import with anomaly flags (unknown employee, duplicate punch, negative hours), overtime (`hr-overtime-v1`), monthly summary. Device clock-in is a named no-op interface only. No payslip.
- **Performance:** review cycles, objectives, appraisals (`hr-performance-v1`).
- **Disciplinary (`DISC-`).** Own ACL (not `/cases`). Access log on every view. Written warning and below complete in HR. Suspension or above waits for MD (`hr-disciplinary-md-v1`, `hr.disciplinary.approve`). Reopen/reverse inserts a new event; prior decisions stay. Never written to `search_index`.
- **Training (`TRN-`).** One session, many participants, per-person attendance/completion. Costed sessions create an `EXP` and start existing **`expense-v1`**. Costs omitted without `hr.training.report`.

## Access

Checked with `can()`, never role names. `isAdminScopedPermission` does not include `hr.*`. MD extra key `hr.disciplinary.approve` sits in `APPROVAL_OR_PAYMENT_KEYS`. Home gate: `hr.employee.view`. The single HR Officer both submits and approves HR_CHANGE / LEAVE / OVERTIME / PERFORMANCE (originator self-approve allowed). Disciplinary MD approval is not self-approve.

| Key | Holders |
| --- | --- |
| `hr.employee.view/manage`, `hr.view_sensitive`, `hr.org.manage`, `hr.recruitment.manage`, `hr.change.approve`, `hr.leave.approve`, `hr.attendance.manage`, `hr.performance.manage`, `hr.documents.manage`, `hr.disciplinary.view/manage/investigate/close`, `hr.training.view/manage/approve/report` | HR Officer |
| `hr.disciplinary.approve` | MD |
| none of the above | Administrator, GM, Finance Head, Inventory Officer, ED roles |

`reporting_manager_id` is an employee-to-employee data field only.

## HTTP (additive)

`/api/hr/dashboard`, `units`, `positions`, `employees`, `changes`, `vacancies`, `applicants`, `offers`, `leave`, `holidays`, `attendance`, `overtime`, `cycles`, `appraisals`, `disciplinary`, `training`. PDFs: `employees/:id/appointment.pdf`, `offers/:id/pdf`. Training finance: `POST /api/hr/training/:id/finance`.

Web: AppShell group **HR** (permission-gated). Routes `/home/hr` and `/hr/*`. MD compact queue on `/home/md`.

## Schema

Migrations `0045_role_key_hr_officer.sql` (enum value alone), `0046_hr.sql` (tables, grants, `DISC`/`TRN` in `app.next_reference`, `hr.view_sensitive` replacing `hr.salary.view` on org-report templates), and `0047_hr_disciplinary_visible.sql` (`app.hr_disciplinary_visible` / workflow subject helper). RLS: employee tables on `hr.employee.view`; disciplinary SELECT uses the SECURITY DEFINER helper so MD approval does not join `hr_employees`. Sensitive columns are stripped in the mapper, not RLS.

## Workflows

| Subject | Definition | Who |
| --- | --- | --- |
| Vacancy / offer / HR change | `hr-change-v1` | `hr.change.approve` |
| Leave | `hr-leave-v1` | `hr.leave.approve` |
| Overtime | `hr-overtime-v1` | `hr.attendance.manage` |
| Appraisal | `hr-performance-v1` | `hr.performance.manage` |
| Disciplinary suspension+ | `hr-disciplinary-md-v1` | `hr.disciplinary.approve` (MD) |
| Training cost | existing `expense-v1` | `finance.expense.approve` |

Leave and training due reminders run on the existing 5s PostgreSQL jobs poller.

## Test results

- `packages/db/test/hr.test.ts` — the 15 Stage acceptance scenarios plus performance
- `apps/web/e2e/hr.spec.ts` — nav, employee create UI, API negatives, MD queue
- `apps/api/src/auth/can.test.ts` — HR Officer all subsidiaries; Admin/GM denied; MD approve-only
- `packages/shared/src/permissions.test.ts` — eight roles; no payroll_officer; Administrator holds zero HR keys

## Acceptance

| Check | Result |
| --- | --- |
| Sensitive fields absent without `hr.view_sensitive` | Pass (`hr.test.ts`) |
| Cross-department unit / cross-entity position rejected | Pass |
| Vacancy → onboarding creates `EMP-` and EDMS HR user folder | Pass |
| Promotion/transfer/termination require approval; previous assignment remains | Pass |
| Leave request → HR approve; balances and all-subsidiary calendar | Pass |
| CSV import flags anomalies; overtime approval works | Pass |
| HR Officer manages all four subsidiaries; GM/admin cannot open another person’s record | Pass |
| Written warning without MD; suspension refused until MD `hr.disciplinary.approve` | Pass |
| Direct API without disciplinary permission cannot read case evidence | Pass |
| Reopened/reversed decision keeps prior events | Pass |
| Disciplinary never in `search_index` / global search | Pass |
| One training session, many participants; per-person attendance/completion | Pass |
| Costed training uses `expense-v1`, not a new payment workflow | Pass |
| Training costs stripped without `hr.training.report` | Pass |
| HR/org/disciplinary mutations write audit old/new values | Pass |
| No Payroll Officer / no employee login portal; `ROLE_KEYS` length 8 | Pass |
| Administrator holds zero HR keys | Pass |

## Deviations

- Offer and vacancy share `hr-change-v1` (same permission, single HR Officer) rather than extra definition keys.
- MD disciplinary name is resolved with `app.hr_employee_public_name` so the MD queue is not empty when RLS would hide `hr_employees`.
- Training expenses are inserted by HrService then `startExpenseInTx`; HR does not hold `finance.expense.manage`.

## Remaining issues

None blocking. Device attendance and payroll processing are out of scope.

## Explicitly not in M17

Staff/manager self-service. Payroll runs / PAYE / pension. Device clock-in hardware. Enabling org-report HR/payroll templates. A ninth role. Merging disciplinary into `/cases`. Redis/BullMQ.
