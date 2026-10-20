# ChopNow API

Base URL (local): `http://localhost:4000`. Version prefix: `/v1`. JSON only.

The **machine-readable contract** is the OpenAPI 3.1 document served at `GET /v1/openapi.json`
(on by default outside production; `API_DOCS_ENABLED`). It is generated from the same zod schemas
that validate requests (`packages/shared-schemas`), so it cannot drift from the code. Import it into
Postman, Insomnia, or any OpenAPI viewer. A test fails if any route is missing from this page.

## Conventions

| Topic | Rule |
|---|---|
| Auth | `Authorization: Bearer <accessToken>`. Access tokens last 15 minutes; refresh with `POST /v1/auth/refresh`. Each refresh token works **once**; replaying an old one signs that login chain out. |
| Money | Integer **kobo** (`250000` = ₦2,500.00). Field names end in `Kobo`. |
| Times | ISO-8601 UTC strings. Opening hours are minutes after midnight, Africa/Lagos (`480` = 08:00). |
| Location | `lat`/`lng` query params (decimal degrees), always together. |
| Errors | `{ "error": { "code", "message", "details?" } }`. `message` is safe to show users. `details` lists field problems for `VALIDATION_FAILED`. |
| Status codes | 400 validation · 401 not signed in / token invalid · 403 role lacks permission · 404 not found **or not yours** · 409 business-rule conflict · 413 body too large · 429 rate limited (`RATE_LIMITED`; sign-in per IP, order/quote/payment/realtime-ticket per account; see SECURITY.md §2b) · 500 unexpected (no internals) · 503 `SERVER_BUSY` with `Retry-After` when the database is saturated (safe to retry). |
| Pagination | `page` (from 1) and `pageSize` (≤ 100). Responses: `{ items, page, pageSize, total }`. |
| Unknown fields | Request bodies reject unknown fields (prevents mass assignment). Responses only contain documented fields. |
| Tracing | Send `X-Request-Id` (8–64 chars) or receive a generated one; it appears in logs. |
| Rate limits | 600 requests/min per IP overall; 20 sign-in/registration/refresh/password attempts per 15 min per IP (configurable). Headers: `RateLimit`, `RateLimit-Policy`. |
| Access | Each route needs one of: public, optional sign-in, any signed-in user, or a named permission (`packages/shared-schemas/src/permissions.ts`). OpenAPI shows it as `x-required-permission`. |

## Endpoints

### Auth
| Endpoint | Access | Notes |
|---|---|---|
| `POST /v1/auth/register` | public | Customer, vendor or rider. Riders need `phone` and `rider.vehicleType`. Returns tokens. |
| `POST /v1/auth/login` | public | Same error for wrong password or unknown email. Locks for 15 min after 5 failures. |
| `POST /v1/auth/refresh` | public | Body `{ refreshToken }`. Rotates the token. |
| `POST /v1/auth/logout` | public | Body `{ refreshToken }`. Revokes that session. |
| `POST /v1/auth/logout-all` | signed in | Revokes all sessions and outstanding access tokens. |
| `POST /v1/me/password` | signed in | `{ currentPassword, newPassword }`. Other devices are signed out; returns new tokens for this one. |

### Account
| Endpoint | Access | Notes |
|---|---|---|
| `GET /v1/me` | signed in | Profile, role, default address, rider summary, owned restaurants. |
| `PATCH /v1/me` | signed in | `fullName`, `phone`. |
| `GET /v1/me/addresses` | address.manage.own | Own addresses only. |
| `POST /v1/me/addresses` | address.manage.own | `latitude`/`longitude` required. First address becomes default. Max 20. |
| `PATCH /v1/me/addresses/{addressId}` | address.manage.own | |
| `DELETE /v1/me/addresses/{addressId}` | address.manage.own | Soft delete; past orders keep their snapshot. |
| `POST /v1/me/addresses/{addressId}/default` | address.manage.own | |
| `GET /v1/me/favourites` | favourite.manage.own | Optional `lat`/`lng` for distance and fee. |
| `PUT /v1/me/favourites/{restaurantId}` | favourite.manage.own | Idempotent. |
| `DELETE /v1/me/favourites/{restaurantId}` | favourite.manage.own | |

### Discovery (customers; sign-in optional)
| Endpoint | Notes |
|---|---|
| `GET /v1/restaurants` | `q`, `lat`, `lng`, `sort` (`recommended`, `distance`, `rating`, `prep_time`, `name`), `includeClosed`. |
| `GET /v1/restaurants/{slug}` | Details, hours and menu. Sold-out items are shown with `isAvailable: false`. Unapproved restaurants return 404. |
| `GET /v1/search/food` | Food-first. `q` (≥2 chars) matches item names, descriptions and category names. Also `minPriceKobo`, `maxPriceKobo`, `category`, `sort` (`relevance`, `price_asc`, `price_desc`, `distance`, `rating`, `prep_time`) and `includeUnavailable`. |
| `GET /v1/food-categories` | Categories with orderable items right now. |

