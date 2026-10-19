import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgePercent, Banknote, Bike, ClipboardList, FileClock, Landmark, LayoutDashboard, LogOut, Menu as MenuIcon, MessageSquareWarning, Radio, ReceiptText, Settings, Store, Undo2, Users, Wallet, X,
} from 'lucide-react';
import { api } from '../lib/api';
import { RealtimeStatusContext, pollEvery, useRealtime } from '../lib/realtime';
import { useSession } from '../state/session';
import { Button } from './ui';

/** Each entry is shown only to roles holding its permission (the API enforces the same). */
export const NAV = [
  { section: 'Operations' },
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, perm: 'dashboard.view' },
  { to: '/orders', label: 'Orders', icon: ClipboardList, perm: 'order.read.any', badge: 'attention' },
  { to: '/dispatch', label: 'Dispatch', icon: Radio, perm: 'dispatch.manage', badge: 'alerts' },
  { to: '/restaurants', label: 'Restaurants', icon: Store, perm: 'restaurant.read.any', badge: 'restaurantApprovals' },
  { to: '/riders', label: 'Riders', icon: Bike, perm: 'rider.read.any', badge: 'riderApprovals' },
  { to: '/users', label: 'Customers & staff', icon: Users, perm: 'customer.read.any' },
  { to: '/reviews', label: 'Reviews', icon: MessageSquareWarning, perm: 'review.moderate' },
  { to: '/promotions', label: 'Promotions', icon: BadgePercent, perm: 'promotion.manage' },
  { section: 'Finance' },
  { to: '/finance', label: 'Summary', icon: Landmark, perm: 'settlement.manage' },
  { to: '/refunds', label: 'Refunds', icon: Undo2, perm: 'payment.read', badge: 'refundRequests' },
  { to: '/cash', label: 'Rider cash', icon: Banknote, perm: 'cash.reconcile', badge: 'remittancesToConfirm' },
  { to: '/settlements', label: 'Settlements & payouts', icon: Wallet, perm: 'settlement.manage' },
  { section: 'Admin' },
  { to: '/settings', label: 'Business rules', icon: Settings, perm: 'config.manage' },
  { to: '/audit', label: 'Audit log', icon: FileClock, perm: 'audit.read' },
];

/** The menu for a role: items it may open, and section headings only when they have items. */
export function navFor(can) {
  const out = [];
  let heading = null;
  for (const item of NAV) {
    if (item.section) heading = item;
    else if (can(item.perm)) {
      if (heading) {
        out.push(heading);
        heading = null;
      }
      out.push(item);
    }
  }
  return out;
}

function useCounts(enabled, pollMs) {
  return useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard, enabled, refetchInterval: pollMs });
}

export function AppShell() {
  const { user, signOut, can } = useSession();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  // Staff receive every order and dispatch change: refetch what's on screen (cheap, keyed queries).
  const live = useRealtime((e) => {
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    if (e.type === 'order.updated' || e.type === 'delivery.updated') {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-order', e.orderId] });
    }
    if (e.type === 'dispatch.updated' || e.type === 'delivery.updated' || e.type === 'order.updated') queryClient.invalidateQueries({ queryKey: ['dispatch'] });
  });
  const counts = useCounts(can('dashboard.view'), pollEvery(live, 30_000, 120_000)).data;
  const badge = (key) =>
    !counts ? 0 : key === 'attention' ? counts.live.exceptions + counts.live.dispatchAlerts : key === 'alerts' ? counts.live.dispatchAlerts : (counts.queues[key] ?? 0);

  const sidebar = (
    <div className="flex h-full flex-col gap-5 p-4">
      <div className="flex items-center gap-2 px-2 pt-2">
        <div className="flex size-9 items-center justify-center rounded-xl bg-ink font-extrabold text-white" aria-hidden>
          C
        </div>
        <div>
          <p className="font-extrabold leading-tight">ChopNow</p>
          <p className="text-xs text-ink-muted">Admin</p>
        </div>
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto">
        <ul className="flex flex-col gap-0.5">
          {navFor(can).map((item) =>
            item.section ? (
              <li key={item.section} className="mt-3 px-3 pb-1 text-xs font-bold uppercase tracking-wide text-ink-muted first:mt-0">
                {item.section}
              </li>
            ) : (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold ${isActive ? 'bg-ink text-white' : 'text-ink hover:bg-surface-muted'}`}
                >
                  <item.icon className="size-4.5 shrink-0" aria-hidden />
                  <span className="flex-1">{item.label}</span>
                  {item.badge && badge(item.badge) > 0 ? (
                    <span className="min-w-6 rounded-full bg-brand px-1.5 text-center text-xs font-bold text-white" aria-label={`${badge(item.badge)} need attention`}>
                      {badge(item.badge)}
                    </span>
                  ) : null}
                </NavLink>
              </li>
            ),
          )}
        </ul>
      </nav>
      <div className="flex flex-col gap-1 border-t border-line px-2 pt-4">
        <p className="truncate text-sm font-semibold">{user?.fullName}</p>
        <p className="truncate text-xs text-ink-muted">
          {user?.role.toLowerCase()} · {user?.email}
        </p>
        <Button variant="outline" size="sm" icon={LogOut} onClick={signOut} className="mt-2">
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
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-line bg-surface lg:block">{sidebar}</aside>
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
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-cream/95 px-4 py-2 backdrop-blur lg:hidden">
          <button type="button" className="flex size-11 items-center justify-center rounded-xl" onClick={() => setOpen(true)} aria-label="Open menu">
            <MenuIcon className="size-5" aria-hidden />
          </button>
          <p className="font-extrabold">ChopNow Admin</p>
          <span className={`size-2.5 rounded-full ${live === 'open' ? 'bg-ok' : 'bg-warn'}`} title={live === 'open' ? 'Live updates on' : 'Live updates reconnecting; refreshing periodically'} aria-label={live === 'open' ? 'Live' : 'Reconnecting'} />
          <ReceiptText className="ml-auto size-5 text-ink-muted" aria-hidden />
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8">
          <RealtimeStatusContext.Provider value={live}>
            <Outlet />
          </RealtimeStatusContext.Provider>
        </main>
      </div>
    </div>
  );
}
