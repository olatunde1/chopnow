import type { BusinessRules, OrderRequest } from '@chopnow/shared-schemas';
import { applyBasisPoints, computeCommission, computeDeliveryFee, computeRiderEarning, computeServiceFee, distanceMeters, isOpenAt } from '@chopnow/shared-utils';
import type { DbOrTx } from '../../db/client.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { Errors } from '../../lib/errors.js';
import { getBusinessRules } from '../settings/business-rules.js';

export interface QuoteProblem {
  code: string;
  message: string;
  lineIndex?: number;
}

type MenuItemFull = Prisma.MenuItemGetPayload<{ include: { variants: true; extras: true; category: true } }>;

export interface PricedLine {
  menuItemId: string;
  name: string;
  variantId: string | null;
  variantName: string | null;
  extras: { extraId: string; name: string; unitPriceKobo: number; quantity: number }[];
  unitPriceKobo: number;
  quantity: number;
  lineTotalKobo: number;
  specialInstructions: string | null;
}

/** Full server-side pricing result. `forCreate` carries what order creation needs beyond the public quote. */
export interface QuoteResult {
  quote: {
    restaurant: { id: string; name: string; slug: string };
    lines: Omit<PricedLine, 'variantId' | 'specialInstructions'>[];
    subtotalKobo: number;
    deliveryFeeKobo: number;
    serviceFeeKobo: number;
    discountKobo: number;
    totalKobo: number;
    distanceMeters: number;
    promotion: { code: string; description: string } | null;
    cashOnDeliveryAllowed: boolean;
    cashOnDeliveryReason: string | null;
    problems: QuoteProblem[];
    canPlaceOrder: boolean;
  };
  forCreate: {
    lines: PricedLine[];
    commissionBps: number;
    commissionKobo: number;
    riderEarningKobo: number;
    promotionId: string | null;
    address: { id: string; label: string; line1: string; line2: string | null; area: string; city: string; landmark: string | null; contactPhone: string | null; instructions: string | null; latitude: number; longitude: number };
    rules: BusinessRules;
  };
}

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

/**
 * Prices an order request against the CURRENT menu, restaurant state, address and business rules.
 * Nothing the client sends about price is used. Problems are collected rather than thrown so the app
 * can show all of them at once; only a missing/foreign restaurant or address throws (404).
 */
