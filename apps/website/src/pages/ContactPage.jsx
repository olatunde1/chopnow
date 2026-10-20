import { Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { Link } from 'react-router';
import { contact } from '../content/site';
import { PageHero, Section } from '../components/ui';

export function ContactPage() {
  // Only details that have been set in content/site.js are shown.
  const channels = [
    contact.email && { icon: Mail, label: 'Email', value: contact.email, href: `mailto:${contact.email}` },
    contact.phone && { icon: Phone, label: 'Phone', value: contact.phone, href: `tel:${contact.phone.replace(/\s/g, '')}` },
    contact.whatsapp && { icon: MessageCircle, label: 'WhatsApp', value: contact.whatsapp, href: `https://wa.me/${contact.whatsapp.replace(/\D/g, '')}` },
  ].filter(Boolean);

  return (
    <>
      <PageHero eyebrow="Contact us" title="We’d love to hear from you">
        Questions about an order, selling on ChopNow, riding with us, advertising, or bringing ChopNow to your town? Reach out.
      </PageHero>
      <Section tone="white" className="pt-12 sm:pt-16">
        <div className="grid gap-6 md:grid-cols-2">
          {channels.length ? (
            channels.map(({ icon: Icon, label, value, href }) => (
              <a key={label} href={href} className="flex items-center gap-4 rounded-3xl bg-cream p-6 ring-1 ring-line hover:ring-brand">
                <Icon className="size-8 text-brand" aria-hidden />
                <span>
                  <span className="block text-sm font-bold uppercase tracking-wider text-ink-muted">{label}</span>
                  <span className="block text-lg font-bold">{value}</span>
                </span>
              </a>
            ))
          ) : (
            <div className="rounded-3xl bg-cream p-6 ring-1 ring-line">
              <p className="text-lg font-bold">Our support lines are being set up</p>
              <p className="mt-2 text-ink-muted">Phone, WhatsApp and email details will appear here before launch.</p>
            </div>
          )}
          <div className="flex items-center gap-4 rounded-3xl bg-cream p-6 ring-1 ring-line">
            <MapPin className="size-8 text-brand" aria-hidden />
            <span>
              <span className="block text-sm font-bold uppercase tracking-wider text-ink-muted">Where we are</span>
              <span className="block text-lg font-bold">{contact.address}</span>
            </span>
          </div>
        </div>
        <p className="mt-10 text-lg text-ink-muted">
          Looking for a quick answer? Try our{' '}
          <Link to="/faq" className="font-semibold text-brand underline">
            FAQ
          </Link>
          .
        </p>
      </Section>
    </>
  );
}
