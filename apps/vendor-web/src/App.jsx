import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { LoadingBlock } from './components/ui';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { MenuPage } from './pages/MenuPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { OrderHistoryPage } from './pages/OrderHistoryPage';
import { OrdersBoardPage } from './pages/OrdersBoardPage';
import { PayoutsPage } from './pages/PayoutsPage';
import { ReportsPage } from './pages/ReportsPage';
import { RestaurantProfilePage } from './pages/RestaurantProfilePage';
import { ReviewsPage } from './pages/ReviewsPage';
import { useSession } from './state/session';

export function App() {
  const { status, restaurant, restaurantsQuery } = useSession();

  if (status === 'restoring' || (status === 'signedIn' && restaurantsQuery.isPending)) {
    return (
      <div className="mx-auto max-w-md p-8">
        <LoadingBlock label="Loading your restaurant" />
      </div>
    );
  }

  if (status !== 'signedIn') {
    return (
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  // Signed in but no restaurant yet: start the application.
  if (!restaurant) return <OnboardingPage />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="orders" element={<OrdersBoardPage />} />
        <Route path="orders/history" element={<OrderHistoryPage />} />
        <Route path="menu" element={<MenuPage />} />
        <Route path="restaurant" element={<RestaurantProfilePage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reviews" element={<ReviewsPage />} />
        <Route path="payouts" element={<PayoutsPage />} />
        <Route path="new-restaurant" element={<OnboardingPage embedded />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
