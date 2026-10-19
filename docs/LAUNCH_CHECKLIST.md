# ChopNow Launch Checklist (Lagos pilot)

ChopNow is **not production-ready until every "Before launch" item is ticked** by the person named.
"Done" items were verified in development on 2026-10-16; the evidence is listed so they can be re-checked.

Owner key: **ENG** engineering · **OPS** operations · **FIN** finance · **BIZ** founders/legal

## Done in development (re-check on staging)
| Item | Evidence |
|---|---|
| Spec §21 acceptance journey works end to end | `tests/e2e/specs/ordering-journey.spec.mjs` (real UIs) and `acceptance-journey.test.ts` (API, online + cash) |
| Business rules enforced on the server; client totals never trusted | `http-orders.test.ts` (tampered totals rejected), `http-security.test.ts` (access manifest, IDOR, 401/403 sweep) |
| Payments: signed webhooks, idempotency, duplicate/mismatch handling, lost-webhook reconciliation | `http-payments.test.ts`, `http-payment-reconciliation.test.ts` |
| Ledger balanced and append-only; settlements reconcile with it | `constraints.test.ts`, `http-finance.test.ts` |
| Rate limits (per account for busy customer actions) and overload behaviour (503, not 500) | `http-security.test.ts`, `error-handler.test.ts`, TEST_PLAN.md §5 |
| Accessibility: no serious/critical axe issues on 16 key screens | browser E2E |
| Production config refuses unsafe values (mock payments, test keys, http, localhost origins, local storage, log-only push, debug logs, placeholder secrets) | `health.test.ts`, `deploy-env.test.ts` |
| Restricted database roles (no DDL; audit/ledger insert-only for the app) | Verified against PostgreSQL 17 (DEPLOYMENT.md §2 step 1) |
| Portal CSP doesn't break the portals | Browser E2E runs the portals under the production CSP and fails on any violation (tested by planting a broken policy) |
| Secrets scan; no server secrets in client bundles | SECURITY.md §2d |

## Before launch
### Infrastructure (ENG)
- [ ] Put the code in a git repository with `main` protected (CI requires pull requests to pass `.github/workflows/ci.yml`).
- [ ] Choose a hosting provider and region, and confirm the defaults in DEPLOYMENT.md §1.
- [ ] Set up a container registry; add the image push to CI.
- [ ] Staging: complete DEPLOYMENT.md §2 end to end, and confirm the images build and run on it. They were written but not built on the development machine.
- [ ] Production database: PostgreSQL 17, UTF-8, point-in-time recovery; `database/roles.sql` applied; the app connects as `chopnow_app`.
- [ ] **Restore drill:** restore a backup into a scratch database and boot the API against it.
- [ ] Buckets: public behind a CDN; private with no public access and versioning on.
- [ ] TLS on all four hostnames; HSTS works; the load balancer allows WebSockets with an idle timeout of at least 60 s.
- [ ] Exactly one worker (`PROCESS_ROLE=worker`) running; `/ready` shows all five jobs fresh.
- [ ] Alerts from OPERATIONS_RUNBOOK.md §2 configured and test-fired.
- [ ] Sentry DSN set for production (separate from staging); one test error seen.
- [ ] Upgrade Prisma to 7.10.1 or later (`prisma`, `@prisma/client` and `@prisma/adapter-pg` together) once it has had about a week of soak time; run the full suites. This clears the CLI's audit findings (SECURITY.md §2d).
- [ ] If more than 2 web instances are planned: move rate limiting to a shared store (DEPLOYMENT.md §3).

### Payments (FIN + ENG)
- [ ] Paystack business account verified (KYC) and live mode enabled.
- [ ] **Staging with test keys:** pay, decline, abandon, refund (full and partial) and a duplicate payment. Confirm each against the Paystack dashboard. Then break the webhook URL on purpose and confirm the reconciliation sweep still applies a payment.
- [ ] Production webhook and callback URLs set (DEPLOYMENT.md §2 step 8); one live order placed and refunded (§6 smoke test).
- [ ] Bank account for settlements and payouts; a named person who makes payout transfers, and a different one who approves refunds.

### Mobile apps (ENG + BIZ)
- [ ] Confirm the bundle identifiers (`app.chopnow.customer`, `app.chopnow.rider`); they can't be changed after upload.
- [ ] `eas init` for both apps; FCM V1 key uploaded; push received on a real Android phone for an order update and a rider offer.
- [ ] Preview builds tested on low-end Android phones (2–3 GB RAM) on Lagos mobile data. This covers location permission, background behaviour while a rider is online, camera uploads and TalkBack on the main screens. Only the web builds have been tested so far.
- [ ] Play Console listings, privacy policy URL, data-safety form (location, phone, name), content rating.
- [ ] Production builds submitted to the internal track, then a closed test with pilot riders and staff.

### Security and legal (BIZ + ENG)
- [ ] External penetration test of the API and portals; fix high and critical findings.
- [ ] Privacy policy and terms (NDPA 2023 / Nigeria Data Protection Commission obligations), cookie notice for the portals, data-retention periods confirmed. The defaults are documented in DATABASE_SCHEMA.md.
- [ ] Restaurant and rider agreements (commission, cash handling, payout schedule, document checks).
- [ ] Decide whether the admin dashboard is IP-restricted or behind a VPN.

### Operations (OPS + FIN)
- [ ] First admin bootstrapped; staff accounts created with the right roles; bootstrap variables removed.
- [ ] Business rules reviewed and confirmed: fees, commission, COD caps, timeouts. Every *(confirm)* in the docs resolved.
- [ ] Pilot restaurants onboarded: documents checked, location and hours correct, menus with photos.
- [ ] Pilot riders onboarded: documents checked; core riders marked; cash hand-in process explained.
- [ ] Staff trained on OPERATIONS_RUNBOOK.md: a stuck order, a PIN lock, a refund and a cash hand-in, each practised on staging.
- [ ] Support contact channel (phone/WhatsApp) staffed during pilot hours.
- [ ] Load check repeated on staging hardware (`npm run test:load` pointed at staging; it currently starts its own local API), with results recorded.

## Launch day
- [ ] Release from a tagged commit; migrations applied; smoke test passed (DEPLOYMENT.md §6).
- [ ] Ops desk watching Admin → Dashboard, Orders (needs attention) and Dispatch; engineering watching Sentry and `/ready`.
- [ ] End-of-day review: trial balance balanced; no stalled refunds; rider cash outstanding reviewed.

## After the first week
- [ ] First weekly settlement generated, approved and paid; restaurants and riders confirm their statements.
- [ ] Review rate-limit 429s, `SERVER_BUSY` counts, dispatch acceptance times and payment reconciliation corrections (Audit log `payment.`).
- [ ] Customer feedback on the PIN flow and on cash.