**Eligibility rules.** A restaurant counts as `isAcceptingOrders: true` only when all of these hold:
- it is approved;
- the vendor has switched orders on;
- it is open now (Lagos time);
- if a location was sent, the location is inside its delivery radius.

Out-of-range restaurants are never returned. Closed or paused restaurants, and sold-out items, are left out unless `includeClosed`/`includeUnavailable` is set; then they come back flagged `orderable: false`. `deliveryFeeKobo` is an estimate from straight-line distance; the final fee is calculated at checkout.

### Vendor: restaurants & menu (owner only; another vendor's records return 404)
| Endpoint | Notes |
|---|---|
| `GET /v1/vendor/restaurants` | |
| `POST /v1/vendor/restaurants` | Starts `PENDING`, not accepting orders. Coordinates required. |
| `GET /v1/vendor/restaurants/{restaurantId}` | Includes `verificationStatus` and `verificationNote` (reason for rejection or suspension). |
| `PATCH /v1/vendor/restaurants/{restaurantId}` | Profile fields only. Verification and commission cannot be changed. Audited. |
| `PUT /v1/vendor/restaurants/{restaurantId}/hours` | `{ windows: [{ dayOfWeek, opensAt, closesAt }] }`. Replaces all. No overlaps. |
| `PUT /v1/vendor/restaurants/{restaurantId}/availability` | `{ isAcceptingOrders }`. Turning on requires approval and opening hours (409 otherwise). |
| `GET /v1/vendor/restaurants/{restaurantId}/menu` | Includes hidden categories and sold-out items. |
| `POST /v1/vendor/restaurants/{restaurantId}/categories` | Names are unique per restaurant. |
| `PATCH /v1/vendor/restaurants/{restaurantId}/categories/{categoryId}` | Rename, reorder, hide (`isActive`). |
| `DELETE /v1/vendor/restaurants/{restaurantId}/categories/{categoryId}` | Only when it has no live items. |
| `POST /v1/vendor/restaurants/{restaurantId}/items` | Item plus `variants` (full price each, one default) and `extras` (price, `maxQuantity`). |
| `PUT /v1/vendor/restaurants/{restaurantId}/items/{itemId}` | Full replace. Variants/extras with `id` are updated, those without are created, missing ones are retired. |
| `PUT /v1/vendor/restaurants/{restaurantId}/items/{itemId}/availability` | `{ isAvailable }` (sold out / back in stock). |
| `DELETE /v1/vendor/restaurants/{restaurantId}/items/{itemId}` | Soft delete. |

### Orders (customers)
Request body for quote and create (`OrderRequestSchema`) contains **no prices**:
`{ restaurantId, addressId, paymentMethod: "ONLINE" | "CASH_ON_DELIVERY", items: [{ menuItemId, variantId?, extras: [{ extraId, quantity }], quantity, specialInstructions? }], promoCode?, customerNote? }`.
Sending `totalKobo`, `unitPriceKobo` or any other unknown field is rejected with 400.

| Endpoint | Access | Notes |
|---|---|---|
| `POST /v1/orders/quote` | order.place | Prices the cart from the **current** menu and rules: subtotal, delivery fee (from the restaurant-to-address distance), service fee, promotion discount and total. Lists every `problem` (sold out, missing option, closed, out of range, below minimum, quantity limit, invalid promo, COD not allowed) with `lineIndex`. Nothing is stored. |
| `POST /v1/orders` | order.place | **Requires `Idempotency-Key`** (8–128 chars, new for each checkout). Re-prices inside a transaction and returns 422 `ORDER_NOT_PLACEABLE` with the problem list if anything changed. Same key + same body replays the original order (`Idempotent-Replayed: true`); same key + different body → 422 `IDEMPOTENCY_KEY_REUSED`; while the first attempt is still running → 409 `REQUEST_IN_PROGRESS`. Cash orders go to the restaurant immediately; online orders only after payment is verified. |
| `GET /v1/orders` | order.read.own | `status=active|past`, paging. |
| `GET /v1/orders/{orderId}` | order.read.own | Items with price snapshots, amounts, timeline, latest payment, `deliveryPin`, `canCancel`, `canPay`. |
| `POST /v1/orders/{orderId}/cancel` | order.cancel.own | Only while `PLACED`. Paid orders → `paymentStatus: REFUND_PENDING` and a refund request. Frees any promo use. |
| `GET /v1/orders/{orderId}/reorder` | order.place | Past order rebuilt at today's prices, plus what is no longer available. |

