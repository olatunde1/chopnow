import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { url } from '../ports.mjs';

/**
 * The spec §21 acceptance journey, driven through the four real apps in one browser:
 * admin approves a restaurant → its owner adds a dish and opens → a customer finds it, customises
 * it and orders with cash → the restaurant accepts and readies it → a rider is offered the job,
 * collects it and completes it with the customer's PIN → the customer sees it delivered → an
 * administrator inspects the order and its financial history. Every page visited is axe-scanned.
 *
 * Accounts are the clearly marked seed accounts (@chopnow.test). The password is never written
 * here: it is SEED_USER_PASSWORD or the development default read from the seed source.
 */
const PASSWORD =
  process.env.SEED_USER_PASSWORD ??
  readFileSync(new URL('../../../services/api/src/db/seed/dev-seed.ts', import.meta.url), 'utf8').match(/DEFAULT_SEED_PASSWORD = '([^']+)'/)[1];
const email = (who) => `${who}@chopnow.test`;

// Grandma's Pot sits at the seed area centre (Sagamu) offset by (-0.002, -0.005); the rider waits nearby.
const NEAR_RESTAURANT = { latitude: 6.8381, longitude: 3.6422 };
// The customer's new delivery address, ~0.7 km from the restaurant (under 2 km, so the ₦500 base fee).
const NEW_ADDRESS = { latitude: 6.844, longitude: 3.644 };
const DISH = 'Grandma’s Smoky Jollof Rice';
const PRICE = 3200; // ₦
const EXTRA = { name: 'Boiled egg', price: 300 };

/** Fails on serious/critical accessibility violations; lesser ones are reported in the test output. */
async function axe(page, name) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  for (const v of violations) console.log(`[axe:${name}] ${v.impact} ${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
  if (process.env.E2E_AXE_SOFT === '1') return; // survey mode: log everything, fail nothing
  expect(blocking.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`), `serious accessibility issues on ${name}`).toEqual([]);
}

