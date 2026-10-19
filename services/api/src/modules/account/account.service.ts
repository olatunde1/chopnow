import type { AddressInput, AddressUpdate, UpdateProfileRequest } from '@chopnow/shared-schemas';
import type { Db } from '../../db/client.js';
import { Prisma, type Address } from '../../generated/prisma/client.js';
import { Errors } from '../../lib/errors.js';
import type { Principal } from '../auth/auth.service.js';

export const MAX_ADDRESSES = 20;

/** Profile, addresses and favourites. Every query is scoped to the caller's own user id. */
export class AccountService {
  constructor(private readonly db: Db) {}

  async me(principal: Principal) {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: principal.userId },
      include: {
        customerProfile: true,
        rider: true,
        ownedRestaurants: { select: { id: true, name: true, verificationStatus: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      mustChangePassword: user.mustChangePassword,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      defaultAddressId: user.customerProfile?.defaultAddressId ?? null,
      rider: user.rider && {
        id: user.rider.id,
        riderType: user.rider.riderType,
        verificationStatus: user.rider.verificationStatus,
        availability: user.rider.availability,
        vehicleType: user.rider.vehicleType,
      },
      restaurants: user.ownedRestaurants,
    };
  }

  async updateProfile(principal: Principal, input: UpdateProfileRequest) {
    try {
      await this.db.user.update({ where: { id: principal.userId }, data: input });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('PHONE_IN_USE', 'This phone number is already used by another account');
      }
      throw err;
    }
    return this.me(principal);
  }

  // ───────── Addresses ─────────

  private async defaultAddressId(userId: string): Promise<string | null> {
    const profile = await this.db.customerProfile.findUnique({ where: { userId } });
    return profile?.defaultAddressId ?? null;
  }

  private toDto(a: Address, defaultId: string | null) {
    return { ...a, isDefault: a.id === defaultId };
  }

  async listAddresses(principal: Principal) {
    const [addresses, defaultId] = await Promise.all([
      this.db.address.findMany({ where: { userId: principal.userId, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
      this.defaultAddressId(principal.userId),
    ]);
    return { items: addresses.map((a) => this.toDto(a, defaultId)) };
  }

  /** Loads an address only if it belongs to the caller; otherwise 404 (never reveal others' records). */
  async getOwnAddress(principal: Principal, addressId: string): Promise<Address> {
    const a = await this.db.address.findFirst({ where: { id: addressId, userId: principal.userId, deletedAt: null } });
    if (!a) throw Errors.notFound('Address');
    return a;
  }

  async createAddress(principal: Principal, input: AddressInput) {
    const { makeDefault, ...data } = input;
    return this.db.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId: principal.userId, deletedAt: null } });
      if (count >= MAX_ADDRESSES) throw Errors.conflict('ADDRESS_LIMIT', `You can save up to ${MAX_ADDRESSES} addresses`);
      const address = await tx.address.create({ data: { ...data, userId: principal.userId } });
      const profile = await tx.customerProfile.upsert({
        where: { userId: principal.userId },
        create: { userId: principal.userId, defaultAddressId: address.id },
        update: makeDefault || count === 0 ? { defaultAddressId: address.id } : {},
      });
      return this.toDto(address, profile.defaultAddressId);
    });
  }

  async updateAddress(principal: Principal, addressId: string, input: AddressUpdate) {
    await this.getOwnAddress(principal, addressId);
    const { makeDefault, ...data } = input;
    const address = await this.db.address.update({ where: { id: addressId }, data });
    if (makeDefault) await this.setDefaultAddress(principal, addressId);
    return this.toDto(address, await this.defaultAddressId(principal.userId));
  }

  /** Soft delete: past orders keep their own address snapshot. */
  async deleteAddress(principal: Principal, addressId: string) {
    await this.getOwnAddress(principal, addressId);
    await this.db.$transaction(async (tx) => {
      await tx.address.update({ where: { id: addressId }, data: { deletedAt: new Date() } });
      await tx.customerProfile.updateMany({ where: { userId: principal.userId, defaultAddressId: addressId }, data: { defaultAddressId: null } });
    });
    return { ok: true as const };
  }

  async setDefaultAddress(principal: Principal, addressId: string) {
    const address = await this.getOwnAddress(principal, addressId);
    await this.db.customerProfile.upsert({
      where: { userId: principal.userId },
      create: { userId: principal.userId, defaultAddressId: addressId },
      update: { defaultAddressId: addressId },
    });
    return this.toDto(address, addressId);
  }

  // ───────── Favourites ─────────

  async favouriteIds(userId: string): Promise<Set<string>> {
    const rows = await this.db.favouriteRestaurant.findMany({ where: { userId }, select: { restaurantId: true } });
    return new Set(rows.map((r) => r.restaurantId));
  }

  async addFavourite(principal: Principal, restaurantId: string) {
    const restaurant = await this.db.restaurant.findFirst({ where: { id: restaurantId, verificationStatus: 'APPROVED' } });
    if (!restaurant) throw Errors.notFound('Restaurant');
    await this.db.favouriteRestaurant.upsert({
      where: { userId_restaurantId: { userId: principal.userId, restaurantId } },
      create: { userId: principal.userId, restaurantId },
      update: {},
    });
    return { ok: true as const };
  }

  async removeFavourite(principal: Principal, restaurantId: string) {
    await this.db.favouriteRestaurant.deleteMany({ where: { userId: principal.userId, restaurantId } });
    return { ok: true as const };
  }
}
