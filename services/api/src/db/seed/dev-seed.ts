/**
 * DEVELOPMENT / TEST SEED DATA — NOT FOR PRODUCTION.
 *
 * Every seeded account uses an @chopnow.test email (".test" is a reserved TLD that can never
 * receive mail), every restaurant description starts with "[Test data]", and a `seed_info`
 * platform setting marks the database as seeded. No financial transactions or ledger entries are
 * seeded: those are produced only by the real order workflow.
 *
 * All seeded accounts share one development password: SEED_USER_PASSWORD, or the default below.
 */
import type { Db, Tx } from '../client.js';
import type { OrderStatus, PaymentMethod, PaymentStatus, Prisma } from '../../generated/prisma/client.js';
import { hashPassword } from '../../modules/auth/password.js';
import { BUSINESS_RULES_KEY, defaultBusinessRules } from '../../modules/settings/business-rules.js';
import { generateDeliveryPin, generateOrderCode } from '../../lib/codes.js';

export const DEFAULT_SEED_PASSWORD = 'ChopNow-dev-2026';
export const SEED_EMAIL_DOMAIN = '@chopnow.test';

export class SeedRefusedError extends Error {}

export interface SeedOptions {
  appEnv: string;
  password?: string;
  /** Clock for time-windowed seed data (promotions). Tests pass their fixed clock. Default: now. */
  now?: Date;
}

export interface SeedSummary {
  users: number;
  restaurants: number;
  menuItems: number;
  riders: number;
  orders: number;
}

const naira = (n: number) => Math.round(n * 100);

/** Sagamu, Ogun State: pilot area (Makun). */
const AREA = { area: 'Makun', city: 'Sagamu', lat: 6.84, lng: 3.647 };

export async function assertSeedAllowed(db: Db, appEnv: string): Promise<void> {
  if (appEnv !== 'development' && appEnv !== 'test') {
    throw new SeedRefusedError(`Refusing to seed: APP_ENV is "${appEnv}". Seeding is only allowed in development or test.`);
  }
  // Protect databases that hold real accounts even if APP_ENV is mis-set.
  const realUsers = await db.user.count({ where: { NOT: { email: { endsWith: SEED_EMAIL_DOMAIN } } } });
  if (realUsers > 0) {
    throw new SeedRefusedError(`Refusing to seed: database contains ${realUsers} non-test account(s).`);
  }
}

