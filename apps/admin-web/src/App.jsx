import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppShell, navFor } from './components/AppShell';
import { EmptyState, LoadingBlock } from './components/ui';
import { ChangePasswordPage, LoginPage } from './pages/AuthPages';
import { useSession } from './state/session';

// Each section loads when first opened, so signing in stays fast.
const PromotionsPage = lazy(() => import('./pages/ConfigPages').then((m) => ({ default: m.PromotionsPage })));
const SettingsPage = lazy(() => import('./pages/ConfigPages').then((m) => ({ default: m.SettingsPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const DispatchPage = lazy(() => import('./pages/DispatchPage').then((m) => ({ default: m.DispatchPage })));
const CashPage = lazy(() => import('./pages/FinancePages').then((m) => ({ default: m.CashPage })));
const FinanceSummaryPage = lazy(() => import('./pages/FinancePages').then((m) => ({ default: m.FinanceSummaryPage })));
const RefundsPage = lazy(() => import('./pages/FinancePages').then((m) => ({ default: m.RefundsPage })));
const SettlementsPage = lazy(() => import('./pages/FinancePages').then((m) => ({ default: m.SettlementsPage })));
const OrderDetailPage = lazy(() => import('./pages/OrderDetailPage').then((m) => ({ default: m.OrderDetailPage })));
const OrdersPage = lazy(() => import('./pages/OrdersPage').then((m) => ({ default: m.OrdersPage })));
const RestaurantsPage = lazy(() => import('./pages/PartnersPages').then((m) => ({ default: m.RestaurantsPage })));
const RidersPage = lazy(() => import('./pages/PartnersPages').then((m) => ({ default: m.RidersPage })));
const AuditPage = lazy(() => import('./pages/PeoplePages').then((m) => ({ default: m.AuditPage })));
const ReviewsModerationPage = lazy(() => import('./pages/PeoplePages').then((m) => ({ default: m.ReviewsModerationPage })));
const UsersPage = lazy(() => import('./pages/PeoplePages').then((m) => ({ default: m.UsersPage })));

/** Renders the page only for roles holding `perm`; the API refuses the requests anyway. */
function Guard({ perm, children }) {
  const { can } = useSession();
  return can(perm) ? <Suspense fallback={<LoadingBlock />}>{children}</Suspense> : <EmptyState title="Not available for your role" message="Ask an admin if you need access." />;
}

export function App() {
  const { status, user, can } = useSession();

  if (status === 'restoring') {
    return (
      <div className="mx-auto max-w-md p-8">
        <LoadingBlock label="Signing you in" />
      </div>
    );
  }
  if (status !== 'signedIn') return <LoginPage />;
  if (user.mustChangePassword) return <ChangePasswordPage />;

  const home = navFor(can).find((n) => n.to)?.to ?? '/';
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={can('dashboard.view') ? <Suspense fallback={<LoadingBlock />}><DashboardPage /></Suspense> : <Navigate to={home} replace />} />
        <Route path="orders" element={<Guard perm="order.read.any"><OrdersPage /></Guard>} />
        <Route path="orders/:orderId" element={<Guard perm="order.read.any"><OrderDetailPage /></Guard>} />
        <Route path="dispatch" element={<Guard perm="dispatch.manage"><DispatchPage /></Guard>} />
        <Route path="restaurants" element={<Guard perm="restaurant.read.any"><RestaurantsPage /></Guard>} />
        <Route path="riders" element={<Guard perm="rider.read.any"><RidersPage /></Guard>} />
        <Route path="users" element={<Guard perm="customer.read.any"><UsersPage /></Guard>} />
        <Route path="reviews" element={<Guard perm="review.moderate"><ReviewsModerationPage /></Guard>} />
        <Route path="finance" element={<Guard perm="settlement.manage"><FinanceSummaryPage /></Guard>} />
        <Route path="refunds" element={<Guard perm="payment.read"><RefundsPage /></Guard>} />
        <Route path="cash" element={<Guard perm="cash.reconcile"><CashPage /></Guard>} />
        <Route path="settlements" element={<Guard perm="settlement.manage"><SettlementsPage /></Guard>} />
        <Route path="audit" element={<Guard perm="audit.read"><AuditPage /></Guard>} />
        <Route path="promotions" element={<Guard perm="promotion.manage"><PromotionsPage /></Guard>} />
        <Route path="settings" element={<Guard perm="config.manage"><SettingsPage /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
