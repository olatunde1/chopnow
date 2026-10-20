import { Link } from 'react-router';

/** ChopNow mark (a steaming bowl) + wordmark. */
export function LogoMark({ className = 'size-9' }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden focusable="false">
      <rect width="64" height="64" rx="16" fill="currentColor" />
      <path d="M14 34h36a18 18 0 0 1-36 0Z" fill="#f6f2e9" />
      <path d="M22 27c0-4 4-4 4-8m6 8c0-4 4-4 4-8m6 8c0-4 4-4 4-8" stroke="#f6f2e9" strokeWidth="3.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ inverse = false }) {
  return (
    <Link to="/" className={`inline-flex items-center gap-2.5 rounded-xl ${inverse ? 'text-cream' : 'text-ink'}`} aria-label="ChopNow home">
      <LogoMark className="size-9 text-brand" />
      <span className="text-2xl font-black tracking-tight">
        Chop<span className={inverse ? 'text-brand-soft' : 'text-brand'}>Now</span>
      </span>
    </Link>
  );
}
