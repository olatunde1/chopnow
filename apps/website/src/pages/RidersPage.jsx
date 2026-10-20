import { Banknote, Clock, IdCard, MapPin, Navigation, Smartphone, Wallet } from 'lucide-react';
import { faqs, links } from '../content/site';
import { StoreButtons } from '../components/StoreButtons';
import { Eyebrow, FeatureGrid, PageHero, Section, Steps } from '../components/ui';
import { FaqList } from './FaqPage';

/** A sketch of a rider's job offer (decorative). */
function OfferMock() {
  return (
    <div className="mx-auto max-w-sm rounded-[2rem] bg-ink p-6 text-cream shadow-xl" aria-hidden>
      <p className="text-sm font-bold uppercase tracking-widest text-brand-soft">New delivery offer</p>
      <p className="mt-3 text-4xl font-black">Earn on this job</p>
      <div className="mt-5 space-y-3 rounded-2xl bg-white/10 p-4">
        <p className="flex items-center gap-2">
          <MapPin className="size-5 text-brand-soft" /> Pick up: Mama’s Kitchen, Makun
        </p>
        <p className="flex items-center gap-2">
          <Navigation className="size-5 text-brand-soft" /> Drop off: Sabo
        </p>
        <p className="flex items-center gap-2">
          <Banknote className="size-5 text-brand-soft" /> Cash to collect shown upfront
        </p>
      </div>
      <div className="mt-5 grid grid-cols-[1fr_2fr] gap-3">
        <span className="rounded-full border-2 border-white/30 py-2.5 text-center font-bold">Decline</span>
        <span className="rounded-full bg-brand py-2.5 text-center font-bold text-white">Accept</span>
      </div>
    </div>
  );
}

export function RidersPage() {
  return (
    <>
      <PageHero
        eyebrow="For riders"
        title={
          <>
            Ride with ChopNow.
            <br />
            <span className="text-brand">Earn on your schedule.</span>
          </>
        }
        actions={<StoreButtons urls={links.riderApp} appName="ChopNow Rider app" />}
        aside={<OfferMock />}
      >
        Deliver food from local restaurants to customers across your town. Go online when you want to work, see what each job pays before you accept it, and get paid for every delivery.
      </PageHero>

      <Section tone="white" labelledBy="rider-why">
        <Eyebrow>Why ride with us</Eyebrow>
        <h2 id="rider-why" className="mb-10 max-w-3xl text-3xl font-black tracking-tight sm:text-5xl">
          Flexible work, clear earnings
        </h2>
        <FeatureGrid
          items={[
            { icon: Clock, title: 'Work when you want', text: 'Switch online for offers and offline when you’re done. No fixed shifts.' },
            { icon: Wallet, title: 'Know what you earn', text: 'Every offer shows your earning before you accept, and the app keeps a record of every payout.' },
            { icon: Navigation, title: 'Simple deliveries', text: 'Clear pickup and drop-off details, with one-tap directions and a delivery PIN to finish each job.' },
          ]}
        />
      </Section>

      <Section labelledBy="rider-needs">
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <Eyebrow>What you need</Eyebrow>
            <h2 id="rider-needs" className="text-3xl font-black tracking-tight sm:text-5xl">
              Ready to ride?
            </h2>
            <ul className="mt-8 space-y-4 text-lg">
              {[
                [Smartphone, 'A smartphone with mobile data'],
                [Navigation, 'A motorcycle or a bicycle'],
                [IdCard, 'A valid government ID'],
                [IdCard, 'For motorcycles: a driver’s licence and vehicle papers'],
              ].map(([Icon, text]) => (
                <li key={text} className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-dark">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <Eyebrow>Get started in 3</Eyebrow>
            <Steps
              steps={[
                ['Download the app', 'Get the ChopNow Rider app and create your account.'],
                ['Upload your documents', 'Add your ID and vehicle details. We review every application.'],
                ['Go online', 'Once approved, go online and start accepting deliveries.'],
              ]}
            />
          </div>
        </div>
      </Section>

      <Section tone="white" labelledBy="rider-faq">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.5fr]">
          <h2 id="rider-faq" className="text-3xl font-black tracking-tight sm:text-5xl">
            Questions from riders
          </h2>
          <FaqList items={faqs.Riders} />
        </div>
      </Section>

      <section aria-labelledby="rider-download" className="px-5 pb-20 sm:px-8">
        <div className="mx-auto max-w-6xl rounded-[2.5rem] bg-brand px-8 py-14 text-white sm:px-14">
          <h2 id="rider-download" className="text-3xl font-black tracking-tight sm:text-5xl">
            Start earning with ChopNow
          </h2>
          <StoreButtons urls={links.riderApp} appName="ChopNow Rider app" tone="light" className="mt-8" />
        </div>
      </section>
    </>
  );
}
