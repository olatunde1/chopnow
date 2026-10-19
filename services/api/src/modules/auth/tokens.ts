import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { ROLES, type Role } from '@chopnow/shared-schemas';

const ISSUER = 'chopnow-api';
const AUDIENCE = 'chopnow-clients';

export interface AccessTokenClaims {
  /** User id */
  sub: string;
  role: Role;
  /** users.tokenVersion at issue time; a bump invalidates outstanding access tokens. */
  tv: number;
}

export class TokenService {
  private readonly key: Uint8Array;

  constructor(secret: string, private readonly accessTtlSeconds: number) {
    this.key = new TextEncoder().encode(secret);
  }

  async signAccess(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ role: claims.role, tv: claims.tv })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtlSeconds}s`)
      .sign(this.key);
  }

  /** Returns null for any invalid, expired or tampered token. */
  async verifyAccess(token: string): Promise<AccessTokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
      const role = payload.role;
      if (typeof payload.sub !== 'string' || typeof payload.tv !== 'number') return null;
      if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) return null;
      return { sub: payload.sub, role: role as Role, tv: payload.tv };
    } catch {
      return null;
    }
  }
}

/** Opaque refresh token: 256 bits of randomness. Only its SHA-256 is stored. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
