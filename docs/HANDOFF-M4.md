# M4 — Documents, seals, approval engine

Companion to `HANDOFF-M1.md`, `HANDOFF-M2.md` and `HANDOFF-M3.md`.

## What shipped

- **Documents:** `documents`, `document_versions` (append-only), `document_access_log` (append-only), `document_upload_policies`. Per-version AES-256-GCM DEK wrapped by `DOCUMENT_ENCRYPTION_KEY`. MIME sniffing, filename sanitization, pluggable `MalwareScanner` (noop in production).
- **Storage:** MinIO via `@aws-sdk/client-s3`. Local fallback `DOCUMENT_STORAGE=fs` writes ciphertext under `data/documents/` when Docker is not running. Direct store access is unreadable without the KEK.
- **Downloads:** app-issued HMAC tokens (`SESSION_SECRET`), bound to user + document + version + expiry. Session download also allowed. Every view/download writes `document_access_log` and the audit log.
- **Seals:** HMAC-SHA256 with `kid`. `SEAL_SIGNING_KEYS` JSON map, `SEAL_ACTIVE_KID`. Canonical JSON + SHA-256. `SealService.verify` → `VALID | INVALID_SIGNATURE | SNAPSHOT_MISMATCH`. Tamper view writes an audit event. `SealBadge` labels: REQUESTED BY, REVIEWED & APPROVED, REJECTED, RETURNED FOR CORRECTION, PAID BY, DELIVERY VERIFIED BY. Version-1 seals stay valid after a return (verified against the frozen snapshot).
- **Approval engine:** data-driven `workflow_definitions` / `stages` / `instances` / `actions`. Guards: permission × scope resolver, no skip, no self-approve, no double-stage approve, row lock + `row_version`, mandatory reasons. Hooks: seal, outbox, holds/SLA, timeline, audit, demo commitments.
- **Fixture:** `PR-2026-000184` milling machine (`YFZ_SEARCH_RECORD_ID`). Seed users: Musa (`gm.yfz`) = spec Amina; Halima (`ed.operations`) = Tunde; Abubakar (`md`) = Chidi.

## Declared deviations

| Topic | Choice |
| --- | --- |
| Archive by Administrator (worked-example wording) | Refused. A5 + A10: current-stage actor or MD (`workflow.archive`). Administrator is not a business actor, so entity RLS hides the row (404) and `can()` would 403 if the row were visible. |
| Role names in stages | Stages store `required_permission`, never a role key. |
| Download URLs | App tokens that decrypt server-side, not raw MinIO presigns (ciphertext is useless to the client). |
| MinIO locally | `docker compose up -d minio`. If Docker is down, `DOCUMENT_STORAGE=fs`. CI uses MinIO. |
| Photographs | Still on disk (`data/user-photographs/`). Not moved to MinIO. |
| Redis / BullMQ | Still the M3 poller. |

## Schema

Migrations `0015`–`0017`.

## Permission keys

| Key | Holders |
| --- | --- |
| `document.upload` / `document.replace` | GM |
| `document.view` | GM, Finance Head, ED Operations, MD, ED Finance |
| `document.view_history` | MD, ED Finance |
| `workflow.archive` / `workflow.restore` | MD |

Administrator holds none of these.

## HTTP

- `GET/POST /api/documents`, `GET /api/documents/:id`, `POST /api/documents/:id/versions`, `POST /api/documents/:id/download-url`, `GET /api/documents/:id/download`
- `GET /api/workflows/pending`, `GET /api/workflows/:id`, `POST /api/workflows/demo`, `POST /api/workflows/subjects/:id/submit`, `POST /api/workflows/:id/actions`, `POST /api/workflows/:id/resubmit`

## Web

`/documents`, `/documents/[id]`, `/workflows`, `/workflows/[id]`. Design system: Seals section. Nav gated on `document.view` and the workflow permission set.

## Environment

`S3_*`, `DOCUMENT_ENCRYPTION_KEY` (64 hex), `SEAL_SIGNING_KEYS`, `SEAL_ACTIVE_KID`, optional `DOCUMENT_STORAGE=minio|fs`, `DOCUMENT_DOWNLOAD_TTL_SECONDS`.

## MinIO runbook

```
docker compose up -d minio
```

The compose file starts MinIO only (local Postgres is unchanged). CI adds a `minio` service beside Postgres. Set `DOCUMENT_STORAGE=minio` and the `S3_*` keys, then restart the API.

## Acceptance

| Check | Result |
| --- | --- |
| Encrypted object ≠ plaintext | Pass (`envelope.test.ts`, `m4-engine.test.ts`) |
| Append-only versions, access log, seals, workflow_actions | Pass (`documents.test.ts`, `seals-workflows.test.ts`) |
| Seal UPDATE/DELETE trigger | Pass (`seals-workflows.test.ts`) |
| Download token expiry / other-user | Pass (unit + Playwright `documents.spec.ts`) |
| GM cannot read version 1 after replace; MD / ED Finance can | Pass (`m4-engine.test.ts` + Playwright) |
| Administrator refused on upload / approve / archive | Pass (`m4-engine.test.ts` + Playwright; archive is 404 under RLS) |
| Self-approve, double-stage approve, skip-stage | Pass (`m4-engine.test.ts`) |
| Reject / return / archive without reason | Pass (`m4-engine.test.ts` + Playwright) |
| Concurrent double-approve → one action | Pass (`m4-engine.test.ts` + Playwright) |
| Valid seal; tampered snapshot → INVALID + audit | Pass (`seals.service.test.ts`, `m4-engine.test.ts`) |
| Tampered seal field → `INVALID_SIGNATURE` | Pass (`seals.service.test.ts`) |
| Old `kid` still verifies after rotation | Pass (`seals.service.test.ts`) |
| Six badge strings | Pass (Playwright `/design`) |
| Musa submit → `ed-operations`, no action row | Pass (`m4-engine.test.ts` + Playwright) |
| Halima APPROVE → stage `md` + approved seal | Pass |
| Abubakar REJECT → terminal, commitment RELEASE, notify | Pass (`m4-engine.test.ts`) |
| RETURN → DRAFT, originator Musa, version 2, v1 seals stay, resubmit at `ed-operations` | Pass |
| ARCHIVE by MD preserves rows, drops from pending; Administrator 403 | Pass |
| Playwright documents + workflows | Pass (`documents.spec.ts`, `workflows.spec.ts`, design-system Seals) |
