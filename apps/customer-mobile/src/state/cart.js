import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Cart (one restaurant per cart for the MVP). Prices here are display snapshots only; the server
 * recalculates everything when the order is placed (Phase 5) and rejects unavailable items.
 */
export const MAX_LINE_QUANTITY = 20;

/** Lines with the same item, variant, extras and instructions are merged. */
export function lineKey({ menuItemId, variantId, extras, instructions }) {
  const ex = [...(extras ?? [])]
    .filter((e) => e.quantity > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => `${e.id}x${e.quantity}`)
    .join(',');
  return `${menuItemId}|${variantId ?? '-'}|${ex}|${(instructions ?? '').trim().toLowerCase()}`;
}

export const cartSelectors = {
  count: (s) => s.lines.reduce((n, l) => n + l.quantity, 0),
  subtotalKobo: (s) => s.lines.reduce((n, l) => n + l.unitPriceKobo * l.quantity, 0),
};

export const useCart = create(
  persist(
    (set, get) => ({
      restaurant: null,
      lines: [],

      /**
       * Adds a line. Returns 'ADDED', or 'DIFFERENT_RESTAURANT' without changing anything when the
       * cart holds another restaurant's food (the UI then asks before calling replaceWith).
       */
      addLine: (restaurant, line) => {
        const current = get().restaurant;
        if (current && current.id !== restaurant.id && get().lines.length > 0) return 'DIFFERENT_RESTAURANT';
        const key = lineKey(line);
        const lines = [...get().lines];
        const existing = lines.findIndex((l) => l.key === key);
        if (existing >= 0) {
          const merged = lines[existing];
          lines[existing] = { ...merged, quantity: Math.min(MAX_LINE_QUANTITY, merged.quantity + line.quantity), unitPriceKobo: line.unitPriceKobo };
        } else {
          lines.push({ ...line, key, quantity: Math.min(MAX_LINE_QUANTITY, line.quantity) });
        }
        set({ restaurant, lines });
        return 'ADDED';
      },

      /** Empties the cart and starts a new one for another restaurant. */
      replaceWith: (restaurant, line) => {
        set({ restaurant: null, lines: [] });
        return get().addLine(restaurant, line);
      },

      setQuantity: (key, quantity) => {
        if (quantity <= 0) return get().removeLine(key);
        set({ lines: get().lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, quantity) } : l)) });
      },

      removeLine: (key) => {
        const lines = get().lines.filter((l) => l.key !== key);
        set({ lines, restaurant: lines.length ? get().restaurant : null });
      },

      clear: () => set({ restaurant: null, lines: [] }),
    }),
    { name: 'chopnow.cart', storage: createJSONStorage(() => AsyncStorage), version: 1 },
  ),
);
