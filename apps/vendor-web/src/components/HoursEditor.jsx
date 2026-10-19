import { useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { hhmmToMinutes, minutesToHHMM, validateOpeningWindows } from '@chopnow/shared-utils';
import { Button } from './ui';

/** Monday first, as restaurants read their week; values are the API's 0 = Sunday … 6 = Saturday. */
export const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

let rowSeq = 0;
const rowKey = () => `r${++rowSeq}`;

/** API windows → editable rows. Closing at 1440 (midnight) shows as "00:00". */
export function windowsToRows(windows) {
  return [...windows]
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.opensAt - b.opensAt)
    .map((w) => ({ key: rowKey(), dayOfWeek: w.dayOfWeek, opens: minutesToHHMM(w.opensAt), closes: w.closesAt === 1440 ? '00:00' : minutesToHHMM(w.closesAt) }));
}

/**
 * Editable rows → API windows, or an error message. A closing time of "00:00" means midnight at
 * the end of the day; past-midnight opening is entered as a second window on the next day.
 */
export function rowsToWindows(rows) {
  const windows = [];
  for (const r of rows) {
    let opensAt;
    let closesAt;
    try {
      opensAt = hhmmToMinutes(r.opens);
      closesAt = hhmmToMinutes(r.closes);
    } catch {
      return { error: 'Enter times as HH:MM, e.g. 08:00.' };
    }
    if (closesAt === 0) closesAt = 1440;
    const day = DAYS.find((d) => d.value === r.dayOfWeek)?.label ?? 'A day';
    if (opensAt >= closesAt) return { error: `${day}: opening time must be before closing time. For past midnight, add a window on the next day from 00:00.` };
    windows.push({ dayOfWeek: r.dayOfWeek, opensAt, closesAt });
  }
  const problem = validateOpeningWindows(windows);
  if (problem) return { error: problem.includes('overlap') ? 'Two opening times on the same day overlap.' : problem };
  return { windows };
}

const timeInput = 'min-h-11 rounded-xl border border-line bg-surface px-3';

export function HoursEditor({ windows, onSave }) {
  const [rows, setRows] = useState(() => windowsToRows(windows));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const update = (next) => {
    setRows(next);
    setDirty(true);
    setError(null);
  };
  const addRow = (dayOfWeek) => update([...rows, { key: rowKey(), dayOfWeek, opens: '09:00', closes: '21:00' }]);
  const setRow = (key, patch) => update(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key) => update(rows.filter((r) => r.key !== key));
  const copyMondayToWeekdays = () => {
    const monday = rows.filter((r) => r.dayOfWeek === 1);
    const keep = rows.filter((r) => r.dayOfWeek === 1 || r.dayOfWeek === 0 || r.dayOfWeek === 6);
    const copies = [2, 3, 4, 5].flatMap((d) => monday.map((m) => ({ ...m, key: rowKey(), dayOfWeek: d })));
    update([...keep, ...copies]);
  };

  const save = async () => {
    const result = rowsToWindows(rows);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSaving(true);
    try {
      await onSave(result.windows);
      setDirty(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm text-bad">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-line">
        {DAYS.map((d) => {
          const dayRows = rows.filter((r) => r.dayOfWeek === d.value);
          return (
            <li key={d.value} className="flex flex-wrap items-start gap-3 py-3" aria-label={d.label}>
              <span className="w-28 pt-2.5 font-semibold">{d.label}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {dayRows.length === 0 ? <span className="pt-2.5 text-sm text-ink-muted">Closed</span> : null}
                {dayRows.map((r) => (
                  <div key={r.key} className="flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={`${r.key}-o`}>
                      {d.label} opens
                    </label>
                    <input id={`${r.key}-o`} type="time" className={timeInput} value={r.opens} onChange={(e) => setRow(r.key, { opens: e.target.value })} />
                    <span aria-hidden>–</span>
                    <label className="sr-only" htmlFor={`${r.key}-c`}>
                      {d.label} closes
                    </label>
                    <input id={`${r.key}-c`} type="time" className={timeInput} value={r.closes} onChange={(e) => setRow(r.key, { closes: e.target.value })} />
                    <Button variant="ghost" size="sm" icon={Trash2} aria-label={`Remove ${d.label} ${r.opens}–${r.closes}`} onClick={() => removeRow(r.key)} />
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" icon={Plus} onClick={() => addRow(d.value)} aria-label={`Add opening time on ${d.label}`}>
                {dayRows.length ? 'Split' : 'Open'}
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-muted">Times are Lagos time. Closing at 00:00 means midnight. Open past midnight? Add a window on the next day starting 00:00.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" icon={Copy} onClick={copyMondayToWeekdays} disabled={!rows.some((r) => r.dayOfWeek === 1)}>
          Copy Monday to Tue–Fri
        </Button>
        <Button className="ml-auto" onClick={save} loading={saving} disabled={!dirty}>
          Save hours
        </Button>
      </div>
    </div>
  );
}
