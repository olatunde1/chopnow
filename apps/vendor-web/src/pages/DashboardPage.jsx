import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowRight, BellRing, ChefHat, Star, TrendingUp } from 'lucide-react';
import { useIncomingCount } from '../components/AppShell';
import { Badge, Card, ErrorState, Money, PageHeader, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { APPROVAL, lagosToday } from '../lib/format';
import { useSession } from '../state/session';

function Stat({ icon: Icon, label, value, to, tone = 'text-ink' }) {
  const body = (
    <Card className="flex h-full items-center gap-4">
      <span className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-sm text-ink-muted">{label}</p>
        <p className={`text-2xl font-extrabold ${tone}`}>{value}</p>
      </div>
      {to ? <ArrowRight className="ml-auto size-5 text-ink-muted" aria-hidden /> : null}
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
  const { restaurant } = useSession();
  const today = lagosToday();
  const incoming = useIncomingCount(restaurant.id);
  const active = useQuery({
    queryKey: ['orders', restaurant.id, 'active', 'count'],
    // 'active' also includes new orders; count only accepted ones (kitchen + waiting for pickup).
    queryFn: async () => {
      const res = await api.orders.list(restaurant.id, { view: 'active', pageSize: 1 });
      return res.total - res.incomingCount;
    },
    refetchInterval: 30_000,
  });
  const sales = useQuery({ queryKey: ['sales', restaurant.id, today, today], queryFn: () => api.reports.sales(restaurant.id, today, today) });
  const approval = APPROVAL[restaurant.verificationStatus] ?? { label: restaurant.verificationStatus, tone: 'neutral' };
  const pending = (q) => (q.isPending ? <Skeleton className="h-8 w-16" /> : q.isError ? '—' : null);

  return (
    <>
      <PageHeader title={`Hello, ${restaurant.name}`} description="Today at a glance (Lagos time)." />

      {restaurant.verificationStatus !== 'APPROVED' ? (
        <Card className="mb-5 flex flex-wrap items-center gap-3 border-warn bg-warn-soft">
          <Badge tone={approval.tone}>{approval.label}</Badge>
          <p className="flex-1 text-sm">Customers can’t see your restaurant until it’s approved. Finish your profile to speed up review.</p>
          <Link to="/restaurant" className="font-semibold text-brand underline">
            Complete profile
          </Link>
        </Card>
      ) : !restaurant.isAcceptingOrders ? (
        <Card className="mb-5 border-warn bg-warn-soft text-sm">You’re paused: customers can browse but can’t order. Switch “Accepting orders” on when you’re ready.</Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={BellRing} label="New orders waiting" value={pending(incoming) ?? incoming.data} to="/orders" tone={incoming.data ? 'text-brand' : 'text-ink'} />
        <Stat icon={ChefHat} label="In progress" value={pending(active) ?? active.data} to="/orders" />
        <Stat icon={TrendingUp} label="Food sales today" value={pending(sales) ?? <Money kobo={sales.data.grossFoodSalesKobo} />} to="/reports" />
        <Stat icon={Star} label="Rating" value={restaurant.ratingAverage ? `${restaurant.ratingAverage.toFixed(1)} ★` : '—'} to="/reviews" />
      </div>

      {sales.isError ? (
        <div className="mt-5">
          <ErrorState error={sales.error} onRetry={sales.refetch} />
        </div>
      ) : sales.data ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-lg font-bold">Today</h2>
            <dl className="grid grid-cols-2 gap-1 text-sm">
              <dt className="text-ink-muted">Delivered orders</dt>
              <dd className="text-right">{sales.data.deliveredOrders}</dd>
              <dt className="text-ink-muted">Cancelled / declined</dt>
              <dd className="text-right">{sales.data.cancelledOrders + sales.data.rejectedOrders}</dd>
              <dt className="text-ink-muted">ChopNow commission</dt>
              <dd className="text-right">
                −<Money kobo={sales.data.commissionKobo} />
              </dd>
              <dt className="font-semibold">Estimated earnings</dt>
              <dd className="text-right font-semibold">
                <Money kobo={sales.data.estimatedNetKobo} />
              </dd>
            </dl>
            <p className="mt-3 text-xs text-ink-muted">Estimates from delivered orders. Payout statements arrive with settlements.</p>
          </Card>
          <Card>
            <h2 className="mb-3 text-lg font-bold">Top dishes today</h2>
            {sales.data.topItems.length === 0 ? (
              <p className="text-sm text-ink-muted">No delivered orders yet today.</p>
            ) : (
              <ol className="flex flex-col gap-2 text-sm">
                {sales.data.topItems.slice(0, 5).map((i) => (
                  <li key={i.name} className="flex justify-between gap-3">
                    <span>
                      {i.quantity}× {i.name}
                    </span>
                    <Money kobo={i.salesKobo} />
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}
