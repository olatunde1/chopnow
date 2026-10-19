import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { AlertTriangle, ClipboardList, Search } from 'lucide-react';
import { FilterChips, Status, ago } from '../components/admin';
import { Card, EmptyState, ErrorState, LoadingBlock, Money, PageHeader, Pagination, Table } from '../components/ui';
import { api } from '../lib/api';
import { pollEvery, useRealtimeStatus } from '../lib/realtime';

const FILTERS = [
  ['', 'All'],
  ['attention', 'Needs attention'],
  ['PLACED', 'New'],
  ['PREPARING', 'Preparing'],
  ['READY_FOR_PICKUP', 'Ready'],
  ['PICKED_UP', 'On the way'],
  ['DELIVERY_EXCEPTION', 'Problems'],
  ['DELIVERED', 'Delivered'],
  ['CANCELLED', 'Cancelled'],
];

export function OrdersPage() {
  const live = useRealtimeStatus();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const filter = params.get('attention') === 'true' ? 'attention' : (params.get('status') ?? '');
  const page = Number(params.get('page') ?? 1);
  const [q, setQ] = useState(params.get('q') ?? '');
  const query = { page, pageSize: 25, ...(filter === 'attention' ? { attention: 'true' } : filter ? { status: filter } : {}), ...(params.get('q') ? { q: params.get('q') } : {}) };
  const list = useQuery({ queryKey: ['admin-orders', query], queryFn: () => api.orders.list(query), placeholderData: (p) => p, refetchInterval: pollEvery(live, 20_000) });

  const update = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  const columns = [
    { key: 'code', header: 'Order', render: (o) => <span className="flex items-center gap-1.5 font-bold">{o.needsAttention ? <AlertTriangle className="size-4 text-bad" aria-label="Needs attention" /> : null}{o.code}</span> },
    { key: 'placed', header: 'Placed', render: (o) => ago(o.placedAt) },
    { key: 'restaurant', header: 'Restaurant', render: (o) => o.restaurantName },
    { key: 'customer', header: 'Customer', render: (o) => o.customerName },
    { key: 'status', header: 'Status', render: (o) => <Status value={o.status} /> },
    { key: 'delivery', header: 'Delivery', render: (o) => (o.riderName ? <span className="text-sm">{o.riderName}</span> : <Status value={o.deliveryStatus} />) },
    { key: 'pay', header: 'Payment', render: (o) => <span className="text-sm">{o.paymentMethod === 'ONLINE' ? 'Online' : 'Cash'} · <Status value={o.paymentStatus} kind="payment" /></span> },
    { key: 'total', header: 'Total', align: 'right', render: (o) => <Money kobo={o.totalKobo} /> },
  ];

  return (
    <>
      <PageHeader title="Orders" description="Search by order code, customer email or phone. Refreshes every 20 seconds." />
      <Card className="mb-4 flex flex-col gap-3">
        <form
          className="flex max-w-xl items-center gap-2 rounded-xl border border-line bg-surface px-3"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: q.trim() });
          }}
          role="search"
        >
          <Search className="size-4 text-ink-muted" aria-hidden />
          <label className="sr-only" htmlFor="order-search">
            Search orders
          </label>
          <input id="order-search" className="min-h-11 flex-1 bg-transparent outline-none" placeholder="CN-7K3Q9P, ada@example.com or 0803…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <FilterChips label="Filter orders" value={filter} onChange={(v) => update({ status: v === 'attention' ? '' : v, attention: v === 'attention' ? 'true' : '' })} options={FILTERS} />
      </Card>
      <Card>
        {list.isPending ? (
          <LoadingBlock />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={list.refetch} />
        ) : (
          <>
            <Table columns={columns} rows={list.data.items} rowKey={(o) => o.id} onRowClick={(o) => navigate(`/orders/${o.id}`)} empty={<EmptyState icon={ClipboardList} title="No orders match" />} />
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={(p) => update({ page: String(p) })} />
          </>
        )}
      </Card>
    </>
  );
}
