import { Apple, Play } from 'lucide-react';
import { cx } from './ui';

const STORES = [
  { key: 'googlePlay', icon: Play, small: 'Get it on', big: 'Google Play' },
  { key: 'appStore', icon: Apple, small: 'Download on the', big: 'App Store' },
];

/**
 * App-store buttons. A store with no URL yet (app not published) shows as "Coming soon" instead of
 * a link that goes nowhere.
 */
export function StoreButtons({ urls, appName, tone = 'dark', className }) {
  const look = tone === 'dark' ? 'bg-ink text-cream' : 'bg-cream text-ink';
  return (
    <ul className={cx('flex flex-wrap gap-3', className)} aria-label={`Get the ${appName}`}>
      {STORES.map(({ key, icon: Icon, small, big }) => {
        const url = urls?.[key];
        const body = (
          <>
            <Icon className="size-7 shrink-0" aria-hidden />
            <span className="flex flex-col text-left leading-tight">
              <span className="text-[11px] font-medium uppercase tracking-wide opacity-80">{url ? small : 'Coming soon to'}</span>
              <span className="text-lg font-bold">{big}</span>
            </span>
          </>
        );
        return (
          <li key={key}>
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" className={cx('flex min-h-14 min-w-48 items-center gap-3 rounded-2xl px-4 py-2 transition-opacity hover:opacity-90', look)} aria-label={`${small} ${big}: ${appName}`}>
                {body}
              </a>
            ) : (
              <span className={cx('flex min-h-14 min-w-48 cursor-default items-center gap-3 rounded-2xl px-4 py-2 opacity-75', look)} aria-label={`${appName} on ${big}: coming soon`}>
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
