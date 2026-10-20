import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { NIGERIAN_STATES, links } from './content/site';
import { StoreButtons } from './components/StoreButtons';

const renderAt = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
const header = () => screen.getByRole('banner');

beforeEach(() => window.localStorage.clear());

describe('header', () => {
  it('has the logo, state picker, About Us, Vendor, Rider, Contact us and the cart, in that order', () => {
    renderAt('/');
    const h = within(header());
    const items = [
      h.getByRole('link', { name: 'ChopNow home' }),
      h.getAllByLabelText('Your state')[0],
      h.getByRole('link', { name: 'About Us' }),
      h.getByRole('link', { name: 'Vendor' }),
      h.getByRole('link', { name: 'Rider' }),
      h.getByRole('button', { name: /Contact us/ }),
      h.getByRole('link', { name: /Cart/ }),
    ];
    for (let i = 1; i < items.length; i++) {
      // DOCUMENT_POSITION_FOLLOWING: each comes after the previous one.
      expect(items[i - 1].compareDocumentPosition(items[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('lists all 36 states and the FCT, starting on Ogun, and marks unserved ones', () => {
    renderAt('/');
    const select = within(header()).getAllByLabelText('Your state')[0];
    expect(NIGERIAN_STATES).toHaveLength(37);
    expect(within(select).getAllByRole('option')).toHaveLength(37);
    expect(select).toHaveValue('Ogun');
    expect(within(select).getByRole('option', { name: 'Ogun' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Kano (coming soon)' })).toBeInTheDocument();
  });

  it('choosing a state we don’t serve explains where we are, and is remembered', async () => {
    const user = userEvent.setup();
    const { unmount } = renderAt('/');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.selectOptions(within(header()).getAllByLabelText('Your state')[0], 'Kano');
    expect(screen.getByRole('status')).toHaveTextContent('ChopNow isn’t delivering in Kano yet');
    expect(screen.getByRole('status')).toHaveTextContent('Sagamu, Ogun State');
    unmount();
    renderAt('/');
    expect(within(header()).getAllByLabelText('Your state')[0]).toHaveValue('Kano');
  });

  it('Contact us opens on hover with FAQ, Product and Ad, and closes when the pointer leaves', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const trigger = within(header()).getByRole('button', { name: /Contact us/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.hover(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(trigger.getAttribute('aria-controls'));
    expect(within(panel).getAllByRole('link').map((a) => a.querySelector('span').textContent)).toEqual(['FAQ', 'Product', 'Ad']);
    await user.unhover(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
  });

  it('Contact us also works from the keyboard: Enter opens, Escape closes', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const trigger = within(header()).getByRole('button', { name: /Contact us/ });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('the Contact us items lead to their pages', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const trigger = within(header()).getByRole('button', { name: /Contact us/ });
    await user.click(trigger);
    await user.click(within(document.getElementById(trigger.getAttribute('aria-controls'))).getByRole('link', { name: /^Ad/ }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Get your business seen');
  });
});

describe('pages', () => {
  it('Vendor page: the headline and the two buttons go to the vendor portal', () => {
    renderAt('/vendors');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sell More.Grow More.');
    expect(screen.getByText(/Join thousands of restaurants, buka's reaching millions of customers daily on Chopnow\./)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Start selling on ChopNow' })[0]).toHaveAttribute('href', links.vendorSignUp);
    expect(screen.getAllByRole('link', { name: 'Log in' })[0]).toHaveAttribute('href', links.vendorLogIn);
  });

  it('Rider page: Google Play and App Store buttons (shown as coming soon until the app is published)', () => {
    renderAt('/riders');
    const stores = screen.getAllByRole('list', { name: 'Get the ChopNow Rider app' })[0];
    expect(within(stores).getByText('Google Play')).toBeInTheDocument();
    expect(within(stores).getByText('App Store')).toBeInTheDocument();
  });

  it('About page: the founder’s photo, then name, nickname and role', () => {
    renderAt('/about');
    const photo = screen.getByRole('img', { name: /Idowu Adetunji/ });
    const name = screen.getByRole('heading', { name: /Idowu Adetunji O\. \(Window T\)/ });
    expect(photo).toHaveAttribute('src', '/team/idowu-adetunji.webp');
    expect(photo.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // photo first (left)
    expect(screen.getByText('CEO / Co-founder')).toBeInTheDocument();
  });

  it('every page renders a single main heading', () => {
    for (const path of ['/', '/about', '/vendors', '/riders', '/faq', '/product', '/advertise', '/contact', '/nope']) {
      const { unmount } = renderAt(path);
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      unmount();
    }
  });
});

describe('store buttons', () => {
  it('link to a store once a URL is set, and say "Coming soon" (not a dead link) until then', () => {
    render(<StoreButtons urls={{ googlePlay: 'https://play.google.com/store/apps/details?id=app.chopnow.rider', appStore: '' }} appName="ChopNow Rider app" />);
    expect(screen.getByRole('link', { name: /Google Play: ChopNow Rider app/ })).toHaveAttribute('href', 'https://play.google.com/store/apps/details?id=app.chopnow.rider');
    expect(screen.queryByRole('link', { name: /App Store/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('ChopNow Rider app on App Store: coming soon')).toBeInTheDocument();
  });
});
