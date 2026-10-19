# ChopNow Test Plan

Status: covers Phases 1–10. Each phase adds its suites here. Phase 11 adds the full ordering
lifecycle and end-to-end tests.

## 1. Test layers

| Layer | Tool | Database | Command |
|---|---|---|---|
| Unit (pure logic) | vitest | none | `npm test` |
| Mobile unit and component | Jest (`jest-expo`) + React Native Testing Library 14 | none | `npm test` (or `npm test -w @chopnow/customer-mobile`) |
| Integration (services, DB constraints, HTTP) | vitest + supertest | real PostgreSQL (`DATABASE_URL_TEST`) | `npm run test:integration` |
| Rider app unit and component | Jest (`jest-expo`) + React Native Testing Library 14 | none | `npm test -w @chopnow/rider-mobile` |
| Admin dashboard unit and component | vitest + jsdom + Testing Library | none | `npm test -w @chopnow/admin-web` |
| Vendor portal unit and component | vitest + jsdom + Testing Library | none | `npm test -w @chopnow/vendor-web` |
| Manual app walkthrough | Expo web preview at phone size against the live API | seeded dev DB | see §3a |
| End-to-end, all four apps in a real browser | Playwright 1.63 + axe-core, installed Edge/Chrome (no browser download) | `chopnow_e2e`, reset each run | `npm run test:e2e` |
| Load (indicative) | autocannon + ws | `chopnow_e2e`, reset each run | `npm run test:load` |

### Customer app suites
| File | Covers |
|---|---|
| `src/lib/menu-pricing.test.js` | Default variant choice, variant + extras × quantity in kobo, required variant, sold-out variant/extra/item, extra limits, quantity bounds |
| `src/state/cart.test.js` | Totals, merging identical configurations (extras in any order), one restaurant per cart with explicit replace, quantity cap, empty cart resets restaurant |
| `src/lib/api-client.test.js` | Query building, ApiError and field errors, friendly network errors, single-flight refresh with rotation, sign-out on rejected refresh, keeping the token on network failure |
| `src/components/components.test.js` | Item customiser live total and payload; cannot add when the restaurant isn't taking orders. Food card shows from-price and flags unavailable results |
| `src/lib/orders.test.js` | Cart → order items never include prices; the idempotency key is reused on network error/409 and renewed after success, rejection or a changed request; status/payment labels |

### Phase 5 API suites
| File | Covers |
|---|---|
| `test/paystack.test.ts` (unit) | Initialise in kobo with the secret only in the auth header; verify status mapping; "not found" = pending but 401/network = error; HMAC over the raw body; payment config refuses mock in deployed environments and live keys outside production |
| `test/integration/http-orders.test.ts` | Quote amounts (food, distance fee, service fee); client prices rejected; per-line problems (sold out, missing/invalid variant, extra limit, foreign item, quantity cap); closed/paused restaurant, out of range, minimum order, foreign address; COD caps (first order vs returning); order creation with snapshots, PIN, commission, rider earning, accept deadline; price snapshot survives a menu change; idempotent replay, key reuse 422, 4 concurrent identical requests → 1 order, retry after failure; WELCOME10 per-customer limit, cap, minimum spend, release on cancel; IDOR; vendors can't order; cancel rules; reorder |
| `test/integration/http-payments.test.ts` | Online orders hidden until paid; test-labelled checkout URL reused; cash/foreign/cancelled orders can't pay; pending until the provider confirms; ledger entry exact and single; signed webhook ×3 → processed once; bad signatures 401 and not stored; concurrent verifies → one journal; amount mismatch → not paid, refund + audit; failed → retry with a new attempt; duplicate charge → refund; cancel after paid → refund; paid after cancel → refund, never sent to the restaurant; mock checkout page; callback page escapes input |

