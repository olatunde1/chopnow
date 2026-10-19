import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, ClipboardList } from 'lucide-react';
import { REJECTION_REASONS } from '@chopnow/shared-schemas';
import { OrderCard } from '../components/OrderCard';
import { Badge, Button, EmptyState, ErrorState, LoadingBlock, Modal, PageHeader, Select, Switch, Textarea, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useSession } from '../state/session';
import { pollEvery, useRealtimeStatus } from '../lib/realtime';

const COLUMNS = [
  { key: 'new', title: 'New', statuses: ['PLACED'] },
  { key: 'kitchen', title: 'In the kitchen', statuses: ['ACCEPTED', 'PREPARING'] },
  { key: 'ready', title: 'Ready for pickup', statuses: ['READY_FOR_PICKUP'] },
];

const REASON_LABEL = {
  ITEM_UNAVAILABLE: 'An item is unavailable',
  TOO_BUSY: 'Too busy right now',
  CLOSING_SOON: 'Closing soon',
  CANNOT_DELIVER_AREA: 'Can’t serve this area',
  OTHER: 'Other reason',
};

/** Short chime using Web Audio (no audio file). Browsers only allow it after the user has interacted. */
function chime() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    o.start();
    o.stop(ctx.currentTime + 0.6);
  } catch {
    // Audio unavailable: the badge and title still show new orders.
  }
}

