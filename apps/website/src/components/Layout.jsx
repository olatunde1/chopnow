import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { contact, links } from '../content/site';
import { CONTACT_MENU, Header, NAV } from './Header';
import { CoverageNotice, LocationProvider } from './location';
import { Logo } from './Logo';

/** New page: start at the top, or at the #section the link points to. */
function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
    }
  }, [pathname, hash]);
  return null;
}

const SOCIAL_LABELS = { instagram: 'Instagram', x: 'X (Twitter)', facebook: 'Facebook', tiktok: 'TikTok' };

function Footer() {
  const socials = Object.entries(contact.socials).filter(([, url]) => url);
  return (
    <footer className="bg-ink px-5 pb-10 pt-16 text-cream sm:px-8">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo inverse />
          <p className="mt-4 max-w-xs leading-relaxed text-cream/80">Your favourite local food, delivered. Now serving Sagamu, Ogun State.</p>
        </div>
        <nav aria-label="Company">
          <h2 className="font-bold">Company</h2>
          <ul className="mt-3 space-y-2 text-cream/80">
            {NAV.map((n) => (
              <li key={n.to}>
                <Link to={n.to} className="hover:text-white hover:underline">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Help">
          <h2 className="font-bold">Help</h2>
          <ul className="mt-3 space-y-2 text-cream/80">
            {[...CONTACT_MENU, { to: '/contact', label: 'Contact us' }].map((n) => (
              <li key={n.to}>
                <Link to={n.to} className="hover:text-white hover:underline">
                  {n.label === 'Ad' ? 'Advertise' : n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <h2 className="font-bold">Get started</h2>
          <ul className="mt-3 space-y-2 text-cream/80">
            <li>
              <a href={links.order} className="hover:text-white hover:underline">
                Order food
              </a>
            </li>
            <li>
              <a href={links.vendorSignUp} className="hover:text-white hover:underline">
                Sell on ChopNow
              </a>
            </li>
            <li>
              <Link to="/riders" className="hover:text-white hover:underline">
                Ride with ChopNow
              </Link>
            </li>
          </ul>
          {socials.length ? (
            <ul className="mt-5 flex flex-wrap gap-3 text-sm">
              {socials.map(([k, url]) => (
                <li key={k}>
                  <a href={url} target="_blank" rel="noreferrer" className="rounded-full bg-white/10 px-3 py-1.5 hover:bg-white/20">
                    {SOCIAL_LABELS[k]}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <p className="mx-auto mt-12 max-w-6xl border-t border-white/15 pt-6 text-sm text-cream/70">© {new Date().getFullYear()} ChopNow. Made in Sagamu, Ogun State.</p>
    </footer>
  );
}

export function Layout() {
  return (
    <LocationProvider>
      <a href="#main" className="sr-only z-50 rounded-full bg-brand px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <ScrollManager />
      <Header />
      <CoverageNotice />
      <main id="main">
        <Outlet />
      </main>
      <Footer />
    </LocationProvider>
  );
}
