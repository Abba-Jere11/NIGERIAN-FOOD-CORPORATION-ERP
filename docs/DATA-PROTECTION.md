# Data protection map

## Sensitive fields

| Area | Fields | Who may read |
| --- | --- | --- |
| HR | `salary_kobo`, bank details on employee, disciplinary body | `hr.view_sensitive`, `hr.disciplinary.view`, payroll keys as documented in M18 |
| Payroll | Net pay, bank, PAYE per line | `payroll.view` (not Administrator) |
| Vendors | Bank account on vendor record | `vendor.view` with entity scope |
| Documents | Encrypted blob; access logged | `document.view` or module-specific proxy (e.g. payslip route) |

## Logging

- API uses Pino; passwords, tokens, MFA secrets, and document DEKs are never logged.
- Failed seal verification writes an audit row without leaking snapshot contents in client responses.

## Export gates

- `audit.export` — CSV export from `/audit`.
- HR/payroll PDFs — permission on owning module, not generic document download for staff payslips.

## Search index

- Indexed text excludes net pay and personal bank numbers.
- Payroll runs index reference + period only (`payroll.view`).

## Retention

- Append-only tables (audit, seals, workflow actions, document versions, access log) — corrections are new rows.
- EDMS retention policies require `edms.manage_retention` (Administrator uses document access explorer, not EDMS portal, for access log review).
