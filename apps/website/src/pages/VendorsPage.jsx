import { BarChart3, BellRing, Bike, ClipboardList, LogIn, Store, Utensils, Wallet } from 'lucide-react';
import { faqs, links } from '../content/site';
import { ButtonLink, Eyebrow, FeatureGrid, PageHero, Section, Steps } from '../components/ui';
import { FaqList } from './FaqPage';

/** A sketch of the vendor order board (decorative). */
function BoardMock() {
  return (
    <div className="rounded-[2rem] bg-surface p-6 shadow-xl ring-1 ring-line" aria-hidden>
      <p className="text-sm font-bold uppercase tracking-widest text-ink-muted">Incoming orders</p>
      {[
        ['CN-7K2M', '2 × Smoky jollof, chicken', 'Accept within 4:58'],
        ['CN-Q9TX', 'Amala, ewedu & gbegiri', 'Accept within 7:31'],
      ].map(([code, items, timer]) => (
        <div key={code} className="mt-4 rounded-2xl bg-cream p-4 ring-1 ring-line">
          <div className="flex items-center justify-between">
            <p className="font-bold">{code}</p>
            <span className="rounded-full bg-warn-soft px-3 py-1 text-xs font-bold text-warn">New</span>
          </div>
          <p className="mt-1 text-ink-muted">{items}</p>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-sm text-ink-muted">{timer}</p>
            <span className="rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white">Accept</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function VendorsPage() {
  return (
    <>
      <PageHero
        eyebrow="For restaurants & bukas"
        title={
          <>
            Sell More.
            <br />
            <span className="text-brand">Grow More.</span>
          </>
        }
        actions={
          <>
            <ButtonLink to={links.vendorSignUp} size="lg" icon={Store}>
              Start selling on ChopNow
            </ButtonLink>
            <ButtonLink to={links.vendorLogIn} size="lg" variant="outline" icon={LogIn}>
              Log in
            </ButtonLink>
          </>
        }
        aside={<BoardMock />}
      >
        Join thousands of restaurants, buka&apos;s reaching millions of customers daily on Chopnow.
      </PageHero>

      <Section tone="white" labelledBy="vendor-why">
        <Eyebrow>Why sell on ChopNow</Eyebrow>
        <h2 id="vendor-why" className="mb-10 max-w-3xl text-3xl font-black tracking-tight sm:text-5xl">
          Everything you need to take orders online
        </h2>
        <FeatureGrid
          items={[
            { icon: Utensils, title: 'Reach new customers', text: 'People nearby find your dishes when they search for jollof, amala, suya and more.' },
            { icon: Bike, title: 'We handle delivery', text: 'A ChopNow rider collects each order from you and delivers it, so you can focus on cooking.' },
            { icon: BellRing, title: 'Never miss an order', text: 'New orders appear on your dashboard instantly, with a sound alert and a clear accept timer.' },
            { icon: ClipboardList, title: 'Your menu, your way', text: 'Add dishes, sizes and extras with photos, mark items sold out, and set your opening hours.' },
            { icon: Wallet, title: 'Clear payouts', text: 'See what you earned on every order, with a statement for each payout period.' },
            { icon: BarChart3, title: 'Know your numbers', text: 'Sales reports, top dishes and customer reviews, all in one place.' },
          ]}
        />
      </Section>

      <Section labelledBy="vendor-steps">
        <Eyebrow>Get started in 3</Eyebrow>
        <h2 id="vendor-steps" className="mb-10 text-3xl font-black tracking-tight sm:text-5xl">
          From sign-up to first order
        </h2>
        <Steps
          steps={[
            ['Create your account', 'Sign up in minutes with your name, phone number and email.'],
            ['Add your restaurant', 'Tell us your address, opening hours and menu, and upload your documents for verification.'],
            ['Go live', 'Once we’ve verified your business, switch on “Accepting orders” and start selling.'],
          ]}
        />
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink to={links.vendorSignUp} size="lg" icon={Store}>
            Start selling on ChopNow
          </ButtonLink>
          <ButtonLink to={links.vendorLogIn} size="lg" variant="outline" icon={LogIn}>
            Log in
          </ButtonLink>
        </div>
      </Section>

      <Section tone="white" labelledBy="vendor-faq">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.5fr]">
          <h2 id="vendor-faq" className="text-3xl font-black tracking-tight sm:text-5xl">
            Questions from vendors
          </h2>
          <FaqList items={faqs.Restaurants} />
        </div>
      </Section>
    </>
  );
}
