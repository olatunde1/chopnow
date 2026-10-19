import type { OrderStatus } from './enums.js';

/**
 * Allowed fulfilment transitions. The API is the only enforcer; clients may read this to decide
 * which buttons to show, but hiding a button is never a security control.
 *
 * DELIVERY_EXCEPTION is recoverable: operations can reassign (back to READY_FOR_PICKUP or
 * PICKED_UP, depending on whether the food left the restaurant) or close it out as CANCELLED.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PLACED: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['PICKED_UP', 'CANCELLED', 'DELIVERY_EXCEPTION'],
  PICKED_UP: ['DELIVERED', 'DELIVERY_EXCEPTION'],
  DELIVERY_EXCEPTION: ['READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
  REJECTED: [],
};

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ['DELIVERED', 'CANCELLED', 'REJECTED'];

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}