### Payments
| Endpoint | Access | Notes |
|---|---|---|
| `POST /v1/orders/{orderId}/payments` | order.place | **Requires `Idempotency-Key`.** Returns `authorizationUrl` for the provider's checkout. An unpaid attempt is reused for 30 minutes. `isTestPayment: true` when the mock provider or a Paystack test key is in use. |
| `POST /v1/payments/{reference}/verify` | order.read.own | Call when the customer returns from checkout. The API asks the provider; the app's own claim is never trusted. Returns `SUCCESSFUL`, `FAILED`, `PENDING` or `ABANDONED`. |
| `POST /v1/payments/webhooks/paystack` | public (HMAC) | Paystack → API only. `x-paystack-signature` is HMAC-SHA512 of the raw body with the secret key; invalid signatures get 401 and are not stored. Each event is stored once; `charge.success` triggers a verify call. |

Payment is confirmed only when the provider's verify response says success **and** the amount and currency match the attempt. On a mismatch, or a second charge for an already-paid order, nothing is marked paid and a refund request is created. Each confirmation posts one ledger entry (debit provider clearing, credit customer order funds), however many times it arrives.

Browser pages (not JSON):
- `GET /v1/payments/callback?reference=…`: Paystack's return URL. It verifies the payment and links back to the app (`chopnow://orders/{id}`).
- `GET|POST /v1/payments/mock/checkout/{reference}`: **development/test only**, available only while `PAYMENT_PROVIDER=mock` (which configuration refuses in staging/production). Banner: "TEST PAYMENT — no real money".

