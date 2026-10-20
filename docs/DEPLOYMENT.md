# ChopNow Deployment

How to stand up staging and production, release changes, and roll back. Day-to-day operations
(incidents, failed orders, payment discrepancies, refunds, cash) are in
[OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md). The go/no-go list is in
[LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md).

> **Status (2026-10-16):** the configuration below has been verified locally: the production build,
> both process roles, the database roles, the CSP under the full browser journey, and the config
> templates against the boot-time validation. It has **not** been deployed to real infrastructure,
> and the container images have **not** been built on this machine (Docker isn't installed here).
> CI builds them on every push.

## 1. What gets deployed

| Component | Artifact | Where it runs | Notes |
|---|---|---|---|
| API (`web`) | `deploy/api.Dockerfile` (target `runtime`), `PROCESS_ROLE=web` | Container service behind an HTTPS load balancer; 1+ instances | REST + WebSocket `/v1/realtime`. The LB must allow WebSocket upgrades and an idle timeout of at least 60 s |
| Worker | Same image, `PROCESS_ROLE=worker` | Exactly **one** container, not behind the LB | Dispatch, accept deadlines, refunds, push, payment reconciliation. Serves only `/health` and `/ready` |
| Migrations | Same Dockerfile, target `migrate` | One-shot job before each release | Connects as the **migrator** role |
| Vendor portal | `deploy/web.Dockerfile`, `APP=vendor-web` | Container (nginx, port 8080) or any static host with the same headers | API URL baked in at build |
| Admin dashboard | `deploy/web.Dockerfile`, `APP=admin-web` | Same; consider restricting by IP/VPN | Staff only |
| Customer and rider apps | EAS builds (`apps/*/eas.json`) | Google Play (Android first) | API URL from the EAS environment |
| Database | Managed PostgreSQL 17, UTF-8 | Provider | Point-in-time recovery on; `database/roles.sql` |
| Object storage | S3-compatible: two buckets | Provider | Public (images, behind a CDN) and private (documents, signed URLs) |

For a small pilot, `PROCESS_ROLE=all` on a single API container is also valid: one process runs everything.

### Defaults chosen *(confirm)*
- **Hosting:** vendor-neutral containers (any of Render, Fly.io, Railway, AWS ECS/Fargate, Google Cloud Run with min-instances ≥ 1, or a VM with Docker). The worker must not scale to zero.
- **Region:** the nearest available to south-west Nigeria, where the pilot runs (Sagamu, Ogun State), e.g. AWS `af-south-1` Cape Town or `eu-west-2` London. Keep the database, API and storage in the same region.
- **Domains:** `api.`, `vendor.`, `admin.` and `media.` subdomains. The templates use `chopnow.example` as a stand-in.
- **Android first:** iOS needs an Apple developer account and isn't in the pilot scope.

## 2. One-time setup per environment (staging first, then production)

Use **separate** accounts and resources for staging and production: database, buckets, Paystack keys (test vs live), JWT secret and Sentry environment. Nothing is shared between them.

1. **Database.** Create a PostgreSQL 17 database with UTF-8 encoding, then turn on automated backups with point-in-time recovery. As the provider's admin user, create the roles with your own passwords:
   ```bash
   psql -v ON_ERROR_STOP=1 -d chopnow -v migrator_pw="'<from secret manager>'" -v app_pw="'<from secret manager>'" -f database/roles.sql
   ```
   The script:
   - enables `pg_trgm`, which the migrations need;
   - makes `chopnow_migrator` the schema owner;
   - gives `chopnow_app` data access only: no DDL or TRUNCATE, and no UPDATE/DELETE on the audit and ledger tables. A migration keeps that true for future tables.

   (Verified on PostgreSQL 17: the migrations run as the migrator, and the API runs as the app role.)
2. **Storage.**
   - **Public bucket:** public-read, served through a CDN at `MEDIA_PUBLIC_BASE_URL`.
   - **Private bucket:** no public access at all.
   - **Access key:** one key with read/write on both buckets only.
3. **Secrets.** Copy the variables from `deploy/env/<staging|production>.env.example` into the platform's secret manager, and generate each secret fresh. The API refuses to boot on a placeholder or an unsafe value, and names the variable in the error. Run `npm test -w @chopnow/api` after editing a template, because `test/deploy-env.test.ts` keeps the templates in step with these rules.
4. **Images.** CI builds them on every push (`.github/workflows/ci.yml`). To build them by hand, from the repo root:
   ```bash
   docker build -f deploy/api.Dockerfile --target runtime --build-arg RELEASE=<sha> -t <registry>/chopnow-api:<sha> .
   docker build -f deploy/api.Dockerfile --target migrate -t <registry>/chopnow-api-migrate:<sha> .
   docker build -f deploy/web.Dockerfile --build-arg APP=vendor-web --build-arg API_BASE_URL=https://api.chopnow.example -t <registry>/chopnow-vendor:<sha> .
   docker build -f deploy/web.Dockerfile --build-arg APP=admin-web  --build-arg API_BASE_URL=https://api.chopnow.example -t <registry>/chopnow-admin:<sha> .
   ```
   Portal images are per environment, because the API URL and the CSP's allowed API origin are baked in.
5. **Migrate.** Run the `migrate` image once with `DATABASE_URL` set to the **migrator** connection string.
6. **API and worker.** Deploy the runtime image twice:
   - `PROCESS_ROLE=web` behind the load balancer. Health check `GET /health`; readiness `GET /ready`, which returns 503 if the database is unreachable or a job has stalled.
   - `PROCESS_ROLE=worker` as a single instance, with health checks on its own port.

   Both use the **app** role's `DATABASE_URL`. Set `TRUST_PROXY` to the number of proxies in front of the API (usually 1), so rate limits see real client IPs.
7. **Portals.** Deploy both nginx images (port 8080; `/healthz` for checks) and put TLS in front. Add their exact origins to `CORS_ALLOWED_ORIGINS`.
8. **Paystack dashboard** (Settings → API Keys & Webhooks), for the matching mode (test for staging, live for production):
   - **Webhook URL:** `https://api.<domain>/v1/payments/webhooks/paystack`. Webhooks are verified with the secret key (HMAC-SHA512); there is no separate webhook secret.
   - **Callback URL:** `https://api.<domain>/v1/payments/callback`.
   - Optionally, allow only Paystack's published webhook IPs at the load balancer.

   If webhooks are ever lost, the worker's reconciliation sweep still asks Paystack about every unconfirmed payment (OPERATIONS_RUNBOOK.md §4).
9. **First administrator.** Set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` (16+ characters in production) on a one-off container, then run:
   ```bash
   node dist/scripts/bootstrap-admin.js
   ```
   It refuses if an admin already exists, and writes an audit entry. Then **remove both variables**. Create every other staff account from the dashboard (Customers & staff → Add staff member); each gets a one-time password that must be changed at first sign-in.
10. **Smoke test** (§6).

Never run `db:seed` against staging or production. It refuses anything but development/test, and only seeds databases holding test accounts.

## 3. Scaling and capacity
- **Web instances:** scale on CPU or connections. Each keeps up to `DATABASE_POOL_MAX` connections (default 10), so keep `(web instances + 1 worker) × DATABASE_POOL_MAX` below the database's connection limit, leaving headroom for migrations and admin sessions.
- **Rate limits** are counted in each process's memory. With *N* web instances, a client spread across them gets up to *N* × the configured limit. That's acceptable for a pilot; before running more than about 2 instances, move to a shared store (LAUNCH_CHECKLIST.md).
- **Realtime:** each web instance runs its own change feed against the database, so sockets work on any instance with no sticky sessions or message broker. Clients reconnect with backoff during deploys.
- **Jobs** are safe on several processes at once, through conditional updates and `SKIP LOCKED`. Running them in one worker just avoids duplicated sweeps.
- **Overload:** when the database pool is saturated, the API answers `503 SERVER_BUSY` with `Retry-After`, and clients retry safely (idempotent writes). Indicative capacity is in TEST_PLAN.md §5.

## 4. Releasing a change
1. CI is green on `main`: typecheck, unit tests, integration tests, browser journey, audit gate and image builds.
2. Build images tagged with the git SHA, plus portal images for the target environment.
3. **Deploy to staging first** and run the smoke test (§6).
4. Run the `migrate` job against production. Migrations must be **backward compatible** with the running version (expand, then contract): add columns as nullable or with defaults, and drop them only in a later release once nothing reads them. This is what makes the next step safe.
5. Roll the web instances (rolling update: each waits for `/ready`), then the worker, then the portals. Shutdown is graceful: on SIGTERM, jobs stop, sockets close and in-flight requests drain, with a 10-second cap. Set the platform's stop timeout to at least 15 s.
6. Watch Sentry and `/ready` for 15 minutes (OPERATIONS_RUNBOOK.md §2).

### Rollback
- **Code:** redeploy the previous SHA's images. Because migrations are backward compatible, the old code runs on the new schema.
- **Migrations are not rolled back automatically.** If one is faulty, write a forward fix. Restore from point-in-time backup only for data corruption, and only with finance on board: the ledger must stay consistent with Paystack, so reconcile afterwards (runbook §4).

## 5. Mobile apps (EAS)
One-time, in each of `apps/customer-mobile` and `apps/rider-mobile`:
```bash
npx eas-cli@latest init
```
This links the Expo project and writes `extra.eas.projectId`, which push notifications need.
```bash
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_API_BASE_URL --value https://api.staging.chopnow.example --visibility plaintext
npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_API_BASE_URL --value https://api.chopnow.example --visibility plaintext
npx eas-cli@latest credentials
```
The last command sets up Android: let EAS manage the keystore, and upload the FCM V1 service-account key for push. `EXPO_PUBLIC_*` values ship inside the app, so only public values ever go there.

| Profile | Use | Output |
|---|---|---|
| `development` | Dev client for engineers | APK |
| `preview` | Internal testers against **staging** | APK (internal distribution link) |
| `production` | Google Play | AAB; version code auto-incremented remotely |

```bash
npx eas-cli@latest build --platform android --profile preview
```
```bash
npx eas-cli@latest build --platform android --profile production
```
```bash
npx eas-cli@latest submit --platform android --profile production
```
`submit` uploads to the internal testing track; promote it in the Play Console. `app.config.js` refuses a preview or production build whose `EXPO_PUBLIC_API_BASE_URL` isn't https, so an app can never ship pointing at a development address. Over-the-air updates (`expo-updates`) aren't set up; every change ships as a store build.

Bundle identifiers: `app.chopnow.customer` and `app.chopnow.rider` *(confirm before the first store upload; they can't be changed afterwards)*.

## 6. Smoke test (every environment, every release)
1. `GET https://api.<domain>/health` → 200; `GET /ready` → `ready`, with every job's `lastOkSecondsAgo` small.
2. The worker's `/ready` lists `dispatch`, `accept-deadline`, `refunds`, `push` and `payments-reconcile`, none of them stalled.
3. Vendor and admin portals load, sign-in works, and the browser console shows no CSP errors.
4. **Staging only:** walk the journey with a preview build. Place a Paystack **test-mode** order and confirm the webhook arrives (Payments on the admin order page). Then do a cash order end to end, with a test rider delivering using the PIN.
5. **Production after launch:** place one small real order from a staff account, then refund it from the dashboard. This proves live payments, webhooks and refunds.

## 7. Configuration reference
- `deploy/env/production.env.example` and `deploy/env/staging.env.example`: every API variable, with what's enforced.
- `.env.example`: local development.
- `services/api/src/config.ts`: the authoritative rules. Deployed environments require https URLs and https origins (no localhost) and refuse the mock provider and placeholder secrets. Production additionally requires live Paystack keys, S3 storage and Expo push, and refuses debug logging.
