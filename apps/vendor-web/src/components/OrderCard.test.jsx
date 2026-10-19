import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { OrderCard } from './OrderCard';
import { toItemPayload } from './ItemEditor';

const NOW = Date.parse('2026-10-15T12:00:00Z');

const order = (over = {}) => ({
  id: 'o1',
  code: 'CN-7K3Q',
  status: 'PLACED',
  paymentMethod: 'ONLINE',
  placedAt: new Date(NOW - 60_000).toISOString(),
  acceptDeadlineAt: new Date(NOW + 5 * 60_000).toISOString(),
  estimatedReadyAt: null,
  customerFirstName: 'Ada',
  customerNote: null,
  subtotalKobo: 450_000,
  estimatedEarningsKobo: 382_500,
  items: [{ name: 'Jollof rice', variantName: 'Large', quantity: 2, specialInstructions: 'No pepper', extras: [{ name: 'Chicken', quantity: 1 }], lineTotalKobo: 450_000 }],
  actions: ['accept', 'reject'],
  ...over,
});

describe('<OrderCard>', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('shows the items, instructions and a live accept countdown', () => {
    render(<OrderCard order={order()} onAction={() => {}} />);
    expect(screen.getByRole('article', { name: 'Order CN-7K3Q, New' })).toBeInTheDocument();
    expect(screen.getByText('“No pepper”')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('Accept within 5:00');
    act(() => vi.advanceTimersByTime(4 * 60_000));
    expect(screen.getByRole('timer')).toHaveTextContent('Accept within 1:00');
    expect(screen.getByRole('timer')).toHaveAttribute('aria-live', 'assertive');
  });

  it('only offers the actions the API allows', () => {
    const onAction = vi.fn();
    const { rerender } = render(<OrderCard order={order()} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(onAction).toHaveBeenCalledWith('accept', expect.objectContaining({ id: 'o1' }));
    expect(screen.queryByRole('button', { name: 'Ready for pickup' })).not.toBeInTheDocument();

    rerender(<OrderCard order={order({ status: 'PREPARING', actions: ['mark_ready', 'report_delay'] })} onAction={onAction} />);
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ready for pickup' }));
    expect(onAction).toHaveBeenLastCalledWith('mark_ready', expect.anything());
  });

  it('shows the rider once one has accepted, and a searching note before', () => {
    const { rerender } = render(<OrderCard order={order({ status: 'PREPARING', actions: [], deliveryStatus: 'OFFERING', rider: null })} onAction={() => {}} />);
    expect(screen.getByText('Finding a rider…')).toBeInTheDocument();
    rerender(<OrderCard order={order({ status: 'READY_FOR_PICKUP', actions: [], deliveryStatus: 'ARRIVED_AT_RESTAURANT', rider: { firstName: 'Chinedu', vehicleType: 'MOTORCYCLE' } })} onAction={() => {}} />);
    expect(screen.getByText(/is here/)).toHaveTextContent('Rider Chinedu is here');
  });

  it('never shows customer contact details', () => {
    render(<OrderCard order={order({ customerPhone: '+2348012345678', deliveryAddress: '12 Herbert Macaulay Way' })} onAction={() => {}} />);
    expect(screen.queryByText(/2348012345678/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Herbert Macaulay/)).not.toBeInTheDocument();
  });
});

describe('dish form payload', () => {
  const base = { categoryId: '0b6f8a52-3c1e-4d7a-9f20-5e8b1c4d2a77', name: 'Jollof rice', description: '', price: '2,500', prepTimeMinutes: '', imageUrl: null, isAvailable: true, variants: [], extras: [] };

  it('converts naira to integer kobo', () => {
    const { ok, payload } = toItemPayload({ ...base, extras: [{ name: 'Chicken', price: '1200.50', maxQuantity: '2', isAvailable: true }] });
    expect(ok).toBe(true);
    expect(payload.priceKobo).toBe(250_000);
    expect(payload.extras[0]).toMatchObject({ priceKobo: 120_050, maxQuantity: 2 });
  });

  it('flags prices that are not amounts', () => {
    const { ok, errors } = toItemPayload({ ...base, price: 'two k' });
    expect(ok).toBe(false);
    expect(errors.price).toMatch(/naira/);
  });
});
