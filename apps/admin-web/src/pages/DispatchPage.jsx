import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Bike, Radio } from 'lucide-react';
import { ReasonDialog, Status, ago, minutes, useAction } from '../components/admin';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, Money, PageHeader, Table } from '../components/ui';
import { api } from '../lib/api';
import { pollEvery, useRealtimeStatus } from '../lib/realtime';

/** Live dispatch: who is waiting for a rider, who is out, and which riders can take work. */
export function DispatchPage() {
  const live = useRealtimeStatus();
  const q = useQuery({ queryKey: ['dispatch'], queryFn: api.dispatch.board, refetchInterval: pollEvery(live, 10_000) });
  const { run } = useAction();
  const [assigning, setAssigning] = useState(null);
  const [unassigning, setUnassigning] = useState(null);
  const refresh = [['dispatch'], ['dashboard']];

  if (q.isPending) return <LoadingBlock label="Loading dispatch" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const { waiting, active, riders } = q.data;
  const free = riders.filter((r) => !r.busy);

  return (
    <>
      <PageHeader title="Dispatch" description="Offers go out automatically, one rider at a time. Step in when something is stuck. Refreshes every 10 seconds." />

      <Card className="mb-5">
        <h2 className="mb-3 text-lg font-bold">Waiting for a rider ({waiting.length})</h2>
        <Table
          columns={[
            { key: 'code', header: 'Order', render: (w) => <Link to={`/orders/${w.orderId}`} className="font-bold text-brand">{w.orderCode}</Link> },
            { key: 'route', header: 'From → to', render: (w) => `${w.restaurantName} → ${w.dropoffArea}` },
            { key: 'food', header: 'Food', render: (w) => <Status value={w.orderStatus} /> },
            { key: 'wait', header: 'Waiting', render: (w) => <span className={w.alerted ? 'font-bold text-bad' : ''}>{minutes(w.waitingSeconds)}{w.alerted ? ' · alerted' : ''}</span> },
            { key: 'offers', header: 'Offers', render: (w) => (w.pendingOfferTo ? `${w.offersMade} · now with ${w.pendingOfferTo}` : w.offersMade) },
            { key: 'cash', header: 'Cash', align: 'right', render: (w) => (w.cashToCollectKobo ? <Money kobo={w.cashToCollectKobo} /> : 'Paid') },
            { key: 'act', header: '', align: 'right', render: (w) => <Button size="sm" onClick={() => setAssigning(w)} disabled={!free.length}>Assign</Button> },
          ]}
          rows={waiting}
          rowKey={(w) => w.deliveryId}
          empty={<EmptyState icon={Radio} title="Nothing waiting" message="Every accepted order has a rider." />}
        />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-lg font-bold">Out for delivery ({active.length})</h2>
          <ul className="divide-y divide-line">
            {active.length === 0 ? <li className="py-3 text-sm text-ink-muted">No deliveries in progress.</li> : null}
            {active.map((a) => (
              <li key={a.deliveryId} className="flex flex-wrap items-center gap-2 py-3 text-sm">
                <Link to={`/orders/${a.orderId}`} className="font-bold text-brand">{a.orderCode}</Link>
                <Status value={a.status} />
                <span className="text-ink-muted">{a.riderName}{a.riderPhone ? ` · ${a.riderPhone}` : ''}</span>
                <span className="basis-full text-ink-muted">{a.restaurantName} → {a.dropoffArea} · assigned {ago(a.assignedAt)}</span>
                {a.status !== 'PICKED_UP' ? <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setUnassigning(a)}>Take back</Button> : null}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-bold">Riders ({riders.length})</h2>
          <ul className="divide-y divide-line">
            {riders.length === 0 ? <li className="py-3 text-sm text-ink-muted">No riders online.</li> : null}
            {riders.map((r) => (
              <li key={r.riderId} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                <Bike className="size-4 text-ink-muted" aria-hidden />
                <span className="font-semibold">{r.name}</span>
                <Badge tone={r.riderType === 'CORE' ? 'info' : 'neutral'}>{r.riderType === 'CORE' ? 'Core' : 'Independent'}</Badge>
                {r.busy ? <Badge tone="warn">On a job</Badge> : r.reachable ? <Badge tone="ok">Free</Badge> : <Badge tone="bad">Not responding</Badge>}
                <span className="ml-auto text-ink-muted">seen {ago(r.lastSeenAt)}{r.outstandingCashKobo ? ' · holds ' : ''}{r.outstandingCashKobo ? <Money kobo={r.outstandingCashKobo} /> : null}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <ReasonDialog
        open={!!assigning}
        title={`Assign ${assigning?.orderCode ?? ''}`}
        message="The rider gets the job straight away (their app shows it on the next refresh). Agree it with them by phone first."
        fields={[{ name: 'riderId', label: 'Rider', type: 'select', required: true, options: free.map((r) => [r.riderId, `${r.name}${r.reachable ? '' : ' (not responding)'}`]) }]}
        confirmLabel="Assign"
        onClose={() => setAssigning(null)}
        onSubmit={({ riderId, reason }) => run(() => api.dispatch.assign(assigning.deliveryId, riderId, reason), { success: 'Rider assigned', invalidate: refresh })}
      />
      <ReasonDialog
        open={!!unassigning}
        title={`Take ${unassigning?.orderCode ?? ''} back from ${unassigning?.riderName ?? ''}?`}
        message="It goes back to automatic dispatch. Tell the rider."
        confirmLabel="Take back"
        destructive
        onClose={() => setUnassigning(null)}
        onSubmit={({ reason }) => run(() => api.dispatch.unassign(unassigning.deliveryId, reason), { success: 'Back in dispatch', invalidate: refresh })}
      />
    </>
  );
}