export async function buildQuote(db: DbOrTx, customerId: string, req: OrderRequest, now: Date): Promise<QuoteResult> {
  const problems: QuoteProblem[] = [];
  const rules = await getBusinessRules(db);

  const restaurant = await db.restaurant.findFirst({
    where: { id: req.restaurantId, verificationStatus: 'APPROVED' },
    include: { hours: true },
  });
  if (!restaurant) throw Errors.notFound('Restaurant');

  const addr = await db.address.findFirst({ where: { id: req.addressId, userId: customerId, deletedAt: null } });
  if (!addr) throw Errors.notFound('Address');

  if (!restaurant.isAcceptingOrders) problems.push({ code: 'RESTAURANT_NOT_ACCEPTING', message: `${restaurant.name} isn’t taking orders right now.` });
  else if (!isOpenAt(restaurant.hours, now)) problems.push({ code: 'RESTAURANT_CLOSED', message: `${restaurant.name} is closed right now.` });

  let distance = 0;
  if (addr.latitude === null || addr.longitude === null || restaurant.latitude === null || restaurant.longitude === null) {
    problems.push({ code: 'ADDRESS_NO_LOCATION', message: 'This address has no map pin. Edit it and set the pin.' });
  } else {
    distance = distanceMeters({ latitude: addr.latitude, longitude: addr.longitude }, { latitude: restaurant.latitude, longitude: restaurant.longitude });
    if (distance > restaurant.deliveryRadiusMeters) {
      problems.push({ code: 'OUT_OF_DELIVERY_RANGE', message: `${restaurant.name} doesn’t deliver to this address.` });
    }
  }

  // ---- Lines ----
  const ids = [...new Set(req.items.map((l) => l.menuItemId))];
  const items = await db.menuItem.findMany({
    where: { id: { in: ids }, restaurantId: restaurant.id, deletedAt: null },
    include: { variants: { where: { deletedAt: null } }, extras: { where: { deletedAt: null } }, category: true },
  });
  const byId = new Map<string, MenuItemFull>(items.map((i) => [i.id, i]));
  const lines: PricedLine[] = [];
  const totalQtyByItem = new Map<string, number>();

  req.items.forEach((line, lineIndex) => {
    const item = byId.get(line.menuItemId);
    if (!item) {
      problems.push({ code: 'ITEM_NOT_FOUND', message: 'An item in your cart is no longer on the menu.', lineIndex });
      return;
    }
    const lineProblems: QuoteProblem[] = [];
    if (!item.isAvailable || !item.category.isActive) lineProblems.push({ code: 'ITEM_UNAVAILABLE', message: `${item.name} is sold out.`, lineIndex });

    let unit = item.priceKobo;
    let variant: (typeof item.variants)[number] | null = null;
    if (item.variants.length > 0) {
      variant = item.variants.find((v) => v.id === line.variantId) ?? null;
      if (!line.variantId) lineProblems.push({ code: 'VARIANT_REQUIRED', message: `Choose an option for ${item.name}.`, lineIndex });
      else if (!variant) lineProblems.push({ code: 'VARIANT_INVALID', message: `The option chosen for ${item.name} is no longer offered.`, lineIndex });
      else if (!variant.isAvailable) lineProblems.push({ code: 'VARIANT_UNAVAILABLE', message: `${item.name} (${variant.name}) is sold out.`, lineIndex });
      else unit = variant.priceKobo;
    } else if (line.variantId) {
      lineProblems.push({ code: 'VARIANT_INVALID', message: `${item.name} has no options to choose.`, lineIndex });
    }

    const extras: PricedLine['extras'] = [];
    const seenExtras = new Set<string>();
    for (const e of line.extras) {
      const extra = item.extras.find((x) => x.id === e.extraId);
      if (!extra || seenExtras.has(e.extraId)) {
        lineProblems.push({ code: 'EXTRA_INVALID', message: `An extra chosen for ${item.name} is no longer offered.`, lineIndex });
        continue;
      }
      seenExtras.add(e.extraId);
      if (!extra.isAvailable) lineProblems.push({ code: 'EXTRA_UNAVAILABLE', message: `${extra.name} is sold out.`, lineIndex });
      if (e.quantity > extra.maxQuantity) lineProblems.push({ code: 'EXTRA_LIMIT', message: `You can add up to ${extra.maxQuantity} × ${extra.name}.`, lineIndex });
      extras.push({ extraId: extra.id, name: extra.name, unitPriceKobo: extra.priceKobo, quantity: e.quantity });
    }

    const qty = (totalQtyByItem.get(item.id) ?? 0) + line.quantity;
    totalQtyByItem.set(item.id, qty);
    if (qty > rules.orders.maxItemQuantity) {
      lineProblems.push({ code: 'QUANTITY_LIMIT', message: `You can order up to ${rules.orders.maxItemQuantity} × ${item.name}.`, lineIndex });
    }

    problems.push(...lineProblems);
    const perUnit = unit + extras.reduce((s, x) => s + x.unitPriceKobo * x.quantity, 0);
    lines.push({
      menuItemId: item.id,
      name: item.name,
      variantId: variant?.id ?? null,
      variantName: variant?.name ?? null,
      extras,
      unitPriceKobo: unit,
      quantity: line.quantity,
      lineTotalKobo: perUnit * line.quantity,
      specialInstructions: line.specialInstructions || null,
    });
  });

  const subtotal = lines.reduce((s, l) => s + l.lineTotalKobo, 0);
  if (restaurant.minOrderKobo > 0 && subtotal < restaurant.minOrderKobo) {
    problems.push({ code: 'BELOW_MINIMUM_ORDER', message: `${restaurant.name} has a minimum order of ${naira(restaurant.minOrderKobo)}. Add ${naira(restaurant.minOrderKobo - subtotal)} more.` });
  }

  const deliveryFee = computeDeliveryFee(distance, rules.pricing);
  const serviceFee = computeServiceFee(subtotal, rules.pricing);

  // ---- Promotion ----
  let discount = 0;
  let promotion: QuoteResult['quote']['promotion'] = null;
  let promotionId: string | null = null;
  if (req.promoCode) {
    const promo = await db.promotion.findUnique({ where: { code: req.promoCode } });
    const invalid = (message: string) => problems.push({ code: 'PROMO_INVALID', message });
    if (!promo || !promo.isActive || promo.startsAt > now || promo.endsAt <= now) invalid('This promo code isn’t valid right now.');
    else if (promo.restaurantId && promo.restaurantId !== restaurant.id) invalid(`This promo code can’t be used at ${restaurant.name}.`);
    else if (subtotal < promo.minSubtotalKobo) invalid(`Spend at least ${naira(promo.minSubtotalKobo)} on food to use this code.`);
    else {
      const [used, usedByCustomer] = await Promise.all([
        promo.usageLimit ? db.promotionRedemption.count({ where: { promotionId: promo.id, isActive: true } }) : Promise.resolve(0),
        db.promotionRedemption.count({ where: { promotionId: promo.id, customerId, isActive: true } }),
      ]);
      if (promo.usageLimit && used >= promo.usageLimit) invalid('This promo code has been fully used.');
      else if (usedByCustomer >= promo.perCustomerLimit) invalid('You’ve already used this promo code.');
      else {
        if (promo.type === 'PERCENT_OFF') discount = applyBasisPoints(subtotal, promo.percentBps ?? 0);
        else if (promo.type === 'FIXED_OFF') discount = Math.min(promo.amountKobo ?? 0, subtotal);
        else discount = deliveryFee;
        if (promo.maxDiscountKobo !== null) discount = Math.min(discount, promo.maxDiscountKobo);
        discount = Math.min(discount, subtotal + deliveryFee);
        promotion = { code: promo.code, description: promo.description };
        promotionId = promo.id;
      }
    }
  }

  const total = subtotal + deliveryFee + serviceFee - discount;

  // ---- Cash on delivery eligibility ----
  let codReason: string | null = null;
  const cod = rules.cashOnDelivery;
  if (!cod.enabled) codReason = 'Cash on delivery isn’t available right now.';
  else if (total > cod.maxOrderTotalKobo) codReason = `Cash on delivery is available for orders up to ${naira(cod.maxOrderTotalKobo)}.`;
  else {
    const delivered = await db.order.count({ where: { customerId, status: 'DELIVERED' } });
    if (delivered === 0 && total > cod.newCustomerMaxOrderTotalKobo) {
      codReason = `For your first order, cash on delivery is available up to ${naira(cod.newCustomerMaxOrderTotalKobo)}. Pay online or reduce your order.`;
    }
  }
  if (req.paymentMethod === 'CASH_ON_DELIVERY' && codReason) problems.push({ code: 'COD_NOT_ALLOWED', message: codReason });

  const commissionBps = restaurant.commissionBpsOverride ?? rules.pricing.commissionBps;
  return {
    quote: {
      restaurant: { id: restaurant.id, name: restaurant.name, slug: restaurant.slug },
      lines: lines.map(({ variantId: _v, specialInstructions: _s, ...l }) => l),
      subtotalKobo: subtotal,
      deliveryFeeKobo: deliveryFee,
      serviceFeeKobo: serviceFee,
      discountKobo: discount,
      totalKobo: total,
      distanceMeters: distance,
      promotion,
      cashOnDeliveryAllowed: codReason === null,
      cashOnDeliveryReason: codReason,
      problems,
      canPlaceOrder: problems.length === 0,
    },
    forCreate: {
      lines,
      commissionBps,
      // Commission is charged on the food subtotal before discounts (see PRODUCT_REQUIREMENTS.md).
      commissionKobo: computeCommission(subtotal, commissionBps),
      riderEarningKobo: computeRiderEarning(deliveryFee, rules.pricing),
      promotionId,
      address: { ...addr, latitude: addr.latitude ?? 0, longitude: addr.longitude ?? 0 },
      rules,
    },
  };
}
