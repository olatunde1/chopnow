# ChopNow Security

Status: authentication, authorisation, HTTP hardening, database-level controls (Phases 2–3), orders
and payments (Phase 5), vendor web sessions and file uploads (Phase 6), dispatch and rider deliveries (Phase 7), finance (Phase 8), the admin dashboard and operations tools (Phase 9), and notifications, realtime and monitoring (Phase 10) are implemented. This
document is updated as each phase lands. "Planned" marks controls not yet implemented.

## 1. Authentication

| Control | Implementation |
|---|---|
| Password storage | scrypt (Node built-in), N=2^16, r=8, p=2, 16-byte salt, 64-byte key. Stored as `scrypt$N$r$p$salt$hash`; stronger parameters are applied on next login (`needsRehash`). Plaintext passwords are never stored or logged. |
| Password policy | 8–128 chars, at least one letter and one digit (`PasswordSchema`). The bootstrap admin needs 16+ characters in production. |
| Login errors | One generic `INVALID_CREDENTIALS` for unknown email or wrong password; a dummy hash equalises timing. |
| Brute force | Account locks for 15 min after 5 consecutive failures (audited). Per-IP limit of 20 sign-in, registration, refresh and password-change requests per 15 min, plus 600 requests/min overall (configurable). |
| Access tokens | HS256 JWT, 15 min, issuer and audience checked, algorithm pinned (rejects `alg: none`). Claims: user id, role, `tokenVersion`. |
| Authority | The token is not trusted for authority. Every request re-reads the user's **current role, status and tokenVersion** from the database, so suspension, role changes and "log out everywhere" take effect immediately. |
| Refresh tokens | 256-bit random opaque tokens; only the SHA-256 is stored. Each refresh rotates the token. Replaying a rotated token revokes the whole session family (theft detection, audited). Concurrent refreshes cannot both succeed (atomic claim). |
| Self-registration | Only `CUSTOMER`, `VENDOR`, `RIDER`. Unknown fields are rejected (`.strict()`), so `role`, `status` or `tokenVersion` cannot be injected. Staff accounts are created only by an ADMIN (Phase 9) or by the one-time bootstrap script. |
| Approval gating | New riders start `PENDING` + `OFFLINE`; restaurants start `PENDING` + not accepting. The database refuses `ONLINE`/accepting for anything not `APPROVED`. |

## 1a. Web sessions (vendor portal; admin in Phase 9)
| Control | Implementation |
|---|---|
| Refresh token storage | Browser clients send `X-ChopNow-Client: web`. The refresh token is then set as an httpOnly cookie (`chopnow_rt`, SameSite=Strict, Path=/v1/auth, Secure outside development) and omitted from the JSON body, so page scripts (and any XSS) cannot read it. |
| CSRF | The cookie is only sent to `/v1/auth/*` and is SameSite=Strict; cookie-based refresh/logout also require the custom `X-ChopNow-Client` header, which a cross-site form cannot send and which CORS only allows for listed origins. Every other endpoint authenticates with the in-memory Bearer token, never the cookie. |
| Logout | Revokes the token server-side and clears the cookie. |
| Mobile apps | Unchanged: refresh token in the OS keychain/keystore, sent in the body. |

## 2. Authorisation

- Roles: CUSTOMER, VENDOR, RIDER, ADMIN, OPERATIONS, SUPPORT, FINANCE.
- Permissions table: `packages/shared-schemas/src/permissions.ts`. Duties are separated: SUPPORT cannot approve refunds or change config, OPERATIONS cannot manage payouts, FINANCE cannot dispatch.
- Ownership: `*.own` permissions only allow acting on the caller's own records. Service-layer queries always include the ownership filter (customer → own addresses and orders; vendor → own restaurants, categories, items and variants; rider → assigned deliveries). Records belonging to someone else return **404**, so their existence is not confirmed.
- Every route declares its access in one place (`defineRoute`). Access is checked before input is parsed.
- Hiding a button in a client is never treated as access control.