async function webSignIn(page, app, who) {
  await page.goto(url(app));
  await page.getByLabel('Email').fill(email(who));
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe.configure({ mode: 'serial' });

test('a customer orders a meal and receives a completed delivery (spec §21)', async ({ browser }) => {
  const shared = { timezoneId: 'Africa/Lagos', locale: 'en-NG' };
  const admin = await (await browser.newContext(shared)).newPage();
  const vendor = await (await browser.newContext(shared)).newPage();
  const customer = await (await browser.newContext({ ...shared, viewport: { width: 420, height: 860 }, permissions: ['geolocation'], geolocation: NEW_ADDRESS })).newPage();
  const riderCtx = await browser.newContext({ ...shared, viewport: { width: 420, height: 860 }, permissions: ['geolocation'], geolocation: NEAR_RESTAURANT });
  const rider = await riderCtx.newPage();

  // The portals are served with the production Content-Security-Policy; anything it blocks fails the run.
  const cspViolations = [];
  for (const [name, page] of [['admin', admin], ['vendor', vendor]]) {
    page.on('console', (m) => {
      if (/Content Security Policy/i.test(m.text())) cspViolations.push(`${name}: ${m.text().slice(0, 200)}`);
    });
  }

  await test.step('1. an administrator approves the new restaurant', async () => {
    await webSignIn(admin, 'admin', 'admin');
    await expect(admin.getByRole('navigation').first()).toBeVisible();
    await axe(admin, 'admin dashboard');
    await admin.goto(`${url('admin')}/restaurants`);
    const row = admin.getByRole('row', { name: /Grandma’s Pot|Grandma's Pot/ });
    await row.click();
    const dialog = admin.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await axe(admin, 'admin restaurant review');
    await dialog.getByRole('button', { name: 'Approve' }).click();
    await expect(admin.getByText('Restaurant approved')).toBeVisible();
  });

  await test.step('2. the restaurant creates its menu and opens for orders', async () => {
    await webSignIn(vendor, 'vendor', 'vendor.pending');
    const accepting = vendor.getByRole('switch', { name: 'Accepting orders' });
    await expect(accepting).toBeEnabled();
    await axe(vendor, 'vendor dashboard');

    await vendor.goto(`${url('vendor')}/menu`);
    await vendor.getByRole('button', { name: /^Add (first )?category$/ }).first().click();
    await vendor.getByLabel('Category name').fill('Rice');
    await vendor.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(vendor.getByText('Category saved')).toBeVisible();

    await vendor.getByRole('button', { name: 'Add dish' }).first().click();
    const editor = vendor.getByRole('dialog');
    await editor.getByLabel('Dish name').fill(DISH);
    await editor.getByLabel('Description').fill('Firewood party jollof with fried plantain. [Test data]');
    await editor.getByLabel('Price (₦)').first().fill(String(PRICE));
    await editor.getByRole('button', { name: 'Add extra' }).click();
    await editor.getByLabel('Extra', { exact: true }).fill(EXTRA.name);
    await editor.getByLabel('Price (₦)').last().fill(String(EXTRA.price));
    await axe(vendor, 'vendor dish editor');
    await editor.getByRole('button', { name: 'Add dish' }).click();
    await expect(editor).toBeHidden();
    await expect(vendor.getByText(DISH, { exact: true })).toBeVisible();

    await accepting.click();
    await expect(accepting).toHaveAttribute('aria-checked', 'true');
    await vendor.goto(`${url('vendor')}/orders`);
    await axe(vendor, 'vendor orders board');
  });

  let orderPath;
  let pin;
  await test.step('3–10. the customer searches for jollof rice, customises a meal, enters an address and orders with cash', async () => {
    await customer.goto(`${url('customer')}/sign-in`);
    await customer.getByTestId('email').filter({ visible: true }).fill(email('ada'));
    await customer.getByTestId('password').filter({ visible: true }).fill(PASSWORD);
    await axe(customer, 'customer sign-in');
    await customer.getByTestId('sign-in-submit').filter({ visible: true }).click();
    await expect(customer.getByText(/Welcome back, /)).toBeVisible();

    await customer.goto(`${url('customer')}/search`);
    await customer.getByTestId('search-input').filter({ visible: true }).fill('jollof rice');
    // Eligible restaurants' meals: the new dish alongside the seeded ones; the closed and pending restaurants stay out.
    const results = customer.locator('[data-testid^="food-"]').filter({ visible: true });
    const result = results.filter({ hasText: DISH }).first();
    await expect(result).toBeVisible();
    expect(await results.count()).toBeGreaterThan(1);
    await expect(results.filter({ hasText: 'Suya Spot' })).toHaveCount(0);
    await axe(customer, 'customer search');
    await result.click();

    // The restaurant page opens straight onto the dish sheet.
    const extra = customer.getByRole('checkbox', { name: EXTRA.name }).filter({ visible: true });
    await extra.click();
    await expect(extra).toHaveAttribute('aria-checked', 'true');
    await expect(customer.getByTestId('add-to-cart').filter({ visible: true })).toContainText('₦3,500');
    await axe(customer, 'customer dish sheet');
    await customer.getByTestId('add-to-cart').filter({ visible: true }).click();
    await customer.getByTestId('cart-bar').filter({ visible: true }).click();
    await expect(customer.getByText(DISH, { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await axe(customer, 'customer cart');
    await customer.getByTestId('go-to-checkout').filter({ visible: true }).click();

    // Step 8: enter a new delivery address, pinned with the phone's location.
    await customer.getByRole('button', { name: 'Add a new address' }).filter({ visible: true }).click();
    await customer.getByLabel('Label', { exact: true }).filter({ visible: true }).fill('Work');
    await customer.getByTestId('line1').filter({ visible: true }).fill('27 Akarigbo Street');
    await customer.getByLabel('Area', { exact: true }).filter({ visible: true }).fill('Makun');
    await customer.getByLabel('City', { exact: true }).filter({ visible: true }).fill('Sagamu');
    await customer.getByRole('button', { name: 'Use my location' }).filter({ visible: true }).click();
    await expect(customer.getByText('Map pin set').filter({ visible: true })).toBeVisible();
    await axe(customer, 'customer address form');
    await customer.getByTestId('save-address').filter({ visible: true }).click();
    await expect(customer.getByText('27 Akarigbo Street').filter({ visible: true }).first()).toBeVisible();

    await customer.getByTestId('pay-cash').filter({ visible: true }).click();
    // Food ₦3,500 + delivery ₦500 + service 5% (₦175) = ₦4,175, priced by the server.
    await expect(customer.getByText('₦4,175').first()).toBeVisible();
    await axe(customer, 'customer checkout');
    await customer.getByTestId('place-order').filter({ visible: true }).click();

    await customer.waitForURL(/\/orders\/[^/]+$/);
    orderPath = new URL(customer.url()).pathname;
    pin = (await customer.getByTestId('delivery-pin').filter({ visible: true }).textContent()).trim();
    expect(pin).toMatch(/^\d{4}$/);
    await axe(customer, 'customer order tracking');
  });

  await test.step('11–13. the restaurant receives, accepts and prepares the order', async () => {
    const card = vendor.getByRole('article', { name: /^Order .+, / });
    await expect(card).toBeVisible({ timeout: 20_000 }); // the board polls every 10 s
    await card.getByRole('button', { name: 'Accept' }).click();
    await vendor.getByLabel('How long will it take?').selectOption('15');
    await vendor.getByRole('button', { name: 'Accept order' }).click();
    await card.getByRole('button', { name: 'Start preparing' }).click();
    await card.getByRole('button', { name: 'Ready for pickup' }).click();
    await expect(vendor.getByRole('region', { name: 'Ready for pickup' }).getByRole('article')).toBeVisible();
    await expect(customer.getByText(/ready/i).first()).toBeVisible({ timeout: 20_000 });
  });

  await test.step('14–16, 18. a rider is offered the job, confirms pickup and completes it with the customer’s PIN', async () => {
    await rider.goto(`${url('rider')}/sign-in`);
    await rider.getByTestId('email').filter({ visible: true }).fill(email('rider.core1'));
    await rider.getByTestId('password').filter({ visible: true }).fill(PASSWORD);
    await axe(rider, 'rider sign-in');
    await rider.getByTestId('sign-in-submit').filter({ visible: true }).click();
    const online = rider.getByTestId('online-switch').filter({ visible: true });
    await expect(online).toBeVisible();
    // The seed has this rider online already; switch on only if needed.
    if (await rider.getByText('You’re offline').filter({ visible: true }).isVisible()) await online.click();
    await expect(rider.getByText('You’re online').filter({ visible: true })).toBeVisible();

    // Dispatch runs every 5 s and needs the rider's fresh location, which the app reports on going online.
    const offer = rider.getByTestId('offer-card').filter({ visible: true });
    await expect(offer).toBeVisible({ timeout: 45_000 });
    await axe(rider, 'rider offer');
    await rider.getByTestId('accept-offer').filter({ visible: true }).click();

    await expect(rider.getByTestId('delivery-panel').filter({ visible: true })).toBeVisible();
    await rider.getByRole('button', { name: 'I’ve arrived at the restaurant' }).click();
    await rider.getByRole('button', { name: 'I’ve collected the food' }).click();
    await expect(customer.getByText(/on the way|picked up/i).first()).toBeVisible({ timeout: 20_000 });

    await rider.getByTestId('cash-input').filter({ visible: true }).fill('4175');
    await rider.getByTestId('pin-input').filter({ visible: true }).fill(pin === '0000' ? '1111' : '0000');
    await rider.getByTestId('complete-delivery').filter({ visible: true }).click();
    await expect(rider.getByTestId('complete-error').filter({ visible: true })).toBeVisible();

    await rider.getByTestId('pin-input').filter({ visible: true }).fill(pin);
    await axe(rider, 'rider delivery');
    await rider.getByTestId('complete-delivery').filter({ visible: true }).click();
    await expect(rider.getByTestId('delivery-panel').filter({ visible: true })).toBeHidden();
  });

  await test.step('17. the customer receives the order and sees it delivered', async () => {
    await expect(customer.getByText('Delivered').first()).toBeVisible({ timeout: 20_000 });
    await expect(customer.getByTestId('delivery-pin').filter({ visible: true })).toBeHidden();
  });

  await test.step('19–21. cash collection recorded, proceeds split, and an administrator inspects the financial history', async () => {
    await admin.goto(`${url('admin')}${orderPath}`);
    await expect(admin.getByText('Delivered').first()).toBeVisible();
    const history = admin.locator('section, div').filter({ has: admin.getByRole('heading', { name: 'Financial history' }) }).last();
    await expect(history).toBeVisible();
    // Food ₦3,500 − 15% commission (₦525) = ₦2,975 to the restaurant; rider ₦400; ChopNow ₦525 + ₦100 + ₦175.
    await expect(history.getByText('Restaurant receives').locator('..')).toContainText('₦2,975');
    await expect(history.getByText('Rider earns').locator('..')).toContainText('₦400');
    await expect(history.getByText('ChopNow revenue').locator('..')).toContainText('₦800');
    await expect(history.getByText('Cash collected by rider', { exact: true })).toBeVisible();
    await expect(history.getByText('Order split on delivery', { exact: true })).toBeVisible();
    await axe(admin, 'admin order detail');
  });

  expect(cspViolations, 'the production CSP blocked something in a portal').toEqual([]);
});
