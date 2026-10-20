import { Link } from 'react-router';

const cx = (...c) => c.filter(Boolean).join(' ');

const BUTTON = {
  primary: 'bg-brand text-white hover:bg-brand-dark border-brand',
  secondary: 'bg-brand-soft text-brand-dark hover:bg-brand-soft-strong border-brand-soft',
  outline: 'bg-transparent text-ink hover:bg-surface border-ink/25',
  light: 'bg-cream text-ink hover:bg-white border-cream',
};

/** A link styled as a button. Internal paths use the router; anything else is a normal link. */
export function ButtonLink({ to, children, variant = 'primary', size = 'md', className, icon: Icon, ...props }) {
  const classes = cx(
    'inline-flex items-center justify-center gap-2 rounded-full border-2 font-semibold transition-colors',
    size === 'lg' ? 'min-h-13 px-7 text-base' : 'min-h-11 px-5 text-sm',
    BUTTON[variant],
    className,
  );
  const content = (
    <>
      {Icon ? <Icon className="size-5" aria-hidden /> : null}
      {children}
    </>
  );
  const internal = to.startsWith('/') && !to.startsWith('//');
  return internal ? (
    <Link to={to} className={classes} {...props}>
      {content}
    </Link>
  ) : (
    <a href={to} className={classes} {...props}>
      {content}
    </a>
  );
}

export function Section({ id, className, children, tone = 'cream', labelledBy }) {
  const tones = { cream: 'bg-cream', white: 'bg-surface', dark: 'bg-ink text-cream', brand: 'bg-brand text-white', muted: 'bg-surface-muted' };
  return (
    <section id={id} aria-labelledby={labelledBy} className={cx(tones[tone], 'px-5 py-16 sm:px-8 sm:py-24', className)}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

export function Eyebrow({ children, className }) {
  return <p className={cx('mb-3 text-sm font-bold uppercase tracking-[0.14em] text-brand', className)}>{children}</p>;
}

export function PageHero({ eyebrow, title, children, actions, aside }) {
  return (
    <section className="px-5 pb-16 pt-12 sm:px-8 sm:pb-24 sm:pt-20">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
        <div>
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h1 className="text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">{title}</h1>
          {children ? <div className="mt-6 max-w-xl text-lg leading-relaxed text-ink-muted">{children}</div> : null}
          {actions ? <div className="mt-8 flex flex-wrap gap-3">{actions}</div> : null}
        </div>
        {aside ? <div>{aside}</div> : null}
      </div>
    </section>
  );
}

/** Numbered steps ("Get started in 3"). */
export function Steps({ steps }) {
  return (
    <ol className="grid gap-5 md:grid-cols-3">
      {steps.map(([title, text], i) => (
        <li key={title} className="rounded-3xl bg-surface p-7 shadow-sm ring-1 ring-line">
          <span className="text-5xl font-black text-brand" aria-hidden>
            {String(i + 1).padStart(2, '0')}
          </span>
          <h3 className="mt-3 text-xl font-bold">
            <span className="sr-only">Step {i + 1}: </span>
            {title}
          </h3>
          <p className="mt-2 leading-relaxed text-ink-muted">{text}</p>
        </li>
      ))}
    </ol>
  );
}

/** Icon + title + text cards. */
export function FeatureGrid({ items, columns = 3 }) {
  return (
    <ul className={cx('grid gap-5 sm:grid-cols-2', columns === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4')}>
      {items.map(({ icon: Icon, title, text }) => (
        <li key={title} className="rounded-3xl bg-surface p-6 ring-1 ring-line">
          <span className="grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand-dark">
            <Icon className="size-6" aria-hidden />
          </span>
          <h3 className="mt-4 text-lg font-bold">{title}</h3>
          <p className="mt-1.5 leading-relaxed text-ink-muted">{text}</p>
        </li>
      ))}
    </ul>
  );
}

export { cx };
