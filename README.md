# ChopNow

Community food ordering and delivery marketplace — MVP monorepo.

> **Status: Phase 5 of 12.** Customers can browse, search, customise dishes, check out with
> **cash on delivery or online payment**, apply promo codes, track and cancel orders, and reorder.
> The server prices every order and protects against duplicate submissions. Paystack is integrated
> behind an adapter; until test keys are configured, a clearly labelled **mock** provider is used.
> The vendor, rider and admin apps come in Phases 6–9.

### Payments in development
- Default `PAYMENT_PROVIDER=mock`: "Pay online" opens a local **TEST PAYMENT** page where you choose
  success or failure. No money moves, and responses mark it `isTestPayment: true`.
- To use Paystack test mode, set `PAYMENT_PROVIDER=paystack` and `PAYSTACK_SECRET_KEY=sk_test_…`
  in `.env` (never in the app). For webhooks to reach your machine, expose the API (e.g. a tunnel),
  set `PUBLIC_API_URL` to that address, and enter `PUBLIC_API_URL/v1/payments/webhooks/paystack`
  as the webhook URL in the Paystack dashboard. Without webhooks, payments are still confirmed when
  the app returns from checkout.
- Test promo code from the seed: `WELCOME10` (10% off food, max ₦1,000, once per customer).

## Prerequisites
- Node.js 22.13+ (developed on 22.13.1) and npm 10+. Keep jsdom on 29.x until Node is upgraded to 22.19+ (jsdom 30 needs it).
- PostgreSQL 17 with three **UTF-8** databases owned by user `chopnow`: `chopnow_dev`, `chopnow_test` (integration tests) and `chopnow_e2e` (browser end-to-end and load tests):
  - **Docker:** `docker compose up -d` creates all three (on an existing volume, create `chopnow_e2e` by hand).
  - **Native (Windows):** `winget install PostgreSQL.PostgreSQL.17`, then in `psql -U postgres`:
    ```sql
    CREATE USER chopnow WITH PASSWORD 'chopnow_dev_password';
    CREATE DATABASE chopnow_dev  OWNER chopnow ENCODING 'UTF8' TEMPLATE template0;
    CREATE DATABASE chopnow_test OWNER chopnow ENCODING 'UTF8' TEMPLATE template0;
    CREATE DATABASE chopnow_e2e  OWNER chopnow ENCODING 'UTF8' TEMPLATE template0;
    ```
    (Windows installers often default to WIN1252; `ENCODING 'UTF8' TEMPLATE template0` avoids that.)
- For mobile apps (Phase 4+): the Expo Go app on a phone, or an Android emulator.

> **Windows note:** if the repo is under `Documents` and Windows Security "Controlled folder access"
> is on, Node and Git are blocked from writing here and `npm install` hangs. Move the repo (e.g.
> `C:\dev\ChopNow`) or allow `node.exe` and `git.exe` in Windows Security → Ransomware protection.

## Setup
```bash
npm install                 # first run creates package-lock.json: commit it
cp .env.example .env        # then edit values; never commit .env
npm run build:packages
npm run db:migrate          # applies migrations to chopnow_dev and generates the Prisma client
npm run db:seed             # loads clearly-marked TEST data (development only)
```

## Running the customer app
1. Start the API: `npm run dev:api`.
2. Point the app at it: copy `apps/customer-mobile/.env.example` to `apps/customer-mobile/.env` and
   set `EXPO_PUBLIC_API_BASE_URL`. For a physical phone, use your computer's LAN IP, e.g.
   `http://192.168.1.20:4000`, with the phone on the same Wi-Fi. Add the web preview origin
   (`http://localhost:8081`) to `CORS_ALLOWED_ORIGINS` in the root `.env` if you use the browser preview.
3. `npm run dev:customer`, then:
   - **Phone:** scan the QR code with Expo Go (Android) or the Camera app (iOS).
   - **Android emulator:** press `a`. **Web preview:** press `w` (development only).
4. Sign in as `ada@chopnow.test` (see development accounts below), or browse without signing in.

The app uses only modules bundled in Expo Go (SDK 57), so no custom native build is needed during
development.

## Running the rider app
1. Start the API (`npm run dev:api`).
2. Copy `apps/rider-mobile/.env.example` to `apps/rider-mobile/.env` (same API address rules as the customer app).
3. `npm run dev:rider`, then open it in Expo Go, an emulator, or press `w` for the web preview (add `http://localhost:8082` to `CORS_ALLOWED_ORIGINS` if you run it on that port).
4. Sign in as `rider.core1@chopnow.test` (approved core rider). Riders must keep the app open while online: offers arrive through a 5-second poll in v1.

