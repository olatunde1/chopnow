import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Input, LoadingBlock, Money, PageHeader, Table } from '../components/ui';
import { api } from '../lib/api';
import { daysAgo, lagosToday, money } from '../lib/format';
import { useSession } from '../state/session';

export const PRESETS = [
  { label: 'Today', days: 0 },
  { label: 'Last 7 days', days: 6 },
  { label: 'Last 30 days', days: 29 },
];

/** Daily bars as a simple accessible chart: each bar is labelled with its value. */
function DailyBars({ days }) {
  const max = Math.max(1, ...days.map((d) => d.grossFoodSalesKobo));
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Food sales by day">
      {days.map((d) => (
        <li key={d.date} className="grid grid-cols-[88px_1fr_auto] items-center gap-3 text-sm">
          <span className="text-ink-muted">{new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
          <span className="h-3 overflow-hidden rounded-full bg-surface-muted">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${(d.grossFoodSalesKobo / max) * 100}%` }} />
          </span>
          <span className="min-w-24 text-right">
            {money(d.grossFoodSalesKobo)} <span className="text-ink-muted">· {d.orders}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ReportsPage() {
  const { restaurant } = useSession();
  const today = lagosToday();
  const [range, setRange] = useState({ from: daysAgo(today, 6), to: today });
  const [draft, setDraft] = useState(range);
  const report = useQuery({
    queryKey: ['sales', restaurant.id, range.from, range.to],
    queryFn: () => api.reports.sales(restaurant.id, range.from, range.to),
    placeholderData: (prev) => prev,
  });

  const choose = (r) => {
    setDraft(r);
    setRange(r);
  };

  return (
    <>
      <PageHeader title="Sales reports" description="Delivered orders only. Figures are estimates until payout statements are issued." />
      <Card className="mb-5 flex flex-wrap items-end gap-3">
        {PRESETS.map((p) => {
          const r = { from: daysAgo(today, p.days), to: today };
          const activePreset = r.from === range.from && r.to === range.to;
          return (
            <Button key={p.label} variant={activePreset ? 'primary' : 'outline'} size="sm" onClick={() => choose(r)} aria-pressed={activePreset}>
              {p.label}
            </Button>
          );
        })}
        <form
          className="ml-auto flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setRange(draft);
          }}
        >
          <Input label="From" type="date" value={draft.from} max={today} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <Input label="To" type="date" value={draft.to} max={today} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <Button type="submit" variant="secondary" disabled={!draft.from || !draft.to}>
            Show
          </Button>
        </form>
      </Card>

      {report.isPending ? (
        <LoadingBlock label="Loading report" />
      ) : report.isError ? (
        <ErrorState error={report.error} onRetry={report.refetch} />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Food sales', <Money key="g" kobo={report.data.grossFoodSalesKobo} />],
              ['Delivered orders', report.data.deliveredOrders],
              ['Average order', <Money key="a" kobo={report.data.averageOrderKobo} />],
              ['Estimated earnings', <Money key="n" kobo={report.data.estimatedNetKobo} />],
            ].map(([label, value]) => (
              <Card key={label}>
                <p className="text-sm text-ink-muted">{label}</p>
                <p className="text-2xl font-extrabold">{value}</p>
              </Card>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <Card>
              <h2 className="mb-3 text-lg font-bold">By day</h2>
              {report.data.deliveredOrders === 0 ? <EmptyState icon={BarChart3} title="No delivered orders in this period" /> : <DailyBars days={report.data.days} />}
            </Card>
            <Card>
              <h2 className="mb-3 text-lg font-bold">Breakdown</h2>
              <dl className="grid grid-cols-2 gap-1 text-sm">
                <dt className="text-ink-muted">Food sales</dt>
                <dd className="text-right">
                  <Money kobo={report.data.grossFoodSalesKobo} />
                </dd>
                <dt className="text-ink-muted">ChopNow commission</dt>
                <dd className="text-right">
                  −<Money kobo={report.data.commissionKobo} />
                </dd>
                <dt className="text-ink-muted">Discounts you funded</dt>
                <dd className="text-right">
                  {report.data.restaurantFundedDiscountKobo ? '−' : ''}
                  <Money kobo={report.data.restaurantFundedDiscountKobo} />
                </dd>
                <dt className="border-t border-line pt-1 font-semibold">Estimated earnings</dt>
                <dd className="border-t border-line pt-1 text-right font-semibold">
                  <Money kobo={report.data.estimatedNetKobo} />
                </dd>
                <dt className="mt-2 text-ink-muted">Cancelled</dt>
                <dd className="mt-2 text-right">{report.data.cancelledOrders}</dd>
                <dt className="text-ink-muted">Declined</dt>
                <dd className="text-right">{report.data.rejectedOrders}</dd>
              </dl>
            </Card>
          </div>

          <Card>
            <h2 className="mb-3 text-lg font-bold">Top dishes</h2>
            <Table
              columns={[
                { key: 'name', header: 'Dish', render: (i) => i.name },
                { key: 'qty', header: 'Sold', align: 'right', render: (i) => i.quantity },
                { key: 'sales', header: 'Sales', align: 'right', render: (i) => <Money kobo={i.salesKobo} /> },
              ]}
              rows={report.data.topItems}
              rowKey={(i) => i.name}
              empty={<p className="p-4 text-sm text-ink-muted">Nothing sold in this period.</p>}
            />
          </Card>
        </div>
      )}
    </>
  );
}