### How authorisation is tested
| Test | What it proves |
|---|---|
| Access manifest (`http-security.test.ts`) | Every route's declared access equals a reviewed list. Weakening a route fails the build; verified by deliberately downgrading a route. |
| Structural rules | Every `/v1/admin/*` route needs a staff-only permission; every `/v1/vendor/*` route needs a vendor permission. |
| Protection sweep | Every protected route returns 401 without a token or with a garbage token, and 403 for **every role** lacking the permission. |
| IDOR tests | Vendor B cannot read or change vendor A's restaurant, hours, availability, menu, items, categories or variants. Customer B cannot read or change customer A's addresses. Verified by deliberately removing the ownership filter, which makes the test fail. |
| Response filtering | Admin and profile responses never contain password hashes or token internals. |

## 2a. HTTP hardening
- `helmet` security headers, `x-powered-by` disabled, 100 kB JSON body limit (413 above it).
- The vendor and admin portals are served by nginx (`deploy/nginx-spa.conf`) with a strict policy:
  - **CSP:** `script-src 'self'` and `style-src 'self'` with no inline code; `connect-src` limited to this environment's API (https and wss); `frame-ancestors 'none'`.
  - **Other headers:** HSTS, `nosniff`, `no-referrer`, a restrictive Permissions-Policy.
  - **Delivery:** source maps are removed from the image.

  The browser E2E serves the portals with this exact CSP and fails on any violation.
- Strict request schemas: unknown fields are rejected, money must be a non-negative integer, coordinates are range-checked.
- Response schemas strip undeclared fields.
- Errors: only `AppError` messages reach clients. Malformed JSON gives `INVALID_JSON`; anything unexpected is a generic 500 with no stack trace, logged with the request id.
- CORS allow-list (`CORS_ALLOWED_ORIGINS`); requests without an Origin (mobile apps, server-to-server) are allowed because CORS does not apply to them.
- `TRUST_PROXY` must equal the number of proxies in front of the API, so rate limits key on the real client IP and cannot be bypassed with a spoofed `X-Forwarded-For`.
- Search input is passed as bound parameters, and `LIKE` wildcards in user input are escaped.
- The OpenAPI document is off by default in production.

## 2b. Rate limits (Phase 11)
| Route | Limit | Keyed by |
|---|---|---|
| Sign-in, registration, refresh, password change | `RATE_LIMIT_AUTH_MAX` (20) per 15 min | IP |
| Everything | `RATE_LIMIT_GLOBAL_MAX` (600) per min | IP |
| `POST /v1/orders` | `RATE_LIMIT_ORDER_MAX` (10) per 10 min | signed-in user |
| `POST /v1/orders/quote` | 12 × the order limit per 10 min | signed-in user |
| Payment start and verify | `RATE_LIMIT_PAYMENT_MAX` (30) per 10 min | signed-in user |
| `POST /v1/payments/webhooks/paystack` | `RATE_LIMIT_WEBHOOK_MAX` (300) per min | IP (each call is also signature-checked before any work) |
| `POST /v1/realtime/ticket` | 30 per min | signed-in user |
| Uploads | 60 per 15 min | IP |

The busy customer actions are limited **per account**, not per IP. Nigerian mobile networks put many subscribers behind one carrier IP (CGNAT), so per-IP limits there would block real customers. A request without a valid token falls back to its IP and is rejected with 401 anyway. Limits are counted before validation, so junk requests use up the budget too. Over the limit: 429 `RATE_LIMITED` with standard `RateLimit` headers. The store is in memory, which is correct for one API instance; a shared store is needed before scaling out (see §8). Tests: `http-security.test.ts` (per-user isolation on a shared IP, each limit trips).

