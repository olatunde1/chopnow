import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { ChevronDown, Menu, ShoppingCart, X } from 'lucide-react';
import { links } from '../content/site';
import { Logo } from './Logo';
import { StateSelect } from './location';
import { cx } from './ui';

export const NAV = [
  { to: '/about', label: 'About Us' },
  { to: '/vendors', label: 'Vendor' },
  { to: '/riders', label: 'Rider' },
];
export const CONTACT_MENU = [
  { to: '/faq', label: 'FAQ', hint: 'Answers to common questions' },
  { to: '/product', label: 'Product', hint: 'The ChopNow apps and features' },
  { to: '/advertise', label: 'Ad', hint: 'Advertise your business on ChopNow' },
];

const navClass = ({ isActive }) =>
  cx('rounded-full px-4 py-2 text-[15px] font-semibold transition-colors hover:bg-surface', isActive ? 'text-brand' : 'text-ink');

/**
 * "Contact us": opens on hover (pointer) and on click/Enter (keyboard, touch). Escape or moving
 * focus/pointer away closes it. A disclosure of links, not an ARIA menu, so it reads naturally.
 */
function ContactDropdown() {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const closeTimer = useRef(null);
  const pointer = useRef('');
  const panelId = useId();
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const openNow = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  // A short delay so the pointer can travel from the button to the panel.
  const closeSoon = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };
  const active = CONTACT_MENU.some((m) => pathname.startsWith(m.to));

  return (
    <div
      ref={wrap}
      className="relative"
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          setOpen(false);
          wrap.current?.querySelector('button')?.focus();
        }
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onPointerDown={(e) => {
          pointer.current = e.pointerType;
        }}
        // With a mouse, hovering already opened it: a click must not close it again.
        // Touch and keyboard (no hover) toggle.
        onClick={() => {
          const mouse = pointer.current === 'mouse';
          pointer.current = '';
          setOpen((v) => (mouse ? true : !v));
        }}
        className={cx('inline-flex items-center gap-1 rounded-full px-4 py-2 text-[15px] font-semibold transition-colors hover:bg-surface', active ? 'text-brand' : 'text-ink')}
      >
        Contact us
        <ChevronDown className={cx('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      <div id={panelId} hidden={!open} className="absolute right-0 top-full z-30 pt-2">
        <ul className="w-72 rounded-2xl bg-surface p-2 shadow-xl ring-1 ring-line">
          {CONTACT_MENU.map((m) => (
            <li key={m.to}>
              <Link to={m.to} className="block rounded-xl px-4 py-3 hover:bg-brand-soft">
                <span className="block font-semibold">{m.label}</span>
                <span className="block text-sm text-ink-muted">{m.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CartLink({ className }) {
  return (
    <a href={links.order} className={cx('grid size-11 place-items-center rounded-full bg-brand text-white transition-colors hover:bg-brand-dark', className)} aria-label="Cart: order food on ChopNow">
      <ShoppingCart className="size-5" aria-hidden />
    </a>
  );
}

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-cream/95 backdrop-blur">
      <div className="mx-auto flex h-18 max-w-6xl items-center gap-4 px-5 sm:px-8">
        <Logo />
        <StateSelect className="hidden w-52 md:block" />

        <nav aria-label="Main" className="ml-auto hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={navClass}>
              {n.label}
            </NavLink>
          ))}
          <ContactDropdown />
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-2">
          <CartLink />
          <button
            type="button"
            className="grid size-11 place-items-center rounded-full ring-1 ring-line lg:hidden"
            aria-expanded={mobileOpen}
            aria-controls="mobile-menu"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </div>

      <div id="mobile-menu" hidden={!mobileOpen} className="border-t border-line bg-cream px-5 pb-6 pt-4 lg:hidden">
        <StateSelect id="state-select-mobile" className="mb-4 md:hidden" />
        <nav aria-label="Main (mobile)">
          <ul className="flex flex-col">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} className={({ isActive }) => cx('block rounded-xl px-3 py-3 text-lg font-semibold', isActive ? 'text-brand' : 'text-ink')}>
                  {n.label}
                </NavLink>
              </li>
            ))}
            <li className="mt-2 border-t border-line pt-3">
              <p className="px-3 pb-1 text-sm font-bold uppercase tracking-wider text-ink-muted">Contact us</p>
              <ul>
                {CONTACT_MENU.map((m) => (
                  <li key={m.to}>
                    <NavLink to={m.to} className={({ isActive }) => cx('block rounded-xl px-3 py-2.5 font-semibold', isActive ? 'text-brand' : 'text-ink')}>
                      {m.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
