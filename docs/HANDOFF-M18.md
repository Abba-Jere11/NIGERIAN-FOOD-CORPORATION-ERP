# M18 — HR 2 Payroll and HR reports

Companion to `HANDOFF-M1.md` through `HANDOFF-M17.md`. The pasted brief still titled this M17; people already occupy M17, so this is **M18**. Global dashboards stay M19.

## What shipped

- **No ninth role.** HR Officer prepares salary structures and `PRL-` runs (`payroll.structure.manage`, `payroll.run.prepare`, `payroll.config`, `payroll.view`). Finance Head holds `payroll.run.approve` and `payroll.pay` at SAME_ENTITY. ED Finance holds `payroll.run.approve` (corporate) above a configurable net threshold, plus `payroll.view`. Administrator, GM, Inventory Officer and MD get none of the line-level payroll keys.
- **Effective-dated structures** and audited PAYE / pension / other statutory **config rows** (never TypeScript constants). Confirming a later version does not overwrite earlier CONFIRMED history; `hr_employees.salary_kobo` is a denormalized snapshot.
- **Calculate** from approved HR only: ACTIVE / PROBATION / CONFIRMED; TERMINATED / RESIGNED excluded from the approved effective date; SUSPENDED excluded unless settings say otherwise. Approved overtime and unpaid leave affect pay. Attendance anomalies list as exceptions and do not change pay.
- **`payroll-run-v1`:** Finance Head, then ED Finance when net ≥ `payroll_settings.ed_finance_threshold_kobo`. Completed workflow locks the run. Payment is a separate `payroll.pay` mutation with evidence, a bank CSV, balanced `JNL` source `PAYROLL`, and PAYE/pension remittance rows.
- **Payslips** as letterhead PDFs filed on the existing employee EDMS HR user folder. Download ACL is `payroll.view` only (not `document.view`). No staff portal.
- **Official reports:** templates `hr_staff` and `payroll` are available. HR Officer has the four GM-level `org_report` keys. Create/submit stamps a live snapshot. Operational hub `/hr/reports`. Finance `payroll_summary` uses locked/paid aggregates. ED Finance home has a Payroll tile.

## Access

Checked with `can()`, never role names. `isAdminScopedPermission` does not include `payroll.*`. `payroll.run.approve` and `payroll.pay` sit in `APPROVAL_OR_PAYMENT_KEYS`. R14 holds because HR cannot approve and Finance Head cannot prepare.

| Key | Holders |
| --- | --- |
| `payroll.structure.manage`, `payroll.run.prepare`, `payroll.config`, `payroll.view` | HR Officer |
| `payroll.run.approve`, `payroll.pay`, `payroll.view` | Finance Head |
| `payroll.run.approve`, `payroll.view` | ED Finance |
| none of the above | Administrator, GM, Inventory Officer, MD, ED Operations |

HR Officer extra: `org_report.create` / `submit` / `view` / `minute.respond`. Still not MD keys.

## HTTP (additive)

`/api/payroll/dashboard`, `settings`, `paye`, `pension`, `statutory`, `structures`, `loans`, `periods`, `runs`, `runs/:id/calculate|submit|pay|remit|adjust`, `runs/:id/payslips/:employeeId`, `reports/hr|variance|remittance`, `snapshot/:templateKey`.

Web: `/hr/payroll`, `/hr/payroll/:id`, `/hr/reports`, Finance Head home payroll payment queue, ED Finance Payroll tile → `/finance/reports/payroll_summary`.

## Schema

Migration `0048_payroll.sql`: permissions and grants, journal source `PAYROLL`, COA 1160/2130/2135/2140/2150, unpaid leave type, settings, PAYE bands, pension 8%/10%, structures, loans, runs (`PRL` unique open period), lines, adjustments, payment batches, remittances, payslips, `payroll-run-v1`, `org_reports.snapshot`, enabled `hr_staff` / `payroll` templates.

RLS: `payroll.view` (or prepare/approve/pay) plus `app.can_access_entity`. `search_index` stores `PRL-` + period with `permission_key = payroll.view` — never net pay, bank or PAYE per person.

## Workflows

| Subject | Definition | Who |
| --- | --- | --- |
| Payroll run | `payroll-run-v1` | `payroll.run.approve` (FH SAME_ENTITY, then EDF CORPORATE if net ≥ threshold) |

Payment is not a workflow stage. Draft-near-period-close reminders use the existing 5s PostgreSQL jobs poller.

## Test results

- `packages/db/test/payroll.test.ts` — eight Stage acceptance scenarios
- `apps/web/e2e/payroll.spec.ts` — nav, ED Finance tile, API negatives
- `packages/db/test/org-reports.test.ts` / `apps/web/e2e/org-reports.spec.ts` — templates available; GM cannot create specialist HR/payroll
- `apps/api/src/auth/can.test.ts` — HR prepare; FH approve+pay; EDF approve+view; Admin/GM/MD/Inventory denied

## Acceptance

| Check | Result |
| --- | --- |
| ₦500k → ₦600k effective 1st of next period, no re-entry | Pass (`payroll.test.ts`) |
| Terminated employee with approved date in period excluded | Pass |
| PAYE/pension config rows change next calculate; `payroll_change` audit | Pass |
| HR cannot approve; FH can; locked run rejects recalculate; adjustment is a new `PRL-` | Pass |
| Payment posts a balanced `PAYROLL` journal; remittance rows; payslip on employee EDMS folder | Pass |
| ED Finance Payroll tile / `payroll_summary` show posted amount | Pass |
| GM/Admin/Inventory: runs, lines and payslips 403; search_index has no net pay | Pass |
| Official `hr_staff` and `payroll` available; HR can submit; GM cannot create payroll specialist; snapshot matches locked run | Pass |
| Eight roles; no Payroll Officer; Administrator holds zero `payroll.*` | Pass |

## Deviations

- Payslip download is proxied by the web app (`/hr/payroll/:id/payslips/:employeeId`) so the session cookie stays on the UI origin. The API still gates on `payroll.view` and decrypts in `PayrollService`, not `DocumentsService.streamForActor`.
- A grade-level fallback structure is used in tests so leftover employees from M17 do not block submit with `MISSING_STRUCTURE`.

## Remaining issues

None blocking. A staff payslip portal and global corporate home are out of scope.

## Explicitly not in M18

Staff payslip portal. A ninth role. Device clocks. Global corporate home (repo M19). Redis/BullMQ. Merging official reports into `/reports`. Giving Administrator any `payroll.*`.
