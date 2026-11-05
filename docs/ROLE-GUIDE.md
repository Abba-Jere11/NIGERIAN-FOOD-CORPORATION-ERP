# Role guide (eight roles)

All access is enforced with `can()` and permission keys — never role names in application logic.

| Role | My dashboard (`homePath`) | Primary responsibilities |
| --- | --- | --- |
| General Manager (`gm`) | `/home/gm` | Subsidiary requisitions, returned needs, entity procurement board |
| ED Operations (`ed_operations`) | `/home/ed-operations` | Machinery procurement review, ageing, cross-subsidiary inventory view |
| Managing Director (`md`) | `/home/md` | Final approvals, major transactions, consolidated finance snapshot |
| ED Finance (`ed_finance`) | `/home/ed-finance` | Funding authorization, payroll tile, finance oversight |
| Finance Head (`finance_head`) | `/home/finance-head` | Payment execution, journals/budget queues, payroll pay |
| Procurement Manager (`inventory_officer`) | `/home/inventory` | Prepare priced proposals, delivery verification, inventory ops |
| HR Officer (`hr_officer`) | `/home/hr` | People, leave, payroll prepare, HR reports |
| Administrator (`administrator`) | `/home/admin` | Users, entities, health, seals — **no business modules** |

## Corporate home vs role dashboard

After sign-in, everyone lands on **`/home`** (corporate summary). Use **My dashboard** in the sidebar for role-specific queues and KPI tiles.

## Cannot do (high level)

- **GM:** cannot approve final procurement or authorize group funding.
- **MD:** cannot prepare priced proposals or execute bank payment.
- **Finance Head:** cannot prepare payroll runs or edit HR salary structures.
- **HR Officer:** cannot approve payroll or pay vendors.
- **Administrator:** cannot view audit log, procurement, finance, inventory, or HR business data.
- **Inventory Officer / PM:** cannot approve MD stage or ED Finance funding (unless explicitly granted).

See `packages/shared/src/permissions.ts` for the full grant matrix.
