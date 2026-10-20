import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { AboutPage } from './pages/AboutPage';
import { AdvertisePage } from './pages/AdvertisePage';
import { ContactPage } from './pages/ContactPage';
import { FaqPage } from './pages/FaqPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProductPage } from './pages/ProductPage';
import { RidersPage } from './pages/RidersPage';
import { VendorsPage } from './pages/VendorsPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="vendors" element={<VendorsPage />} />
        <Route path="riders" element={<RidersPage />} />
        <Route path="faq" element={<FaqPage />} />
        <Route path="product" element={<ProductPage />} />
        <Route path="advertise" element={<AdvertisePage />} />
        <Route path="contact" element={<ContactPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