## Live updates and push
The API serves live updates at `ws://<api>/v1/realtime` (the apps connect automatically). In development pushes are only logged (`PUSH_PROVIDER=log`). To try real push: build a development client with EAS (needs an Expo account and project id), set `PUSH_PROVIDER=expo`, sign in on a physical phone and allow notifications. Expo Go on Android can't receive remote push.

## Running the admin dashboard
1. Start the API with `http://localhost:5174` in `CORS_ALLOWED_ORIGINS`.
2. `npm run dev:admin`, open http://localhost:5174 and sign in as `admin@chopnow.test` (or `ops`, `support`, `finance` to see each role's view).
3. Add real staff from **Customers & staff → Add staff member**; they set their own password at first sign-in.

## Running the vendor portal
1. Start the API (`npm run dev:api`) with `http://localhost:5173` in `CORS_ALLOWED_ORIGINS` (it is in `.env.example`).
2. Optional: copy `apps/vendor-web/.env.example` to `apps/vendor-web/.env` to point at another API.
3. `npm run dev:vendor`, open http://localhost:5173 and sign in as `vendor.mamankechi@chopnow.test`.
   New orders appear on the Orders board once they're sent to the restaurant (online orders after payment).

## Commands
| Command | What it does |
|---|---|
| `npm run dev:api` | Start the API with reload on http://localhost:4000 (OpenAPI at `/v1/openapi.json`) |
| `npm run dev:customer` | Build shared packages and start the customer app (Expo) |
| `npm run dev:rider` | Build shared packages and start the rider app (Expo) |
| `npm run dev:admin` | Build shared packages and start the admin dashboard (Vite) on http://localhost:5174 |
| `npm run dev:vendor` | Build shared packages and start the vendor portal (Vite) on http://localhost:5173 |
| `npm test` | Unit tests for every workspace, including the customer app's Jest suite (no database needed) |
| `npm run test:integration` | API integration tests against `DATABASE_URL_TEST` (real Postgres; truncates it) |
| `npm run test:e2e` | Browser end-to-end: builds the four web apps, starts an API on the e2e database (port 4100, mock payments), and drives the full ordering journey in an installed Edge or Chrome with accessibility checks. See docs/TEST_PLAN.md |
| `npm run test:load` | Indicative load check (search, quote, order placement, realtime fan-out, dispatch) against its own API on the e2e database |
| `npm run typecheck` | Type-check every workspace |
| `npm run build` | Build shared packages and the API |
| `npm run db:migrate` | Create/apply migrations in development |
| `npm run db:seed` | Wipe and reseed the development database with test data |
| `npm run admin:bootstrap -w @chopnow/api` | Create the first ADMIN from `BOOTSTRAP_ADMIN_*` (one-time) |

## Development accounts (after `db:seed`)
All seeded accounts end in `@chopnow.test` and share the development password from
`SEED_USER_PASSWORD` (or the default in `services/api/src/db/seed/dev-seed.ts`):
`admin`, `ops`, `support`, `finance`, `vendor.mamankechi`, `vendor.bukka`, `vendor.suya`,
`vendor.pending`, `ada`, `tunde`, `rider.core1`, `rider.core2`, `rider.indie1`, `rider.pending`.

## Documentation
- `docs/ARCHITECTURE.md` — system design and technology decisions
- `docs/PRODUCT_REQUIREMENTS.md` — MVP defaults and business rules awaiting confirmation
- `docs/DATABASE_SCHEMA.md` — tables, constraints, transactions, retention, access control
- `docs/SECURITY.md` — authentication, authorisation, HTTP hardening and data protection
- `docs/API_DOCUMENTATION.md` — endpoints, conventions, error codes, eligibility rules
- `docs/TEST_PLAN.md` — test layers, suites, coverage of the acceptance journey
- `docs/DEPLOYMENT.md` — environments, container images, database roles, releases, rollback, mobile builds
- `docs/OPERATIONS_RUNBOOK.md` — monitoring, failed orders, payment discrepancies, refunds, cash, settlements, incidents
- `docs/LAUNCH_CHECKLIST.md` — what is verified, and what must be done before the pilot goes live
