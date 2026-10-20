import { ChevronDown } from 'lucide-react';
import { Link } from 'react-router';
import { faqs } from '../content/site';
import { PageHero, Section } from '../components/ui';

/** Expandable questions (native details/summary: keyboard and screen-reader friendly). */
export function FaqList({ items }) {
  return (
    <div className="divide-y divide-line rounded-3xl bg-surface ring-1 ring-line">
      {items.map(([q, a]) => (
        <details key={q} className="group px-6 py-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-bold [&::-webkit-details-marker]:hidden">
            {q}
            <ChevronDown className="size-5 shrink-0 text-brand transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="mt-3 leading-relaxed text-ink-muted">{a}</p>
        </details>
      ))}
    </div>
  );
}

export function FaqPage() {
  return (
    <>
      <PageHero eyebrow="FAQ" title="Frequently asked questions">
        Everything about ordering, paying, selling and riding with ChopNow. Can’t find your answer?{' '}
        <Link to="/contact" className="font-semibold text-brand underline">
          Get in touch
        </Link>
        .
      </PageHero>
      <Section tone="white" className="pt-12 sm:pt-16">
        <div className="space-y-14">
          {Object.entries(faqs).map(([group, items]) => (
            <section key={group} aria-labelledby={`faq-${group}`}>
              <h2 id={`faq-${group}`} className="mb-5 text-2xl font-black">
                {group}
              </h2>
              <FaqList items={items} />
            </section>
          ))}
        </div>
      </Section>
    </>
  );
}
