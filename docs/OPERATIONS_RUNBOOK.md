# ChopNow Operations Runbook

For the people running ChopNow day to day: operations, support and finance staff, and whoever is on call.
Deployment, releases and rollback are in [DEPLOYMENT.md](DEPLOYMENT.md).

**Golden rules**
- **Never edit the database by hand to fix an order or money.** Use the admin dashboard. Every action there checks the business rules, writes the ledger correctly and records who did it in the audit log. The audit and ledger tables are append-only: the database refuses changes even from the API, and the production app role has no rights to change them.
- **Customers' money is real.** If something looks wrong with a payment, find out what Paystack actually received (§4) before acting.
- **Write a reason** every time the dashboard asks for one. It goes into the audit log and, for cancellations and declines, to the customer.

## 1. Roles: who can do what
| Role | Typical person | Can | Can't |
|---|---|---|---|
| SUPPORT | Customer support | Search orders and users; view payments; ask Paystack about a payment; request refunds; moderate reviews | Approve refunds, cancel orders, dispatch, change settings |
| OPERATIONS | Ops desk | Everything support can, plus: cancel orders, retry or force-complete deliveries, the dispatch board, approve restaurants and riders | Approve refunds, payouts |
| FINANCE | Finance | Approve or reject refunds, confirm rider cash hand-ins, settlements and payouts, finance summary | Dispatch, cancel orders |
| ADMIN | Founders | Everything, including staff accounts and business rules | Approve their **own** refund request (no one can) |

Separation of duties is enforced by the API: whoever requests a refund can't approve it.

## 2. Monitoring and health
| Signal | Where | Healthy |
|---|---|---|
| API liveness | `GET https://api.<domain>/health` | 200 |
| API readiness | `GET /ready` on each web instance | `ready`, with the `realtime-feed` job fresh |
| Worker | `/ready` on the worker | `ready`; `dispatch`, `accept-deadline`, `refunds`, `push` and `payments-reconcile` fresh, none `stalled` |
| Errors | Sentry (when `SENTRY_DSN` is set) | No new 5xx issues after a release |
| Business | Admin → Dashboard | Orders flowing; "needs attention" low |

A job is **stalled** when it hasn't succeeded for 5 of its intervals; `/ready` then returns 503 and `lastError` says why. Every API response carries an `X-Request-Id` header. Ask anyone reporting a problem for it, then search the logs or Sentry by it.

**Alerts to set up on your platform** (start with these):
- `/ready` failing for more than 2 minutes on any instance, the worker included.
- Sentry: a new issue, or more than 10 errors in 5 minutes.
- Database CPU above 80% or connections above 80% of the limit.
- `503 SERVER_BUSY` responses above 1% for 5 minutes (database pool saturated; see DEPLOYMENT.md §3).

## 3. Investigating a failed or stuck order
Start at **Admin → Orders** and search by order code (`CN-…`), the customer's email or the customer's phone. Tick "Needs attention" to see the orders that need someone. An order needs attention when it has waited too long for the restaurant, nobody has accepted its delivery for 10 minutes, or it's in `DELIVERY_EXCEPTION`.

Open the order. The detail page shows everything in one place:
- **Timeline:** every status change, with who made it and why.
- **Money:** each payment attempt and its status, cash collected, and refunds.
- **Delivery:** the rider and the delivery events.
- **Financial history:** every ledger journal, the money split, and which settlement covers it.

