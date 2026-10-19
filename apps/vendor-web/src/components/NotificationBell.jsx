import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { client } from '../lib/api';
import { dateTime } from '../lib/format';

export const notificationsApi = {
  list: () => client.get('/v1/me/notifications', { query: { pageSize: 15 } }),
  read: (body) => client.post('/v1/me/notifications/read', body),
};

/** Header bell: unread count and the latest notifications. Opening an order notification goes to the board. */
export function NotificationBell({ pollMs = 60_000 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: notificationsApi.list, refetchInterval: pollMs });
  const unread = q.data?.unreadCount ?? 0;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markRead = async (body) => {
    await notificationsApi.read(body).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="relative flex size-11 items-center justify-center rounded-xl hover:bg-surface-muted"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="size-5" aria-hidden />
        {unread ? <span className="absolute right-1 top-1 min-w-5 rounded-full bg-brand px-1 text-center text-xs font-bold text-white" aria-hidden>{unread > 9 ? '9+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-xl" role="dialog" aria-label="Notifications">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-bold">Notifications</p>
            {unread ? (
              <button type="button" className="text-sm font-semibold text-brand" onClick={() => markRead({ all: true })}>
                Mark all read
              </button>
            ) : null}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {(q.data?.items ?? []).length === 0 ? <li className="px-4 py-6 text-center text-sm text-ink-muted">Nothing yet.</li> : null}
            {(q.data?.items ?? []).map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-surface-muted ${n.readAt ? '' : 'bg-brand-soft/40'}`}
                  onClick={() => {
                    if (!n.readAt) void markRead({ ids: [n.id] });
                    setOpen(false);
                    if (n.orderId) navigate(n.type === 'order.new' ? '/orders' : '/orders/history');
                  }}
                >
                  <span className="text-sm font-semibold">{n.title}</span>
                  <span className="text-sm text-ink-muted">{n.body}</span>
                  <span className="text-xs text-ink-muted">{dateTime(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
