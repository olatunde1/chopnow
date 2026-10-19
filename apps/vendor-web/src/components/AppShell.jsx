import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, ClipboardList, History, Landmark, LayoutDashboard, LogOut, Menu as MenuIcon, Star, Store, UtensilsCrossed, X } from 'lucide-react';
import { api } from '../lib/api';
import { APPROVAL } from '../lib/format';
import { useSession } from '../state/session';
import { RealtimeStatusContext, pollEvery, useRealtime } from '../lib/realtime';
import { NotificationBell } from './NotificationBell';
import { Badge, Button, Switch, useToast } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/orders', label: 'Live orders', icon: ClipboardList, badge: true },
  { to: '/orders/history', label: 'Order history', icon: History },
  { to: '/menu', label: 'Menu', icon: UtensilsCrossed },
  { to: '/restaurant', label: 'Restaurant profile', icon: Store },
  { to: '/reports', label: 'Sales reports', icon: BarChart3 },
  { to: '/payouts', label: 'Payouts', icon: Landmark },
  { to: '/reviews', label: 'Reviews', icon: Star },
];

/** Number of orders waiting to be accepted, refreshed every 15 s (shown as a badge and in the tab title). */
export function useIncomingCount(restaurantId, pollMs = 15_000) {
  return useQuery({
    queryKey: ['orders', restaurantId, 'incoming-count'],
    queryFn: async () => (await api.orders.list(restaurantId, { view: 'incoming', pageSize: 1 })).incomingCount,
    enabled: !!restaurantId,
    refetchInterval: pollMs,
  });
}

function AcceptingSwitch({ restaurant }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (on) => api.restaurants.setAccepting(restaurant.id, on),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['restaurants'] });
      toast.show(r.isAcceptingOrders ? 'You’re open for orders' : 'Orders paused', 'success');
    },
    onError: (e) => toast.show(e.message, 'danger'),
  });
  const approved = restaurant.verificationStatus === 'APPROVED';
  return (
    <Switch
      checked={restaurant.isAcceptingOrders}
      disabled={!approved || mutation.isPending}
      onChange={(on) => mutation.mutate(on)}
      label="Accepting orders"
      description={approved ? (restaurant.isAcceptingOrders ? (restaurant.isOpenNow ? 'Open for orders' : 'On, but outside opening hours') : 'Paused') : 'Available after approval'}
    />
  );
}

function NavItems({ incoming, onNavigate }) {
  return (
    <ul className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon, end, badge }) => (
        <li key={to}>
          <NavLink
            to={to}
            end={end ?? to === '/orders'}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex min-h-11 items-center gap-3 rounded-xl px-3 font-semibold ${isActive ? 'bg-brand-soft text-brand-dark' : 'text-ink-muted hover:bg-surface-muted hover:text-ink'}`
            }
          >
            <Icon className="size-5" aria-hidden />
            <span className="flex-1">{label}</span>
            {badge && incoming ? (
              <span className="rounded-full bg-brand px-2 py-0.5 text-xs text-white" aria-label={`${incoming} new orders`}>
                {incoming}
              </span>
            ) : null}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

export function AppShell() {
  const { user, restaurant, restaurants, setRestaurantId, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  // Live updates: refetch this restaurant's orders and the bell when the API says something changed.
  const live = useRealtime((e) => {
    if (e.type === 'notification.new') queryClient.invalidateQueries({ queryKey: ['notifications'] });
    if ((e.restaurantId && e.restaurantId === restaurant?.id) || e.notificationType === 'order.new') queryClient.invalidateQueries({ queryKey: ['orders', restaurant?.id] });
  }, !!user);
  const incoming = useIncomingCount(restaurant?.id, pollEvery(live, 15_000)).data ?? 0;
  useEffect(() => {
    document.title = `${incoming ? `(${incoming}) ` : ''}ChopNow for Restaurants`;
  }, [incoming]);
  const approval = restaurant ? APPROVAL[restaurant.verificationStatus] : null;

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center gap-2 px-2 pt-2">
        <div className="flex size-9 items-center justify-center rounded-xl bg-brand font-extrabold text-white" aria-hidden>
          C
        </div>
        <div>
          <p className="font-extrabold leading-tight">ChopNow</p>
          <p className="text-xs text-ink-muted">for Restaurants</p>
        </div>
      </div>
      {restaurants.length > 1 ? (
        <label className="flex flex-col gap-1 px-2 text-sm font-semibold">
          Restaurant
          <select className="min-h-11 rounded-xl border border-line bg-surface px-2" value={restaurant?.id} onChange={(e) => setRestaurantId(e.target.value)}>
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <nav aria-label="Main" className="flex-1">
        <NavItems incoming={incoming} onNavigate={() => setOpen(false)} />
      </nav>
      <div className="flex flex-col gap-2 border-t border-line px-2 pt-4">
        <p className="truncate text-sm font-semibold">{user?.fullName}</p>
        <p className="truncate text-xs text-ink-muted">{user?.email}</p>
        <Button variant="outline" size="sm" icon={LogOut} onClick={signOut}>
          Sign out
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-2">
        Skip to content
      </a>
      <aside className="hidden w-64 shrink-0 border-r border-line bg-surface lg:block">{sidebar}</aside>
      {open ? (
        <div className="fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="relative w-72 max-w-[85%] bg-surface">
            <button type="button" className="absolute right-2 top-2 flex size-11 items-center justify-center" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="size-5" aria-hidden />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-line bg-cream/95 px-4 py-3 backdrop-blur sm:px-6">
          <button type="button" className="flex size-11 items-center justify-center rounded-xl hover:bg-surface-muted lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <MenuIcon className="size-5" aria-hidden />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h2 className="truncate font-bold">{restaurant?.name ?? 'Your restaurant'}</h2>
            {approval ? <Badge tone={approval.tone}>{approval.label}</Badge> : null}
          </div>
          {restaurant ? <AcceptingSwitch restaurant={restaurant} /> : null}
          <NotificationBell pollMs={pollEvery(live, 30_000, 120_000)} />
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
          <RealtimeStatusContext.Provider value={live}>
            <Outlet />
          </RealtimeStatusContext.Provider>
        </main>
      </div>
    </div>
  );
}
