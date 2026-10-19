# ChopNow Architecture

Status: Phase 5 (API core, ordering and online/cash payment; customer app through checkout and order tracking). This document is updated at the end of each phase.

## 1. Shape of the system

One backend, one database, four clients.

```
 customer-mobile (Expo)   rider-mobile (Expo)   vendor-web (Vite)   admin-web (Vite)
          \                     |                     |                  /
           \___________ HTTPS REST (/v1) + Socket.IO (live order events) _/
                                     |
                         services/api  (Express 5 + TypeScript)
                         modular monolith, one deployable
       ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
       │ auth     │ catalog  │ orders   │ payments │ dispatch │ finance  │ ...
       └──────────┴──────────┴────┬─────┴──────────┴──────────┴──────────┘
                                  │ Prisma ORM (driver adapter: pg)
                             PostgreSQL 17
   external adapters: Paystack | S3-compatible storage | Expo Push | Sentry | (optional) Google Maps
```

No microservices. Modules talk to each other through in-process service interfaces and a small
in-process domain-event bus (e.g. `order.accepted` → dispatch module creates rider offers;
`order.delivered` → finance module writes ledger entries). Background work (offer timeouts,
accept deadlines, refund checks, push delivery, payment reconciliation) runs as short periodic
sweeps over the domain tables themselves. State lives in PostgreSQL, so a restart loses nothing
and no Redis or queue is needed for the pilot. The same image runs as `web` (API + sockets) or
`worker` (the sweeps); see §14.

## 2. Technology decisions

| Concern | Choice | Why |
|---|---|---|
| Monorepo | npm workspaces (npm 11, already installed) | No extra tooling; Expo SDK 52+ auto-configures Metro for npm workspaces. |
| Backend | Node 22 LTS, Express 5, TypeScript 6.0 | Small surface, well understood; TS 7 (native compiler) skipped until tooling catches up. |
| Validation | zod 4 schemas, shared in `packages/shared-schemas` | Same schema validates the API request and client forms; drives OpenAPI generation. |
| Database | PostgreSQL 17 | Transactions, check constraints, partial unique indexes, `FOR UPDATE SKIP LOCKED` for dispatch. |
| ORM | Prisma 7.10 (stable; 8.x is still RC) with `@prisma/adapter-pg` | Versioned SQL migrations, typed client. Raw SQL allowed for check constraints and locking. |
| Auth | In-house: scrypt password hashes (Node built-in), short-lived JWT access token (15 min, `jose`) + opaque rotating refresh token stored hashed in DB | Works identically for Expo and web; revocable sessions; no third-party user store to sync roles with. Role comes from the DB on every request, never from the client. scrypt chosen over argon2 because the `argon2` package has no Windows prebuild and would require a C++ toolchain on every dev machine. |
| Real-time | Socket.IO, rooms per order / restaurant / rider | Clients always re-fetch state over REST on reconnect; sockets are a hint, not the source of truth. |
| Payments | Paystack (NGN) behind a `PaymentProvider` interface; `MockPaymentProvider` for dev/tests | Mock is labelled in every response and refused in production. |
| Storage | `StorageDriver` interface: local disk (dev) / S3-compatible (staging/prod) | Public bucket for food images; private bucket + short-lived signed URLs for verification documents. |
| Push | Expo Push behind a `PushProvider` interface; `log` driver in dev | In-app notification table is always written first. |
| Logging / errors | pino (structured JSON, secrets redacted) + Sentry (enabled when DSN set) | |
| Tests | vitest + supertest; integration tests against a real `chopnow_test` Postgres database | |
| Mobile | Expo SDK 57 (React Native 0.86, React 19.2.3), Expo Router, JS/JSX | Expo Router is built on React Navigation. Icons: `@expo/vector-icons` (Ionicons/Lucide set). |
| Web | Vite 8, React 19.2.3, Tailwind CSS 4, React Router, TanStack Query | Icons: `lucide-react`. React version pinned to Expo's to avoid duplicate React copies in the workspace. |

## 3. Money

All amounts are integers in kobo (`NGN` minor units). Percentages are integer basis points.
See `packages/shared-utils/src/money.ts`. The API recomputes every price, fee, discount and total
at order creation and snapshots item prices into `order_items`; client-supplied totals are ignored.

## 4. Repository layout

