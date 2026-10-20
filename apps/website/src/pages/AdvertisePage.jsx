import { BadgePercent, Megaphone, Sparkles, Store } from 'lucide-react';
import { ButtonLink, Eyebrow, FeatureGrid, PageHero, Section } from '../components/ui';

export function AdvertisePage() {
  return (
    <>
      <PageHero
        eyebrow="Advertise"
        title={
          <>
            Get your business <span className="text-brand">seen</span>
          </>
        }
        actions={
          <ButtonLink to="/contact" size="lg" icon={Megaphone}>
            Talk to us about advertising
          </ButtonLink>
        }
      >
        Put your restaurant, brand or product in front of hungry customers in Sagamu, right when they’re deciding what to eat.
      </PageHero>
      <Section tone="white" labelledBy="ad-options">
        <Eyebrow>Ways to promote</Eyebrow>
        <h2 id="ad-options" className="mb-10 text-3xl font-black tracking-tight sm:text-5xl">
          Advertising on ChopNow
        </h2>
        <FeatureGrid
          items={[
            { icon: BadgePercent, title: 'Promo codes', text: 'Run a discount for new or returning customers. Codes are checked automatically: dates, minimum spend and usage limits.' },
            { icon: Sparkles, title: 'Featured placement', text: 'Have your restaurant or dishes highlighted where customers browse. (Coming soon)' },
            { icon: Store, title: 'Brand partnerships', text: 'Food and drink brands: reach customers alongside the restaurants that serve you. (Coming soon)' },
          ]}
        />
        <p className="mt-10 max-w-2xl text-lg text-ink-muted">
          Advertising is opening up as ChopNow grows. Tell us what you’d like to promote, and we’ll work out what fits.
        </p>
      </Section>
    </>
  );
}
