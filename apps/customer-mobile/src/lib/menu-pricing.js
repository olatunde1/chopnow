/**
 * Client-side price preview for a customised menu item. The server recalculates every price at
 * checkout; this exists so the customer sees the right number before adding to cart.
 */

/** The variant pre-selected when the sheet opens: the default if available, else the first available. */
export function initialVariantId(item) {
  const live = item.variants.filter((v) => v.isAvailable);
  if (live.length === 0) return null;
  return (live.find((v) => v.isDefault) ?? live[0]).id;
}

/**
 * Validates a selection and returns { ok, unitPriceKobo, lineTotalKobo, problems }.
 * selection = { variantId, extras: { [extraId]: quantity }, quantity }
 */
export function priceSelection(item, selection, { maxQuantity = 20 } = {}) {
  const problems = [];
  if (!item.isAvailable) problems.push('This item is sold out.');

  let base = item.priceKobo;
  let variant = null;
  if (item.variants.length > 0) {
    variant = item.variants.find((v) => v.id === selection.variantId) ?? null;
    if (!variant) problems.push('Choose a size or option.');
    else if (!variant.isAvailable) problems.push(`${variant.name} is sold out.`);
    else base = variant.priceKobo;
  }

  const extras = [];
  let extrasPerUnit = 0;
  for (const [extraId, qty] of Object.entries(selection.extras ?? {})) {
    if (!qty) continue;
    const extra = item.extras.find((e) => e.id === extraId);
    if (!extra) {
      problems.push('An extra is no longer offered.');
      continue;
    }
    if (!extra.isAvailable) problems.push(`${extra.name} is sold out.`);
    if (!Number.isInteger(qty) || qty < 0 || qty > extra.maxQuantity) problems.push(`You can add up to ${extra.maxQuantity} × ${extra.name}.`);
    extras.push({ id: extra.id, name: extra.name, priceKobo: extra.priceKobo, quantity: qty });
    extrasPerUnit += extra.priceKobo * qty;
  }

  const quantity = selection.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > maxQuantity) problems.push(`Quantity must be between 1 and ${maxQuantity}.`);

  const unitPriceKobo = base + extrasPerUnit;
  return {
    ok: problems.length === 0,
    problems,
    variant,
    extras,
    unitPriceKobo,
    lineTotalKobo: unitPriceKobo * quantity,
  };
}