/** Empties every application table (keeps the migrations table). Development/test only. */
export async function truncateAll(db: Db): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function seedDevelopmentData(db: Db, opts: SeedOptions): Promise<SeedSummary> {
  await assertSeedAllowed(db, opts.appEnv);
  await truncateAll(db);
  const passwordHash = await hashPassword(opts.password ?? DEFAULT_SEED_PASSWORD);

  return db.$transaction(
    async (tx) => {
      await tx.platformSetting.create({
        data: { key: BUSINESS_RULES_KEY, value: defaultBusinessRules(), description: 'Fees, commission, COD and dispatch rules' },
      });
      await tx.platformSetting.create({
        data: {
          key: 'seed_info',
          value: { isTestData: true, seededAt: new Date().toISOString(), note: 'Development seed data. Not real customers, vendors or riders.' },
        },
      });

      const user = (email: string, fullName: string, role: Prisma.UserCreateInput['role'], phone?: string) =>
        tx.user.create({ data: { email: `${email}${SEED_EMAIL_DOMAIN}`, fullName, role, phone, passwordHash } });

      // Staff
      await user('admin', 'Test Admin', 'ADMIN');
      await user('ops', 'Test Operations', 'OPERATIONS');
      await user('support', 'Test Support', 'SUPPORT');
      await user('finance', 'Test Finance', 'FINANCE');

      // Vendors & restaurants
      const v1 = await user('vendor.mamankechi', 'Nkechi Okafor (test)', 'VENDOR', '+2348030000001');
      const v2 = await user('vendor.bukka', 'Femi Adeyemi (test)', 'VENDOR', '+2348030000002');
      const v3 = await user('vendor.suya', 'Musa Bello (test)', 'VENDOR', '+2348030000003');
      const v4 = await user('vendor.pending', 'Grace Eze (test)', 'VENDOR', '+2348030000004');
      const admin = await tx.user.findUniqueOrThrow({ where: { email: `admin${SEED_EMAIL_DOMAIN}` } });

      const restaurant = (
        ownerId: string,
        name: string,
        slug: string,
        description: string,
        opts: { approved: boolean; accepting: boolean; dLat: number; dLng: number; prep: number; minOrder?: number },
      ) =>
        tx.restaurant.create({
          data: {
            ownerId,
            name,
            slug,
            description: `[Test data] ${description}`,
            addressLine: `${Math.floor(Math.random() * 90) + 10} Akarigbo Street`,
            area: AREA.area,
            city: AREA.city,
            latitude: AREA.lat + opts.dLat,
            longitude: AREA.lng + opts.dLng,
            verificationStatus: opts.approved ? 'APPROVED' : 'PENDING',
            approvedAt: opts.approved ? new Date() : null,
            approvedById: opts.approved ? admin.id : null,
            isAcceptingOrders: opts.accepting,
            prepTimeMinutes: opts.prep,
            minOrderKobo: opts.minOrder ?? 0,
            hours: { create: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, opensAt: 8 * 60, closesAt: 22 * 60 })) },
          },
        });

      const mama = await restaurant(v1.id, "Mama Nkechi's Kitchen", 'mama-nkechis-kitchen', 'Home-style Nigerian rice dishes and soups.', {
        approved: true, accepting: true, dLat: 0.002, dLng: -0.001, prep: 25,
      });
      const bukka = await restaurant(v2.id, 'Bukka Republic', 'bukka-republic', 'Party jollof, swallow and small chops.', {
        approved: true, accepting: true, dLat: -0.004, dLng: 0.003, prep: 20, minOrder: naira(1500),
      });
      const suya = await restaurant(v3.id, 'Suya Spot Express', 'suya-spot-express', 'Grilled suya and drinks. Currently closed for orders.', {
        approved: true, accepting: false, dLat: 0.006, dLng: 0.004, prep: 15,
      });
      await restaurant(v4.id, "Grandma's Pot", 'grandmas-pot', 'Awaiting verification; must not appear to customers.', {
        approved: false, accepting: false, dLat: -0.002, dLng: -0.005, prep: 30,
      });

      let menuItems = 0;
      type ItemSpec = {
        name: string;
        description: string;
        price: number;
        available?: boolean;
        variants?: { name: string; price: number; isDefault?: boolean }[];
        extras?: { name: string; price: number; max?: number }[];
      };
      const menu = async (restaurantId: string, categories: Record<string, ItemSpec[]>) => {
        let catOrder = 0;
        for (const [catName, items] of Object.entries(categories)) {
          const cat = await tx.menuCategory.create({ data: { restaurantId, name: catName, sortOrder: catOrder++ } });
          let itemOrder = 0;
          for (const it of items) {
            await tx.menuItem.create({
              data: {
                restaurantId,
                categoryId: cat.id,
                name: it.name,
                description: it.description,
                priceKobo: naira(it.price),
                isAvailable: it.available ?? true,
                sortOrder: itemOrder++,
                variants: it.variants && {
                  create: it.variants.map((v, i) => ({ name: v.name, priceKobo: naira(v.price), isDefault: v.isDefault ?? i === 0, sortOrder: i })),
                },
                extras: it.extras && {
                  create: it.extras.map((e, i) => ({ name: e.name, priceKobo: naira(e.price), maxQuantity: e.max ?? 1, sortOrder: i })),
                },
              },
            });
            menuItems++;
          }
        }
      };

      const proteinExtras = [
        { name: 'Fried chicken', price: 1500, max: 2 },
        { name: 'Beef', price: 1000, max: 3 },
        { name: 'Fried plantain (dodo)', price: 500, max: 2 },
        { name: 'Coleslaw', price: 300 },
      ];

      await menu(mama.id, {
        Rice: [
          {
            name: 'Jollof Rice',
            description: 'Smoky party-style jollof rice cooked in a rich tomato and pepper base.',
            price: 2500,
            variants: [{ name: 'Regular', price: 2500 }, { name: 'Large', price: 3500 }],
            extras: proteinExtras,
          },
          {
            name: 'Fried Rice',
            description: 'Nigerian fried rice with mixed vegetables and liver.',
            price: 2700,
            variants: [{ name: 'Regular', price: 2700 }, { name: 'Large', price: 3700 }],
            extras: proteinExtras,
          },
          { name: 'Ofada Rice & Ayamase', description: 'Local rice with green pepper stew.', price: 3800, available: false },
        ],
        'Soups & Swallow': [
          {
            name: 'Egusi Soup & Pounded Yam',
            description: 'Melon seed soup with assorted meat.',
            price: 4000,
            extras: [{ name: 'Extra pounded yam', price: 700 }, { name: 'Assorted meat', price: 1200, max: 2 }],
          },
        ],
        Drinks: [{ name: 'Chapman', description: 'Chilled house Chapman.', price: 1200 }],
      });

      await menu(bukka.id, {
        Mains: [
          {
            name: 'Party Jollof Rice',
            description: 'Firewood jollof with the bottom-pot flavour.',
            price: 3000,
            variants: [{ name: 'Regular', price: 3000 }, { name: 'Jumbo', price: 4500 }],
            extras: proteinExtras,
          },
          { name: 'Amala & Ewedu', description: 'With gbegiri and stew.', price: 3200, extras: [{ name: 'Goat meat', price: 1500, max: 2 }] },
        ],
        'Small Chops': [
          { name: 'Small Chops Platter', description: 'Puff-puff, samosa, spring rolls and gizzard.', price: 4500 },
        ],
      });

      await menu(suya.id, {
        Grill: [
          { name: 'Beef Suya', description: 'Spicy grilled beef skewers with onions.', price: 2000 },
          { name: 'Jollof Rice & Suya', description: 'Jollof rice topped with beef suya.', price: 3500 },
        ],
      });

      // Promotion (test data): 10% off food, capped at ₦1,000, once per customer.
      await tx.promotion.create({
        data: {
          code: 'WELCOME10',
          description: '[Test data] 10% off your food, up to ₦1,000',
          type: 'PERCENT_OFF',
          percentBps: 1000,
          maxDiscountKobo: naira(1000),
          minSubtotalKobo: naira(2000),
          perCustomerLimit: 1,
          fundedBy: 'PLATFORM',
          startsAt: new Date((opts.now ?? new Date()).getTime() - 86_400_000),
          endsAt: new Date((opts.now ?? new Date()).getTime() + 365 * 86_400_000),
          createdById: admin.id,
        },
      });

      // Customers
      const ada = await user('ada', 'Ada Obi (test)', 'CUSTOMER', '+2348031110001');
      const tunde = await user('tunde', 'Tunde Bakare (test)', 'CUSTOMER', '+2348031110002');
      const adaAddr = await tx.address.create({
        data: { userId: ada.id, label: 'Home', line1: '12 Sabo Road', area: AREA.area, city: AREA.city, landmark: 'Opposite the pharmacy', latitude: AREA.lat + 0.008, longitude: AREA.lng - 0.002, contactPhone: '+2348031110001' },
      });
      const tundeAddr = await tx.address.create({
        data: { userId: tunde.id, label: 'Office', line1: '5 Market Road', area: AREA.area, city: AREA.city, latitude: AREA.lat - 0.003, longitude: AREA.lng + 0.006 },
      });
      await tx.customerProfile.create({ data: { userId: ada.id, defaultAddressId: adaAddr.id } });
      await tx.customerProfile.create({ data: { userId: tunde.id, defaultAddressId: tundeAddr.id } });

      // Riders
      const rider = async (
        email: string,
        name: string,
        phone: string,
        r: { type: 'CORE' | 'INDEPENDENT'; approved: boolean; online: boolean; vehicle: 'MOTORCYCLE' | 'BICYCLE'; plate?: string },
      ) => {
        const u = await user(email, name, 'RIDER', phone);
        return tx.rider.create({
          data: {
            userId: u.id,
            riderType: r.type,
            verificationStatus: r.approved ? 'APPROVED' : 'PENDING',
            approvedAt: r.approved ? new Date() : null,
            approvedById: r.approved ? admin.id : null,
            availability: r.online ? 'ONLINE' : 'OFFLINE',
            vehicleType: r.vehicle,
            vehiclePlate: r.plate,
          },
        });
      };
      const core1 = await rider('rider.core1', 'Chinedu Core (test)', '+2348032220001', { type: 'CORE', approved: true, online: true, vehicle: 'MOTORCYCLE', plate: 'LAG-123-AB' });
      await rider('rider.core2', 'Bisi Core (test)', '+2348032220002', { type: 'CORE', approved: true, online: false, vehicle: 'MOTORCYCLE', plate: 'LAG-456-CD' });
      await rider('rider.indie1', 'Kunle Independent (test)', '+2348032220003', { type: 'INDEPENDENT', approved: true, online: true, vehicle: 'BICYCLE' });
      await rider('rider.pending', 'Pending Rider (test)', '+2348032220004', { type: 'INDEPENDENT', approved: false, online: false, vehicle: 'MOTORCYCLE' });

      // Sample orders (illustrative states only; amounts follow the default rules, no ledger postings).
      const jollof = await tx.menuItem.findFirstOrThrow({ where: { restaurantId: mama.id, name: 'Jollof Rice' }, include: { variants: true, extras: true } });
      const partyJollof = await tx.menuItem.findFirstOrThrow({ where: { restaurantId: bukka.id, name: 'Party Jollof Rice' }, include: { variants: true } });

      const large = jollof.variants.find((v) => v.name === 'Large')!;
      const chicken = jollof.extras.find((e) => e.name === 'Fried chicken')!;
      const regularParty = partyJollof.variants.find((v) => v.name === 'Regular')!;

      const orders = 0
        + (await sampleOrder(tx, {
          customerId: ada.id, restaurantId: mama.id, address: adaAddr, method: 'CASH_ON_DELIVERY', paymentStatus: 'SUCCESSFUL',
          path: ['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERED'],
          item: { menuItemId: jollof.id, name: jollof.name, variantId: large.id, variantName: large.name, unit: large.priceKobo, qty: 1,
            extras: [{ extraId: chicken.id, name: chicken.name, unit: chicken.priceKobo, qty: 1 }] },
          deliveredBy: core1.id, actorIds: { vendor: v1.id, rider: core1.userId },
        }))
        + (await sampleOrder(tx, {
          customerId: tunde.id, restaurantId: bukka.id, address: tundeAddr, method: 'ONLINE', paymentStatus: 'PENDING',
          path: ['PLACED'],
          item: { menuItemId: partyJollof.id, name: partyJollof.name, variantId: regularParty.id, variantName: regularParty.name, unit: regularParty.priceKobo, qty: 2, extras: [] },
          actorIds: { vendor: v2.id },
        }))
        + (await sampleOrder(tx, {
          customerId: ada.id, restaurantId: bukka.id, address: adaAddr, method: 'CASH_ON_DELIVERY', paymentStatus: 'PENDING',
          path: ['PLACED', 'ACCEPTED', 'PREPARING'],
          item: { menuItemId: partyJollof.id, name: partyJollof.name, variantId: regularParty.id, variantName: regularParty.name, unit: regularParty.priceKobo, qty: 1, extras: [] },
          actorIds: { vendor: v2.id },
        }));

      return {
        users: await tx.user.count(),
        restaurants: await tx.restaurant.count(),
        menuItems,
        riders: await tx.rider.count(),
        orders,
      };
    },
    { timeout: 60_000 },
  );
}