export function OrdersBoardPage() {
  const live = useRealtimeStatus();
  const { restaurant } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(null); // { orderId, action }
  const [accepting, setAccepting] = useState(null);
  const [prep, setPrep] = useState(String(restaurant.prepTimeMinutes));
  const [rejecting, setRejecting] = useState(null);
  const [reject, setReject] = useState({ reason: 'ITEM_UNAVAILABLE', note: '' });
  const [delaying, setDelaying] = useState(null);
  const [delay, setDelay] = useState({ minutes: '15', note: '' });
  const [sound, setSound] = useState(false);
  const [tab, setTab] = useState('new');

  const board = useQuery({
    queryKey: ['orders', restaurant.id, 'board'],
    // Live updates refetch at once; polling is the fallback (fast only without a connection).
    queryFn: () => api.orders.list(restaurant.id, { view: 'active', pageSize: 100 }),
    refetchInterval: pollEvery(live, 10_000),
  });

  // Chime when the number of new orders goes up.
  const lastIncoming = useRef(null);
  const incoming = board.data?.incomingCount ?? 0;
  useEffect(() => {
    if (lastIncoming.current !== null && incoming > lastIncoming.current && sound) chime();
    lastIncoming.current = incoming;
  }, [incoming, sound]);

  const run = async (order, action, fn, success) => {
    setBusy({ orderId: order.id, action });
    try {
      await fn();
      toast.show(success, 'success');
    } catch (e) {
      toast.show(e.message, 'danger');
    } finally {
      setBusy(null);
      queryClient.invalidateQueries({ queryKey: ['orders', restaurant.id] });
    }
  };

  const onAction = (action, order) => {
    if (action === 'accept') {
      setPrep(String(restaurant.prepTimeMinutes));
      return setAccepting(order);
    }
    if (action === 'reject') {
      setReject({ reason: 'ITEM_UNAVAILABLE', note: '' });
      return setRejecting(order);
    }
    if (action === 'delay') {
      setDelay({ minutes: '15', note: '' });
      return setDelaying(order);
    }
    if (action === 'start_preparing') return run(order, action, () => api.orders.startPreparing(restaurant.id, order.id), `${order.code} is being prepared`);
    if (action === 'mark_ready') return run(order, action, () => api.orders.ready(restaurant.id, order.id), `${order.code} is ready. A rider will collect it.`);
    return undefined;
  };

  if (board.isPending) return <LoadingBlock label="Loading orders" />;
  if (board.isError) return <ErrorState error={board.error} onRetry={board.refetch} />;

  const orders = board.data.items;
  const byColumn = Object.fromEntries(COLUMNS.map((c) => [c.key, orders.filter((o) => c.statuses.includes(o.status))]));

  return (
    <>
      <PageHeader
        title="Live orders"
        description="Updates every 10 seconds. Accept new orders quickly: unanswered orders are declined automatically after 10 minutes."
        actions={<Switch checked={sound} onChange={setSound} label="Sound for new orders" description="Chime for new orders" />}
      />
      {restaurant.verificationStatus !== 'APPROVED' || !restaurant.isAcceptingOrders ? (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn" role="status">
          <BellRing className="size-4" aria-hidden />
          {restaurant.verificationStatus !== 'APPROVED' ? 'Your restaurant is awaiting approval, so customers can’t order yet.' : 'You’re paused. Switch on “Accepting orders” at the top to receive new orders.'}
        </p>
      ) : null}

      {/* Mobile: one column at a time. */}
      <div className="mb-4 flex gap-2 lg:hidden" role="tablist" aria-label="Order columns">
        {COLUMNS.map((c) => (
          <button
            key={c.key}
            role="tab"
            aria-selected={tab === c.key}
            onClick={() => setTab(c.key)}
            className={`min-h-11 flex-1 rounded-xl px-3 text-sm font-semibold ${tab === c.key ? 'bg-ink text-white' : 'bg-surface text-ink'}`}
          >
            {c.title} ({byColumn[c.key].length})
          </button>
        ))}
      </div>

      {orders.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No orders right now" message="New orders appear here automatically." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {COLUMNS.map((c) => (
            <section key={c.key} aria-label={c.title} className={`flex flex-col gap-3 ${tab === c.key ? '' : 'hidden lg:flex'}`}>
              <h2 className="flex items-center gap-2 font-bold">
                {c.title} <Badge tone={c.key === 'new' && byColumn[c.key].length ? 'brand' : 'neutral'}>{byColumn[c.key].length}</Badge>
              </h2>
              {byColumn[c.key].map((o) => (
                <OrderCard key={o.id} order={o} onAction={onAction} busyAction={busy?.orderId === o.id ? busy.action : null} />
              ))}
              {byColumn[c.key].length === 0 ? <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-ink-muted">Nothing here</p> : null}
            </section>
          ))}
        </div>
      )}

      <Modal
        open={!!accepting}
        onClose={() => setAccepting(null)}
        title={`Accept ${accepting?.code ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setAccepting(null)}>
              Cancel
            </Button>
            <Button
              loading={busy?.action === 'accept'}
              onClick={() => {
                const o = accepting;
                setAccepting(null);
                run(o, 'accept', () => api.orders.accept(restaurant.id, o.id, Number(prep)), `${o.code} accepted`);
              }}
            >
              Accept order
            </Button>
          </>
        }
      >
        <Select label="How long will it take?" value={prep} onChange={(e) => setPrep(e.target.value)}>
          {[10, 15, 20, 25, 30, 40, 45, 60, 90].map((m) => (
            <option key={m} value={m}>
              {m} minutes
            </option>
          ))}
        </Select>
        <p className="mt-2 text-sm text-ink-muted">The customer sees this as the time their food will be ready.</p>
      </Modal>

      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={`Decline ${rejecting?.code ?? ''}?`}
        footer={
          <>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Keep order
            </Button>
            <Button
              variant="danger"
              disabled={reject.reason === 'OTHER' && reject.note.trim().length < 3}
              onClick={() => {
                const o = rejecting;
                setRejecting(null);
                run(o, 'reject', () => api.orders.reject(restaurant.id, o.id, reject.reason, reject.note.trim() || undefined), `${o.code} declined. The customer has been told.`);
              }}
            >
              Decline order
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Select label="Reason" value={reject.reason} onChange={(e) => setReject({ ...reject, reason: e.target.value })}>
            {REJECTION_REASONS.map((r) => (
              <option key={r} value={r}>
                {REASON_LABEL[r]}
              </option>
            ))}
          </Select>
          <Textarea
            label={reject.reason === 'OTHER' ? 'Tell the customer why' : 'Note for the customer (optional)'}
            value={reject.note}
            onChange={(e) => setReject({ ...reject, note: e.target.value })}
            maxLength={200}
          />
          {rejecting?.paymentMethod === 'ONLINE' ? <p className="text-sm text-ink-muted">This order was paid online; the customer will be refunded in full.</p> : null}
        </div>
      </Modal>

      <Modal
        open={!!delaying}
        onClose={() => setDelaying(null)}
        title={`${delaying?.code ?? ''} running late`}
        footer={
          <>
            <Button variant="outline" onClick={() => setDelaying(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const o = delaying;
                setDelaying(null);
                run(o, 'delay', () => api.orders.delay(restaurant.id, o.id, Number(delay.minutes), delay.note.trim() || undefined), 'Customer updated with the new time');
              }}
            >
              Update time
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Select label="Extra time needed" value={delay.minutes} onChange={(e) => setDelay({ ...delay, minutes: e.target.value })}>
            {[5, 10, 15, 20, 30, 45, 60].map((m) => (
              <option key={m} value={m}>
                {m} more minutes
              </option>
            ))}
          </Select>
          <Textarea label="Reason (optional)" value={delay.note} onChange={(e) => setDelay({ ...delay, note: e.target.value })} maxLength={200} />
        </div>
      </Modal>
    </>
  );
}
