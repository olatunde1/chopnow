import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HoursEditor, rowsToWindows, windowsToRows } from './HoursEditor';

const row = (dayOfWeek, opens, closes) => ({ key: `${dayOfWeek}${opens}`, dayOfWeek, opens, closes });

describe('opening hours conversion', () => {
  it('round-trips windows, showing midnight close as 00:00', () => {
    const windows = [
      { dayOfWeek: 5, opensAt: 18 * 60, closesAt: 1440 },
      { dayOfWeek: 1, opensAt: 8 * 60, closesAt: 22 * 60 },
    ];
    const rows = windowsToRows(windows);
    expect(rows.map(({ dayOfWeek, opens, closes }) => [dayOfWeek, opens, closes])).toEqual([
      [1, '08:00', '22:00'],
      [5, '18:00', '00:00'],
    ]);
    expect(rowsToWindows(rows).windows).toEqual([...windows].reverse());
  });

  it('rejects a window that closes before it opens, with guidance for overnight hours', () => {
    expect(rowsToWindows([row(5, '18:00', '02:00')]).error).toMatch(/Friday: opening time must be before closing time/);
  });

  it('rejects overlapping windows on the same day but allows split shifts', () => {
    expect(rowsToWindows([row(1, '08:00', '14:00'), row(1, '13:00', '20:00')]).error).toMatch(/overlap/);
    expect(rowsToWindows([row(1, '08:00', '14:00'), row(1, '17:00', '22:00')]).windows).toHaveLength(2);
  });

  it('rejects malformed times', () => {
    expect(rowsToWindows([row(1, '8am', '22:00')]).error).toMatch(/HH:MM/);
  });
});

describe('<HoursEditor>', () => {
  it('opens a closed day and saves the converted windows', async () => {
    const onSave = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<HoursEditor windows={[]} onSave={onSave} />);
    const sunday = screen.getByRole('listitem', { name: 'Sunday' });
    expect(within(sunday).getByText('Closed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save hours' })).toBeDisabled();

    await user.click(within(sunday).getByRole('button', { name: 'Add opening time on Sunday' }));
    await user.click(screen.getByRole('button', { name: 'Save hours' }));
    expect(onSave).toHaveBeenCalledWith([{ dayOfWeek: 0, opensAt: 540, closesAt: 1260 }]);
  });

  it('copies Monday to the other weekdays', async () => {
    const onSave = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<HoursEditor windows={[{ dayOfWeek: 1, opensAt: 480, closesAt: 1200 }, { dayOfWeek: 6, opensAt: 600, closesAt: 1380 }]} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'Copy Monday to Tue–Fri' }));
    await user.click(screen.getByRole('button', { name: 'Save hours' }));
    const days = onSave.mock.calls[0][0].map((w) => w.dayOfWeek).sort();
    expect(days).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('shows the API error and keeps the edits when saving fails', async () => {
    const user = userEvent.setup();
    render(<HoursEditor windows={[]} onSave={async () => Promise.reject(new Error('Restaurant not found'))} />);
    await user.click(screen.getByRole('button', { name: 'Add opening time on Monday' }));
    await user.click(screen.getByRole('button', { name: 'Save hours' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Restaurant not found');
    expect(screen.getByRole('button', { name: 'Save hours' })).toBeEnabled();
  });
});