## 2c. Overload behaviour (Phase 11)
Found by the load test: a burst of 200 simultaneous order acceptances queued behind the 10-connection pool, and about a third failed with a 500. The causes were Prisma's 2-second wait for a transaction connection (`P2028`) and the dispatch kick after acceptance. The fix:
- **Pool size:** configurable with `DATABASE_POOL_MAX` (default 10).
- **Wait time:** a transaction may now wait up to 10 s for a connection.
- **Failure response:** if one still can't get a connection, the API answers 503 `SERVER_BUSY` with `Retry-After: 2` instead of a 500. Writes are transactional and order and payment creation are idempotent, so a retry is safe.
- **Result:** 200 and 400 simultaneous acceptances then all succeeded.

## 2d. Dependency audit and secrets scan (Phase 11, 2026-10-16)
**`npm audit --omit=dev`** reports 65 advisories (49 high, 16 moderate). They come from 7 root packages, and none is in code the API runs in production:

| Package | Pulled in by | Where it runs | Decision |
|---|---|---|---|
| node-forge, uuid, decode-uri-component | Expo CLI / config plugins / expo-router build tooling | Developer machine and app build; not shipped in the API. node-forge is used for dev-server certificates, not for verifying anything at runtime | The only fix is a major Expo downgrade (44), which would break the SDK. Track Expo releases |
| braces, sprintf-js | jest (mobile app tests) | Test runner only | Fix needs jest 30 (major); track with the jest-expo upgrade |
| mysql2, deepmerge-ts | the `prisma` CLI | Migrations and code generation; the API uses `@prisma/client` + `adapter-pg`, and mysql2 only matters for MySQL databases | Fixed in Prisma 7.10.1, released 2026-10-15. Upgrade all three Prisma packages together after a short soak (Phase 12 checklist) |

The API also logs a deprecation warning from the `pg` driver: "client.query() while a query is running". The stack trace shows it comes from Prisma 7.10.0's own query interpreter inside transactions, not from ChopNow code. It is harmless on pg 8, and `pg` is pinned exactly at 8.23.1, so pg 9 (which removes the behaviour) can't arrive unnoticed.

**Secrets scan:** a pattern search of the source tree covered Paystack, AWS, GitHub, Slack and Google keys, private keys, Sentry DSNs and database URLs with passwords. It found only the documented local-development password in `.env.example`/`docker-compose.yml` and obviously fake keys in test fixtures. The four production builds of the web and mobile apps were also checked against every secret value in the server `.env`: no leaks, and they contain only `*_API_BASE_URL`. `.env` files are git-ignored at every level.