interface SampleOrderSpec {
  customerId: string;
  restaurantId: string;
  address: { id: string; label: string; line1: string; area: string; city: string; landmark: string | null; latitude: number | null; longitude: number | null };
  method: PaymentMethod;
  paymentStatus: PaymentStatus;
  path: OrderStatus[];
  item: {
    menuItemId: string; name: string; variantId: string; variantName: string; unit: number; qty: number;
    extras: { extraId: string; name: string; unit: number; qty: number }[];
  };
  deliveredBy?: string;
  actorIds: { vendor: string; rider?: string };
}

/** Creates one illustrative order with status history using the default pricing rules. */
async function sampleOrder(tx: Tx, s: SampleOrderSpec): Promise<number> {
  const rules = defaultBusinessRules().pricing;
  const perUnit = s.item.unit + s.item.extras.reduce((a, e) => a + e.unit * e.qty, 0);
  const subtotal = perUnit * s.item.qty;
  const deliveryFee = rules.deliveryBaseFeeKobo;
  const serviceFee = Math.min(rules.serviceFeeMaxKobo, Math.max(rules.serviceFeeMinKobo, Math.round((subtotal * rules.serviceFeeBps) / 10_000)));
  const commission = Math.round((subtotal * rules.commissionBps) / 10_000);
  const riderEarning = Math.max(rules.riderMinEarningKobo, Math.round((deliveryFee * rules.riderShareOfDeliveryBps) / 10_000));
  const total = subtotal + deliveryFee + serviceFee;
  const final = s.path[s.path.length - 1]!;
  const t0 = Date.now() - 60 * 60_000;
  const at = (i: number) => new Date(t0 + i * 8 * 60_000);
  const idx = (st: OrderStatus) => s.path.indexOf(st);
  const stamp = (st: OrderStatus) => (idx(st) >= 0 ? at(idx(st)) : null);

  const order = await tx.order.create({
    data: {
      code: generateOrderCode(),
      customerId: s.customerId,
      restaurantId: s.restaurantId,
      addressId: s.address.id,
      deliveryAddress: {
        label: s.address.label, line1: s.address.line1, area: s.address.area, city: s.address.city, landmark: s.address.landmark,
      },
      deliveryLatitude: s.address.latitude,
      deliveryLongitude: s.address.longitude,
      status: final,
      paymentMethod: s.method,
      paymentStatus: s.paymentStatus,
      subtotalKobo: subtotal,
      deliveryFeeKobo: deliveryFee,
      serviceFeeKobo: serviceFee,
      totalKobo: total,
      commissionBps: rules.commissionBps,
      commissionKobo: commission,
      riderEarningKobo: riderEarning,
      deliveryPin: generateDeliveryPin(),
      idempotencyKey: `seed-${crypto.randomUUID()}`,
      visibleToVendorAt: s.method === 'CASH_ON_DELIVERY' ? at(0) : null,
      placedAt: at(0),
      acceptedAt: stamp('ACCEPTED'),
      preparingAt: stamp('PREPARING'),
      readyAt: stamp('READY_FOR_PICKUP'),
      pickedUpAt: stamp('PICKED_UP'),
      deliveredAt: stamp('DELIVERED'),
      items: {
        create: {
          menuItemId: s.item.menuItemId,
          variantId: s.item.variantId,
          nameSnapshot: s.item.name,
          variantNameSnapshot: s.item.variantName,
          unitPriceKobo: s.item.unit,
          quantity: s.item.qty,
          lineTotalKobo: subtotal,
          extras: { create: s.item.extras.map((e) => ({ extraId: e.extraId, nameSnapshot: e.name, unitPriceKobo: e.unit, quantity: e.qty })) },
        },
      },
    },
  });

  const actorFor = (st: OrderStatus) =>
    st === 'PLACED' ? { id: s.customerId, role: 'CUSTOMER' }
      : st === 'PICKED_UP' || st === 'DELIVERED' ? { id: s.actorIds.rider ?? null, role: 'RIDER' }
      : { id: s.actorIds.vendor, role: 'VENDOR' };
  for (let i = 0; i < s.path.length; i++) {
    const st = s.path[i]!;
    const actor = actorFor(st);
    await tx.orderStatusHistory.create({
      data: { orderId: order.id, fromStatus: i === 0 ? null : s.path[i - 1]!, toStatus: st, actorUserId: actor.id, actorRole: actor.role, reason: '[Test data]', createdAt: at(i) },
    });
  }

  if (s.method === 'ONLINE') {
    await tx.payment.create({
      data: { orderId: order.id, provider: 'MOCK', reference: `SEED-${order.code}`, amountKobo: total, status: 'INITIALIZED' },
    });
  }

  const delivered = final === 'DELIVERED';
  if (idx('ACCEPTED') >= 0) {
    const delivery = await tx.delivery.create({
      data: {
        orderId: order.id,
        status: delivered ? 'DELIVERED' : 'OFFERING',
        currentRiderId: delivered ? s.deliveredBy : null,
        cashToCollectKobo: s.method === 'CASH_ON_DELIVERY' ? total : 0,
        dispatchStartedAt: stamp('ACCEPTED'),
        assignedAt: delivered ? stamp('PREPARING') : null,
        arrivedAtRestaurantAt: delivered ? stamp('READY_FOR_PICKUP') : null,
        pickedUpAt: stamp('PICKED_UP'),
        deliveredAt: stamp('DELIVERED'),
        pinVerifiedAt: stamp('DELIVERED'),
      },
    });
    if (s.method === 'CASH_ON_DELIVERY') {
      await tx.cashCollection.create({
        data: {
          orderId: order.id,
          deliveryId: delivery.id,
          riderId: delivered ? s.deliveredBy : null,
          amountDueKobo: total,
          amountCollectedKobo: delivered ? total : 0,
          status: delivered ? 'COLLECTED' : 'PENDING',
          collectedAt: stamp('DELIVERED'),
          // The delivered sample is historical and already handed in, so it carries no ledger postings.
          amountReconciledKobo: delivered ? total : 0,
          reconciliationStatus: delivered ? 'RECONCILED' : 'NOT_DUE',
        },
      });
    }
    // A delivered sample carries its rider earning, already paid out (no ledger postings).
    if (delivered && s.deliveredBy) {
      await tx.riderEarning.create({
        data: { riderId: s.deliveredBy, orderId: order.id, deliveryId: delivery.id, type: 'DELIVERY_FEE', amountKobo: riderEarning, status: 'SETTLED', createdAt: stamp('DELIVERED') ?? undefined },
      });
      await tx.rider.update({ where: { id: s.deliveredBy }, data: { completedDeliveries: { increment: 1 } } });
    }
  }
  return 1;
}