### Phase 6 suites
| File | Covers |
|---|---|
| `test/integration/http-vendor-orders.test.ts` | Incoming/active/history views and counts; vendors see only their own orders (404 for others) and never the address/phone/PIN; accept with prep time sets the ready estimate; accept after the deadline refused; decline with reason (refund request when paid, promo released, audited); prepare → ready, including straight from ACCEPTED; illegal transitions 409; concurrent accepts → one wins; delay moves the estimate; auto-decline sweep; unpaid online orders invisible; sales report totals, Lagos days, top dishes; reviews (delivered only, once, within the window, rating refresh, one vendor reply); web cookie sessions (httpOnly cookie, no token in body, refresh and logout via cookie) |
| `test/integration/http-uploads.test.ts` | JPEG/PNG/WebP accepted and re-encoded to WebP; GPS EXIF stripped; renamed non-images, tiny images and >5 MB rejected; foreign restaurant 404; menu/logo URLs outside our media base rejected; documents stored privately (not under /media) and listed to the owner; signed URLs work, tampered or expired ones fail |
| `apps/vendor-web/src/lib/api.test.js` | Web-client header and cookies; in-memory Bearer token; one refresh for concurrent 401s; session-expired callback; no refresh on auth endpoints; network and field errors; query encoding |
| `apps/vendor-web/src/lib/format.test.js` | Naira text ↔ kobo (rejects non-amounts, no float drift); Lagos calendar day; date ranges; status labels |
| `apps/vendor-web/src/components/HoursEditor.test.jsx` | Window ↔ row conversion (midnight as 00:00), overnight guidance, overlaps vs split shifts, malformed times; opening a day and saving; copying Monday to weekdays; API errors kept on screen |
| `apps/vendor-web/src/components/OrderCard.test.jsx` | Items, instructions and live countdown (urgent under 2 min); only API-allowed actions shown; no customer contact details; dish payload in kobo and price errors |
| `apps/customer-mobile/src/components/components.test.js` (ReviewForm) | Rating required; payload with trimmed comment; server error shown |

### Phase 7 suites
| File | Covers |
|---|---|
| `test/integration/http-dispatch.test.ts` (24) | Only approved riders go online; location stored only while online; customers/vendors refused. Dispatch starts on acceptance with a cash record; nearest core rider offered first; offers show area only (no address/phone/PIN); vendor sees OFFERING. Expiry → next tier after 2 min (`widenedAt`); decline → next rider, decliner not re-asked; expired/foreign offers refused; going offline passes the offer on; one offer per rider under concurrent sweeps; operations alerted once after 10 min; cash-limit riders get online orders only; cancellation withdraws offers. Full cash delivery: accept (customer sees rider first name/vehicle, rider sees address), other rider 404, busy rider gets no offers and the DB blocks a forced second job, pickup waits for "ready", wrong PIN counted, short/missing cash refused, completion → order DELIVERED + paid, cash OUTSTANDING, balanced CASH_COLLECTED journal, one earning, idempotent; history/earnings/profile; rider rating. Release re-offers and audits; online orders take no cash; PIN locks after 5; problem after pickup → DELIVERY_EXCEPTION, rider offline, audited. Rider documents (private, type-checked). |
| `apps/rider-mobile/src/lib/delivery.test.js` | PIN and cash validation (naira text → exact kobo, full amount only, none for online orders), step titles/hints, distances, countdown, maps links, registration payload passes the API schema |
| `apps/rider-mobile/src/components/components.test.js` | Offer card: earning, cash, area, live countdown, accept/decline, disabled after expiry. Delivery panel: pickup disabled until ready, arrival action, customer contact only after pickup, PIN/cash validation before completing, server PIN error and lock |
| `apps/rider-mobile/src/lib/api-client.test.js` | Same client contract as the customer app (refresh, errors) |
| Customer `components.test.js` / vendor `OrderCard.test.jsx` | Optional rider rating; restaurant sees "Finding a rider…" then the rider's name |

Mutation checks (Phase 7): letting independent riders in from the start fails the tiering test; removing the rider-ownership filter on deliveries fails 5 tests.

### Phase 8 suites
| File | Covers |
|---|---|
| `test/integration/http-finance.test.ts` (19) | Delivery split: online + platform promo lines exact (restaurant, rider, commission, delivery margin, service fee, promotion), customer funds fully allocated; cash orders. Refunds: declined paid order → approve → provider → REFUNDED with both journals; support requests, can't approve; requester can't approve own; delivered orders need `chargeTo`; restaurant-charged refunds reduce its payable; partial → PARTIALLY_REFUNDED; caps; pending provider refund completed via signed webhook re-check; failed → retry → manual bank transfer; cash orders manual; rejected requests post nothing; duplicate charge booked as unapplied and refunded without touching the order; concurrent approvals → one. Cash: positions, over-declaration refused, FIFO allocation, journal, rider sees status, reject, direct record, never over-clear. Settlements: period must have ended; net equals ledger balance for restaurant and rider; breakdown reconciles; overlaps skipped; drafts hidden from restaurants; other restaurant 404; payout booked only on bank reference; failed payout retried; double payout 409; negative carry-forward into the next period; rider payouts settle earnings. Summary: revenue from the ledger, balances, trial balance balanced, ops refused. |
| `test/paystack.test.ts` | Refund request shape (transaction reference, kobo, note) and status mapping; provider errors surfaced |
| `http-payments.test.ts` (updated) | Mismatched and duplicate charges now book an "unapplied" journal to REFUNDS_PAYABLE |
| Vendor `PayoutsPage.test.jsx` · rider `delivery.test.js`, `components.test.js` | Statement breakdown and transfer attempts; hand-in validation and sheet |