| Symptom | Likely cause | What to do |
|---|---|---|
| Customer says "I paid but my order says unpaid" | Paystack's webhook is late or lost | On the order → Money, press **Check with provider** on the payment. It asks Paystack now and applies the answer: the order goes to the restaurant, or the payment is marked failed. The worker also does this automatically within minutes (§4). If Paystack shows no successful charge, the customer didn't complete payment; they can retry from the app |
| Online order still unpaid after 30 minutes | Customer abandoned checkout | The worker cancels it automatically ("Payment was not completed in time") and releases any promo. If they pay later anyway, it's refunded automatically. No action needed |
| Order stuck at PLACED, paid | Restaurant hasn't responded | The restaurant has 10 minutes (Business rules), then the order is declined automatically and refunded. Phone the restaurant if it's urgent; cancel with a reason if the customer asks |
| "Finding a rider" for a long time | No free rider nearby; all declined; riders at their cash limit | **Dispatch** board: see who's online and free; **Assign** a rider (with a reason). After 10 minutes with no taker, the order is flagged and a `dispatch.unassigned_alert` entry is written. Riders at their cash limit only get online-paid jobs until they hand cash in (§6) |
| Rider can't complete: PIN locked after 5 wrong attempts | Wrong PIN given, or a fraud attempt | Phone the customer. If the food was handed over, use **Confirm delivered** with a clear reason (and the cash amount for cash orders). This is a proof override, audited as `delivery.proof_override` |
| `DELIVERY_EXCEPTION` | Rider reported a problem after pickup (accident, customer unreachable) | Phone the rider and the customer. Then either **Retry delivery** (same or a new rider) or **Cancel** with a reason. A paid order is refunded through the normal refund approval |
| Restaurant says it never saw the order | Unpaid online orders are hidden until paid; the restaurant was paused or closed | Check the Money section: a restaurant only sees an online order once one of its payments is SUCCESSFUL. Then check the restaurant was approved, accepting orders and open at that time |
| Customer wants to cancel after acceptance | Customers can only cancel while PLACED | Operations: **Cancel** with a reason. A paid order gets a refund request, which finance approves |

Never set an order's status any other way: the dashboard actions keep the order, delivery, cash and ledger consistent.

## 4. Payment discrepancies
### How payments become final
A payment attempt (`CN-XXXXXX-n`) is created when the customer taps Pay. It becomes final through whichever comes first:
1. **Paystack's webhook**, signature-verified and processed once even when Paystack retries.
2. **The customer's in-app check** ("I've paid", or the return page).
3. **Check with provider** pressed by staff.
4. **The reconciliation sweep (worker).** It asks Paystack about every unconfirmed attempt: first after 3 minutes, then every 15 minutes for an hour, hourly to 6 hours, every 6 hours up to 48 hours.

All four apply the same rules in one transaction, so it doesn't matter which wins or how often they run:

| Paystack says | ChopNow does |
|---|---|
| Success, right amount, order open | Order paid; sent to the restaurant; ledger: provider clearing → customer funds |
| Success, but the order was already cancelled or declined | Payment kept on record; order `REFUND_PENDING`; full refund request for finance |
| Success, wrong amount (`AMOUNT_MISMATCH`) | Not applied to the order; money booked as owed back; refund request; audited `payment.amount_mismatch` |
| Success, but the order was already paid by another attempt (`DUPLICATE_CHARGE`) | Same as above; audited `payment.duplicate_charge` |
| Failed or abandoned | Attempt marked; the customer can try again |
| Pending | Nothing yet; asked again later |

