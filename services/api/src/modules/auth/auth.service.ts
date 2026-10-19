import { randomUUID } from 'node:crypto';
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
  STAFF_ROLES,
  type Role,
} from '@chopnow/shared-schemas';
import type { Db } from '../../db/client.js';
import { Prisma, type User } from '../../generated/prisma/client.js';
import { AppError, Errors } from '../../lib/errors.js';
import { writeAudit, type RequestContext } from '../audit/audit.js';
import { getDummyHash, hashPassword, needsRehash, verifyPassword } from './password.js';
import { TokenService, generateRefreshToken, hashToken } from './tokens.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export interface AuthSettings {
  refreshTokenTtlDays: number;
  accessTokenTtlSeconds: number;
}

/** Staff accounts hold wider powers, so their chosen passwords must be longer. */
export const STAFF_PASSWORD_MIN_LENGTH = 12;

export interface PublicUser {
  id: string;
  email: string;
  phone: string | null;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
}

/** The authenticated caller, resolved from the database on every request (role is never taken from the client). */
export interface Principal {
  userId: string;
  role: Role;
  /** Only password change and session endpoints are allowed while true. */
  mustChangePassword?: boolean;
}

function toPublicUser(u: User): PublicUser {
  return { id: u.id, email: u.email, phone: u.phone, fullName: u.fullName, role: u.role, mustChangePassword: u.mustChangePassword };
}

