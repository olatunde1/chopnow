import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES } from '../src/enums.js';
import { ORDER_TRANSITIONS, TERMINAL_ORDER_STATUSES, canTransitionOrder } from '../src/order-transitions.js';

describe('order transitions', () => {
  it('defines transitions for every status', () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it('terminal statuses have no outgoing transitions', () => {
    for (const s of TERMINAL_ORDER_STATUSES) expect(ORDER_TRANSITIONS[s]).toEqual([]);
  });

  it('allows the happy path', () => {
    const path = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERED'] as const;
    for (let i = 1; i < path.length; i++) expect(canTransitionOrder(path[i - 1]!, path[i]!)).toBe(true);
  });

  it('blocks delivering an order that was never picked up', () => {
    expect(canTransitionOrder('READY_FOR_PICKUP', 'DELIVERED')).toBe(false);
    expect(canTransitionOrder('PREPARING', 'DELIVERED')).toBe(false);
  });

  it('blocks cancelling after pickup (must go through DELIVERY_EXCEPTION)', () => {
    expect(canTransitionOrder('PICKED_UP', 'CANCELLED')).toBe(false);
  });
});