### When the numbers don't match
1. **Find the order.** Admin → Orders, by code; the payment reference starts with the order code.
2. **Compare with Paystack.** In the Paystack dashboard (Transactions), search the reference and compare its status and amount with the order page's Money section.
3. **Act on what you find:**

   | Paystack | ChopNow | Action |
   |---|---|---|
   | Successful | Unpaid | Press **Check with provider**. If it still disagrees, escalate to engineering with the reference and request id |
   | Not successful | Paid | Should be impossible: ChopNow only marks a payment paid after Paystack confirms it, and records the provider's transaction id. Escalate immediately and don't refund until engineering has looked |
   | Successful twice | Paid once | The second charge is booked as a duplicate and refunded once finance approves (Refunds, reason "Duplicate payment…") |
   | Webhooks failing | n/a | Paystack dashboard → Webhooks shows delivery failures. Common causes: wrong webhook URL; the wrong key (the key in ChopNow must match the dashboard's mode, test or live); a firewall blocking Paystack's IPs. The sweep covers the gap meanwhile, but fix the cause |

4. **Ledger check.** Admin → Finance summary shows the **trial balance**, which must be balanced. The provider-clearing balance should match money Paystack holds that hasn't yet been settled to the ChopNow bank account. Investigate any unexplained difference before running settlements.

Every automatic correction writes an audit entry: Admin → Audit log, filter by `payment.`.

## 5. Refunds
- **Created automatically:** for paid orders that are cancelled, declined or timed out; for duplicate or mismatched charges; and for payments that arrive after an order closed.
- **Requested by staff:** support or operations, from the order (complaints, partial refunds). For delivered orders, choose who bears the cost (`chargeTo`: ChopNow or the restaurant).
- **Approved by finance** (Refunds), by someone other than the requester. ChopNow then calls Paystack:
  - **SUCCESSFUL:** done; the customer is notified.
  - **PROCESSING:** Paystack is still working on it. The worker re-checks every 2 minutes, and a refund webhook also triggers a re-check.
  - **FAILED:** use **Retry**. If Paystack can't refund (old card, closed account), pay the customer by bank transfer, then use **Mark paid** with the transfer reference.
- **Cash orders** are refunded by bank transfer outside Paystack, then **Mark paid**.
- A refund can never exceed what was paid minus earlier refunds; the API enforces this.

## 6. Rider cash
Cash collected at delivery is the rider's to hand in.
- **Rider cash** shows each rider's outstanding balance.
- A rider at the limit (₦30,000 by default, set in Business rules) gets only online-paid offers until they hand cash in.
- The rider transfers the cash to the ChopNow account and declares it in the app (amount and reference). Finance checks the bank statement, then **Confirm** (allocated to the oldest cash first) or **Reject** with a reason.
- Never confirm a declaration without seeing the money arrive.

## 7. Settlements and payouts (weekly, Lagos dates)
1. **Generate settlements** for a period that has ended (Settlements & payouts → Generate). Each restaurant's and rider's net equals its ledger balance; refunds charged to a restaurant after its last payout carry forward.
2. Review the breakdown (orders, gross, commission, discounts, refunds, carried amounts), then **Approve**.
3. **Start payout.** This records a payout reference (`PO-…`) to quote on the bank transfer. ChopNow does **not** move money automatically: finance makes the bank transfer.
4. **Complete** with the bank's transfer reference, or **Fail**, then start again.

Restaurants see approved statements in the vendor portal, and riders in the app; drafts are hidden from them.

## 8. Accounts and access
- **First administrator:** DEPLOYMENT.md §2 step 9.
- **New staff:** Customers & staff → Add staff member. The one-time password is shown **once**; send it through a separate channel, and it must be changed at first sign-in.
- **Leavers:** suspend the account the same day. Their sessions stop working immediately.
- **Suspected account compromise:** suspend the user. If it's a staff account, also review the Audit log filtered by that person.
- **Locked accounts** (5 wrong passwords) unlock automatically after 15 minutes.
- **Restaurant and rider approval** (Restaurants, Riders): check the documents (signed links expire after 5 minutes, and every view is audited), the location and the hours, then Approve, or Reject with a note the applicant sees.

## 9. Business rules
Admin → Business rules (admin only, audited). Changes apply to new orders immediately; existing orders keep the prices they were placed with.

The settings cover:
- fees and commission;
- cash-on-delivery caps;
- dispatch timings;
- the restaurant's accept time;
- the unpaid-order timeout (30 min);
- delivery radius.

Announce a fee change to restaurants before making it.

## 10. Incidents
1. **Assess.** Is it ordering, payments, dispatch or a single customer? Check `/ready`, Sentry and the Paystack status page.
2. **Contain.**
   - **Payments broken:** pause online payment by turning off restaurants' "Accepting orders" if needed. There is no global switch in v1; cash on delivery keeps working. *(confirm whether a global maintenance switch is wanted)*
   - **Dispatch broken:** the Dispatch board lets operations assign riders by hand.
   - **Database saturated** (`SERVER_BUSY`): scale the web instances down rather than up if the database connection limit is the bottleneck, or raise the database tier.
3. **Communicate.** Tell restaurants and riders through your usual channel, and customers in-app if it's prolonged.
4. **Recover.** Restore service first. The reconciliation sweep then settles any payment caught mid-incident; check Refunds and Rider cash afterwards.
5. **Review.** Write up the timeline from the audit log, request ids and Sentry.

## 11. Backups and data
- **Backups:** the managed database's automated backups with point-in-time recovery, retained for at least 14 days. **Test a restore into a scratch database before launch, then quarterly.**
- **Storage:** turn on bucket versioning for the private (documents) bucket.
- **Personal data:**
  - Customer addresses and phones are visible only to the customer, the assigned rider (after acceptance) and staff.
  - Verification documents are opened only through 5-minute signed links, and each view is audited.
  - Delivery PINs are never shown to restaurants, support staff, notifications or logs. Operations can see the PIN on the order page, to help a stuck delivery.
- **Restoring:** a full restore loses everything since the restore point. Afterwards, reconcile payments with Paystack for that window (§4); the sweep looks back 48 hours, so re-check older ones by hand.
