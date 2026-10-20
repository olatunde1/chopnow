import { HeartHandshake, MapPin, ShieldCheck, Sparkles } from 'lucide-react';
import { team } from '../content/site';
import { ButtonLink, Eyebrow, FeatureGrid, PageHero, Section } from '../components/ui';

/** One person: photo on the left, their story on the right (stacks on phones). */
function TeamMember({ person }) {
  const id = `person-${person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  return (
    <article className="grid items-center gap-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" aria-labelledby={id}>
      <div className="relative mx-auto w-full max-w-sm md:max-w-none">
        <div className="absolute -bottom-4 -left-4 -z-10 h-full w-full rounded-[2rem] bg-brand-soft" aria-hidden />
        <img src={person.photo} alt={person.photoAlt} width="590" height="1280" loading="lazy" className="aspect-[4/5] w-full rounded-[2rem] object-cover object-top shadow-lg" />
      </div>
      <div>
        <h3 id={id} className="text-3xl font-black tracking-tight sm:text-4xl">
          {person.name}
          {person.nickname ? (
            <>
              {' '}
              <span className="text-brand">({person.nickname})</span>
            </>
          ) : null}
        </h3>
        <p className="mt-2 text-lg font-bold uppercase tracking-[0.12em] text-ink-muted">{person.role}</p>
        <div className="mt-6 space-y-4 text-lg leading-relaxed text-ink-muted">
          {person.bio.map((p) => (
            <p key={p.slice(0, 24)}>{p}</p>
          ))}
        </div>
      </div>
    </article>
  );
}

export function AboutPage() {
  return (
    <>
      <PageHero eyebrow="About us" title="Good food, close to home">
        ChopNow connects people with the restaurants, bukas and kitchens around them, and with local riders who bring the food to their door. We’re starting in Sagamu, Ogun State.
      </PageHero>

      <Section tone="white" labelledBy="mission-heading">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <Eyebrow>Our mission</Eyebrow>
            <h2 id="mission-heading" className="text-3xl font-black tracking-tight sm:text-5xl">
              Make local food easy to get, and good business for everyone who makes it happen
            </h2>
          </div>
          <div className="space-y-5 text-lg leading-relaxed text-ink-muted">
            <p>Some of the best food in Nigeria comes from small kitchens and bukas that most people outside their street never hear about. ChopNow gives them a simple way to take orders online, reach new customers and get paid properly.</p>
            <p>For customers, that means more choice, honest prices you can see before you pay, and the freedom to pay online or with cash. For riders, it means flexible work with clear earnings on every job.</p>
            <p>We’re starting small on purpose: getting every order right in one town first, then growing across Ogun State and beyond.</p>
          </div>
        </div>
      </Section>

      <Section labelledBy="values-heading">
        <Eyebrow>What we stand for</Eyebrow>
        <h2 id="values-heading" className="mb-10 text-3xl font-black tracking-tight sm:text-5xl">
          Our values
        </h2>
        <FeatureGrid
          columns={4}
          items={[
            { icon: MapPin, title: 'Local first', text: 'We grow with the communities we serve, one town at a time.' },
            { icon: ShieldCheck, title: 'Trust', text: 'Verified partners, delivery PINs and clear prices on every order.' },
            { icon: HeartHandshake, title: 'Fair partnerships', text: 'Restaurants and riders should earn well from every order they help complete.' },
            { icon: Sparkles, title: 'Simple', text: 'Ordering, selling and delivering should take a few taps, not a manual.' },
          ]}
        />
      </Section>

      <Section tone="white" labelledBy="team-heading">
        <Eyebrow>The team</Eyebrow>
        <h2 id="team-heading" className="mb-12 text-3xl font-black tracking-tight sm:text-5xl">
          The people behind ChopNow
        </h2>
        <div className="space-y-20">
          {team.map((person) => (
            <TeamMember key={person.name} person={person} />
          ))}
        </div>
        <div className="mt-20 rounded-[2rem] bg-cream p-8 ring-1 ring-line sm:p-12">
          <h3 className="text-2xl font-black">More of the team, coming soon</h3>
          <p className="mt-3 max-w-2xl text-lg text-ink-muted">We’re growing. If you want to help build the future of local food delivery, we’d love to hear from you.</p>
          <ButtonLink to="/contact" className="mt-6">
            Get in touch
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
