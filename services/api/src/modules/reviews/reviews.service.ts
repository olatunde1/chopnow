import type { Db, Tx } from '../../db/client.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError, Errors } from '../../lib/errors.js';
import type { Principal } from '../auth/auth.service.js';
import { REVIEW_WINDOW_DAYS } from '../orders/orders.service.js';

/** Recomputes the denormalised rating from published reviews (kept on restaurants/riders for listing). */
export async function refreshRatings(tx: Tx, restaurantId: string, riderId: string | null) {
  const r = await tx.review.aggregate({ where: { restaurantId, status: 'PUBLISHED' }, _avg: { restaurantRating: true }, _count: { _all: true } });
  await tx.restaurant.update({
    where: { id: restaurantId },
    data: { ratingAverage: r._avg.restaurantRating ? Math.round(r._avg.restaurantRating * 10) / 10 : null, ratingCount: r._count._all },
  });
  if (riderId) {
    const d = await tx.review.aggregate({ where: { riderId, status: 'PUBLISHED', riderRating: { not: null } }, _avg: { riderRating: true }, _count: { riderRating: true } });
    await tx.rider.update({
      where: { id: riderId },
      data: { ratingAverage: d._avg.riderRating ? Math.round(d._avg.riderRating * 10) / 10 : null, ratingCount: d._count.riderRating },
    });
  }
}

const firstName = (full: string) => full.split(/\s+/)[0] ?? 'Customer';

export class ReviewsService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** One review per delivered order, by the customer who ordered, within the review window. */
  async create(principal: Principal, orderId: string, input: { restaurantRating: number; riderRating?: number; comment?: string }) {
    try {
      return await this.db.$transaction(async (tx) => {
        const order = await tx.order.findFirst({ where: { id: orderId, customerId: principal.userId }, include: { delivery: { select: { currentRiderId: true } } } });
        if (!order) throw Errors.notFound('Order');
        if (order.status !== 'DELIVERED' || !order.deliveredAt) throw new AppError(409, 'NOT_DELIVERED', 'You can review an order once it has been delivered.');
        if (this.now().getTime() - order.deliveredAt.getTime() > REVIEW_WINDOW_DAYS * 86_400_000) {
          throw new AppError(409, 'REVIEW_WINDOW_CLOSED', `Reviews can be left within ${REVIEW_WINDOW_DAYS} days of delivery.`);
        }
        const riderId = order.delivery?.currentRiderId ?? null;
        const review = await tx.review.create({
          data: {
            orderId,
            customerId: principal.userId,
            restaurantId: order.restaurantId,
            riderId: input.riderRating ? riderId : null,
            restaurantRating: input.restaurantRating,
            riderRating: riderId ? (input.riderRating ?? null) : null,
            comment: input.comment || null,
          },
        });
        await refreshRatings(tx, order.restaurantId, riderId);
        return { id: review.id, ok: true as const };
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new AppError(409, 'ALREADY_REVIEWED', 'You’ve already reviewed this order.');
      throw err;
    }
  }

  async listForVendor(principal: Principal, restaurantId: string, page: number, pageSize: number) {
    const restaurant = await this.db.restaurant.findFirst({ where: { id: restaurantId, ownerId: principal.userId } });
    if (!restaurant) throw Errors.notFound('Restaurant');
    const where = { restaurantId, status: 'PUBLISHED' as const };
    const [total, rows] = await Promise.all([
      this.db.review.count({ where }),
      this.db.review.findMany({ where, include: { customer: { select: { fullName: true } }, order: { select: { code: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return {
      items: rows.map((r) => ({ id: r.id, orderCode: r.order.code, customerFirstName: firstName(r.customer.fullName), restaurantRating: r.restaurantRating, comment: r.comment, vendorReply: r.vendorReply, vendorRepliedAt: r.vendorRepliedAt, createdAt: r.createdAt })),
      page,
      pageSize,
      total,
      ratingAverage: restaurant.ratingAverage,
      ratingCount: restaurant.ratingCount,
    };
  }

  async reply(principal: Principal, restaurantId: string, reviewId: string, reply: string) {
    const review = await this.db.review.findFirst({ where: { id: reviewId, restaurantId, restaurant: { ownerId: principal.userId } } });
    if (!review) throw Errors.notFound('Review');
    await this.db.review.update({ where: { id: reviewId }, data: { vendorReply: reply, vendorRepliedAt: this.now() } });
    return { ok: true as const };
  }
}