function parseOrThrow<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: unknown } } }, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw Errors.validation(r.error.issues);
  return r.data;
}

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly tokens: TokenService,
    private readonly settings: AuthSettings,
  ) {}

  async register(input: unknown, ctx: RequestContext = {}): Promise<AuthResult> {
    const req = parseOrThrow(RegisterRequestSchema, input);
    const passwordHash = await hashPassword(req.password);

    let user: User;
    try {
      user = await this.db.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { email: req.email, phone: req.phone ?? null, passwordHash, fullName: req.fullName, role: req.role },
        });
        if (req.role === 'CUSTOMER') {
          await tx.customerProfile.create({ data: { userId: created.id } });
        }
        if (req.role === 'RIDER' && req.rider) {
          // Riders start PENDING and OFFLINE; operations verifies documents and sets CORE/INDEPENDENT.
          await tx.rider.create({
            data: {
              userId: created.id,
              vehicleType: req.rider.vehicleType,
              vehiclePlate: req.rider.vehiclePlate,
              vehicleDescription: req.rider.vehicleDescription,
            },
          });
        }
        await writeAudit(
          tx,
          { actorUserId: created.id, actorRole: created.role, action: 'auth.register', entityType: 'User', entityId: created.id },
          ctx,
        );
        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('ACCOUNT_EXISTS', 'An account with this email or phone number already exists');
      }
      throw err;
    }

    return this.issueSession(user, randomUUID(), ctx);
  }

  async login(input: unknown, ctx: RequestContext = {}): Promise<AuthResult> {
    const req = parseOrThrow(LoginRequestSchema, input);
    const user = await this.db.user.findUnique({ where: { email: req.email } });

    if (!user) {
      await verifyPassword(req.password, await getDummyHash()); // equalise timing
      throw Errors.invalidCredentials();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) throw Errors.accountLocked();

    const ok = await verifyPassword(req.password, user.passwordHash);
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await this.db.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
        },
      });
      if (lock) {
        await writeAudit(this.db, { actorUserId: null, actorRole: 'SYSTEM', action: 'auth.account_locked', entityType: 'User', entityId: user.id }, ctx);
        throw Errors.accountLocked();
      }
      throw Errors.invalidCredentials();
    }

    if (user.status !== 'ACTIVE') throw Errors.accountInactive();

    const updated = await this.db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        ...(needsRehash(user.passwordHash) ? { passwordHash: await hashPassword(req.password) } : {}),
      },
    });
    return this.issueSession(updated, randomUUID(), ctx);
  }

  /**
   * Rotates a refresh token. Each token works once. Presenting a token that was already rotated
   * means it was copied, so the whole session family is revoked and the user must sign in again.
   */
  async refresh(input: unknown, ctx: RequestContext = {}): Promise<AuthResult> {
    const { refreshToken } = parseOrThrow(RefreshRequestSchema, input);
    const session = await this.db.authSession.findUnique({ where: { tokenHash: hashToken(refreshToken) }, include: { user: true } });
    if (!session) throw Errors.unauthenticated();

    if (session.revokedAt) {
      if (session.revokedReason === 'ROTATED') {
        await this.db.authSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
        });
        await writeAudit(
          this.db,
          { actorUserId: session.userId, actorRole: session.user.role, action: 'auth.refresh_reuse_detected', entityType: 'AuthSession', entityId: session.familyId },
          ctx,
        );
      }
      throw Errors.unauthenticated();
    }
    if (session.expiresAt <= new Date()) throw Errors.unauthenticated();
    if (session.user.status !== 'ACTIVE') throw Errors.accountInactive();

    // Atomic claim: only one concurrent refresh with this token can win.
    const claimed = await this.db.authSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'ROTATED' },
    });
    if (claimed.count !== 1) throw Errors.unauthenticated();

    const { result, sessionId } = await this.createSession(session.user, session.familyId, ctx);
    await this.db.authSession.update({ where: { id: session.id }, data: { replacedById: sessionId } });
    return result;
  }

  /** Revokes one session (sign out on this device). Unknown tokens are ignored. */
  async logout(input: unknown): Promise<void> {
    const { refreshToken } = parseOrThrow(RefreshRequestSchema, input);
    await this.db.authSession.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
    });
  }

  /** Signs the user out everywhere: revokes all refresh tokens and invalidates outstanding access tokens. */
  async logoutAll(userId: string, actor: Principal, ctx: RequestContext = {}): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
      await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'LOGOUT_ALL' } });
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'auth.logout_all', entityType: 'User', entityId: userId }, ctx);
    });
  }

  /**
   * Changes the password after checking the current one. All other sessions and outstanding access
   * tokens are invalidated; a fresh session is returned so the current device stays signed in.
   */
  async changePassword(principal: Principal, input: unknown, ctx: RequestContext = {}): Promise<AuthResult> {
    const req = parseOrThrow(ChangePasswordRequestSchema, input);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (!(await verifyPassword(req.currentPassword, user.passwordHash))) {
      throw new AppError(400, 'CURRENT_PASSWORD_INCORRECT', 'Your current password is incorrect');
    }
    if ((STAFF_ROLES as readonly string[]).includes(user.role) && req.newPassword.length < STAFF_PASSWORD_MIN_LENGTH) {
      throw Errors.validation([{ in: 'body', path: 'newPassword', message: `Staff passwords need at least ${STAFF_PASSWORD_MIN_LENGTH} characters` }]);
    }
    if (req.newPassword === req.currentPassword) throw Errors.validation([{ in: 'body', path: 'newPassword', message: 'Choose a password different from your current one' }]);
    const passwordHash = await hashPassword(req.newPassword);
    const updated = await this.db.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id: user.id }, data: { passwordHash, tokenVersion: { increment: 1 }, mustChangePassword: false } });
      await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' } });
      await writeAudit(tx, { actorUserId: user.id, actorRole: user.role, action: 'auth.password_changed', entityType: 'User', entityId: user.id }, ctx);
      return u;
    });
    return this.issueSession(updated, randomUUID(), ctx);
  }

  /**
   * Resolves a bearer token to a principal. The role and status come from the database, so a
   * suspended user or a changed role takes effect immediately rather than when the token expires.
   */
  async authenticate(accessToken: string): Promise<Principal | null> {
    const claims = await this.tokens.verifyAccess(accessToken);
    if (!claims) return null;
    const user = await this.db.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, role: true, status: true, tokenVersion: true, mustChangePassword: true },
    });
    if (!user || user.status !== 'ACTIVE' || user.tokenVersion !== claims.tv) return null;
    return { userId: user.id, role: user.role, ...(user.mustChangePassword ? { mustChangePassword: true } : {}) };
  }

  private async issueSession(user: User, familyId: string, ctx: RequestContext): Promise<AuthResult> {
    return (await this.createSession(user, familyId, ctx)).result;
  }

  private async createSession(user: User, familyId: string, ctx: RequestContext) {
    if (user.status !== 'ACTIVE') throw Errors.accountInactive();
    const refreshToken = generateRefreshToken();
    const session = await this.db.authSession.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.settings.refreshTokenTtlDays * 86_400_000),
        userAgent: ctx.userAgent?.slice(0, 300),
        ipAddress: ctx.ipAddress,
      },
    });
    const accessToken = await this.tokens.signAccess({ sub: user.id, role: user.role, tv: user.tokenVersion });
    const result: AuthResult = {
      user: toPublicUser(user),
      accessToken,
      accessTokenExpiresIn: this.settings.accessTokenTtlSeconds,
      refreshToken,
    };
    return { result, sessionId: session.id };
  }
}
