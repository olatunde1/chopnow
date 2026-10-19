import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Ban, CheckCheck, RefreshCw, RotateCcw, Undo2 } from 'lucide-react';
import { Facts, ReasonDialog, Status, useAction } from '../components/admin';
import { Badge, Button, Card, ErrorState, LoadingBlock, Money, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { pollEvery, useRealtimeStatus } from '../lib/realtime';
import { dateTime, nairaToKobo } from '../lib/format';
import { useSession } from '../state/session';
import { ACCOUNT } from './FinancePages';

const EVENT_LABEL = {
  DISPATCH_STARTED: 'Looking for a rider', OFFERED: 'Offered to rider', OFFER_EXPIRED: 'Offer expired', DECLINED: 'Rider declined', ACCEPTED: 'Rider accepted',
  ARRIVED_AT_RESTAURANT: 'Rider at restaurant', PICKED_UP: 'Picked up', DELIVERED: 'Delivered (PIN)', DELIVERED_BY_OVERRIDE: 'Delivered (confirmed by staff)', RELEASED: 'Rider handed it back',
  PROBLEM_REPORTED: 'Problem reported', RETRY_SAME_RIDER: 'Retry with same rider', REDISPATCHED: 'Sent back to dispatch', ASSIGNED_BY_STAFF: 'Assigned by staff', UNASSIGNED_BY_STAFF: 'Taken back by staff', CANCELLED: 'Delivery cancelled',
};

export function OrderDetailPage() {
  const live = useRealtimeStatus();
  const { orderId } = useParams();
  const q = useQuery({ queryKey: ['admin-order', orderId], queryFn: () => api.orders.get(orderId), refetchInterval: pollEvery(live, 15_000) });
  const { run, busy } = useAction();
  const { can } = useSession();
  const [dialog, setDialog] = useState(null);
  const refresh = [['admin-order', orderId], ['admin-orders'], ['dashboard']];

  if (q.isPending) return <LoadingBlock label="Loading order" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const o = q.data;
  const has = (a) => o.actions.includes(a);
  const addr = o.deliveryAddress;
  const d = o.delivery;

  return (
    <>
      <Link to="/orders" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-brand">
        <ArrowLeft className="size-4" aria-hidden /> Orders
      </Link>
      <PageHeader
        title={`Order ${o.code}`}
        description={`${o.restaurantName} · placed ${dateTime(o.placedAt)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {has('retry_delivery') ? <Button icon={RotateCcw} onClick={() => setDialog('retry')}>Retry delivery</Button> : null}
            {has('confirm_delivered') ? <Button variant="secondary" icon={CheckCheck} onClick={() => setDialog('confirm')}>Confirm delivered</Button> : null}
            {has('request_refund') ? <Button variant="outline" icon={Undo2} onClick={() => setDialog('refund')}>Request refund</Button> : null}
            {has('cancel') ? <Button variant="danger" icon={Ban} onClick={() => setDialog('cancel')}>Cancel order</Button> : null}
          </div>
        }
      />
      <div className="mb-5 flex flex-wrap gap-2">
        <Status value={o.status} />
        {o.deliveryStatus ? <Status value={o.deliveryStatus} /> : null}
        <Badge>{o.paymentMethod === 'ONLINE' ? 'Paid online' : 'Cash on delivery'}</Badge>
        <Status value={o.paymentStatus} kind="payment" />
        {o.needsAttention ? <Badge tone="bad">Needs attention</Badge> : null}
      </div>
      {o.cancellationReason ? <p className="mb-5 rounded-xl bg-bad-soft p-3 text-sm text-bad">{o.cancellationReason}</p> : null}
      {d?.failureReason ? <p className="mb-5 rounded-xl bg-bad-soft p-3 text-sm text-bad">Rider reported: {d.failureReason}</p> : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
          <Card>
            <h2 className="mb-3 text-lg font-bold">Items</h2>
            <ul className="divide-y divide-line">
              {o.items.map((i, idx) => (
                <li key={idx} className="flex justify-between gap-3 py-2">
                  <span>
                    {i.quantity}× {i.name}
                    {i.variantName ? ` (${i.variantName})` : ''}
                    {i.extras.length ? <span className="block text-sm text-ink-muted">+ {i.extras.join(', ')}</span> : null}
                    {i.specialInstructions ? <span className="block text-sm text-warn">“{i.specialInstructions}”</span> : null}
                  </span>
                  <Money kobo={i.lineTotalKobo} />
                </li>
              ))}
            </ul>
            <dl className="mt-3 grid grid-cols-2 gap-1 border-t border-line pt-3 text-sm">
              {[
                ['Food', o.subtotalKobo], ['Delivery fee', o.deliveryFeeKobo], ['Service fee', o.serviceFeeKobo],
                ...(o.discountKobo ? [[`Discount${o.promotionCode ? ` (${o.promotionCode})` : ''}`, -o.discountKobo]] : []),
              ].map(([l, v]) => (
                <div key={l} className="contents">
                  <dt className="text-ink-muted">{l}</dt>
                  <dd className="text-right"><Money kobo={v} /></dd>
                </div>
              ))}
              <dt className="font-bold">Total</dt>
              <dd className="text-right font-bold"><Money kobo={o.totalKobo} /></dd>
              <dt className="text-ink-muted">Commission · rider earning</dt>
              <dd className="text-right text-ink-muted"><Money kobo={o.commissionKobo} /> · <Money kobo={o.riderEarningKobo} /></dd>
            </dl>
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-bold">Timeline</h2>
            <ol className="flex flex-col gap-2 text-sm">
              {o.timeline.map((h, idx) => (
                <li key={idx} className="flex flex-wrap gap-x-3">
                  <span className="w-36 shrink-0 text-ink-muted">{dateTime(h.at)}</span>
                  <Status value={h.to} />
                  <span className="text-ink-muted">{h.actorRole?.toLowerCase()}</span>
                  {h.reason ? <span className="basis-full pl-39 text-ink-muted sm:basis-auto sm:pl-0">“{h.reason}”</span> : null}
                </li>
              ))}
            </ol>
          </Card>

          {d ? (
            <Card>
              <h2 className="mb-3 text-lg font-bold">Delivery</h2>
              <Facts
                rows={[
                  ['Rider', d.rider ? `${d.rider.fullName} (${d.rider.vehicleType.toLowerCase()})` : 'None yet'],
                  ['Rider phone', d.rider?.phone],
                  ['Offers made', d.offersMade],
                  ['Wrong PIN attempts', d.pinFailedAttempts],
                  ['Proof override', d.proofOverrideReason],
                  ['Operations alerted', d.dispatchAlertAt ? dateTime(d.dispatchAlertAt) : null],
                ]}
              />
              <ol className="mt-4 flex flex-col gap-1.5 border-t border-line pt-3 text-sm">
                {d.events.map((e, idx) => (
                  <li key={idx} className="flex flex-wrap gap-x-3">
                    <span className="w-36 shrink-0 text-ink-muted">{dateTime(e.at)}</span>
                    <span className="font-semibold">{EVENT_LABEL[e.type] ?? e.type}</span>
                    {e.riderName ? <span className="text-ink-muted">{e.riderName}</span> : null}
                    {e.note ? <span className="text-ink-muted">· {e.note}</span> : null}
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
          {o.financialHistory ? <FinancialHistory h={o.financialHistory} /> : null}
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <h2 className="mb-3 text-lg font-bold">Customer</h2>
            <Facts rows={[['Name', o.customer.fullName], ['Email', o.customer.email], ['Phone', o.customer.phone], ['Delivery PIN', o.deliveryPin ? <span className="font-mono text-lg font-bold tracking-widest">{o.deliveryPin}</span> : 'Hidden for your role']]} />
            <h3 className="mb-2 mt-4 font-bold">Address</h3>
            <p className="text-sm">
              {[addr.line1, addr.line2, addr.area, addr.city].filter(Boolean).join(', ')}
              {addr.landmark ? <span className="block text-ink-muted">Landmark: {addr.landmark}</span> : null}
              {addr.contactPhone ? <span className="block text-ink-muted">Contact: {addr.contactPhone}</span> : null}
            </p>
            {o.customerNote ? <p className="mt-2 text-sm text-ink-muted">Note: {o.customerNote}</p> : null}
          </Card>
          <Card>
            <h2 className="mb-3 text-lg font-bold">Restaurant</h2>
            <Facts rows={[['Name', o.restaurant.name], ['Phone', o.restaurant.phone], ['Area', o.restaurant.area]]} />
          </Card>
          <Card>
            <h2 className="mb-3 text-lg font-bold">Money</h2>
            {o.payments.map((p) => (
              <p key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono">{p.reference}</span> <Status value={p.status} kind="payment" /> <Money kobo={p.amountKobo} />
                {p.provider === 'MOCK' ? <Badge tone="warn">Test</Badge> : null}
                {p.failureReason ? <span className="text-bad">{p.failureReason.toLowerCase().replace(/_/g, ' ')}</span> : null}
                {p.status !== 'SUCCESSFUL' && can('payment.read') ? (
                  <Button variant="ghost" size="sm" icon={RefreshCw} disabled={busy} aria-label={`Check payment ${p.reference} with the provider`} onClick={() => run(() => api.orders.checkPayment(p.reference), { success: (r) => r.message, invalidate: refresh })}>
                    Check with provider
                  </Button>
                ) : null}
              </p>
            ))}
            {o.cash ? <p className="text-sm">Cash: <Money kobo={o.cash.collectedKobo} /> of <Money kobo={o.cash.dueKobo} /> · {o.cash.status.toLowerCase().replace(/_/g, ' ')} · {o.cash.reconciliationStatus.toLowerCase().replace(/_/g, ' ')}</p> : null}
            {o.refunds.length ? (
              <ul className="mt-2 flex flex-col gap-1 border-t border-line pt-2 text-sm">
                {o.refunds.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    Refund <Money kobo={r.amountKobo} /> <Status value={r.status} /> <span className="text-ink-muted">{r.reason}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        </div>
      </div>

      <ReasonDialog
        open={dialog === 'cancel'}
        title={`Cancel ${o.code}?`}
        message={o.paymentStatus === 'SUCCESSFUL' ? 'The customer paid online: a full refund request will be created for finance to approve.' : 'The customer and restaurant will see it as cancelled.'}
        confirmLabel="Cancel order"
        destructive
        onClose={() => setDialog(null)}
        onSubmit={({ reason }) => run(() => api.orders.cancel(o.id, reason), { success: 'Order cancelled', invalidate: refresh })}
      />
      <ReasonDialog
        open={dialog === 'retry'}
        title="Retry the delivery"
        fields={[{ name: 'mode', label: 'How', type: 'select', required: true, options: [['SAME_RIDER', `Same rider tries again${d?.rider ? ` (${d.rider.fullName})` : ''}`], ['NEW_RIDER', 'Find a new rider (food is back at the restaurant)']] }]}
        confirmLabel="Retry"
        onClose={() => setDialog(null)}
        onSubmit={({ mode, reason }) => run(() => api.orders.retryDelivery(o.id, mode, reason), { success: 'Delivery restarted', invalidate: refresh })}
      />
      <ReasonDialog
        open={dialog === 'confirm'}
        title="Confirm delivered without the PIN"
        message="Only when you are sure the customer received the food (e.g. confirmed by phone). This is recorded as a proof override."
        fields={o.cash ? [{ name: 'cash', label: 'Cash the rider received (₦)', type: 'number', required: true, hint: `Amount due: ₦${(o.cash.dueKobo / 100).toLocaleString('en-NG')}` }] : []}
        confirmLabel="Confirm delivered"
        onClose={() => setDialog(null)}
        onSubmit={({ reason, cash }) => {
          const kobo = o.cash ? nairaToKobo(cash) : undefined;
          if (o.cash && kobo === null) return { ok: false, message: 'Enter the cash amount in naira, e.g. 5750' };
          return run(() => api.orders.confirmDelivered(o.id, reason, kobo), { success: 'Marked as delivered', invalidate: refresh });
        }}
      />
      <ReasonDialog
        open={dialog === 'refund'}
        title="Request a refund"
        message="Finance approves refunds. A different person must approve a refund you request."
        fields={[
          { name: 'amount', label: 'Amount (₦)', type: 'number', required: true },
          ...(o.status === 'DELIVERED' ? [{ name: 'chargeTo', label: 'Suggested to be borne by', type: 'select', options: [['RESTAURANT', 'The restaurant (deducted at settlement)'], ['PLATFORM', 'ChopNow']] }] : []),
        ]}
        reasonLabel="Reason (shown to finance; audited)"
        confirmLabel="Send to finance"
        onClose={() => setDialog(null)}
        onSubmit={({ amount, chargeTo, reason }) => {
          const kobo = nairaToKobo(amount);
          if (!kobo) return { ok: false, message: 'Enter the amount in naira, e.g. 1500' };
          return run(() => api.orders.requestRefund(o.id, { amountKobo: kobo, reason, ...(chargeTo ? { chargeTo } : {}) }), { success: 'Refund requested', invalidate: refresh });
        }}
      />
    </>
  );
}

const JOURNAL = { ONLINE_PAYMENT_CAPTURED: 'Payment received', CASH_COLLECTED: 'Cash collected by rider', ORDER_SETTLED: 'Order split on delivery', REFUND: 'Refund', CASH_REMITTED: 'Cash handed in', PAYOUT: 'Payout', ADJUSTMENT: 'Adjustment' };

/** The order's ledger journals (append-only), the money split and the settlements covering it. */
function FinancialHistory({ h }) {
  return (
    <Card>
      <h2 className="mb-3 text-lg font-bold">Financial history</h2>
      {h.split ? (
        <dl className="mb-4 grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">
          {[['Restaurant receives', h.split.restaurantKobo], ['Rider earns', h.split.riderKobo], ['ChopNow revenue', h.split.platformRevenueKobo], ['Promotion cost', h.split.platformPromotionCostKobo]].map(([l, v]) => (
            <div key={l} className="rounded-xl bg-surface-muted p-2">
              <dt className="text-ink-muted">{l}</dt>
              <dd className="font-bold"><Money kobo={v} /></dd>
            </div>
          ))}
        </dl>
      ) : <p className="mb-3 text-sm text-ink-muted">Not split yet: the order hasn’t been delivered.</p>}
      <p className="mb-3 text-sm">
        Restaurant settlement: {h.restaurantSettlement ? <><Status value={h.restaurantSettlement.status} /> {h.restaurantSettlement.from} – {h.restaurantSettlement.to}</> : 'not settled yet'}
        {' · '}Rider settlement: {h.riderSettlement ? <><Status value={h.riderSettlement.status} /> {h.riderSettlement.from} – {h.riderSettlement.to}</> : 'not settled yet'}
      </p>
      {h.journals.length === 0 ? <p className="text-sm text-ink-muted">No money has moved for this order.</p> : (
        <ol className="flex flex-col gap-3">
          {h.journals.map((j) => (
            <li key={j.id} className="rounded-xl border border-line p-3 text-sm">
              <p className="flex flex-wrap gap-x-2"><span className="font-semibold">{JOURNAL[j.type] ?? j.type}</span><span className="text-ink-muted">{dateTime(j.at)}</span></p>
              <p className="mb-2 text-ink-muted">{j.description}</p>
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ink-muted"><th className="font-semibold">Account</th><th className="text-right font-semibold">Debit</th><th className="text-right font-semibold">Credit</th></tr></thead>
                <tbody>
                  {j.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{ACCOUNT[l.account] ?? l.account}{l.party ? ` · ${l.party}` : ''}</td>
                      <td className="text-right">{l.direction === 'DEBIT' ? <Money kobo={l.amountKobo} /> : ''}</td>
                      <td className="text-right">{l.direction === 'CREDIT' ? <Money kobo={l.amountKobo} /> : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