### Vendor: orders, reports, reviews, uploads (owner only; other restaurants' records return 404)
Restaurants only see orders sent to them: cash orders immediately, online orders once paid. They see the customer's first name, items and note. They never see the customer's address, phone, email or the delivery PIN.

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /v1/vendor/restaurants/{restaurantId}/orders` | order.process.own | `view=incoming` (waiting to accept, oldest first) · `active` (incoming + kitchen) · `history`; `q` = order code; returns `incomingCount`. Each order lists its allowed `actions`. |
| `GET /v1/vendor/restaurants/{restaurantId}/orders/{orderId}` | order.process.own | |
| `POST /v1/vendor/restaurants/{restaurantId}/orders/{orderId}/accept` | order.process.own | Optional `prepTimeMinutes` (default: the restaurant's). Sets `estimatedReadyAt`. 409 `ACCEPT_DEADLINE_PASSED` after the 10-minute window. |
| `POST /v1/vendor/restaurants/{restaurantId}/orders/{orderId}/reject` | order.process.own | `reason`: `ITEM_UNAVAILABLE`, `TOO_BUSY`, `CLOSING_SOON`, `CANNOT_DELIVER_AREA` or `OTHER` (needs `note`). Paid orders → refund requested; the promo is released. Audited. |
| `POST /v1/vendor/restaurants/{restaurantId}/orders/{orderId}/start-preparing` | order.process.own | ACCEPTED → PREPARING. |
| `POST /v1/vendor/restaurants/{restaurantId}/orders/{orderId}/ready` | order.process.own | → READY_FOR_PICKUP (records PREPARING first if needed). |
| `POST /v1/vendor/restaurants/{restaurantId}/orders/{orderId}/delay` | order.process.own | `extraMinutes` (5–120), optional `note`. Moves `estimatedReadyAt`, which the customer sees. Audited. |
| `GET /v1/vendor/restaurants/{restaurantId}/reports/sales` | finance.read.own | `from`, `to` (YYYY-MM-DD, Lagos dates, ≤ 92 days). Delivered/cancelled/rejected counts, gross food sales, commission, restaurant-funded discounts, estimated net, daily series, top items. |
| `GET /v1/vendor/restaurants/{restaurantId}/reviews` | review.reply.own | Paged, with the restaurant's rating summary. |
| `POST /v1/vendor/restaurants/{restaurantId}/reviews/{reviewId}/reply` | review.reply.own | Public reply (can be edited by replying again). |
| `POST /v1/vendor/restaurants/{restaurantId}/images` | menu.manage.own | `multipart/form-data`, field `file`; `?purpose=menu_item|logo|cover`. JPG/PNG/WebP ≤ 5 MB, ≥ 200×200. Re-encoded to WebP (≤ 1600 px, metadata stripped). Returns `url` for `imageUrl`/`logoUrl`/`coverImageUrl`. Only ChopNow-hosted URLs are accepted in those fields. |
| `POST /v1/vendor/restaurants/{restaurantId}/documents` | restaurant.manage.own | `multipart/form-data`: `file` (PDF/JPG/PNG ≤ 10 MB, sniffed by content) and `type` (`CAC_CERTIFICATE`, `FOOD_HANDLER_PERMIT`, `OWNER_ID`, `OTHER`). Stored **privately**; staff access it via expiring signed links (Phase 9). |
| `GET /v1/vendor/restaurants/{restaurantId}/documents` | restaurant.manage.own | Upload list with review status. |

Orders not accepted within `orders.vendorAcceptTimeoutSeconds` (default 10 min) are declined automatically by a 30-second background sweep (`actor: SYSTEM`), with a refund if paid.

### Rider (own records only; another rider's offers and deliveries return 404)
Dispatch starts when the restaurant accepts (`dispatch.startDispatchOn`, default `ACCEPTED`): a delivery is created (plus a cash-collection record for cash orders) and offered to **one rider at a time** for `dispatch.offerTimeoutSeconds` (45 s). Core riders only for the first `dispatch.coreOnlyWindowSeconds` (2 min), then independent riders too. Eligible riders are approved, online, seen in the last 90 s (the app's poll or location), not on a delivery and not holding another offer; closest to the restaurant first. Riders who declined or released a delivery aren't asked again; a rider whose offer expired can be asked again after 2 min. Cash orders skip riders whose outstanding cash is at or above their limit (`cashOnDelivery.riderOutstandingCashLimitKobo`, ₦30,000, or a per-rider override). If nobody accepts within `dispatch.alertOperationsAfterSeconds` (10 min), operations is alerted once (audit `dispatch.unassigned_alert`). A 5-second background sweep expires offers and makes the next one.

Privacy: an offer shows the restaurant, the drop-off **area**, distances, earning and cash to collect. The full address, landmark, instructions, contact phone and customer first name are returned only to the assigned rider while the delivery is active. The PIN is never sent to riders.

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /v1/rider/me` | rider.profile.own | Verification status, availability, vehicle, completed deliveries, rating, `outstandingCashKobo`, `cashLimitKobo`, today's earnings and deliveries (Lagos day). |
| `PUT /v1/rider/availability` | delivery.work.own | `{ online }`. Online needs an APPROVED rider on an ACTIVE account (409 `RIDER_NOT_APPROVED`). Going offline withdraws a pending offer, which passes to the next rider. |
| `PUT /v1/rider/location` | delivery.work.own | `{ latitude, longitude }`. Stored only while online and overwritten (no history). Counts as a heartbeat. |
| `GET /v1/rider/work` | delivery.work.own | `{ availability, offer, delivery }`: the current pending offer and active delivery. The app polls this every 5 s while online; it also counts as a heartbeat. |
| `POST /v1/rider/offers/{offerId}/accept` | delivery.work.own | First valid acceptance wins. 409 `OFFER_UNAVAILABLE` (expired/withdrawn/taken), `ALREADY_ON_DELIVERY` (database-enforced: one active delivery per rider), `RIDER_NOT_ONLINE`. Returns the delivery with full drop-off details. |
| `POST /v1/rider/offers/{offerId}/decline` | delivery.work.own | Optional `reason`: `TOO_FAR`, `BUSY`, `VEHICLE_ISSUE`, `OTHER`. The next rider is offered immediately. |
| `POST /v1/rider/deliveries/{deliveryId}/arrived` | delivery.work.own | ASSIGNED → ARRIVED_AT_RESTAURANT. |
| `POST /v1/rider/deliveries/{deliveryId}/picked-up` | delivery.work.own | Requires the restaurant to have marked the order ready (409 `FOOD_NOT_READY`). Delivery and order → PICKED_UP. |
| `POST /v1/rider/deliveries/{deliveryId}/complete` | delivery.work.own | `{ pin, cashCollectedKobo? }`. Wrong PIN → 422 `INVALID_PIN` with `details.attemptsLeft` (counted even though the request fails); after `dispatch.maxPinAttempts` (5) → 423 `PIN_LOCKED` (audited; operations can override in Phase 9). Cash orders must record the amount received: equal to the amount due unless `cashOnDelivery.allowPartialCollection` (422 `CASH_AMOUNT_SHORT`/`CASH_AMOUNT_INVALID`); online orders must not (422 `NO_CASH_DUE`). On success: delivery and order DELIVERED (cash orders' `paymentStatus` → SUCCESSFUL), cash marked OUTSTANDING with a `CASH_COLLECTED` journal (Dr RIDER_CASH_HELD / Cr CUSTOMER_ORDER_FUNDS), and a DELIVERY_FEE rider earning (CALCULATED; settled in Phase 8). |
| `POST /v1/rider/deliveries/{deliveryId}/release` | delivery.work.own | Before pickup only. `reason`: `VEHICLE_ISSUE`, `EMERGENCY`, `RESTAURANT_TOO_SLOW`, `OTHER`; optional `note`. The job goes back to dispatch; this rider isn't offered it again. Audited. |
| `POST /v1/rider/deliveries/{deliveryId}/problem` | delivery.work.own | After pickup only. `reason`: `CUSTOMER_UNREACHABLE`, `CUSTOMER_REFUSED`, `CANNOT_PAY`, `WRONG_ADDRESS`, `UNSAFE`, `ACCIDENT`, `OTHER`; optional `note`. Delivery → FAILED, order → DELIVERY_EXCEPTION for operations, cash NOT_COLLECTED, rider set offline. Audited. |
| `GET /v1/rider/deliveries` | delivery.work.own | Paged history (delivered, failed, cancelled) with drop-off area only. |
| `GET /v1/rider/earnings` | earnings.read.own | `from`, `to` (Lagos dates, ≤ 92 days): deliveries, total, daily series, `unsettledKobo`, `outstandingCashKobo`. |
| `POST /v1/rider/documents` | rider.profile.own | `multipart/form-data`: `file` (PDF/JPG/PNG ≤ 10 MB) and `type` (`DRIVERS_LICENCE`, `VEHICLE_PAPERS`, `RIDER_ID`, `OTHER`). Stored privately. Works before approval. |
| `GET /v1/rider/documents` | rider.profile.own | Upload list with review status. |

Customers and restaurants see `deliveryStatus` and `rider: { firstName, vehicleType }` on their order views once a rider accepts; never the rider's phone, plate or location.

### Notifications and realtime
| Endpoint | Access | Notes |
|---|---|---|
| `GET /v1/me/notifications` | authenticated | `page`, `pageSize`, `unread=true`. Newest first, with `unreadCount`. Each item: `type` (e.g. `order.accepted`, `delivery.offer`, `refund.completed`), `title`, `body`, `orderId`, small `data`. |
| `POST /v1/me/notifications/read` | authenticated | `{ ids: [...] }` or `{ all: true }`. Only your own. |
| `PUT /v1/me/push-tokens` | authenticated | `{ token, platform: IOS\|ANDROID\|WEB }` with an Expo push token (`ExponentPushToken[…]`). A token already registered moves to the account now signed in on that device. |
| `POST /v1/me/push-tokens/remove` | authenticated | `{ token }`: stop pushes to this device (call on sign-out). |
| `POST /v1/realtime/ticket` | authenticated | Returns `{ ticket, expiresAt, url }` for opening the WebSocket within 30 seconds. |

**WebSocket** `GET /v1/realtime?ticket=…` (upgrade). Server → client only; messages are JSON "something changed, refetch" hints carrying ids, never personal data:
- `{ type: 'hello' }` on connect
- `order.updated` `{ orderId, restaurantId, status }`: to the customer, the restaurant (once the order reached it), the assigned rider, and staff
- `delivery.updated` `{ orderId, restaurantId, deliveryId, event }`: to the customer and restaurant; riders get `work.updated`; staff get `dispatch.updated`
- `work.updated` `{ deliveryId }`: to a rider when they are offered a job or their job changes
- `notification.new` `{ notificationId, notificationType, orderId }`: to the notification's owner

Rejected with 401 for a missing, forged, expired or outdated ticket (password changed, suspended, pending password change) and 403 for a browser origin not in `CORS_ALLOWED_ORIGINS`. Connections are pinged every 25 s and re-validated every 5 minutes. Clients keep slow polling as a fallback.

### Operations (staff; admin dashboard)
Staff see full order details, including customer contact, because resolving problems needs them. Every change needs a reason and is audited. State changes are conditional, so a staff action can't race a rider or restaurant.

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /v1/admin/dashboard` | dashboard.view | Today: placed/delivered/cancelled, gross order value, average delivery minutes. Live: awaiting restaurant, in kitchen, awaiting rider, on the way, exceptions, dispatch alerts, riders online/busy, restaurants open. Queues: approvals, documents, refund requests, remittances. |
| `GET /v1/admin/orders` | order.read.any | `q` (order code, customer email or phone), `status`, `restaurantId`, `attention=true` (exceptions, dispatch alerts, restaurant not responding for 20+ min). Paged, newest first. |
| `GET /v1/admin/orders/{orderId}` | order.read.any | Customer contact, restaurant, items, all amounts (incl. commission and rider earning), address, timeline with actor roles and reasons, payments, refunds, delivery (rider, offers made, PIN attempts, events), cash, and `actions` allowed for the caller. `deliveryPin` only for order managers. |
| `POST /v1/admin/orders/{orderId}/cancel` | order.manage.any | `{ reason }`. PLACED → READY_FOR_PICKUP or DELIVERY_EXCEPTION only (409 `ORDER_NOT_CANCELLABLE` once the rider has the food). Paid orders → refund requested; offers withdrawn. Audited. |
| `POST /v1/admin/orders/{orderId}/retry-delivery` | order.manage.any | `{ mode: SAME_RIDER\|NEW_RIDER, reason }` for DELIVERY_EXCEPTION. Same rider → back to PICKED_UP (PIN attempts reset; 409 `RIDER_BUSY` if they took another job); new rider → READY_FOR_PICKUP and back to dispatch. Audited. |
| `POST /v1/admin/orders/{orderId}/confirm-delivered` | order.manage.any | `{ reason, cashCollectedKobo? }` for picked-up orders (incl. locked PIN): records a proof override and books cash, rider earning and the order split exactly as a PIN delivery. Audited (`delivery.proof_override`). |
| `POST /v1/admin/payments/{reference}/verify` | payment.read | Asks the payment provider about one attempt now and applies the result exactly as a webhook would (confirms, refunds a late or duplicate charge, or marks it failed). For "I paid but it says unpaid". Idempotent; audited (`payment.staff_verify`). The worker's reconciliation sweep does the same automatically for unconfirmed attempts. |
| `GET /v1/admin/dispatch` | dispatch.manage | Waiting deliveries (age, offers made, who holds the current offer, alerted), active deliveries with rider and phone, riders online or busy (reachable, cash held). |
| `POST /v1/admin/deliveries/{deliveryId}/assign` | dispatch.manage | `{ riderId, reason }`: give a waiting delivery to an approved rider (pending offers withdrawn). 409 `RIDER_BUSY` / `DELIVERY_NOT_WAITING` / `RIDER_NOT_APPROVED`. Audited. |
| `POST /v1/admin/deliveries/{deliveryId}/unassign` | dispatch.manage | `{ reason }`: before pickup only; back to dispatch. Audited. |
| `GET /v1/admin/users` | customer.read.any | `q` (email, name, phone), `role`, `status`. Includes order count and whether a password change is pending. |
| `GET /v1/admin/users/{userId}` | customer.read.any |  |
| `POST /v1/admin/users/{userId}/suspend` | customer.manage | `{ reason }`. Customers need customer.manage; staff accounts also need staff.manage. Not yourself, not the last admin; restaurants and riders use their own suspend routes (409 `USE_APPROVAL_FLOW`). Signs the user out everywhere. Audited. |
| `POST /v1/admin/users/{userId}/reactivate` | customer.manage | `{ reason }`. Audited. |
| `POST /v1/admin/staff` | staff.manage | `{ email, fullName, phone?, role }` (staff roles only). Returns a 16-character one-time password **once**; until it is changed, that account can only call `POST /v1/me/password`, `GET /v1/me` and auth endpoints (403 `PASSWORD_CHANGE_REQUIRED`). Audited (without the password). |
| `GET /v1/admin/restaurant-documents` | restaurant.approve | `status`, `restaurantId` filters; oldest first. |
| `POST /v1/admin/restaurant-documents/{documentId}/link` | restaurant.approve | A 5-minute signed link to view the file. Every view is audited (`document.view`). |
| `POST /v1/admin/restaurant-documents/{documentId}/review` | restaurant.approve | `{ status: ACCEPTED\|REJECTED, note }` (rejections need a note the owner sees). |
| `GET /v1/admin/rider-documents` | rider.approve | As above, for riders (`riderId` filter). |
| `POST /v1/admin/rider-documents/{documentId}/link` | rider.approve |  |
| `POST /v1/admin/rider-documents/{documentId}/review` | rider.approve |  |
| `GET /v1/admin/promotions` | promotion.manage | All promotions with active redemptions. |
| `POST /v1/admin/promotions` | promotion.manage | `code` (4–20 letters/digits, stored upper-case), `type` PERCENT_OFF (`percentBps`, optional `maxDiscountKobo`) / FIXED_OFF (`amountKobo`) / FREE_DELIVERY, `minSubtotalKobo`, optional `restaurantId`, `fundedBy` (restaurant-funded needs a restaurant), `startsAt`, `endsAt`, `usageLimit?`, `perCustomerLimit`. 409 `PROMO_CODE_EXISTS`. Audited. |
| `PATCH /v1/admin/promotions/{promotionId}` | promotion.manage | `isActive`, `endsAt`, `usageLimit`, `description`. Audited. |
| `GET /v1/admin/reviews` | review.moderate | `status`, `maxRating` filters. |
| `POST /v1/admin/reviews/{reviewId}/moderate` | review.moderate | `{ status: HIDDEN\|PUBLISHED, note }`. Ratings are recomputed from published reviews. Audited. |
| `GET /v1/admin/audit` | audit.read | `entityType`, `entityId`, `actorUserId`, `action` (prefix, e.g. `refund.`). Newest first, with the actor’s name and role. |

### Finance (staff; restaurants and riders see only their own statements)
Money is integer kobo throughout. Every money movement is a balanced, append-only journal (see ARCHITECTURE §11). Payouts are **manual bank transfers**: the API records them; it never sends money itself.

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /v1/admin/finance/summary` | settlement.manage | `from`, `to` (Lagos dates): delivered orders, gross order value, food sales, revenue (commission, delivery margin, service fees), promotion cost, refunds paid; balances now (owed to restaurants/riders, cash held by riders, refunds owed, provider clearing, customer funds held); work queue counts; trial balance with `balanced`. |
| `GET /v1/admin/finance/refunds` | payment.read | Paged, `status` filter. Shows `chargeTo`, `method`, payment reference and whether it was a test payment. |
| `GET /v1/admin/finance/refunds/{refundId}` | payment.read | |
| `POST /v1/admin/orders/{orderId}/refunds` | refund.request | `{ amountKobo, reason, chargeTo? }` (`RESTAURANT`/`PLATFORM`, a suggestion for delivered orders). At most what was paid minus refunds not rejected (422 `REFUND_EXCEEDS_PAID`); 409 `NOTHING_TO_REFUND` if nothing was paid. Cancelled/declined paid orders get a full refund request automatically. Audited. |
| `POST /v1/admin/finance/refunds/{refundId}/approve` | refund.approve | Not by the person who requested it (403 `SEPARATION_OF_DUTIES`). Delivered orders need `chargeTo` (`RESTAURANT` → deducted from its next settlement; `PLATFORM` → ChopNow cost). Online payments are then sent to the provider (status SUCCESSFUL, or PROCESSING while the provider completes it, or FAILED); cash orders stay APPROVED until paid manually. Audited. |
| `POST /v1/admin/finance/refunds/{refundId}/reject` | refund.approve | `{ reason }`. Only REQUESTED. No ledger effect. |
| `POST /v1/admin/finance/refunds/{refundId}/retry` | refund.approve | FAILED provider refunds. If the provider already has a record it is re-checked rather than sent again. |
| `POST /v1/admin/finance/refunds/{refundId}/mark-paid` | refund.approve | `{ bankReference }`: finance paid the customer by transfer (cash orders, or when the provider can't). |
| `POST /v1/admin/finance/refunds/{refundId}/refresh` | refund.approve | Re-checks a PROCESSING refund with the provider (also done by a 2-minute sweep and on `refund.*` webhooks, which are never trusted on their own). |
| `GET /v1/admin/finance/cash` | cash.reconcile | Per rider: cash outstanding, limit, open collections, oldest collection, transfers awaiting confirmation. |
| `GET /v1/admin/finance/remittances` | cash.reconcile | Paged; `status`, `riderId` filters; shows which orders each hand-in cleared. |
| `POST /v1/admin/finance/remittances` | cash.reconcile | `{ riderId, amountKobo, method: BANK_TRANSFER\|CASH_HANDOVER, reference?, note? }`: a hand-in finance verified itself; confirmed immediately. |
| `POST /v1/admin/finance/remittances/{remittanceId}/confirm` | cash.reconcile | Clears the rider's oldest collections first; never more than outstanding (409 `REMITTANCE_EXCEEDS_OUTSTANDING`). Journal `CASH_REMITTED`. Audited. |
| `POST /v1/admin/finance/remittances/{remittanceId}/reject` | cash.reconcile | `{ reason }` (e.g. not on the bank statement). |
| `POST /v1/admin/finance/settlements/generate` | settlement.manage | `{ from, to, kind: VENDOR\|RIDER\|ALL }` for a period that has ended (422 `PERIOD_NOT_ENDED`). Creates DRAFT settlements; parties with an overlapping or later live settlement are listed in `skipped`. |
| `GET /v1/admin/finance/settlements` | settlement.manage | Paged; `kind`, `status` filters. |
| `GET /v1/admin/finance/settlements/{kind}/{settlementId}` | settlement.manage | `kind` = `vendor` or `rider`. Breakdown (orders/deliveries, gross, commission, restaurant-funded discounts, refund deductions, `adjustmentsKobo` carried from earlier periods) and payouts. |
| `POST /v1/admin/finance/settlements/{kind}/{settlementId}/approve` | settlement.manage | DRAFT → APPROVED. Zero/negative nets are approved with nothing to pay; negatives carry into the next settlement. |
| `POST /v1/admin/finance/settlements/{kind}/{settlementId}/cancel` | settlement.manage | `{ reason }`. Unpaid settlements only; regenerate afterwards. |
| `POST /v1/admin/finance/settlements/{kind}/{settlementId}/payout` | payout.manage | Creates a payout (INITIATED) with our reference `PO-XXXXXXXX` to quote on the transfer. One live payout per settlement (409 `PAYOUT_IN_PROGRESS`); 409 `NOTHING_TO_PAY` if net ≤ 0. |
| `POST /v1/admin/finance/payouts/{payoutId}/complete` | payout.manage | `{ bankReference }` after making the transfer: payout SUCCESSFUL, settlement PAID, journal `PAYOUT` (Dr payable / Cr PLATFORM_BANK), rider earnings SETTLED. Audited. |
| `POST /v1/admin/finance/payouts/{payoutId}/fail` | payout.manage | `{ reason }`: settlement FAILED; a new payout can be started. |
| `GET /v1/vendor/restaurants/{restaurantId}/settlements` | finance.read.own | Owner only (404 otherwise); approved and later statements with payouts. Drafts are hidden. |
| `GET /v1/rider/settlements` | earnings.read.own | Own approved and later statements. |
| `GET /v1/rider/remittances` | earnings.read.own | Own cash hand-ins. |
| `POST /v1/rider/remittances` | delivery.work.own | `{ amountKobo, reference }`: "I transferred my cash". At most outstanding minus transfers awaiting confirmation (422). Finance confirms it against the bank statement. |

### Reviews (customers)
| Endpoint | Access | Notes |
|---|---|---|
| `POST /v1/orders/{orderId}/review` | review.write.own | Delivered orders only, once, within 14 days. `restaurantRating` 1–5, optional `riderRating`, `comment`. Updates the restaurant's (and rider's) rating. |

### Web portal sessions
Browser portals send `X-ChopNow-Client: web` on login/register/refresh/logout and use `credentials: 'include'`. The refresh token is then set as an `HttpOnly; SameSite=Strict; Path=/v1/auth` cookie (`Secure` outside development) and returned as `""` in the body. `POST /v1/auth/refresh` with the header and no body uses the cookie. Mobile apps keep sending the refresh token in the body.

### Media
`GET /media/{key}` serves public images when `STORAGE_DRIVER=local` (in production, images come from the S3/CDN URL in `MEDIA_PUBLIC_BASE_URL`). `GET /media-private/{key}?exp=…&sig=…` serves private files only with a valid, unexpired HMAC signature.

### Admin
| Endpoint | Permission | Notes |
|---|---|---|
| `GET /v1/admin/restaurants` | restaurant.read.any | `status`, `q`, paging. |
| `GET /v1/admin/restaurants/{restaurantId}` | restaurant.read.any | Includes `hoursConfigured` and `menuItemCount` for review. |
| `POST /v1/admin/restaurants/{restaurantId}/approve` | restaurant.approve | Needs coordinates and opening hours. Optional `note`. Audited. |
| `POST /v1/admin/restaurants/{restaurantId}/reject` | restaurant.approve | `reason` required. Pending only. |
| `POST /v1/admin/restaurants/{restaurantId}/suspend` | restaurant.approve | `reason` required. Switches orders off and hides the restaurant. |
| `GET /v1/admin/riders` | rider.read.any | `status`, `riderType`, `q`, paging. |
| `GET /v1/admin/riders/{riderId}` | rider.read.any | |
| `POST /v1/admin/riders/{riderId}/approve` | rider.approve | `riderType` (`CORE`/`INDEPENDENT`) required. |
| `POST /v1/admin/riders/{riderId}/reject` | rider.approve | `reason` required. |
| `POST /v1/admin/riders/{riderId}/suspend` | rider.approve | Sets the rider offline. 409 while they hold an active delivery. |
| `PUT /v1/admin/riders/{riderId}/type` | rider.approve | |
| `GET /v1/admin/settings/business-rules` | config.manage | |
| `PUT /v1/admin/settings/business-rules` | config.manage | Full document, validated. Audited with before and after. Applies to new orders only. |

### Operational
| Endpoint | Notes |
|---|---|
| `GET /health` | Liveness (no database check). |
| `GET /ready` | Readiness (checks the database). 503 when it cannot be reached. |
| `GET /v1/openapi.json` | OpenAPI 3.1 document. |

## Example: search for jollof rice in Sagamu
```http
GET /v1/search/food?q=jollof%20rice&lat=6.848&lng=3.645
```
```json
{
  "items": [
    {
      "item": { "id": "…", "name": "Jollof Rice", "categoryName": "Rice", "fromPriceKobo": 250000, "isAvailable": true, "hasVariants": true, "hasExtras": true, "description": "…", "imageUrl": null },
      "restaurant": { "slug": "mama-nkechis-kitchen", "name": "Mama Nkechi's Kitchen", "isOpenNow": true, "isAcceptingOrders": true, "distanceMeters": 640, "deliveryFeeKobo": 50000, "deliversToLocation": true, "prepTimeMinutes": 25, "minOrderKobo": 0, "…": "…" },
      "orderable": true
    }
  ],
  "page": 1, "pageSize": 20, "total": 3
}
```

Order, payment, delivery, finance, notification and support endpoints are added in Phases 5–10.
