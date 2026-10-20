# ChopNow — Product Requirements (MVP)

The full brief is the source of truth for scope. This file records the **MVP defaults chosen where the
brief left room**, so they can be reviewed and changed deliberately. Items marked *(confirm)* affect
the business model and should be confirmed by the business owner before launch; they are all
configurable at runtime from the admin dashboard, not hard-coded.

## Market and money
- Launch market: one Nigerian neighbourhood. Currency NGN, stored as integer kobo.
- Payment provider: Paystack (card, bank transfer, USSD via Paystack Checkout). *(confirm)*
- Cash on delivery: enabled, subject to eligibility rules below.

## Pricing defaults (all configurable) *(confirm)*
| Rule | Default |
|---|---|
| Restaurant commission | 15% of food subtotal (before discounts funded by the platform) |
| Delivery fee charged to customer | ₦500 base + ₦100 per km beyond 2 km, capped at ₦1,500 |
| Rider earning per delivery | 80% of delivery fee, minimum ₦400 |
| Service fee charged to customer | 5% of food subtotal, min ₦50, max ₦300 |
| Minimum order | per restaurant (default none) |
| Delivery radius | 5 km from restaurant (straight-line, from coordinates) |

## Cash on delivery defaults *(confirm)*
- COD allowed for order totals up to ₦20,000.
- New customers (no completed orders) limited to ₦10,000 COD.
- A rider with outstanding unreconciled cash ≥ ₦30,000 receives no further COD offers.
- Partial collection: **not** permitted by default; rider records a dispute/failed delivery instead.

## Operational defaults
- One restaurant per cart.
- Rider offer window: 45 seconds per rider; core riders only for the first 2 minutes, then independent riders added.
- Proof of delivery: 4-digit PIN shown to the customer, entered by the rider. Operations can override with a recorded reason.
- Customer cancellation: free while `PLACED`; after acceptance, only via support/operations.
- Restaurant must accept within 10 minutes or the order is auto-rejected (and refunded if paid).
- Pilot location: Sagamu, Ogun State (decided 2026-10-20; previously Yaba, Lagos). The app's fallback "pilot area" centre is about 6.840° N, 3.647° E, and the development seed places its test restaurants and customers in Makun, Sagamu. *(confirm the starting neighbourhood)* Dates and opening hours use Nigeria time (WAT, the `Africa/Lagos` timezone), shown to users as "Nigeria time".
- Online orders not paid within 30 minutes are cancelled automatically, and any promo code is released; a payment that arrives later is refunded automatically. *(confirm)*
- Live GPS tracking: out of scope for v1; status tracking only.

## Dispatch and delivery rules (implemented in Phase 7) *(confirm)*
- Dispatch starts when the restaurant accepts the order (configurable to "when food is ready").
- Offers go to one rider at a time for 45 s: nearest core rider first; independent riders join after 2 minutes. Operations is alerted if nobody accepts within 10 minutes.
- A rider is "reachable" if their app checked in during the last 90 s; riders must keep the app open while online (no background tracking in v1).
- A rider who declines or hands back a job isn't offered it again; a rider who lets an offer expire can be offered it again after 2 minutes.
- The rider can only mark the food collected after the restaurant marks it ready.
- Cash orders: the rider records the cash received, which must equal the amount due; if the customer can't pay, the rider reports a problem and operations resolves it.
- A rider who reports a problem after pickup is set offline until they go online again.
- Rider earnings are recorded at delivery (80% of the delivery fee, min ₦400) and paid at settlement (Phase 8).

## Notifications (implemented in Phase 10) *(confirm)*
- Customers: order accepted (with ready time), running late, declined or cancelled (with reason and refund note), rider assigned, on the way (PIN reminder), delivered, delivery problem, payment confirmed, refund sent.
- Restaurants: new order, order cancelled or expired, approval decisions, rejected documents, payouts.
- Riders: new offer (urgent), job assigned or taken back by ChopNow, cancelled job, approval decisions, cash hand-in confirmed or not matched, payouts.
- Staff aren't pushed; the dashboard updates live.
- Pushes older than 30 minutes aren't sent (they stay in the in-app list). No SMS or email in v1.

## Operations rules (implemented in Phase 9) *(confirm)*
- Staff roles: **Support** (look up orders and people, request refunds, moderate reviews), **Operations** (+ cancel and fix orders, dispatch, approve restaurants and riders, promotions), **Finance** (refunds, rider cash, settlements, payouts, audit log), **Admin** (everything, including staff accounts and business rules).
- Staff can cancel an order until the rider has the food, or after a delivery problem. Paid orders are refunded through finance.
- After a delivery problem, operations either retries with the same rider, sends the job to a new rider, cancels, or confirms delivery without the PIN (with a reason).
- Operations can hand a waiting job to a specific rider, or take a job back before pickup.
- Every staff change needs a written reason and is kept in the audit log.

## Finance rules (implemented in Phase 8) *(confirm)*
- Revenue is recognised when an order is delivered: the restaurant is owed the food subtotal minus commission minus any discount it funded; the rider is owed their earning; ChopNow keeps commission, delivery fee minus rider earning, and the service fee, and bears platform-funded discounts.
- Refunds after delivery are charged to the restaurant or to ChopNow, chosen by finance when approving. Before delivery they come from the customer's own payment.
- A person cannot approve a refund they requested. Support can request refunds; only finance (or an admin) approves them, reconciles cash, settles and records payouts.
- Riders hand in cash by bank transfer (declared in the app, confirmed by finance) or in person. Cash is cleared oldest first. In v1 unremitted cash is **not** deducted from a rider's payout; it's shown on the statement and blocks cash orders at the limit.
- Settlements are run by finance for any past period (weekly suggested, Monday–Sunday Lagos time). A negative balance (e.g. a late refund charged to the restaurant) is carried into the next settlement.
- Payouts are manual bank transfers. ChopNow records our payout reference and the bank reference; bank account details are held by finance outside the system for the pilot.

## Ordering and payment rules (implemented in Phase 5)
- Online orders reach the restaurant only after the payment is confirmed with the provider. Cash orders reach it immediately.
- A customer can retry an unpaid online order, and the same checkout link is reused for 30 minutes.
- An order that is paid twice, paid for the wrong amount, or paid after cancellation is never applied to the order; a refund request is created for finance.
- Promotions: percent-off (with optional cap), fixed-off, or free delivery; optional restaurant scope, minimum food spend, total and per-customer limits. A cancelled order frees its promotion use. Who funds the discount (platform or restaurant) is recorded for settlement.
- Commission is calculated on the food subtotal before discounts. A restaurant-funded discount is deducted from that restaurant's settlement (Phase 8), not from the commission base. *(confirm)*
- At most 20 of any one item, and 30 cart lines, per order.

## Out of scope for the MVP
Multi-restaurant carts, scheduled orders, AI recommendations, real automated payouts, loyalty
points, multi-city zones, in-app chat (support uses tickets).