```
ChopNow/
  apps/
    customer-mobile/   Expo app (Phase 4–5)
    rider-mobile/      Expo app (Phase 7)
    vendor-web/        Vite + Tailwind (Phase 6)
    admin-web/         Vite + Tailwind (Phase 9)
  services/
    api/
      prisma.config.ts       points Prisma at database/prisma
      src/modules/<module>/  auth, audit, settings, … ({routes,service}.ts from Phase 3)
      src/db/                Prisma client factory, development seed (src/db/seed/dev-seed.ts)
      src/scripts/           seed-dev.ts, bootstrap-admin.ts
      src/generated/prisma/  generated client (git-ignored)
      test/                  unit tests (no DB) · test/integration/ (real Postgres)
  packages/
    shared-schemas/    enums, state machines, permissions, zod request schemas
    shared-utils/      pure functions: money, fees, time windows (no I/O)
  database/
    prisma/            schema.prisma + versioned migrations
    init/              docker-compose bootstrap SQL
  docs/
  .env.example
  docker-compose.yml   optional local Postgres
```

Deviations from the suggested layout: Prisma migrations live in `database/prisma/migrations`
(Prisma's required sibling of `schema.prisma`) instead of `database/migrations`; the development
seed lives in `services/api/src/db/seed/` instead of `database/seeds/` because it reuses the API's
password hashing, business-rule defaults and generated client.

Apps are added to the root `workspaces` list in the phase that creates them, so each Expo app's
pinned React/React Native versions are installed and checked at that point.

## 5. API conventions

Full reference: `docs/API_DOCUMENTATION.md` and `GET /v1/openapi.json`.

- Base path `/v1`. JSON only. Errors: `{ "error": { "code", "message", "details?" } }`.
- **Route registry** (`services/api/src/http/route.ts`). Each endpoint is one `defineRoute({...})` declaring its method, path, access, zod schemas for params, query, body and response, and its handler. The registry then:
  1. resolves the caller from the bearer token (role re-read from the database);
  2. enforces access (401/403) before any input is parsed;
  3. validates params, query and body (400 with field details);
  4. runs the handler;
  5. parses the result through the response schema, so undeclared fields such as `passwordHash` can never be serialised;
  6. generates the OpenAPI document from the same definitions.
- **Ownership** is enforced in services: records are loaded with the caller's id in the `where` clause, and a miss returns 404 (not 403), so other users' records are not confirmed to exist.
- **Module layout:** `src/modules/<module>/<name>.service.ts` (business rules, no HTTP) and `<name>.routes.ts` (thin route definitions). Services are composed in `createServices()` in `app.ts`. Clocks are injected for testability.
- **Idempotency:** retryable mutations (order creation, payment init, cash confirmation, payouts) will require an `Idempotency-Key` header from Phase 5. The `idempotency_keys` table already exists.
- **Pagination:** `?page=&pageSize=` (≤100), returning `{ items, page, pageSize, total }`. Chosen over cursors because admin tables need page numbers and pilot-scale data is small.
- **Rate limiting:** in-memory limits: global and auth per IP; order placement, quotes, payments and realtime tickets per signed-in user (carrier NAT shares IPs); webhooks per IP (SECURITY.md §2b). Correct for a single API instance; move to a shared store (Postgres or Redis) before running more than one instance.
- **Database pool:** `DATABASE_POOL_MAX` connections per process (default 10); transactions wait up to 10 s for a connection, then the API answers 503 `SERVER_BUSY` (SECURITY.md §2c).
- **CORS:** allow-list from `CORS_ALLOWED_ORIGINS`. Mobile apps send no `Origin` and are unaffected.
- **Discovery** loads approved restaurants and filters by opening hours, vendor switch and straight-line delivery radius in code. Food search narrows candidates with a trigram-indexed `LIKE` first. This is appropriate for one neighbourhood (tens of restaurants); move filtering into SQL or PostGIS before multi-city scale.

## 6. Order, payment and dispatch model (summary)

- Fulfilment status (`PLACED … DELIVERED`) and payment status (`PENDING … REFUNDED`) are separate
  columns with separate history. Transition rules: `packages/shared-schemas/src/order-transitions.ts`.
- Online orders become visible to the restaurant only once the payment is verified server-side
  with Paystack (webhook or verify call). COD orders are visible immediately if COD eligibility passes.
- Dispatch: on `READY_FOR_PICKUP` (or `ACCEPTED`, configurable), offer to eligible approved, online,
  idle CORE riders first; after the configured window, widen to INDEPENDENT riders; on exhaustion,
  raise an operations alert. Only one active assignment per delivery (partial unique index).
- Finance: append-only double-entry style ledger; settlements are generated for admin review;
  no real payouts are sent in the MVP.

Detailed schema: `docs/DATABASE_SCHEMA.md` (Phase 2).

## 6a. Ordering and payment flow (Phase 5)

```
App cart ──POST /v1/orders/quote──► buildQuote(): current menu + restaurant state + address distance
                                     + business rules + promo + COD rules → amounts & problems
App ──POST /v1/orders (Idempotency-Key)──► withIdempotency() ─► one DB transaction:
        re-quote · lock promo · insert order + items (price snapshots) + history + redemption
   CASH: visibleToVendorAt = now, acceptDeadlineAt = now + 10 min
   ONLINE: hidden from the restaurant until paid
App ──POST /v1/orders/:id/payments (Idempotency-Key)──► Payment row (reference CN-XXXXXX-n) ─► provider.initialize
Customer pays on provider page ─► (a) Paystack webhook (HMAC) ─┐
                                  (b) app returns: POST /v1/payments/:ref/verify ─┤
                                  (c) Paystack callback page ──────────────────────┘
                     every path ─► provider.verify(ref) ─► applyVerification() (row lock, idempotent):
                     amount/currency match? → payment SUCCESSFUL, order paymentStatus SUCCESSFUL,
                     visible to restaurant, ledger: Dr PROVIDER_CLEARING / Cr CUSTOMER_ORDER_FUNDS
                     mismatch / duplicate / order already closed → refund request + audit
```

- **Provider adapter** (`modules/payments/provider.ts`): `PaystackProvider` (HTTP with timeouts, HMAC-SHA512 webhooks) and `MockPaymentProvider` (in-memory, dev/test only, with its own hosted test checkout page). Swapping providers touches only this module.
- **State changes** go through `transitionOrder()`, which checks the transition table and applies the change only if the order is still in the expected state (optimistic concurrency), then writes history.
- **Refunds** are recorded as `REQUESTED` (cancel after payment, late payment, mismatch, duplicate). Approval and execution with the provider are Phase 8.
- **Not yet:** the vendor accept-deadline timeout job (Phase 6) and periodic reconciliation of unprocessed payment events or stuck `INITIALIZED` attempts (Phase 8).

## 7. Customer mobile app (`apps/customer-mobile`)

Expo SDK 57 · React Native 0.86 · React 19.2.3 · Expo Router · JavaScript/JSX.

```
src/
  app/                 routes (Expo Router)
    (tabs)/            Home · Search · Orders · Favourites · Account
    restaurant/[slug]  menu + item customiser (?item= opens a dish directly from search)
    orders/[id]        tracking: timeline, delivery PIN, pay / retry / check payment, cancel, reorder
    cart · checkout · location · sign-in · sign-up · addresses · address-form · +not-found
  components/ui/       design system: Text, Button, TextField, SearchBar, Chip, StatusBadge, Price,
                       FoodImage, QuantityStepper, Screen, EmptyState, ErrorState, Skeleton,
                       ConfirmDialog, Sheet, Toast
  components/          RestaurantCard, FoodCard, MenuItemRow, ItemCustomiser, CartBar, LocationHeader
  lib/                 api-client (fetch, refresh, errors), api (endpoints), hooks (React Query),
                       menu-pricing, forms, device-location, navigation, config, token-storage(.web)
  state/               auth (context), cart and delivery location (zustand, persisted)
  theme/tokens.js      colours, spacing, radius, type scale, touch target (48), shadows
```

| Concern | Decision |
|---|---|
| Navigation | Expo Router with the JavaScript `Tabs`/`Stack` (same behaviour on native and web preview). Modals for sign-in, sign-up, location. |
| Server data | TanStack Query. Keys include delivery location and sign-in state, so results refresh when either changes. 4xx responses are not retried. |
| Client state | zustand stores persisted with AsyncStorage: cart and delivery location only. |
| Sessions | Access token in memory only. Refresh token in the OS keychain/keystore (`expo-secure-store`); on the web preview, sessionStorage. Concurrent 401s share one refresh; a rejected refresh signs the user out. |
| Validation | Forms use the same zod schemas as the API (`@chopnow/shared-schemas`), and server field errors are mapped back onto fields. |
| Money | Integer kobo everywhere; formatted with `formatMinor`. The cart shows menu-time prices as an estimate; checkout shows the server's quote, and only that total is charged. |
| Checkout | Live server quote (re-fetched when address, payment method or promo changes). Per-line problems are highlighted. An idempotency tracker keeps the same key for retries of the same request (network error / 409) and issues a new one after success, a definitive rejection, or a changed request. |
| Payment | `expo-web-browser` opens the provider checkout; on return the app calls verify. The app never marks anything paid itself. Order detail also offers "Pay again" and "I've paid, check status". Test payments are labelled. |
| Order updates | Order detail polls every 10 s while in progress (WebSocket push replaces this in Phase 10). |
| Cart | One restaurant per cart. Adding from another restaurant asks before clearing. Identical configurations merge. Quantity capped at 20 per line. |
| Location | GPS (`expo-location`), a saved address, or the pilot-area centre (labelled approximate). Addresses require a pin because eligibility and fees depend on coordinates. A map picker needs a maps key and is deferred. |
| Images | Vendor-uploaded photos served from ChopNow storage; placeholder tiles when a dish has none. No hot-linked stock images. |
| Reviews | Order detail shows the restaurant's ready-by estimate while it's being prepared, and a star rating + comment form once delivered (14-day window, once per order). |
| Accessibility | 48 pt touch targets, labelled controls, roles and states (radio, checkbox, disabled, busy), live regions for errors and toasts, WCAG AA colour pairs. Status is always text, never colour alone. |
| Monorepo | npm workspaces. React and React DOM are pinned at the root (`devDependencies` + `overrides`) so Expo's peer resolution can't hoist a second React. `expo-doctor` passes. |

## 8. Vendor web portal (`apps/vendor-web`, Phase 6)

React 19.2.3 · Vite 8 · Tailwind CSS 4 · React Router 7 · TanStack Query · JavaScript/JSX.

```
src/
  pages/        Auth (sign in / register), Onboarding, Dashboard, OrdersBoard, OrderHistory, Menu,
                RestaurantProfile (photos, hours, details, documents, checklist), Reports, Reviews
  components/   ui (Button, Field/Input/Select/Textarea, Switch, Badge, Card, Modal, ConfirmDialog,
                Toast, Table, Pagination, Skeleton, Empty/Error states, Money), AppShell, OrderCard,
                ItemEditor, RestaurantForm, HoursEditor
  lib/          api (cookie-session client + endpoints), format (kobo, Lagos dates, statuses)
  state/        session (signed-in vendor + selected restaurant)
```

| Concern | Decision |
|---|---|
| Sessions | API "web mode" (`X-ChopNow-Client: web`): the refresh token is an httpOnly, SameSite=Strict cookie (Secure outside development) scoped to `/v1/auth`, never readable by JavaScript or returned in a response body. The access token is kept in memory only; a page reload restores the session through the cookie. Only VENDOR accounts may use the portal (the API enforces the same). |
| Orders board | Polls every 10 s (WebSocket push in Phase 10); the tab title and sidebar show the incoming count. Buttons come from the API's per-order `actions` list, and the API re-checks every transition. Each incoming order shows a countdown to the 10-minute auto-decline. Vendors never see the customer's address, phone or PIN. |
| Auto-decline | `expireOverdue` runs every 30 s in the API process. It closes PLACED orders past `acceptDeadlineAt` (refund request if paid, promo released) through the same path as a manual decline. With more than one API instance this moves to a single scheduled worker (Phase 12). |
| Menu | Categories and dishes with options (variants) and extras; "sold out" toggles instead of deletion; prices are entered in naira and sent as integer kobo, validated with the API's zod schema. |
| Hours | Several windows per day; closing at 00:00 means midnight; past-midnight opening is a second window on the next day. Validated client-side with the shared `validateOpeningWindows` and again by the API. |
| Reports | Delivered orders only, by Lagos calendar day: food sales, commission, restaurant-funded discounts, estimated net, top dishes. Labelled as estimates until settlement statements (Phase 8). |
| Accessibility | Labelled controls, 44 px minimum targets, focus rings, live regions for toasts and the accept countdown, status as text not colour. Layout works from 360 px (drawer navigation on small screens). |

## 9. File storage (Phase 6)

`StorageDriver` has two implementations: **local** (development/test; files under `STORAGE_LOCAL_DIR`, public files served at `/media`, private files only through HMAC-signed, expiring `/media-private` URLs) and **s3** (any S3-compatible store; public bucket behind `MEDIA_PUBLIC_BASE_URL`, private bucket with presigned URLs). Production refuses the local driver.

Images (menu items, logos, covers) are type-checked by content (magic bytes), limited to 5 MB and at least 200×200, then re-encoded by sharp to WebP (longest edge 1600 px) with all metadata stripped. Documents (PDF/JPG/PNG, 10 MB) are stored privately under random keys. Image URLs saved on menus and restaurants must point at our own media base URL.

## 10. Dispatch and the rider app (Phase 7)

**Lifecycle.** When the restaurant accepts (`dispatch.startDispatchOn = ACCEPTED`; or on "ready" if set to `READY_FOR_PICKUP`), `openDelivery` creates the delivery (status OFFERING) and, for cash orders, a cash-collection record, in the same transaction as the order change. `DispatchService` then offers it:

| Rule | Default / behaviour |
|---|---|
| Offer style | One rider at a time, `dispatch.offerTimeoutSeconds` (45 s). Simple to reason about, no acceptance races between riders for the same job; a decline moves on immediately. |
| Tiers | CORE riders only for `coreOnlyWindowSeconds` (2 min), then INDEPENDENT riders too (`widenedAt` recorded). |
| Eligibility | APPROVED, ONLINE, account ACTIVE, seen in the last 90 s (app poll or location), no active delivery, no other pending offer. Not riders who declined or released this delivery; riders whose offer expired may be asked again after 2 min. |
| Cash limit | Cash orders skip riders whose outstanding cash ≥ their limit (`riderOutstandingCashLimitKobo`, ₦30,000, or a per-rider override). |
| Ranking | Straight-line distance from the rider's last position to the restaurant; unknown positions last; then most recently seen. |
| Alert | No acceptance after `alertOperationsAfterSeconds` (10 min): `dispatchAlertAt` set once, audit `dispatch.unassigned_alert`, warning logged. The admin dashboard (Phase 9) lists these. |
| Triggers | Immediately after accept/decline/release/going offline (`kick`, awaited, never fails the caller), plus a 5-second sweep in `server.ts` that expires offers, then offers waiting jobs oldest first across the **whole** queue (batches of 50, stopping once no rider is free, so jobs a free rider can't take never hide later ones they can), then raises the 10-minute operations alert in its own pass. |
| Concurrency | Deliveries are locked `FOR UPDATE SKIP LOCKED`; the chosen rider row is locked before an offer is created; acceptance is a conditional update; the database allows one active delivery per rider and one accepted offer per delivery. Safe with several API instances. |

**Delivery steps.** ASSIGNED → ARRIVED_AT_RESTAURANT → PICKED_UP (only once the restaurant marked the food ready; order → PICKED_UP) → DELIVERED (customer's PIN; cash orders record the amount, which must equal the amount due). Before pickup a rider can **release** the job (back to dispatch, audited); after pickup they can **report a problem** (delivery FAILED, order DELIVERY_EXCEPTION for operations, rider set offline, audited). Every step appends a `delivery_events` row.

**Money on delivery.** Cash: `CASH_COLLECTED` journal (Dr RIDER_CASH_HELD for that rider / Cr CUSTOMER_ORDER_FUNDS), cash collection OUTSTANDING until remitted (Phase 8), order `paymentStatus` SUCCESSFUL. Every delivery: one DELIVERY_FEE `rider_earnings` row (CALCULATED) for the snapshotted `riderEarningKobo`; settlement and payout are Phase 8.

### Rider app (`apps/rider-mobile`)
Expo SDK 57 · React Native 0.86 · Expo Router · JavaScript/JSX, same stack and design system as the customer app.

```
src/
  app/              sign-in · sign-up (apply with vehicle) · (tabs)/ Deliveries · Earnings · Account
  components/       OfferCard (countdown, earning, cash, distances), DeliveryPanel (step card, call /
                    directions, PIN + cash form, hand-back and problem sheets), ui/ (copied kit)
  lib/              api-client (+ multipart upload), api, delivery (pure helpers: steps, cash/PIN
                    validation, distances, maps links), hooks (profile, 5 s work poll, location), forms
  state/            auth (RIDER accounts only)
```

| Concern | Decision |
|---|---|
| Updates | `GET /v1/rider/work` every 5 s while online or on a delivery (also the heartbeat). WebSocket/push replaces polling in Phase 10. |
| Location | Foreground only, every 30 s while online, via `expo-location`; overwritten server-side, used only for ranking. Background tracking and live customer maps are out of scope for v1. |
| Sessions | Refresh token in the OS keychain/keystore (`expo-secure-store`, separate key from the customer app); sessionStorage on the web preview. Signing out goes offline first. |
| Documents | `expo-document-picker`, uploaded as multipart; PDF/JPG/PNG ≤ 10 MB (checked in the app and by content on the server). |
| Code sharing | The UI kit, API client and token storage were **copied** from the customer app to avoid destabilising it mid-pilot. Extracting a shared `packages/mobile-ui` is recorded tech debt. |

Customers see "Chinedu is on the way to you" (first name, vehicle, delivery status); restaurants see the rider's first name and whether they've arrived. Neither sees the rider's phone, plate or location.

## 11. Finance (Phase 8)

Double-entry, append-only ledger (`financial_transactions` + `ledger_entries`), every journal balanced (checked in code and by a deferred database trigger) and posted exactly once per business event (idempotency key), in the same transaction as the business change. Journals carry the app clock (`at`), so periods and tests agree.

| Event | Journal | Key |
|---|---|---|
| Online payment captured | Dr PROVIDER_CLEARING / Cr CUSTOMER_ORDER_FUNDS | `payment:<id>:captured` |
| Duplicate or wrong-amount charge | Dr PROVIDER_CLEARING / Cr REFUNDS_PAYABLE (owed back, never applied to the order) | `payment:<id>:unapplied` |
| Cash collected at the door | Dr RIDER_CASH_HELD (rider) / Cr CUSTOMER_ORDER_FUNDS | `cash:<id>:collected` |
| **Order delivered** | Dr CUSTOMER_ORDER_FUNDS (+ Dr PROMOTION_EXPENSE for platform-funded discounts) / Cr VENDOR_PAYABLE (food − commission − restaurant-funded discount), Cr RIDER_PAYABLE (rider earning), Cr PLATFORM_COMMISSION_REVENUE, Cr PLATFORM_DELIVERY_REVENUE (fee − rider earning), Cr PLATFORM_SERVICE_FEE_REVENUE | `order:<id>:settled` |
| Refund approved | Dr CUSTOMER_ORDER_FUNDS (order never completed) · VENDOR_PAYABLE (delivered, restaurant bears it) · ADJUSTMENTS (delivered, platform bears it) / Cr REFUNDS_PAYABLE. None for unapplied charges. | `refund:<id>:approved` |
| Refund paid | Dr REFUNDS_PAYABLE / Cr PROVIDER_CLEARING (provider) or PLATFORM_BANK (manual transfer) | `refund:<id>:paid` |
| Rider cash handed in | Dr PLATFORM_BANK / Cr RIDER_CASH_HELD (rider); allocated to the oldest open collections first | `remittance:<id>:confirmed` |
| Payout recorded as paid | Dr VENDOR_PAYABLE or RIDER_PAYABLE / Cr PLATFORM_BANK | `payout:<id>:paid` |

**Refunds.** REQUESTED (automatic for cancelled/declined paid orders and unapplied charges; staff for complaints) → APPROVED by someone other than the requester, with `chargeTo` fixed → provider refund (SUCCESSFUL, PROCESSING until the provider confirms, or FAILED → retry / mark paid by bank transfer). The provider is called only after the row is claimed (PROCESSING), outside any database transaction; a network error is flagged "check the provider dashboard before retrying". Refund webhooks only trigger a re-fetch; a 2-minute sweep re-checks PROCESSING refunds. Order `paymentStatus` becomes PARTIALLY_REFUNDED / REFUNDED.

**Settlements.** Generated for a past period (Lagos dates) per restaurant and rider: net payable = payable balance at period end (excluding payouts) − earlier settlements that had something to pay. This always reconciles with the ledger and carries forward anything not yet covered, including negative balances (e.g. a refund charged to the restaurant after its last payout). Breakdown fields (orders, gross, commission, restaurant-funded discounts, refund deductions) explain the number; `adjustmentsKobo` is what was carried. DRAFT → APPROVED → PAYOUT_INITIATED (our reference `PO-XXXXXXXX` to quote) → PAID when finance records the bank reference, or FAILED → start again. One live payout per settlement (unique index). Rider earnings move CALCULATED → APPROVED → SETTLED with their settlement.

**Not in v1** *(confirm)*: automatic transfers (Paystack Transfers), storing bank account details (needs encryption at rest and verification; finance holds them offline for the pilot), netting a rider's unremitted cash against their payout (shown on the statement instead), maker-checker on payouts (all payout steps are audited), and multi-currency.

Clients: the vendor portal has a **Payouts** page (approved statements, breakdown, transfer attempts); the rider app's Earnings tab shows cash hand-ins (declare a transfer; finance confirms) and payout statements. Staff finance screens arrive with the admin dashboard (Phase 9); every action is already available through the API.

## 12. Admin dashboard and operations (Phase 9)

**API** (`services/api/src/modules/ops`): `OpsOrdersService` (dashboard, order search and detail, cancel, retry delivery, confirm delivered without PIN, dispatch board, manual assign/unassign) and `OpsAdminService` (users and staff, verification documents, promotions, review moderation, audit log). Delivery completion is shared with the rider app (`dispatch/finalize-delivery.ts`), so a staff-confirmed delivery books cash, rider earning and the order split exactly like a PIN delivery.

| Fix | What happens |
|---|---|
| Cancel (PLACED … READY_FOR_PICKUP, DELIVERY_EXCEPTION) | Same closure as a customer/restaurant cancellation: refund requested if paid, promo released, delivery and offers cancelled. Not once the rider has the food (wait for delivery or a reported problem). |
| Retry delivery, same rider | Delivery FAILED → PICKED_UP, order DELIVERY_EXCEPTION → PICKED_UP, PIN attempts reset. |
| Retry delivery, new rider | Delivery back to OFFERING (dispatch clock and alert reset), order → READY_FOR_PICKUP, previous rider's offer released (not re-offered). |
| Confirm delivered | For picked-up orders, e.g. a locked PIN: proof override with reason (DB requires PIN or override for DELIVERED), cash must equal the amount due. |
| Assign / unassign | Assign gives a waiting delivery to an approved rider (DB still allows one active job per rider); unassign before pickup returns it to dispatch. |

**Staff accounts.** Created by an admin with a 16-character one-time password shown once (never stored or audited in plain text). `users.mustChangePassword` blocks every request except `POST /v1/me/password`, `GET /v1/me` and auth endpoints until changed; staff passwords must be 12+ characters and differ from the current one. Suspension bumps `tokenVersion` and revokes sessions, so it takes effect immediately; admins can't suspend themselves or the last admin.

**Web app** (`apps/admin-web`, React 19.2.3 · Vite 8 · Tailwind 4 · React Router 7 · TanStack Query; port 5174). Same browser session model as the vendor portal (httpOnly refresh cookie, in-memory access token). Staff roles only.

```
src/
  pages/        Auth (sign in, set password), Dashboard, Orders, OrderDetail (actions with reasons),
                Dispatch, Partners (restaurants, riders + documents), People (users/staff, reviews,
                audit), Config (promotions, business rules), Finance (summary, refunds, cash,
                settlements & payouts)
  components/   AppShell (menu filtered by permission, live badges), admin (Status labels,
                ReasonDialog, useAction, Facts, FilterChips), Documents (signed-link viewer + review), ui
  lib/          api (cookie-session client + every admin endpoint), format
  state/        session (staff only; can(permission) from the shared permission table)
```

| Concern | Decision |
|---|---|
| Permissions | The menu and each route use the same `ROLE_PERMISSIONS` table as the API (`hasPermission`). Hidden items are a convenience; the API refuses the requests regardless (covered by the access manifest and sweep). |
| Every change has a reason | `ReasonDialog` requires ≥ 5 characters, which the API stores in the audit log (and, where relevant, shows to the restaurant, rider or customer). |
| Live data | Dashboard 15 s, orders 20 s, dispatch 10 s polling (WebSocket push in Phase 10). |
| Documents | Opened through a 5-minute signed link; every view is audited. |
| Money | Shown in naira from integer kobo; amounts typed in naira are converted with the shared parser. Payout and refund screens say plainly that ChopNow records transfers made outside the system. |
| Performance | Pages are code-split per section (main bundle ≈ 430 kB). |

Found and fixed while building it: the shared `Modal` re-ran its focus effect on every render when given an inline `onClose`, moving focus back to the first field while typing (vendor portal and admin). Regression test in `vendor-web/src/components/Modal.test.jsx`.

## 13. Notifications, realtime and monitoring (Phase 10)

**Notifications (durable outbox).** `notify()` writes `notifications` rows inside the transaction of the change they describe (order placed or paid, accepted, delayed, declined/cancelled/expired, rider assigned, picked up, delivered, delivery problem, delivery offer, staff assignment changes, approval decisions, rejected documents, cash hand-in decisions, payouts, refunds). Wording lives in `notifications/messages.ts`; each row has a dedupe key so an event notifies once. Bodies never contain PINs, addresses or phone numbers. Customers aren't told about their own cancellations; restaurants aren't told about their own declines.

**Push.** The `push` job (every 3 s) claims pending rows with `FOR UPDATE SKIP LOCKED`, sends them through a `PushProvider` (Expo in deployed environments, a logger in development, memory in tests) outside any transaction, and records the result: dead tokens (`DeviceNotRegistered`) are disabled; outages leave rows pending (up to 5 attempts); users without devices are marked handled; anything older than 30 minutes is not pushed (it stays in the in-app list). Offers are sent high-priority with a 45 s TTL on an "urgent" Android channel. Expo receipts aren't polled in v1.

**Realtime.** `/v1/realtime` WebSocket (`ws`), opened with a 30-second HMAC ticket from `POST /v1/realtime/ticket` (the access token never goes in a URL). A `ChangeFeed` job (every 1 s) reads the append-only tables the business logic already writes (order status history, delivery events, offers, notifications) with a 15-second look-back and an id set to catch late commits without duplicates, and tells each connected party "something changed" (ids only). Every instance runs its own feed over the shared database, so it scales horizontally without a message broker; at higher volume the feed can move to Postgres LISTEN/NOTIFY or Redis (Phase 12 note). Clients refetch over REST and keep slower polling as a fallback (vendor board 10 s → 60 s, rider work 5 s → 15 s, keeping the 90 s dispatch heartbeat, customer order 10 s → 60 s, admin screens 10–30 s → 60–120 s).

| Who | Events | Client reaction |
|---|---|---|
| Customer | `order.updated`, `delivery.updated`, `notification.new` | Refetch the order; update notifications |
| Restaurant owner | the same, for orders that reached the restaurant | Refetch the board and incoming count; bell |
| Rider | `work.updated` (offers, job changes), `order.updated` for their job, `notification.new` | Refetch work immediately |
| Staff | every `order.updated`/`delivery.updated`, `dispatch.updated` | Refetch dashboard, dispatch, orders |

Shared client: `createRealtimeClient` in `@chopnow/shared-utils` (ticket → connect → reconnect with 1–30 s jittered backoff; stops when signed out), used by all four apps.

**Mobile push.** `expo-notifications` + `expo-device`: after sign-in the app asks permission, gets an Expo push token (needs a physical device and the EAS project id, set at build time in Phase 12) and registers it; sign-out removes it. Tapping a notification opens the order (customer) or the deliveries tab (rider). Expo Go on Android can't receive remote push since SDK 53, so push is verified with a development build; live updates work in Expo Go.

**Monitoring.** Sentry (`@sentry/node`) only when `SENTRY_DSN` is set: 5xx errors and failed background jobs are reported with the request id or job name; user info, cookies, headers, bodies, query strings and database data are not collected. Each background job records a heartbeat; `GET /ready` returns 503 (`degraded`) if a job hasn't succeeded for 5 intervals, plus the number of live connections. Jobs never overlap themselves on one instance. Graceful shutdown stops jobs, closes sockets, drains requests and flushes Sentry.

Not in v1: SMS/email notifications, notification preferences, web push for the portals (they use the bell and live updates), Expo receipt polling, client-side Sentry.

## 14. Deployment and operations (Phase 12)
| Concern | Design |
|---|---|
| Process roles | One image, `PROCESS_ROLE`: `all` (single instance), `web` (HTTP, WebSocket, realtime feed; scale horizontally), `worker` (dispatch, accept deadlines, refunds, push, payment reconciliation; one instance, `/health` and `/ready` only). Jobs are safe on several processes anyway (conditional updates, `SKIP LOCKED`, claimed rows); the worker just avoids duplicated sweeps |
| Images | `deploy/api.Dockerfile`: `runtime` (production dependencies only, non-root, no Prisma CLI) and `migrate` (one-shot `prisma migrate deploy`). `deploy/web.Dockerfile`: a static portal on unprivileged nginx with a strict CSP whose `connect-src` is the environment's API |
| Database roles | `chopnow_migrator` owns the schema; `chopnow_app` (what the API uses) has DML only, and only INSERT/SELECT on the audit and ledger tables (`database/roles.sql` and the `app_role_append_only` migration) |
| Payment reconciliation | Worker job, every minute. It asks the provider about unconfirmed attempts on a backoff (3 min, every 15 min to 1 h, hourly to 6 h, 6-hourly to 48 h; `payments.lastReconciledAt`, claimed per round), then cancels online orders unpaid after `orders.unpaidOnlineOrderTimeoutSeconds` (default 30 min), releasing promotions. It applies results through the same `applyVerification` as webhooks, so order, ledger and refunds stay consistent whichever source wins |
| Closing vs paying | `closeUnfulfilledOrder` and `applyVerification` both lock the order's payments, then the order, and decide from fresh data. A cancellation racing a payment confirmation always ends refunded, never cancelled-but-paid (test: `http-payment-reconciliation.test.ts`) |
| Configuration | Validated at boot. Deployed environments require https URLs and origins and refuse the mock provider and placeholders. Production also requires live Paystack keys, S3 storage and Expo push, and refuses debug logs. Templates: `deploy/env/*.env.example`, kept honest by `test/deploy-env.test.ts` |
| Mobile builds | EAS profiles development/preview/production per app. `app.config.js` refuses non-development builds without an https API URL |
| CI | `.github/workflows/ci.yml`: typecheck, unit tests, critical-advisory gate; integration and browser E2E on Postgres 17; image builds and a container smoke test |
