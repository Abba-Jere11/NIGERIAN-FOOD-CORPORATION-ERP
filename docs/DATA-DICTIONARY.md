# Data dictionary (pointer)

Authoritative enums and reference prefixes live in `@nfc/shared`:

- **References:** `PR-`, `REQ-`, `PAY-`, `GRN-`, `JNL-`, `PRL-`, `VEN-`, `DOC-`, etc. — see `packages/shared/src/references.ts` and `formatReferenceNumber`.
- **Procurement statuses:** `PROCUREMENT_STATUSES` in `packages/shared/src/procurement.ts`.
- **Requisition statuses:** `packages/shared/src/requisitions.ts`.
- **Workflow definitions:** keys such as `procurement-v1`, `payroll-run-v1` in migrations `0017_workflows.sql`, `0048_payroll.sql`, `0049_requisition.sql`.
- **Core tables:** organization (`entities`, `departments`), identity (`users`, role assignments), procurement chain (`requisitions`, `procurement_requests`, `procurement_payments`, `procurement_goods_receipts`), finance (`accounts`, `journals`, `journal_lines`), HR/payroll (`hr_employees`, `payroll_runs`), platform (`search_index`, `audit_log`, `seals`, `workflow_instances`).

Use SQL migrations under `packages/db/migrations/` for column-level truth; this document is an index for operators and integrators.
