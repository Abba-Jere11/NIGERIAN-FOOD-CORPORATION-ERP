# NFC Mini ERP — Runbook

## Local parity with CI

```powershell
pnpm install
pnpm db:bootstrap
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Environment variables mirror `.env.example` and `.github/workflows/ci.yml`.

## Backup

- **PostgreSQL:** `pg_dump -Fc -h localhost -U postgres nfc_erp_dev > backup/nfc-$(Get-Date -Format yyyyMMdd-HHmm).dump`
- **Object storage:** mirror the `S3_BUCKET` prefix (MinIO: `mc mirror` or AWS CLI `sync`).

## Restore drill (timed)

1. Note start time.
2. Create empty database `nfc_erp_restore_test`.
3. `pg_restore -d nfc_erp_restore_test backup/<file>.dump`
4. Run `pnpm db:migrate` against restore DB if version lag expected.
5. `pnpm --filter @nfc/api start` with `PGDATABASE=nfc_erp_restore_test` and hit `/health`.
6. Restore object store prefix into a scratch bucket; open one known document id.
7. Record elapsed minutes in change log / handoff sign-off.

## Migrations and seed

- `pnpm db:migrate` applies `packages/db/migrations/*.sql` in order.
- `pnpm db:seed` loads identities, demo procurement, finance baselines.
- `pnpm db:reset` drops operational data (see `packages/db/scripts/wipe-operational-data.mjs`) — dev only.

## Seal key rotation

1. Add new kid to `SEAL_SIGNING_KEYS` JSON in secrets store.
2. Set `SEAL_ACTIVE_KID` to the new kid on API instances.
3. Deploy; new seals use new kid. Old seals remain verifiable with retired keys present in JSON.
4. Never remove a kid until all seals signed with it are archived from live workflows.

## Auth rate limits

- `POST /api/auth/login` and `POST /api/auth/mfa`: 20 requests per IP per 60 seconds (`@nestjs/throttler`).
- Global module default: 120 requests per minute for other throttled routes if added later.

## Security headers

- API: `helmet` in `apps/api/src/main.ts`.
- Web: security headers in `apps/web/next.config.ts`.

## CI guard scripts

- `node scripts/check-no-role-branch.mjs` — no role-name branching in apps.
- `node scripts/check-api-guards.mjs` — every Nest HTTP route has `@Public`, `@ActorOnly`, or `@RequirePermission`.

## Jobs

Background work uses the PostgreSQL poller (`JobsService`, 5s interval when `JOBS_ENABLED=true`). Inspect lag via `/admin/health` and `GET /api/admin/ops`.
