import { useEffect, useState } from 'react';
import { AlarmClock, Banknote, Bike, Check, ChefHat, Clock, CreditCard, PackageCheck, X } from 'lucide-react';
import { orderStatus, time } from '../lib/format';
import { Badge, Button, Money } from './ui';

/** Seconds left before an incoming order is auto-declined (null when not applicable). */
export function useCountdown(deadlineIso) {
  const secondsLeft = () => Math.max(0, Math.round((Date.parse(deadlineIso) - Date.now()) / 1000));
  const [left, setLeft] = useState(() => (deadlineIso ? secondsLeft() : null));
  useEffect(() => {
    if (!deadlineIso) {
      setLeft(null);
      return undefined;
    }
    const tick = () => setLeft(Math.max(0, Math.round((Date.parse(deadlineIso) - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [deadlineIso]);
  return left;
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * One order on the kitchen board. Buttons are shown from the API's `actions` list; the API
 * enforces the same rules regardless.
 */
export function OrderCard({ order, onAction, busyAction }) {
  const status = orderStatus(order.status);
  const left = useCountdown(order.status === 'PLACED' ? order.acceptDeadlineAt : null);
  const has = (a) => order.actions.includes(a);
  const urgent = left !== null && left <= 120;

  return (
    <article
      aria-label={`Order ${order.code}, ${status.label}`}
      className={`flex flex-col gap-3 rounded-2xl border bg-surface p-4 shadow-sm ${order.status === 'PLACED' ? 'border-brand' : 'border-line'}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-extrabold tracking-wide">{order.code}</h3>
        <Badge tone={status.tone}>{status.label}</Badge>
        <Badge tone="neutral" icon={order.paymentMethod === 'ONLINE' ? CreditCard : Banknote}>
          {order.paymentMethod === 'ONLINE' ? 'Paid online' : 'Cash on delivery'}
        </Badge>
        <span className="ml-auto text-sm text-ink-muted">{time(order.placedAt)}</span>
      </header>

      {left !== null ? (
        <p role="timer" aria-live={urgent ? 'assertive' : 'off'} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${urgent ? 'bg-bad-soft text-bad' : 'bg-warn-soft text-warn'}`}>
          <AlarmClock className="size-4" aria-hidden />
          {left > 0 ? `Accept within ${mmss(left)} or it will be declined automatically` : 'Time to accept has passed'}
        </p>
      ) : null}

      <p className="text-sm text-ink-muted">
        For <span className="font-semibold text-ink">{order.customerFirstName}</span>
        {order.estimatedReadyAt ? (
          <>
            {' '}
            · <Clock className="inline size-3.5" aria-hidden /> ready by <span className="font-semibold text-ink">{time(order.estimatedReadyAt)}</span>
          </>
        ) : null}
      </p>
      {order.rider ? (
        <p className="flex items-center gap-2 text-sm">
          <Bike className="size-4 text-info" aria-hidden />
          Rider <span className="font-semibold">{order.rider.firstName}</span> {order.deliveryStatus === 'ARRIVED_AT_RESTAURANT' ? 'is here' : 'is on the way'}
        </p>
      ) : order.deliveryStatus === 'OFFERING' ? (
        <p className="text-sm text-ink-muted">Finding a rider…</p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {order.items.map((i, idx) => (
          <li key={idx} className="flex gap-3">
            <span className="min-w-8 rounded-lg bg-surface-muted px-2 py-0.5 text-center font-bold">{i.quantity}×</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold break-words">
                {i.name}
                {i.variantName ? <span className="font-normal text-ink-muted"> · {i.variantName}</span> : null}
              </p>
              {i.extras.length ? <p className="text-sm text-ink-muted">+ {i.extras.map((e) => (e.quantity > 1 ? `${e.quantity}× ${e.name}` : e.name)).join(', ')}</p> : null}
              {i.specialInstructions ? <p className="text-sm font-semibold text-warn">“{i.specialInstructions}”</p> : null}
            </div>
          </li>
        ))}
      </ul>
      {order.customerNote ? <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm">Note: {order.customerNote}</p> : null}

      <footer className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <span className="mr-auto text-sm text-ink-muted">
          Food <Money kobo={order.subtotalKobo} className="font-semibold text-ink" /> · you receive ≈ <Money kobo={order.estimatedEarningsKobo} className="font-semibold text-ink" />
        </span>
        {has('reject') ? (
          <Button variant="outline" size="sm" icon={X} onClick={() => onAction('reject', order)} disabled={!!busyAction}>
            Decline
          </Button>
        ) : null}
        {has('accept') ? (
          <Button size="sm" icon={Check} onClick={() => onAction('accept', order)} loading={busyAction === 'accept'}>
            Accept
          </Button>
        ) : null}
        {has('report_delay') ? (
          <Button variant="ghost" size="sm" icon={Clock} onClick={() => onAction('delay', order)} disabled={!!busyAction}>
            Running late
          </Button>
        ) : null}
        {has('start_preparing') ? (
          <Button variant="secondary" size="sm" icon={ChefHat} onClick={() => onAction('start_preparing', order)} loading={busyAction === 'start_preparing'}>
            Start preparing
          </Button>
        ) : null}
        {has('mark_ready') ? (
          <Button size="sm" icon={PackageCheck} onClick={() => onAction('mark_ready', order)} loading={busyAction === 'mark_ready'}>
            Ready for pickup
          </Button>
        ) : null}
      </footer>
    </article>
  );
}
