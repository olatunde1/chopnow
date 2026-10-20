import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertTriangle, Bike, ChefHat, Clock, PackageCheck, Store } from 'lucide-react';
import { Card, ErrorState, LoadingBlock, Money, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { pollEvery, useRealtimeStatus } from '../lib/realtime';
import { useSession } from '../state/session';

function Tile({ label, value, to, tone, icon: Icon }) {
  const body = (
    <Card className={`flex h-full items-center gap-3 ${tone === 'bad' && value ? 'border-bad bg-bad-soft' : tone === 'warn' && value ? 'border-warn bg-warn-soft' : ''}`}>
      {Icon ? <Icon className="size-5 shrink-0 text-ink-muted" aria-hidden /> : null}
      <div className="min-w-0">
        <p className="text-sm text-ink-muted">{label}</p>
        <p className="text-2xl font-extrabold">{value}</p>
      </div>
    </Card>
  );
  return to ? (
    <Link to={to} className="rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  );
}

export function DashboardPage() {
  const connection = useRealtimeStatus();
  const { can } = useSession();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard, refetchInterval: pollEvery(connection, 15_000) });
  if (q.isPending) return <LoadingBlock label="Loading dashboard" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const { today, live, queues } = q.data;
  const orders = (params) => (can('order.read.any') ? `/orders?${new URLSearchParams(params)}` : undefined);

  return (
    <>
      <PageHeader title="Dashboard" description="Refreshes every 15 seconds. Nigeria time (WAT)." />
      <h2 className="mb-3 text-lg font-bold">Needs attention now</h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Delivery problems" value={live.exceptions} tone="bad" icon={AlertTriangle} to={orders({ status: 'DELIVERY_EXCEPTION' })} />
        <Tile label="No rider after 10 min" value={live.dispatchAlerts} tone="bad" icon={Bike} to={can('dispatch.manage') ? '/dispatch' : undefined} />
        <Tile label="Waiting for a rider" value={live.awaitingRider} tone="warn" icon={Clock} to={can('dispatch.manage') ? '/dispatch' : undefined} />
        <Tile label="Waiting for restaurant" value={live.awaitingRestaurant} tone="warn" icon={Store} to={orders({ status: 'PLACED' })} />
      </div>

      <h2 className="mb-3 text-lg font-bold">Live</h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="In the kitchen" value={live.inKitchen} icon={ChefHat} />
        <Tile label="On the way" value={live.onTheWay} icon={PackageCheck} />
        <Tile label="Riders online" value={live.ridersOnline} />
        <Tile label="Riders on a job" value={live.ridersBusy} />
        <Tile label="Restaurants open" value={live.restaurantsOpen} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-lg font-bold">Today</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-ink-muted">Orders placed</dt>
            <dd className="text-right font-semibold">{today.ordersPlaced}</dd>
            <dt className="text-ink-muted">Delivered</dt>
            <dd className="text-right font-semibold">{today.ordersDelivered}</dd>
            <dt className="text-ink-muted">Cancelled or declined</dt>
            <dd className="text-right font-semibold">{today.ordersCancelled}</dd>
            <dt className="text-ink-muted">Value of delivered orders</dt>
            <dd className="text-right font-semibold">
              <Money kobo={today.grossOrderValueKobo} />
            </dd>
            <dt className="text-ink-muted">Average order-to-door time</dt>
            <dd className="text-right font-semibold">{today.averageDeliveryMinutes === null ? '—' : `${today.averageDeliveryMinutes} min`}</dd>
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-bold">Work queues</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {[
              ['Restaurants to approve', queues.restaurantApprovals, can('restaurant.approve') ? '/restaurants?status=PENDING' : null],
              ['Riders to approve', queues.riderApprovals, can('rider.approve') ? '/riders?status=PENDING' : null],
              ['Documents to review', queues.documentsToReview, can('restaurant.approve') ? '/restaurants?status=PENDING' : null],
              ['Refund requests', queues.refundRequests, can('payment.read') ? '/refunds?status=REQUESTED' : null],
              ['Cash hand-ins to confirm', queues.remittancesToConfirm, can('cash.reconcile') ? '/cash' : null],
            ].map(([label, n, to]) => (
              <li key={label} className="flex items-center justify-between gap-3">
                {to ? (
                  <Link to={to} className="font-semibold text-brand underline-offset-2 hover:underline">
                    {label}
                  </Link>
                ) : (
                  <span>{label}</span>
                )}
                <span className={`min-w-8 rounded-full px-2 text-center font-bold ${n ? 'bg-brand text-white' : 'bg-surface-muted'}`}>{n}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
