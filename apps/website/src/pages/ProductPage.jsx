import { BadgePercent, BarChart3, Bike, ClipboardList, KeyRound, LayoutDashboard, MapPin, Search, Smartphone, Store, Wallet } from 'lucide-react';
import { links } from '../content/site';
import { StoreButtons } from '../components/StoreButtons';
import { ButtonLink, Eyebrow, PageHero, Section } from '../components/ui';

const PRODUCTS = [
  {
    icon: Smartphone,
    name: 'ChopNow app',
    for: 'For customers',
    text: 'Find food near you, order in a few taps, and follow it to your door.',
    features: [
      [Search, 'Search dishes and restaurants open near you'],
      [ClipboardList, 'Choose sizes and extras, with the full price before you pay'],
      [Wallet, 'Pay online (card, transfer, USSD) or cash on delivery'],
      [KeyRound, 'Live order updates and a delivery PIN for every order'],
    ],
  },
  {
    icon: LayoutDashboard,
    name: 'ChopNow for Restaurants',
    for: 'For vendors',
    text: 'A web dashboard that works on a laptop, tablet or phone.',
    features: [
      [ClipboardList, 'Live order board with sound alerts and accept timers'],
      [Store, 'Menu, photos, prices, sold-out switches and opening hours'],
      [BarChart3, 'Sales reports, top dishes and customer reviews'],
      [Wallet, 'Payout statements for every period'],
    ],
  },
  {
    icon: Bike,
    name: 'ChopNow Rider',
    for: 'For riders',
    text: 'Everything a rider needs to find, complete and get paid for deliveries.',
    features: [
      [MapPin, 'Delivery offers near you, with the earning shown upfront'],
      [KeyRound, 'Pickup and drop-off steps, finished with the customer’s PIN'],
      [Wallet, 'Earnings, payouts and cash records in one place'],
      [BadgePercent, 'Go online and offline whenever you like'],
    ],
  },
];

export function ProductPage() {
  return (
    <>
      <PageHero eyebrow="Product" title="One platform, three apps">
        ChopNow brings customers, restaurants and riders together. Each gets an app built for what they do.
      </PageHero>
      <Section tone="white" className="pt-12 sm:pt-16">
        <ul className="grid gap-6 lg:grid-cols-3">
          {PRODUCTS.map(({ icon: Icon, name, for: audience, text, features }) => (
            <li key={name} className="flex flex-col rounded-[2rem] bg-cream p-8 ring-1 ring-line">
              <span className="grid size-14 place-items-center rounded-2xl bg-brand text-white">
                <Icon className="size-7" aria-hidden />
              </span>
              <Eyebrow className="mt-6 mb-1">{audience}</Eyebrow>
              <h2 className="text-2xl font-black">{name}</h2>
              <p className="mt-2 text-ink-muted">{text}</p>
              <ul className="mt-6 space-y-3">
                {features.map(([FIcon, f]) => (
                  <li key={f} className="flex gap-3">
                    <FIcon className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Section>
      <Section labelledBy="product-cta">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <Eyebrow>Hungry already?</Eyebrow>
            <h2 id="product-cta" className="text-3xl font-black tracking-tight sm:text-4xl">
              Get the ChopNow app
            </h2>
            <StoreButtons urls={links.customerApp} appName="ChopNow app" className="mt-6" />
          </div>
          <div>
            <Eyebrow>Run a restaurant?</Eyebrow>
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Sell on ChopNow</h2>
            <ButtonLink to="/vendors" size="lg" className="mt-6">
              Learn more
            </ButtonLink>
          </div>
        </div>
      </Section>
    </>
  );
}