**Headers and cookies** (checked on a live response): helmet defaults (HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy: no-referrer`, a restrictive CSP for any HTML), no `X-Powered-By`. The web refresh cookie is `httpOnly`, `SameSite=Strict`, and `Secure` outside development and test.

## 3. Secrets and configuration
- Secrets come only from environment variables or the host's secret manager. `.env` is git-ignored; `.env.example` holds placeholders only.
- The API refuses to start with an invalid config. Error messages name the variable, never its value. Rules for deployed environments (`services/api/src/config.ts`, tested in `health.test.ts` and `deploy-env.test.ts`):
  - **Staging and production:** no placeholder JWT secret; https `PUBLIC_API_URL`; https browser origins with no localhost; no mock payment provider.
  - **Production only:** live Paystack keys (`sk_live_`; test keys would take no real money while orders look real); S3 storage; Expo push; no debug/trace logging.
  - **Outside production:** live keys are refused.
- Per-environment variable lists: `deploy/env/staging.env.example` and `deploy/env/production.env.example`. Values live in the hosting provider's secret manager.
- Only `EXPO_PUBLIC_*` / `VITE_*` values reach client bundles, and those must be non-secret.

## 4. Data protection
- **Passwords and refresh tokens:** hashed only (above).
- **Verification documents:** stored in a private bucket. The database keeps only the storage key, and access is through short-lived signed URLs for the owner and staff with approval permissions (Phase 3).
- **Addresses:** visible to the owner, staff, the restaurant (area only), and the assigned rider from assignment until delivery completes. Riders who are merely being offered a job see only the restaurant and an approximate drop-off area.
- **Delivery PIN:** visible only to the ordering customer and staff. Failed attempts are counted and capped (`dispatch.maxPinAttempts`).
- **Rider location:** only the latest position is stored (overwritten), used for dispatch and never shown to customers in v1.
- **Payment records:** no card data is ever received or stored; Paystack handles card entry. We store references, status and a sanitised verification payload.
- **Logs:** pino redacts `Authorization`, cookies and the Paystack signature header.

## 5. Audit and integrity
- `audit_logs`, `order_status_history`, `financial_transactions` and `ledger_entries` are append-only, enforced by database triggers.
- Journals must balance; the database rejects an unbalanced journal at commit.
- Audited so far: registration, account lockout, refresh-token reuse, logout-all, admin bootstrap, restaurant/rider decisions, settings changes, order cancellation, and payment anomalies (amount mismatch, duplicate charge). Later phases add refunds, dispatch overrides, proof overrides, settlement and payout actions.

## 5a. Orders and payments
| Risk | Control |
|---|---|
| Client tampers with prices | Order requests carry no prices (unknown fields → 400). Every amount is recomputed from the current menu and rules inside the order transaction; the DB checks `total = subtotal + fees − discount`. |
| Double submission / retry creates two orders | `Idempotency-Key` required; the (user, scope, key) row with a request hash replays the original response, refuses reuse with a different body, and blocks concurrent duplicates. A unique (customer, key) index on `orders` is the backstop. |
| Fake "payment successful" from the app or a redirect | Never trusted. Payment is applied only after the API calls the provider's verify endpoint and the amount and currency match. |
| Forged webhook | HMAC-SHA512 over the **raw** body with the secret key, constant-time comparison. Invalid signatures get 401 and are not stored. |
| Replayed webhook / concurrent confirmations | Events unique on (provider, dedupe key). The payment row is locked `FOR UPDATE` while applying. The ledger posting is keyed `payment:<id>:captured`. At most one successful payment per order (partial unique index). |
| Paid twice, or paid after cancellation | The second or late payment is not applied to the order; a refund request is created and the event audited. |
| Secret keys | Server-only env vars; never logged (the signature header is redacted). `sk_live_` keys refused unless `APP_ENV=production`; the mock provider refused in staging/production. |
| Promo abuse | Validated server-side for window, scope, minimum spend, total and per-customer limits. The promotion row is locked during redemption so limits can't be overshot; cancelled orders release their redemption. |
| Seeing someone else's order or PIN | Every order and payment lookup filters by the caller's id (404 otherwise). The delivery PIN is returned only to the ordering customer. Covered by the IDOR tests and the route sweep. |
| Callback page injection | The reference is validated against a strict pattern, and all output is HTML-escaped (tested with a `<script>` payload). |

## 5b. File uploads
| Risk | Control |
|---|---|
| Disguised files (e.g. HTML or script renamed .jpg) | Type decided from the file's magic bytes, not its name or the browser's MIME type. Only JPEG/PNG/WebP images and PDF/JPEG/PNG documents are accepted. |
| Oversized uploads / memory abuse | multer limits (5 MB images, 10 MB documents, one file); 413 `FILE_TOO_LARGE`. Images also need at least 200×200 and are bounded by sharp's pixel limit. |
| Hidden metadata (GPS, camera details) | Every image is decoded and re-encoded to WebP with metadata removed (tested: an image with GPS EXIF comes back without it). |
| Path traversal / overwriting | Keys are generated server-side (random UUIDs under the restaurant id); `assertSafeKey` rejects `..`, absolute paths and unexpected characters. Original filenames are stored only as display text. |
| Hot-linking or tracking pixels in menus | Saved image URLs (menu items, logo, cover) must start with our `MEDIA_PUBLIC_BASE_URL`. |
| Exposure of verification documents | Stored privately, never under `/media`; listed to the owning vendor as metadata only, and to staff with approval permissions via short-lived signed URLs (HMAC-SHA256, constant-time comparison, expiry). |
| Content sniffing | `/media` responses carry `X-Content-Type-Options: nosniff`; only re-encoded images are ever stored there. |

## 5c. Vendor order actions
Every accept/decline/prepare/ready/delay checks restaurant ownership (404 otherwise) and the order's current state with an optimistic update, so double clicks or two staff acting at once cannot apply a transition twice. Declines and delays are audited. Vendor order views exclude the customer's address, phone, delivery PIN and payment references.

## 5d. Riders and deliveries
| Risk | Control |
|---|---|
| Rider sees customer data they don't need | Offers carry the restaurant, drop-off **area**, distances and money only. Full address, landmark, instructions, contact phone, first name and note are returned only to the rider holding the delivery and only while it's active; history shows the area only. The PIN is never sent to riders. |
| Rider acts on someone else's job | Every offer/delivery lookup is scoped to the caller's rider record (404 otherwise); route permissions `delivery.work.own` / `rider.profile.own` / `earnings.read.own` (rider-only, checked structurally in tests). |
| Two riders take the same job, or one rider takes two | Conditional updates plus database unique indexes (one accepted offer per delivery, one active delivery per rider). Concurrent sweeps lock rows with SKIP LOCKED. |
| Fake proof of delivery | 4-digit PIN compared in constant time; wrong attempts are counted even though the request fails and lock at `dispatch.maxPinAttempts` (audited). Staff overrides need a recorded reason (Phase 9). The database refuses DELIVERED without pickup and PIN/override. |
| Cash handling | Amount recorded at delivery must equal the amount due (partial only if enabled); collection is journalled to the rider's RIDER_CASH_HELD; riders at their outstanding-cash limit get no cash offers. Online-paid orders refuse any cash entry. |
| Unapproved riders working | Going online requires APPROVED + ACTIVE (also a database check); suspension (Phase 9) requires reassigning an active delivery first. |
| Location privacy | Only the latest position, only while online, foreground only; never shown to customers or restaurants. |
| Abandoned jobs | Release (before pickup) and problem reports (after) are audited with reasons; a rider who reports a problem is set offline. |

## 5e. Finance controls
| Risk | Control |
|---|---|
| Lost or double-counted money | Every movement is a balanced, append-only journal posted once per event (idempotency key) inside the business transaction; the finance summary includes a trial balance that must balance. Duplicate and wrong-amount charges are booked as owed back on receipt. |
| One person moving money alone | A refund can't be approved by its requester (403 `SEPARATION_OF_DUTIES`). Support can request but not approve; finance permissions (`refund.approve`, `cash.reconcile`, `settlement.manage`, `payout.manage`) belong to FINANCE and ADMIN only. All refund, remittance, settlement and payout steps are audited with the actor. |
| Refunding more than was paid | Requests are capped at the amount paid minus refunds not rejected (order row locked). Unapplied charges are refunded separately and never count against the order. |
| Double refunds | Approval and provider submission are conditional state changes; the provider is called only after the refund is claimed; concurrent approvals → one 200 and one 409. Retries re-check an existing provider refund instead of creating another. |
| Fake refund confirmations | Refund webhooks are signature-checked and only prompt a re-fetch from the provider. |
| Rider cash going missing | Collections are journalled to the rider; hand-ins can't exceed what's outstanding, are allocated oldest first with rows locked, and need finance confirmation; riders at their limit get no cash offers. |
| Paying the wrong amount or twice | Settlements are computed from the ledger, cannot overlap, and allow one live payout; money is booked as paid only when finance records the bank reference. Restaurants and riders see only their own approved statements (404 for others). |
| Bank details exposure | Not stored in v1 *(confirm)*. |

## 5f. Staff tools
| Risk | Control |
|---|---|
| Weak or shared staff passwords | Admins create staff with a random one-time password shown once; the account can do nothing but change it (403 `PASSWORD_CHANGE_REQUIRED`). Staff passwords: 12+ characters, letters and digits, not the current one. |
| Over-broad access | Least-privilege roles (SUPPORT < OPERATIONS; FINANCE separate; ADMIN all). Support can't cancel, dispatch, approve, see the delivery PIN or move money; operations can't settle, pay out, change rules or read the audit log. |
| Staff seeing more personal data than needed | Customer contact and address are shown on order detail for resolving problems; the delivery PIN only to order managers; verification documents only to approvers, through 5-minute signed links, each view audited. |
| Silent or unexplained changes | Every staff change requires a reason and writes an audit entry with actor, role, IP and before/after. The audit log is append-only and readable by finance and admins. |
| Locking everyone out | Admins can't suspend themselves or the last active admin. Restaurants and riders are suspended through their own flows (which protect active orders and deliveries). |
| Staff overriding proof of delivery | Only order managers, only for picked-up orders, always with a reason; recorded as `proofOverrideReason` on the delivery and audited. |

## 5g. Notifications and realtime
| Risk | Control |
|---|---|
| Leaking personal data through push or sockets | Push and in-app texts never include PINs, addresses or phone numbers; socket messages carry ids only and clients refetch through the normal, permission-checked API. |
| Someone else's updates | Events go only to the order's customer, its restaurant owner (once the order reached it), its rider, and staff; covered by tests that other customers and restaurants receive nothing. |
| Stolen socket credentials | Sockets open with a 30-second HMAC ticket (domain-separated key) bound to the user's token version; the user is re-read on connect (active, no pending password change) and every 5 minutes, so password changes and suspensions cut sockets off. Browser origins must be on the CORS allow-list (cross-site WebSocket hijacking). Client messages are ignored; frames are capped at 1 KB. |
| Push to the wrong person | A device token belongs to the account that last registered it; sign-out removes it; tokens Expo reports dead are disabled. |
| Monitoring leaking data | Sentry collects no user info, cookies, headers, bodies, query strings or DB data, and is off without a DSN. |

## 5h. Payment reconciliation and database roles (Phase 12)
| Threat | Mitigation |
|---|---|
| Lost or blocked webhooks leave a customer charged for an order that never happens | The worker asks Paystack about every unconfirmed attempt (backoff up to 48 h) and applies the result like a webhook: late payment confirmed, payment after closure refunded, duplicate charge refunded. Staff can trigger the same check (`POST /v1/admin/payments/{reference}/verify`, audited) |
| Abandoned online orders hold promotion redemptions and clutter the customer's active orders | Cancelled after `orders.unpaidOnlineOrderTimeoutSeconds` (default 30 min), after one last provider check; promotions released |
| Cancellation racing a payment confirmation: cancelled but paid, no refund | Both paths lock the payments, then the order, and decide from fresh data. Verified by a test that fails on the old code |
| A compromised API process altering history or the schema | The API connects as `chopnow_app`: no DDL, no TRUNCATE, no UPDATE/DELETE on audit and ledger tables (on top of the triggers). Migrations use a separate `chopnow_migrator` login. Verified on PostgreSQL 17 |

## 6. Initial administrator
In a deployed container: set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` (16+ characters in production) and run `node dist/scripts/bootstrap-admin.js`. Locally: run `npm run admin:bootstrap -w @chopnow/api` with `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` set, then remove both variables. Every further staff account is created from the admin dashboard (Customers & staff → Add staff member). The script refuses if any ADMIN already exists and writes an audit entry.

## 7. Development data
`npm run db:seed` refuses unless `APP_ENV` is development/test **and** the database contains only `@chopnow.test` accounts. Seeded data is marked as test data and contains no financial transactions.

## 8. Planned (later phases)
Tracked in LAUNCH_CHECKLIST.md:
- A shared rate-limit store (e.g. Redis) before running more than 2 web instances.
- Optionally restrict the webhook route to Paystack's published IP ranges at the load balancer.
- The Prisma 7.10.1 upgrade (see §2d) after a short soak.
- An external penetration test before public launch.

Done in Phase 12: the dependency audit gate in CI (critical advisories fail the build), and the production database roles (§5h).
