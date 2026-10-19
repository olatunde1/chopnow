import type { DbOrTx } from '../../db/client.js';
import type { Prisma } from '../../generated/prisma/client.js';

export interface NotifyInput {
  userId: string;
  /** Machine-readable kind, e.g. "order.accepted" (clients use it for icons and deep links). */
  type: string;
  title: string;
  body: string;
  orderId?: string | null;
  /** Small, non-sensitive extras for the client (ids, amounts). Never PINs, addresses or phone numbers. */
  data?: Record<string, string | number | boolean | null>;
  /** One notification per event and recipient, e.g. "order:<id>:accepted:<userId>". */
  dedupeKey: string;
  /** Delivery hints for the push sender. */
  push?: { priority?: 'default' | 'high'; ttlSeconds?: number };
}

/**
 * Records notifications in the caller's transaction, so they exist exactly when the business change
 * commits (a durable outbox). The push sender and the realtime feed pick them up afterwards.
 * Re-notifying the same event is a no-op (dedupe key).
 */
export async function notify(db: DbOrTx, input: NotifyInput | NotifyInput[], at?: Date) {
  const list = (Array.isArray(input) ? input : [input]).filter((n) => !!n.userId);
  if (!list.length) return;
  await db.notification.createMany({
    data: list.map((n) => ({
      userId: n.userId,
      type: n.type,
      title: n.title.slice(0, 120),
      body: n.body.slice(0, 400),
      orderId: n.orderId ?? null,
      data: { ...(n.data ?? {}), ...(n.push ? { _push: n.push } : {}) } as Prisma.InputJsonValue,
      dedupeKey: n.dedupeKey,
      ...(at ? { createdAt: at } : {}),
    })),
    skipDuplicates: true,
  });
}

/** Who to tell about an order: the customer, the restaurant owner (once the order reached them) and the rider. */
export async function orderParties(db: DbOrTx, orderId: string) {
  const o = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      id: true, code: true, customerId: true, visibleToVendorAt: true, estimatedReadyAt: true, totalKobo: true, paymentMethod: true,
      restaurant: { select: { id: true, name: true, ownerId: true } },
      delivery: { select: { currentRider: { select: { userId: true, user: { select: { fullName: true } } } } } },
    },
  });
  return {
    order: o,
    customerId: o.customerId,
    vendorUserId: o.visibleToVendorAt ? o.restaurant.ownerId : null,
    riderUserId: o.delivery?.currentRider?.userId ?? null,
    riderFirstName: o.delivery?.currentRider?.user.fullName.split(/\s+/)[0] ?? null,
  };
}
