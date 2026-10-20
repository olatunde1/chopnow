import { Link } from 'react-router';
import { ArrowRight, Banknote, Bike, CheckCircle2, Clock, KeyRound, MapPin, Search, ShieldCheck, Store, Users, Utensils } from 'lucide-react';
import { faqs, links, SERVICE_AREAS } from '../content/site';
import { useLocationChoice } from '../components/location';
import { StoreButtons } from '../components/StoreButtons';
import { ButtonLink, Eyebrow, Section, Steps } from '../components/ui';
import { FaqList } from './FaqPage';

/** A phone showing an order on its way, drawn in CSS (no stock photos). */
function PhoneMock() {
  return (
    <div className="relative mx-auto w-full max-w-sm" aria-hidden>
      <div className="absolute -inset-y-6 inset-x-0 -z-10 rounded-[3rem] bg-brand-soft sm:-inset-6" />
      <div className="rounded-[2.5rem] border-[10px] border-ink bg-cream p-5 shadow-2xl">
        <div className="mx-auto mb-5 h-1.5 w-20 rounded-full bg-ink/20" />
        <p className="text-sm text-ink-muted">Deliver to</p>
        <p className="font-bold">Sabo, Sagamu</p>
        <div className="mt-4 rounded-2xl bg-surface p-4 ring-1 ring-line">
          <div className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-xl bg-brand-soft text-xl font-black text-brand-dark">M</span>
            <div>
              <p className="font-bold">Mama’s Kitchen</p>
              <p className="text-sm text-ink-muted">Smoky jollof · Grilled chicken</p>
            </div>
          </div>
          <ol className="mt-4 space-y-2.5 text-sm">
            {[
              ['Order accepted', true],
              ['Food is being prepared', true],
              ['Rider is on the way', true],
              ['Delivered', false],
            ].map(([t, done]) => (
              <li key={t} className="flex items-center gap-2">
                <CheckCircle2 className={`size-5 ${done ? 'text-ok' : 'text-line'}`} />
                <span className={done ? 'font-semibold' : 'text-ink-muted'}>{t}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="mt-4 rounded-2xl bg-ink p-4 text-cream">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-soft">Delivery PIN</p>
          <p className="mt-1 text-3xl font-black tracking-[0.3em]">4 8 2 6</p>
          <p className="mt-1 text-xs text-cream/75">Share only with your rider</p>
        </div>
      </div>
    </div>
  );
}

const FEATURES = ['Live order tracking', 'Pay online or cash on delivery', 'Secure delivery PIN', 'Your favourite local spots', 'Verified restaurants', 'Friendly local riders', 'See the full price before you pay', 'Support for customers, vendors and riders'];

export function HomePage() {
  const { state, served } = useLocationChoice();
  const live = Object.entries(SERVICE_AREAS).flatMap(([s, cities]) => cities.map((c) => `${c}, ${s}`));
  return (
    <>
      <section className="px-5 pb-20 pt-12 sm:px-8 sm:pt-20">
        <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <Eyebrow>Now delivering in Sagamu</Eyebrow>
            <h1 className="text-5xl font-black leading-[1.02] tracking-tight sm:text-7xl">
              Hungry?
              <br />
              <span className="text-brand">ChopNow.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-muted">
              Order jollof, amala, suya and more from the restaurants and bukas you love. Pay online or with cash, watch your order move, and receive it with a delivery PIN only you know.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink to={links.order} size="lg" icon={Utensils}>
                Order now
              </ButtonLink>
              <ButtonLink to="/vendors" size="lg" variant="outline">
                Sell on ChopNow
              </ButtonLink>
            </div>
          </div>
          <PhoneMock />
        </div>
      </section>

      <Section tone="white" labelledBy="join-heading">
        <Eyebrow>Join the ChopNow family</Eyebrow>
        <h2 id="join-heading" className="max-w-2xl text-3xl font-black tracking-tight sm:text-5xl">
          Grow with us
        </h2>
        <ul className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            { icon: Store, title: 'Start selling', text: 'Own a restaurant, buka or kitchen? Reach new customers in your area, and let our riders handle the delivery.', to: '/vendors', cta: 'Sell on ChopNow' },
            { icon: Bike, title: 'Ride with us', text: 'Earn on your own schedule delivering food across your town. Go online when you want offers, offline when you’re done.', to: '/riders', cta: 'Become a rider' },
            { icon: Users, title: 'Behind the scenes', text: 'We’re a young team building ChopNow from Sagamu. Meet the people behind it and the journey ahead.', to: '/about', cta: 'About us' },
          ].map(({ icon: Icon, title, text, to, cta }) => (
            <li key={title} className="flex flex-col rounded-3xl bg-cream p-7 ring-1 ring-line">
              <span className="grid size-14 place-items-center rounded-2xl bg-brand text-white">
                <Icon className="size-7" aria-hidden />
              </span>
              <h3 className="mt-5 text-2xl font-bold">{title}</h3>
              <p className="mt-2 flex-1 leading-relaxed text-ink-muted">{text}</p>
              <Link to={to} className="mt-6 inline-flex items-center gap-2 font-bold text-brand hover:underline">
                {cta}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="steps-heading">
        <div className="mb-10 max-w-2xl">
          <Eyebrow>Get started in 3</Eyebrow>
          <h2 id="steps-heading" className="text-3xl font-black tracking-tight sm:text-5xl">
            Food at your door, in three steps
          </h2>
        </div>
        <Steps
          steps={[
            ['Find your food', 'Search for a dish or browse restaurants open near you. Customise it with sizes and extras.'],
            ['Pay your way', 'Pay online with card, bank transfer or USSD, or choose cash on delivery. You see the full price, delivery included, before you pay.'],
            ['Track and receive', 'Follow your order from the kitchen to your door, and give your rider your delivery PIN when it arrives.'],
          ]}
        />
      </Section>

      <section aria-label="What you get with ChopNow" className="overflow-hidden bg-brand py-6 text-white">
        <ul className="marquee flex w-max gap-10 whitespace-nowrap text-lg font-bold">
          {[...FEATURES, ...FEATURES].map((f, i) => (
            <li key={i} className="flex items-center gap-10" aria-hidden={i >= FEATURES.length}>
              {f}
              <span className="text-brand-soft" aria-hidden>
                ✦
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Section tone="white" labelledBy="why-heading">
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <Eyebrow>Why ChopNow</Eyebrow>
            <h2 id="why-heading" className="text-3xl font-black tracking-tight sm:text-5xl">
              Built for how we really order
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-ink-muted">Cash or transfer, busy roads, a buka you’ve trusted for years: ChopNow is designed around everyday ordering in Nigeria.</p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {[
              [Banknote, 'Cash or online', 'Pay with card, transfer or USSD, or hand cash to your rider.'],
              [KeyRound, 'Delivery PIN', 'Your order is only completed when you give the rider your code.'],
              [Clock, 'Live updates', 'Know when it’s accepted, cooking, picked up and on its way.'],
              [ShieldCheck, 'Verified partners', 'Every restaurant and rider is checked before they join.'],
            ].map(([Icon, t, d]) => (
              <li key={t} className="rounded-3xl bg-cream p-6 ring-1 ring-line">
                <Icon className="size-7 text-brand" aria-hidden />
                <h3 className="mt-3 text-lg font-bold">{t}</h3>
                <p className="mt-1 text-ink-muted">{d}</p>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section tone="dark" labelledBy="where-heading">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.14em] text-brand-soft">Where we deliver</p>
            <h2 id="where-heading" className="text-3xl font-black tracking-tight sm:text-5xl">
              Starting in Sagamu. Coming to you next.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-cream/85">
              We’re launching in Sagamu, Ogun State, so we can get every order right with our first restaurants, riders and customers, before growing to more towns and states.
            </p>
            <p className="mt-4 text-cream/85">
              {served ? (
                <>
                  Good news: ChopNow is live in <strong className="text-white">{state}</strong>.
                </>
              ) : (
                <>
                  Not in <strong className="text-white">{state}</strong> yet?{' '}
                  <Link to="/contact" className="font-bold text-brand-soft underline">
                    Tell us you want ChopNow there
                  </Link>
                  .
                </>
              )}
            </p>
          </div>
          <ul className="grid gap-3">
            {live.map((place) => (
              <li key={place} className="flex items-center gap-4 rounded-3xl bg-white/10 p-6">
                <MapPin className="size-8 text-brand-soft" aria-hidden />
                <div>
                  <p className="text-xl font-bold">{place} State</p>
                  <p className="text-cream/75">Live now</p>
                </div>
              </li>
            ))}
            <li className="flex items-center gap-4 rounded-3xl border-2 border-dashed border-white/25 p-6">
              <Search className="size-8 text-cream/60" aria-hidden />
              <p className="text-cream/80">More towns and states coming soon</p>
            </li>
          </ul>
        </div>
      </Section>

      <Section labelledBy="faq-heading">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.5fr]">
          <div>
            <Eyebrow>FAQs</Eyebrow>
            <h2 id="faq-heading" className="text-3xl font-black tracking-tight sm:text-5xl">
              Questions? We’ve got answers.
            </h2>
            <Link to="/faq" className="mt-6 inline-flex items-center gap-2 font-bold text-brand hover:underline">
              See all FAQs
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <FaqList items={[...faqs.Ordering.slice(0, 3), faqs.Payments[0]]} />
        </div>
      </Section>

      <section id="download" aria-labelledby="download-heading" className="px-5 pb-20 sm:px-8">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-[2.5rem] bg-brand px-8 py-14 text-white sm:px-14">
          <h2 id="download-heading" className="max-w-2xl text-3xl font-black tracking-tight sm:text-5xl">
            Place your order in seconds
          </h2>
          <p className="mt-4 max-w-xl text-lg text-white/90">Get the ChopNow app and order from the best spots in Sagamu.</p>
          <StoreButtons urls={links.customerApp} appName="ChopNow app" tone="light" className="mt-8" />
        </div>
      </section>
    </>
  );
}