Mutation checks (Phase 8): removing the separation-of-duties check fails 4 tests; booking restaurant-charged refunds to ADJUSTMENTS instead of VENDOR_PAYABLE fails 6; counting negative settlements as already settled failed the carry-forward test (found and fixed while writing it).

### Phase 9 suites
| File | Covers |
|---|---|
| `test/integration/http-ops.test.ts` (14) | Dashboard counts and access; order search by code (any case) and email; detail hides the PIN and actions from support, shows them to operations; ops cancels a paid order (refund requested, rider's offer withdrawn, audited), finance can't; problem → retry same rider → PIN delivery; problem → new rider → offered to another rider, cash reset; confirm delivered without PIN books cash, earning and split once, then 409 for repeats and cancellation; dispatch board, assign, busy rider 409, unapproved rider 409, unassign → back to dispatch, audited; support can search users but not suspend; admin suspends → user's token stops working; can't suspend self or restaurants via this route; staff creation (admin only, duplicate 409, password never in the audit log) → one-time password login is blocked except changing it → works after; documents: list, wrong owner type 404, signed link expiry 5 min and audited, rejection needs a note and is visible to the rider; promotions: validation, upper-casing, duplicate 409, pause, audited; hiding a review recomputes ratings and removes it from the vendor view; audit log filter and access |
| `apps/admin-web/src/admin.test.jsx` (14 with `api.test.js`) | Menu per role (support/finance/operations/admin/customer) and section headings; plain status labels; reason dialog requires a reason, passes fields, keeps the server error; promotion form converts naira, percent and Lagos dates; new staff account shows the one-time password once |
| `apps/vendor-web/src/components/Modal.test.jsx` | Regression: typing in a second field of a modal keeps focus (fails on the old code) |
| `http-security.test.ts` | Access manifest now includes the 26 operations routes |

Mutation checks (Phase 9): showing the PIN to every staff role fails the detail test; removing the password-change gate fails the staff-account test.

### Phase 10 suites
| File | Covers |
|---|---|
| `test/integration/http-notifications.test.ts` (12) | Full journey creates exactly: restaurant "new order"; customer accepted (with Lagos ready time), rider assigned (first name), on the way, delivered; rider high-priority offer with 45 s TTL; no PIN, address, phone or email anywhere in notifications. Cancellations skip the person who cancelled; declines show the reason. In-app list: unread count, `_push` hidden, mark some/all read, never another user's. Push: invalid tokens refused, token moves between accounts, sent once to the right device, outage keeps them pending with the error, dead tokens disabled, stale ones not pushed, sign-out stops pushes. Realtime: forged, missing and expired tickets 401, foreign origin 403, allowed origin OK, unauthenticated ticket request 401; the customer, restaurant and staff get the order's events while another restaurant and customer get nothing, no repeats on a second poll, no personal data; a rider gets `work.updated` and the offer notification; outdated ticket after token-version change 401. `/ready` reports jobs and returns 503 when one stalls. |
| `test/push-realtime.test.ts` (4) | Ticket round trip and 30 s expiry; tampered, foreign-key and malformed tickets rejected. Expo adapter: payload (priority, TTL, channel, auth header), ticket mapping incl. DeviceNotRegistered, batches of 100, 429/5xx/network → retryable |
| `packages/shared-utils/test/realtime.test.ts` (3) | Backoff schedule; connects with a fresh ticket, ignores hello and junk, reconnects after a drop, stops cleanly; stays closed when signed out; retries when the ticket call fails |

Found while writing them: a delivery-events or offers query failing would have stopped notifications from being published in the same poll; the feed now isolates each source and records its last error.

### Phase 11 suites
| File | Covers |
|---|---|
| `test/integration/acceptance-journey.test.ts` (23) | Spec §21 through the HTTP API, once for online payment and once for cash on delivery. A vendor registers, creates and configures a restaurant, ops approves it, and it builds a menu. Anonymous browsing; "jollof rice" search; out-of-area search is empty. A customer registers and adds an address; a tampered client total is rejected; idempotent placement; mock payment (online). The restaurant accepts, prepares and readies the order. Dispatch offers the rider, who accepts, arrives and picks up; a wrong PIN gives 422, the right one delivers. The customer timeline matches. Payment or cash state is recorded. The admin order detail shows the exact split and only balanced journals in order. Next day: settlements cover both orders with exact gross, commission and net; the order detail shows the covering draft settlement; the trial balance is balanced |
| `tests/e2e/specs/ordering-journey.spec.mjs` | The same journey through the **real UIs**, in four separate browser sessions: admin dashboard, vendor portal, customer app and rider app (Expo web builds). Admin approves Grandma's Pot. Its owner creates a category and a dish with an extra, and opens. The customer searches "jollof rice": several eligible meals, the closed restaurant absent. They tick the extra (price updates to ₦3,500), add to cart, enter a **new** address pinned by browser geolocation, choose cash, see the server total ₦4,175 and place the order; the tracking page shows a 4-digit PIN. The vendor board receives it, then accept (15 min), prepare, ready; the customer sees the update. The rider signs in and comes online with a location, the offer arrives through real dispatch, and they accept, arrive and collect; the customer sees it on the way. A wrong PIN is refused on screen, then cash ₦4,175 + the right PIN completes; the customer sees Delivered and the PIN disappears. Admin order detail shows restaurant ₦2,975, rider ₦400, ChopNow ₦800, plus the cash-collected and split journals. **axe-core WCAG 2.1 AA scan on 16 screens**; any serious or critical violation fails the run (`E2E_AXE_SOFT=1` logs without failing) |
| `tests/load/run.mjs` | Search, quote, order placement, dispatch latency and realtime fan-out; results in §5 |
| `http-security.test.ts` (+4) | Order placement limited per customer, with another customer on the same IP unaffected and quotes on their own larger budget. Payment start and verify limited. Webhook limited per IP, with unsigned calls still rejected. Realtime tickets limited per user |
| `test/error-handler.test.ts` (3) | No database connection in time (P2028) gives 503 `SERVER_BUSY` + `Retry-After`, not 500; P2002/P2025 mappings kept; unexpected errors are a generic 500 without details |

#### Bugs found by the Phase 11 tests (all fixed)
| Found by | Bug | Fix |
|---|---|---|
| Browser E2E | Opening a dish from search auto-opened its sheet, but closing it (Add or ✕) re-triggered the auto-open, so a customer coming from search could never leave the dish sheet | Auto-open once per search result (`restaurant/[slug].jsx`) |
| axe | Customer and rider apps: `accessibilityState` isn't emitted by react-native-web 0.21, so checkboxes, radios and disabled or busy buttons had no `aria-checked`/`aria-disabled`/`aria-busy` on the web build (critical) | Standard `aria-*` props, which React Native 0.86 also supports natively |
| axe | Sheet backdrops had a "Close" label without a role (serious) | `accessibilityRole="button"` |
| axe | Filter chips exposed `aria-selected` on a button (critical) | `aria-pressed` on the web, `accessibilityState.selected` natively |
| axe | Vendor dish editor: unlabelled photo file input (critical) | `aria-label` |
| Review during E2E | Every quantity stepper was called "Increase quantity", so screen readers couldn't tell extras apart | Steppers are named after what they count ("Increase Chicken") |
| Load test | 200 simultaneous acceptances: about a third failed with 500 (pool exhausted, Prisma P2028) | Configurable pool, 10 s connection wait, 503 + `Retry-After` instead of 500 (SECURITY.md §2c) |
| Load test (code review of the dispatch sweep) | Only the 50 oldest waiting jobs were considered, so a job a free rider could take could starve behind 50 they couldn't | The whole queue is walked until no rider is free; the operations alert has its own pass (`http-dispatch.test.ts`, fails on the old code) |
| Acceptance test | Admin order detail had no financial history (spec §21 step 21) | Journals, split and covering settlements on `GET /v1/admin/orders/:id` and the admin page |

### Phase 12 suites
| File | Covers |
|---|---|
| `test/integration/http-payment-reconciliation.test.ts` (7) | A payment with a lost webhook is applied by the sweep: not before the 3-minute grace, once only. Backoff: still-pending attempts aren't re-asked every minute. An unpaid online order closes after 30 minutes and releases its promotion (SYSTEM, recorded in history). The provider is checked before closing, so a paid order is never cancelled. Money arriving after closure is refunded. Closing uses fresh payment data, not the caller's snapshot (fails on the old code). Staff "check with provider": support allowed, customer 403, unknown reference 404, idempotent, audited |
| `test/health.test.ts` (+5) | Complete production config loads; `PROCESS_ROLE` parsed; https for the public URL and origins (staging too); localhost or path origins refused; Paystack test keys, log-only push and debug logs refused in production; a staging config with test keys, log push and debug logs is allowed |
| `test/deploy-env.test.ts` (4) | `deploy/env/{staging,production}.env.example` boot once filled in, and are refused with their placeholders |
| `http-security.test.ts` (+1) | The PIN-exposure helper catches real leaks but not dates, ids, amounts or coordinates. It replaces a plain substring check that flaked when a random PIN was "2026" (it matched the year in timestamps) |
| Browser E2E (updated) | Vendor and admin portals served with the **production CSP** from `deploy/nginx-spa.conf`; any CSP violation fails the run (checked by planting a policy without the API origin, which fails) |
| Manual (scratch scripts, removed) | `database/roles.sql` on PostgreSQL 17: migrations as the migrator; the app role refused CREATE, ALTER, DROP, TRUNCATE and UPDATE/DELETE on audit and ledger; the API boots, registers a user and writes audit rows as the app role. Found and fixed: the migrator couldn't create `pg_trgm`. Compiled `dist/server.js` in `web` and `worker` roles: correct jobs each; the worker serves only `/health` and `/ready`. EAS config guard refuses a production build without an https API URL |

#### Bugs found in Phase 12 (all fixed)
| Bug | Impact | Fix |
|---|---|---|
| No payment reconciliation: the `reconciliation` source existed but nothing used it | Lost webhook + app closed: the customer was charged, the order auto-cancelled unpaid, and no refund was made | Worker sweep (ARCHITECTURE.md §14) |
| Unpaid online orders never closed | Promo redemptions stayed active and counted against usage limits; stale "active" orders for the customer | Closed after the business-rule timeout |
| Cancellation decided "was it paid?" from a pre-transaction snapshot; payment confirmation didn't lock the order | Race: a cancelled order marked paid, with no refund | Lock payments then order in both; fresh read |
| Migrator role couldn't create the `pg_trgm` extension | First production migration would fail | `roles.sql` creates it as admin |
| Production accepted Paystack **test** keys | Live orders with no real money moving | Refused at boot |

## 3f. Live updates walkthrough (Phase 10, live API)
1. API started with five background jobs; `/ready` showed each with a recent heartbeat and one live connection (the admin tab).
2. Vendor portal signed in: a cash order placed by script showed in the bell ("1 unread") and the tab title about 0.3 s after the order call returned. With the board open, the next order's card appeared about 0.2 s after creation, while the board's poll is 60 s when live.
3. Push in development (`PUSH_PROVIDER=log`): no devices registered, so notifications were marked handled without sending (checked in the database).
4. Not verified here: real device push (needs an EAS build with a project id; Expo Go on Android can't receive remote push).

## 3e. Admin dashboard walkthrough (Phase 9, live API, 434 px and tablet widths)
1. Operations signed in: dashboard showed 1 delivery problem, 1 dispatch alert (seeded order, 53 min), 2 waiting for a rider; the menu had no finance, rules or audit items.
2. Orders → Problems → CN-JA52B2: rider's report, PIN, and Retry / Confirm delivered / Cancel offered. Retry → "find a new rider" with a reason → Ready / Finding rider; timeline "Sent back to dispatch".
3. A rider came online; Dispatch → Assign CN-JA52B2 to Bisi with a reason → Out for delivery; Bisi shown "On a job"; a rider who hadn't checked in was labelled "not responding".
4. Admin: all 14 menu items; created staff member Kemi (Operations) → one-time password shown once.
5. Signed in as Kemi with it → "Set your password" only; a 6-character password was refused; a strong one let her in with the operations menu.
6. Finance: summary, settlements and audit pages loaded (the audit log showed Kemi's password change); opening /dispatch directly showed "Not available for your role".
7. Fixed during the build: modal focus jumping while typing (both web apps); admin bundle split per section.

## 3d. Finance walkthrough (Phase 8, live API, mock payments)
1. Delivered a cash order and an online order (₦3,125 each) with rider core1.
2. Rider app → Earnings: cash to hand in ₦3,125; declaring ₦4,000 refused ("at most ₦3,125"); declared ₦3,125 (ref OPAY-77120) → "awaiting confirmation".
3. Finance confirmed it → allocated to CN-3RZYD7; rider app shows Confirmed and ₦0 to hand in.
4. Support requested a ₦500 refund on the online order; support could not approve it (403); finance approved, charged to the restaurant → SUCCESSFUL (test payment).
5. Summary for today: commission ₦750, delivery margin ₦200, service fees ₦250; owed to the restaurant ₦3,750 (= 2 × ₦2,125 − ₦500), to the rider ₦800; cash held ₦0; trial balance balanced. Settling today was refused (period not ended).
6. Vendor portal → Payouts: page and nav work; "No statements yet" (settlement and payout flows are exercised by the integration suite with a moving clock).
7. Found: the rider preview had been started in CI mode (no reloads) and served an old bundle; restarted it normally.

## 3c. Rider app walkthrough (Phase 7, web preview at 321–375 px against the live API)
1. Signed-out → redirected to sign-in; signed in as `rider.core1` (seeded online).
2. The 5-second sweep immediately offered the seeded Bukka sample order (₦3,650 cash); declined it → the new Mama Nkechi order was offered (₦8,700 cash, 3 items, 42 s).
3. Accepted → full address, landmark and note shown; "collected" disabled until ready. Arrived → restaurant marked ready → restaurant sees "Rider Chinedu"; collected.
4. Wrong PIN → "4 attempts left"; correct PIN + ₦8,700 → delivered; customer sees DELIVERED, paid, can review; earnings ₦400, cash to hand in ₦14,450 (= ₦5,750 sample + ₦8,700).
5. A further offer left to run out: the card disappeared at 0 s and the app returned to "waiting". The seeded sample (no rider ever accepted) produced the expected operations alert.
6. Fixed during the walkthrough: "1 deliveries" pluralisation; the seeded delivered sample had no earning record.

## 3b. Customer app walkthrough (Phase 5, live API + mock payments)
1. A cart holding items deleted by a reseed: checkout refused it ("Restaurant not found"). A "Clear cart and browse" action was added so the customer can recover.
2. Large Jollof + chicken, cash: quote ₦5,000 + ₦500 (0.7 km) + ₦250 = ₦5,750. WELCOME10 applied: −₦500 → ₦5,250. Placed: order CN-DRHFK9, PIN shown, cart cleared.
3. Party Jollof, pay online: redirected to the TEST checkout (₦3,650). Simulated success → the order shows "Paid" with a "Test payment" badge and the PIN.
4. Cancelled the paid order from its page: the dialog warned about a refund; the order showed Cancelled / "Refund in progress".
5. Orders tab listed all three orders with status and payment labels.
6. `expo export --platform web` bundled every screen (1,499 modules).

## 3a. Customer app walkthrough (Phase 4, web preview at 375×812 against the live API and seeded DB)
1. Home without a location: prompt shown, categories loaded from the API.
2. Location: chose the pilot area. Home then listed the 2 open restaurants with distance and ₦500 delivery fee. Suya Spot (paused) and Grandma's Pot (pending) were not shown.
3. Search "jollof rice": 2 dishes (Mama Nkechi's from ₦2,500; Bukka from ₦3,000).
4. Opened the result: the restaurant menu showed, with Ofada flagged "Sold out", and the customiser opened automatically.
5. Chose Large + 1 fried chicken: total ₦5,000 (₦3,500 + ₦1,500). Added; cart bar and toast appeared.
6. Tried adding Bukka's Party Jollof: the "Start a new cart?" dialog appeared; cancel kept the cart. The cart survived a full reload.
7. Sign-in: empty submit showed inline errors. Signed in as the seeded customer. The refresh token was in sessionStorage, not localStorage. The session was restored after a full reload.
8. Address form: save without a map pin was blocked with a message; with the pilot pin it saved and became the delivery location.
9. Favourited Bukka from its page; it appeared on the Favourites tab.
10. Cart screen: line with variant and extras, subtotal, clear-cart confirmation.
11. Stopped the API: Search showed "We can't reach ChopNow right now…" with Try again, and the cart bar still worked.
12. Layout: no horizontal overflow at 375 px (16 px gutters measured); only the category chip row scrolls sideways, by design.

Bugs found and fixed during the walkthrough:
- Modals didn't close when opened directly from a URL (now fall back to Home).
- A stale "set the map pin" error stayed after the pin was set.
- The empty-password message was zod's default wording.
- A disabled button could still fire its handler in tests (now natively disabled as well).

Integration tests run files one at a time against a dedicated database whose name must contain
`test`. Each file truncates it and reseeds. Migrations are applied with `prisma migrate deploy`
before the suite, so the committed migrations are exercised every run. Tests use an injected clock
(Wednesday 12:00 Lagos) so opening-hours results don't depend on when they run.

## 2. Suites and what they cover

### Unit
| File | Covers |
|---|---|
| `packages/shared-utils/test/money.test.ts` | Kobo parsing and formatting, basis-point rounding, rejection of non-integers |
| `packages/shared-utils/test/discovery-utils.test.ts` | Distance, Lagos-time opening hours (including the midnight rollover), window validation, delivery/service fee, rider earning, commission |
| `packages/shared-schemas/test/*.test.ts` | Order transition table, role permissions (separation of duties, no staff self-registration), auth request schemas |
| `services/api/test/health.test.ts` | Health endpoint, config validation, refusal of placeholder secrets |
| `services/api/test/auth-primitives.test.ts` | scrypt hashing, JWT forgery, `alg:none`, expiry, refresh-token hashing |
| `services/api/test/schema-sync.test.ts` | Shared enums match DB enums; business-rule defaults and validation |
| `services/api/test/slugify.test.ts` | Restaurant URL slugs |

### Integration
| File | Covers |
|---|---|
| `auth.service.test.ts` | Registration, duplicates, role injection, lockout, suspension, DB-sourced roles, refresh rotation, replay detection, concurrent refresh, logout(-all) |
| `constraints.test.ts` | Every database-level rule: approval gates, order totals, PIN, one successful payment, webhook dedupe, delivery proof, one active delivery per rider, cash bounds, balanced/append-only ledger |
| `seed.test.ts` | Seed refuses production and real data, is repeatable, creates no financial records, includes positive and negative discovery cases |
| `http-security.test.ts` | Access manifest, admin/vendor structural rules, 401/403 sweep over every route and role, IDOR (vendors, customers), safe errors, body limits, response filtering, request ids, rate limiting, CORS |
| `http-catalog.test.ts` | Vendor registration → pending → blocked from opening → hours → approval (role-gated, audited) → menu with variants/extras → discoverable → sold out → retire variants → delete → suspension |
| `http-discovery.test.ts` | "jollof rice" search (acceptance steps 4–5), eligibility (closed, pending, out of range, outside hours), price filter and sort, sold-out handling, wildcard escaping, restaurant list and detail, categories, favourites |
| `http-account-admin.test.ts` | Auth over HTTP, password change, profile, addresses (soft delete, default), rider approval and suspension, business-rule changes (admin-only, validated, audited), OpenAPI and docs completeness |

### Mutation checks performed (Phase 3)
To confirm the security tests would catch real mistakes, these bugs were planted in a scratch copy:

| Planted bug | Caught by |
|---|---|
| Restaurant-approve route downgraded to "any signed-in user" | Access manifest and admin structural rule (the enforcement sweep alone did **not** catch it, which is why the manifest was added) |
| Ownership filter removed from vendor restaurant lookup | Vendor IDOR test |

## 3. Acceptance-journey coverage (spec §21)
Every step is covered three ways: the HTTP journey test (`acceptance-journey.test.ts`, online **and** cash), the browser journey (`ordering-journey.spec.mjs`, cash, real UIs), and the focused suites listed.

| Step | Browser E2E | Focused suites |
|---|---|---|
| 1. An administrator creates or approves a restaurant | ✓ admin approves Grandma's Pot | `http-catalog.test.ts`, `http-ops.test.ts` |
| 2. The restaurant creates a menu | ✓ category, dish, extra; opens | `http-catalog.test.ts`, `HoursEditor.test.jsx`, `OrderCard.test.jsx` |
| 3. A customer opens the app | ✓ Expo web build | walkthrough §3a (a native-device run waits on the EAS build, Phase 12) |
| 4. The customer searches for jollof rice | ✓ "jollof rice" | `http-discovery.test.ts` |
| 5. Eligible restaurants and available meals | ✓ several results, closed restaurant absent | `http-discovery.test.ts` |
| 6. Selects and customises a meal | ✓ extra changes the price | `components.test.js`, `menu-pricing.test.js` |
| 7. Adds it to the cart | ✓ | `cart.test.js` |
| 8. Enters a delivery address | ✓ new address, geolocation pin | `http-account-admin.test.ts` |
| 9. Chooses online payment or cash | ✓ cash (online in the HTTP journey) | `http-orders.test.ts`, `http-payments.test.ts` |
| 10. Validates the order and calculates the total | ✓ server total ₦4,175 | `http-orders.test.ts` (tampered totals, caps, idempotency) |
| 11. The restaurant receives the order | ✓ vendor board | `http-vendor-orders.test.ts`, `http-notifications.test.ts` |
| 12. Accepts or rejects it | ✓ accept (reject in the focused suite) | `http-vendor-orders.test.ts` |
| 13. Food preparation | ✓ preparing → ready | `http-vendor-orders.test.ts` |
| 14. Assigns an eligible rider | ✓ real dispatch offer | `http-dispatch.test.ts` (tiers, expiry, decline, cash limits) |
| 15. Rider confirms pickup | ✓ | `http-dispatch.test.ts` |
| 16. Rider delivers the food | ✓ | `http-dispatch.test.ts` |
| 17. Customer receives the order | ✓ sees Delivered | `http-notifications.test.ts` |
| 18. Marked delivered through a valid completion workflow | ✓ wrong PIN refused, right PIN + cash | `http-dispatch.test.ts` (PIN lock), `http-ops.test.ts` (staff override) |
| 19. Payment or cash-collection state recorded | ✓ cash-collected journal | `http-payments.test.ts`, `http-finance.test.ts` |
| 20. Restaurant proceeds, rider earnings, platform fees | ✓ ₦2,975 / ₦400 / ₦800 | `http-finance.test.ts`, settlements in `acceptance-journey.test.ts` |
| 21. Administrator inspects the order and its financial history | ✓ | `acceptance-journey.test.ts`, `http-ops.test.ts` |

## 4. Not yet covered
- **Native devices:** the customer and rider apps were tested as Expo **web** builds (same JavaScript, react-native-web). Native-only paths (push delivery, background location, camera uploads, TalkBack/VoiceOver) need an EAS build on real Android phones (Phase 12).
- **Real Paystack:** online payment ran on the mock provider. Paystack test mode needs test keys in `.env` (see README).
- **Load on production-like infrastructure:** the §5 numbers come from one Windows PC. Repeat on staging hardware before launch.
- **Penetration test** by an external party before public launch (Phase 12 checklist).
- **Several API instances:** the rate limiter, realtime hub and job runner assume one instance (documented in ARCHITECTURE.md).

## 5. Load check (Phase 11, indicative)
`npm run test:load`, run on 2026-10-16. Everything ran on one Windows PC: the API (single process, pool of 10), embedded PostgreSQL 17 and the load generator shared the same CPU. These are **relative** numbers for spotting regressions, not production capacity. Repeat on staging hardware before launch.

| Test | Load | Throughput | p50 | p90 | p99 | Errors |
|---|---|---|---|---|---|---|
| Food search "jollof", anonymous | 25 connections, 10 s | 93 req/s | 198 ms | 482 ms | 844 ms | 0 |
| Cart quote (signed in) | 25 connections, 10 s | 90 req/s | 243 ms | 384 ms | 662 ms | 0 |
| Order placement (idempotent, online orders) | 10 connections, 10 s | 43 orders/s | 210 ms | 291 ms | 529 ms | 0 |
| Dispatch: restaurant accepts → rider's app sees the offer | 5 sequential samples | — | 16 ms | 37 ms | 37 ms | 0 missed |
| Realtime fan-out: 200 sockets, 200 simultaneous acceptances | 200 customers | 200 accepts in 8 s | 438 ms | 550 ms | 632 ms | 0 missed |

How to read these:
- **Fan-out latency** is bounded by the change feed's 1-second poll. Every customer heard their own order's update, and nobody else's.
- **Dispatch** offers at once on acceptance, through a kick. The 5-second sweep catches anything the kick missed.
- **Pilot scale:** order placement at 43 orders/s is several orders of magnitude above the Lagos pilot's expected peak.
- **Search and quote** are the slowest paths per request. Each makes about 4 database round trips, and business rules are read from the database on every call. A short in-process cache for rules is the first optimisation if staging shows a need.

Problems found and fixed while building the check:
1. **Pool exhaustion:** 200 simultaneous acceptances returned about one-third 500s. Fixed (SECURITY.md §2c); 400 simultaneous acceptances now all succeed.
2. **Dispatch head-of-line starvation:** the sweep looked only at the 50 oldest waiting jobs, so a later job a free rider could take was never offered when the first 50 were ones they couldn't take (cash limit, declined). The sweep now walks the whole queue and stops when no rider is free. The 10-minute operations alert has its own pass. Covered by a new test in `http-dispatch.test.ts`, which fails on the old code.
