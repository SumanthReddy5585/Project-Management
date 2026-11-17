# Operations

## One-click local run

`START-WINDOWS.bat` / `start.sh` → `backend/scripts/run-local.js`: starts a bundled PostgreSQL 17 (`embedded-postgres`, MIT, listening on 127.0.0.1 only, random password in `backend/.local/secret.json`), applies migrations and records them in `_prisma_migrations` like Prisma does, loads demo data on an empty database (`SKIP_DEMO=1` to skip), then serves API and web app together on http://localhost:4000 (`PORT` to change). For evaluation and demos; use the deployment approach below for real use.

## Local development

Prerequisites: Node.js 22 (≥ 20.19), PostgreSQL 16, npm.

```bash
# 1. Databases (dev + dedicated test DB; the test name must end in _test)
createuser -P pm            # password: pm_dev_pw (or change .env)
createdb -O pm pm_dev && createdb -O pm pm_test

# 2. Backend
cd backend
cp .env.example .env
npm ci
npx prisma migrate deploy       # applies committed migrations
npm run seed:demo               # OPTIONAL demo data (refuses in production)
npm run dev                     # http://localhost:4000

# 3. Frontend
cd ../frontend
npm ci
npm run dev                     # http://localhost:5173 (proxies /api to :4000)
```

**First run on your machine, once:** run `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code` with `SHADOW_DATABASE_URL` set to an empty scratch database. It should exit 0. The initial migration was generated in a sandbox where Prisma's schema-engine binary could not be downloaded, so this confirms it matches what Prisma itself produces. CI runs the same check. If it reports drift on a fresh setup, delete `prisma/migrations/20261117000000_init` and run `npx prisma migrate dev --name init`.

### Tests

```bash
cd backend && npm test          # unit + integration (uses TEST_DATABASE_URL; truncates only *_test DBs)
cd frontend && npx playwright install chromium && npx playwright test   # E2E: needs API + web running with demo seed
```

The test setup refuses to run unless the database name ends in `_test`.

## Docker (local, production-like)

```bash
POSTGRES_PASSWORD=choose-one docker compose up --build
docker compose exec api npm run seed:demo      # optional demo data
# or create a real org and admin:
docker compose exec -e INIT_ADMIN_PASSWORD='S3cure-pass-123' api node prisma/init-org.js --org "Acme" --slug acme --email admin@acme.com --name "Ada Admin"
```

The app runs at http://localhost:8080. nginx serves the SPA and proxies `/api` on the same origin. The API container runs `prisma migrate deploy` on start. Data persists in the `pgdata` and `uploads` volumes. *The images were not built in the authoring sandbox (Docker Hub was unreachable). Run `docker compose build` once and report any issue.*

## Production initialization

Never run the demo seed in production. Create the first organization and administrator with:

```bash
INIT_ADMIN_PASSWORD='…' node prisma/init-org.js --org "Org name" --slug org --email admin@org.com --name "Admin Name" --timezone Asia/Kolkata
```

Everyone else joins through invitations.

## Deployment approach

1. **Edge:** a TLS-terminating reverse proxy (nginx/ALB) serves `frontend/dist` and proxies `/api` to the API on the same origin. Set `TRUST_PROXY=1` (the number of proxies).
2. **API:** `NODE_ENV=production`, `COOKIE_SECURE=true` (the app refuses to start otherwise), `APP_ORIGIN` and `CORS_ORIGINS` set to the public origin, secrets from your secret manager. Run `npx prisma migrate deploy` as a release step before rolling out new instances.
3. **Database:** managed PostgreSQL 16 with automated backups and point-in-time recovery.
4. **Files:** one instance with a persistent volume, **or** several instances on a shared filesystem (NFS/EFS), **or** a new object-storage provider implementing `storage/index.js`. Do not run several instances with separate local disks.
5. **Scaling:** the API is stateless apart from files. Sessions live in PostgreSQL, and jobs use advisory locks, so several instances are safe.
6. **Shutdown:** SIGTERM stops jobs, drains HTTP, disconnects Prisma and force-exits after 15 s.

## Backup and restore

Back up the database and `uploads/` **together**. File rows reference storage keys.

```bash
# Backup
pg_dump --format=custom --no-owner "$DATABASE_URL" > meridian-$(date +%F).dump
tar -czf uploads-$(date +%F).tgz -C backend uploads
# Restore (into an empty database, then files)
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" meridian-YYYY-MM-DD.dump
tar -xzf uploads-YYYY-MM-DD.tgz -C backend
```

Take the file backup *after* the database dump. Extra files are harmless (the cleanup job removes orphans after 1 hour); missing files are logged by the cleanup job. Test a restore regularly.

## Observability

- Structured JSON logs (pino) with a request id (`X-Request-Id`, echoed in error responses). Cookies, CSRF tokens, passwords and token hashes are redacted.
- `/health` for liveness, `/ready` for readiness (checks the database).
- Job outcomes are logged as `job finished` with counts.

## Security checklist: done vs remaining

Done: argon2id hashing; DB-backed sessions with hashed tokens, absolute and idle expiry; `__Host-` Secure HttpOnly SameSite=Lax cookies in production; synchronizer CSRF token plus Origin check; explicit CORS allowlist; helmet headers on the API and CSP on nginx; zod validation everywhere; rate limiting on login and token endpoints; single-use expiring invite and reset tokens (only hashes stored); reset revokes sessions; no secrets or hashes in responses or logs; record-level authorization with 404 for out-of-scope IDs; audit log; private file serving with sandbox CSP; CSV formula-injection protection; negative authorization tests.

Remaining before production:
- Penetration test and dependency audit (`npm audit`) in your pipeline.
- Antivirus scanning of uploads (e.g. ClamAV) if customers upload files.
- Outbound email (invitations, resets, notifications) through a transactional email provider.
- MFA/SSO if required by your customers.
- Rate limiting is per-process in memory. Use a shared store (Redis) for several instances.
- Data retention and privacy policy (audit and notification retention, user deletion/export).

## Continuous integration

The GitHub Actions workflow is in `docs/github-actions-ci.yml`. To enable it, move it to `.github/workflows/ci.yml` (GitHub requires the "workflow" permission for that change, so do it in the GitHub web editor or with your own git credentials).
