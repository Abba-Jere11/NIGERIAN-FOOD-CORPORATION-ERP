# Administrator guide

The Administrator role manages identity, platform health, and configuration visibility. It does **not** receive procurement, finance, inventory, HR business, or audit log permissions.

## Starting points

- **Corporate home** (`/home`) — only failed jobs/mail/notifications when no business permissions are granted.
- **My dashboard** (`/home/admin`) — links to users, roles, entities, sessions, permission log, health, workflow definitions, seal tool, document access explorer, notification templates, overdue workflows (read-only).

## Users and access

- **Users** (`/admin/users`) — create accounts, lock/unlock, assign roles (step-up for role assign).
- **Roles** (`/admin/roles`) — default grant matrix (read-only reference).
- **Entities** (`/admin/entities`) — subsidiaries and departments.
- **Sessions** (`/admin/sessions`) — revoke active sessions.
- **Permission log** (`/admin/permission-log`) — grant and account changes.

## Platform health

- **Health** (`/admin/health`) — outbox, mail failures, reference counters, manual job run.
- **Workflow definitions** (`/admin/workflows`) — read-only stage map.
- **Seal verification** (`/admin/seals`) — enter `PR-…` reference; recomputes seal integrity without opening procurement UI.
- **Document access** (`/admin/document-access`) — paginated `document_access_log` search.
- **Notifications / SLA** (`/admin/notifications`) — `notification_types` and `sla_thresholds` (read-only).

## What administrators cannot do

- View procurement registers, finance dashboards, inventory, HR employee records, or `/audit`.
- Approve workflows or execute payments.

Use a business role account for operational testing; use Administrator only for platform tasks.
