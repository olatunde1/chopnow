import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Search } from 'lucide-react';
import { Badge, Card, EmptyState, ErrorState, LoadingBlock, Modal, Money, PageHeader, Pagination, Table } from '../components/ui';
import { api } from '../lib/api';
import { dateTime, orderStatus } from '../lib/format';
import { useSession } from '../state/session';

export function OrderHistoryPage() {
  const { restaurant } = useSession();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const history = useQuery({
    queryKey: ['orders', restaurant.id, 'history', page, q],
    queryFn: () => api.orders.list(restaurant.id, { view: 'history', page, pageSize: 20, q: q.trim() || undefined }),
    placeholderData: (prev) => prev,
  });

  const columns = [
    { key: 'code', header: 'Order', render: (o) => <span className="font-bold">{o.code}</span> },
    { key: 'placed', header: 'Placed', render: (o) => dateTime(o.placedAt) },
    { key: 'items', header: 'Items', render: (o) => <span className="line-clamp-2">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (o) => {
        const s = orderStatus(o.status);
        return <Badge tone={s.tone}>{s.label}</Badge>;
      },
    },
    { key: 'food', header: 'Food', align: 'right', render: (o) => <Money kobo={o.subtotalKobo} /> },
    { key: 'earn', header: 'You receive ≈', align: 'right', render: (o) => (o.status === 'DELIVERED' ? <Money kobo={o.estimatedEarningsKobo} /> : '—') },
  ];

  return (
    <>
      <PageHeader title="Order history" description="Completed, cancelled and declined orders." />
      <Card>
        <label className="mb-4 flex max-w-sm items-center gap-2 rounded-xl border border-line bg-surface px-3">
          <Search className="size-4 text-ink-muted" aria-hidden />
          <span className="sr-only">Search by order code</span>
          <input
            className="min-h-11 flex-1 bg-transparent outline-none"
            placeholder="Search by order code, e.g. CN-7K3"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </label>
        {history.isPending ? (
          <LoadingBlock />
        ) : history.isError ? (
          <ErrorState error={history.error} onRetry={history.refetch} />
        ) : (
          <>
            <Table
              columns={columns}
              rows={history.data.items}
              rowKey={(o) => o.id}
              onRowClick={setSelected}
              empty={<EmptyState icon={History} title={q ? 'No matching orders' : 'No past orders yet'} />}
            />
            <Pagination page={page} pageSize={20} total={history.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={`Order ${selected?.code ?? ''}`}>
        {selected ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone={orderStatus(selected.status).tone}>{orderStatus(selected.status).label}</Badge>
              <Badge>{selected.paymentMethod === 'ONLINE' ? 'Paid online' : 'Cash on delivery'}</Badge>
            </div>
            <p className="text-sm text-ink-muted">Placed {dateTime(selected.placedAt)} for {selected.customerFirstName}</p>
            {selected.cancellationReason ? <p className="rounded-xl bg-bad-soft p-3 text-sm text-bad">{selected.cancellationReason}</p> : null}
            <ul className="flex flex-col gap-2">
              {selected.items.map((i, idx) => (
                <li key={idx} className="flex justify-between gap-3">
                  <span>
                    {i.quantity}× {i.name}
                    {i.variantName ? ` (${i.variantName})` : ''}
                    {i.extras.length ? <span className="block text-sm text-ink-muted">+ {i.extras.map((e) => e.name).join(', ')}</span> : null}
                  </span>
                  <Money kobo={i.lineTotalKobo} />
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-2 gap-1 border-t border-line pt-3 text-sm">
              <dt className="text-ink-muted">Food subtotal</dt>
              <dd className="text-right">
                <Money kobo={selected.subtotalKobo} />
              </dd>
              {selected.status === 'DELIVERED' ? (
                <>
                  <dt className="text-ink-muted">ChopNow commission</dt>
                  <dd className="text-right">
                    −<Money kobo={selected.commissionKobo} />
                  </dd>
                  <dt className="font-semibold">You receive ≈</dt>
                  <dd className="text-right font-semibold">
                    <Money kobo={selected.estimatedEarningsKobo} />
                  </dd>
                </>
              ) : (
                <dd className="col-span-2 text-ink-muted">No earnings or commission: this order wasn’t delivered.</dd>
              )}
            </dl>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
