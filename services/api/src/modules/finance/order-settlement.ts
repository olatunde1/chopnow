import type { Tx } from '../../db/client.js';
import { postJournal, type LedgerLine } from './ledger.js';

/**
 * Splits a delivered order's money between the restaurant, the rider and the platform (one
 * ORDER_SETTLED journal, posted in the same transaction as the delivery):
 *
 *   Dr CUSTOMER_ORDER_FUNDS          money received for the order (online capture or cash collected)
 *   Dr PROMOTION_EXPENSE             discount the platform funded
 *   Dr ADJUSTMENTS                   cash short-collected (only if partial collection is enabled)
 *     Cr VENDOR_PAYABLE (restaurant) food subtotal − commission − discount the restaurant funded
 *     Cr RIDER_PAYABLE (rider)       the rider earning snapshotted on the order
 *     Cr PLATFORM_COMMISSION_REVENUE commission (on the subtotal before discounts)
 *     Cr PLATFORM_DELIVERY_REVENUE   delivery fee − rider earning (a debit if the earning is larger)
 *     Cr PLATFORM_SERVICE_FEE_REVENUE service fee
 *
 * It balances because total = subtotal + delivery fee + service fee − discount. Idempotent per order.
 */
export async function postOrderSettlement(tx: Tx, params: { orderId: string; riderId: string; receivedKobo: number; at: Date; createdById?: string }) {
  const o = await tx.order.findUniqueOrThrow({ where: { id: params.orderId }, include: { promotion: { select: { fundedBy: true } } } });
  const restaurantDiscount = o.promotion?.fundedBy === 'RESTAURANT' ? o.discountKobo : 0;
  const platformDiscount = o.discountKobo - restaurantDiscount;
  const deliveryMargin = o.deliveryFeeKobo - o.riderEarningKobo;
  const vendorShare = o.subtotalKobo - o.commissionKobo - restaurantDiscount;
  const shortfall = o.totalKobo - params.receivedKobo;
  if (shortfall < 0) throw new Error(`Received more than the order total for ${o.code}`);

  const lines: LedgerLine[] = [
    { account: 'CUSTOMER_ORDER_FUNDS', direction: 'DEBIT', amountKobo: params.receivedKobo },
    { account: 'PROMOTION_EXPENSE', direction: 'DEBIT', amountKobo: platformDiscount },
    { account: 'ADJUSTMENTS', direction: 'DEBIT', amountKobo: shortfall },
    // Normally a credit; a debit only if a restaurant-funded discount exceeds what the food earned.
    { account: 'VENDOR_PAYABLE', direction: vendorShare >= 0 ? 'CREDIT' : 'DEBIT', amountKobo: Math.abs(vendorShare), restaurantId: o.restaurantId },
    { account: 'RIDER_PAYABLE', direction: 'CREDIT', amountKobo: o.riderEarningKobo, riderId: params.riderId },
    { account: 'PLATFORM_COMMISSION_REVENUE', direction: 'CREDIT', amountKobo: o.commissionKobo },
    { account: 'PLATFORM_DELIVERY_REVENUE', direction: deliveryMargin >= 0 ? 'CREDIT' : 'DEBIT', amountKobo: Math.abs(deliveryMargin) },
    { account: 'PLATFORM_SERVICE_FEE_REVENUE', direction: 'CREDIT', amountKobo: o.serviceFeeKobo },
  ];
  return postJournal(tx, {
    type: 'ORDER_SETTLED',
    idempotencyKey: `order:${o.id}:settled`,
    description: `Order ${o.code} delivered: split between restaurant, rider and platform`,
    orderId: o.id,
    createdById: params.createdById,
    at: params.at,
    lines,
  });
}
