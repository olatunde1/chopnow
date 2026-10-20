import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import { DEFAULT_STATE, NIGERIAN_STATES, SERVICE_AREAS, isServed } from '../content/site';

const KEY = 'chopnow.website.state';
const Ctx = createContext(null);

const read = () => {
  try {
    const v = window.localStorage.getItem(KEY);
    return NIGERIAN_STATES.includes(v) ? v : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE; // private mode / blocked storage
  }
};

/** The visitor's chosen state, remembered on this device only. */
export function LocationProvider({ children }) {
  const [state, setStateRaw] = useState(read);
  const setState = useCallback((next) => {
    setStateRaw(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // not remembered; fine
    }
  }, []);
  const value = useMemo(() => ({ state, setState, served: isServed(state), cities: SERVICE_AREAS[state] ?? [] }), [state, setState]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLocationChoice = () => useContext(Ctx);

/** The "state" dropdown in the header: every Nigerian state, marked by whether we deliver there yet. */
export function StateSelect({ id = 'state-select', className = '' }) {
  const { state, setState } = useLocationChoice();
  return (
    <div className={`relative ${className}`}>
      <label htmlFor={id} className="sr-only">
        Your state
      </label>
      <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand" aria-hidden />
      <select
        id={id}
        value={state}
        onChange={(e) => setState(e.target.value)}
        className="min-h-11 w-full cursor-pointer appearance-none rounded-full border-2 border-line bg-surface py-2 pl-9 pr-9 text-sm font-semibold text-ink hover:border-brand/40"
      >
        {NIGERIAN_STATES.map((s) => (
          <option key={s} value={s}>
            {s}
            {isServed(s) ? '' : ' (coming soon)'}
          </option>
        ))}
      </select>
      <svg viewBox="0 0 20 20" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden>
        <path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** Shown under the header when the chosen state isn't served yet. */
export function CoverageNotice() {
  const { state, served } = useLocationChoice();
  if (served) return null;
  const live = Object.entries(SERVICE_AREAS)
    .map(([s, cities]) => `${cities.join(', ')}, ${s} State`)
    .join(' and ');
  return (
    <div role="status" className="bg-warn-soft px-5 py-3 text-center text-sm text-ink sm:px-8">
      ChopNow isn’t delivering in {state} yet. We’re live in <strong>{live}</strong>, and coming to more states soon.
    </div>
  );
}
