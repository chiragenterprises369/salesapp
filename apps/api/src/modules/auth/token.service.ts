import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  JWT_AUDIENCE,
  PlatformClaimsSchema,
  SUPER_SESSION,
  WorkspaceClaimsSchema,
  type PlatformClaims,
  type WorkspaceClaims,
} from '@vistar/shared';
import { z } from 'zod';
import { AppException } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import { ACCESS_TTL_SEC, CHALLENGE_AUDIENCE, CHALLENGE_TTL_SEC } from './auth.constants.js';

export type VerifiedWorkspaceClaims = WorkspaceClaims & { iat: number; exp: number };
export type VerifiedPlatformClaims = PlatformClaims & { iat: number; exp: number };

const TimesSchema = z.object({ iat: z.number().int(), exp: z.number().int() });
const ChallengeClaimsSchema = z.object({ aud: z.literal(CHALLENGE_AUDIENCE), sub: z.uuid(), jti: z.string().min(8) });
export type ChallengeClaims = z.infer<typeof ChallengeClaimsSchema>;

const invalid = () => new AppException('AUTH_TOKEN_INVALID', 'Invalid or malformed token. Sign in again');

/**
 * Signs and verifies the three token kinds (HS256):
 * - workspace access token: JWT_ACCESS_SECRET, audience vistar:workspace
 * - platform access token:  SUPER_JWT_SECRET, audience vistar:platform
 * - Super Admin 2FA challenge: SUPER_JWT_SECRET, audience vistar:platform:challenge (5 min)
 * A token is checked for the expected audience before anything else, so a token minted for one
 * audience always fails with AUTH_TOKEN_INVALID on the other.
 */
@Injectable()
export class TokenService {
  /** change #20: from the security policy at sign time (Super Admin can change it at runtime). */
  get accessTtlSec(): number {
    return ACCESS_TTL_SEC();
  }

  constructor(private readonly jwt: JwtService) {}

  signWorkspaceAccess(claims: Omit<WorkspaceClaims, 'aud'>): { token: string; expiresIn: number } {
    let expiresIn = this.accessTtlSec;
    // An impersonation token never outlives its support session.
    if (claims.imp) expiresIn = Math.max(1, Math.min(expiresIn, claims.imp.exp - Math.floor(Date.now() / 1000)));
    const token = this.jwt.sign({ ...claims }, { secret: getEnv().JWT_ACCESS_SECRET, audience: JWT_AUDIENCE.workspace, expiresIn, algorithm: 'HS256' });
    return { token, expiresIn };
  }

  async verifyWorkspaceAccess(token: string): Promise<VerifiedWorkspaceClaims> {
    const payload = await this.verify(token, getEnv().JWT_ACCESS_SECRET, JWT_AUDIENCE.workspace);
    const claims = WorkspaceClaimsSchema.safeParse(payload);
    const times = TimesSchema.safeParse(payload);
    if (!claims.success || !times.success) throw invalid();
    return { ...claims.data, ...times.data };
  }

  signPlatformAccess(claims: Omit<PlatformClaims, 'aud'>): { token: string; expiresIn: number } {
    const expiresIn = SUPER_SESSION.accessTtlSec;
    const token = this.jwt.sign({ ...claims }, { secret: getEnv().SUPER_JWT_SECRET, audience: JWT_AUDIENCE.platform, expiresIn, algorithm: 'HS256' });
    return { token, expiresIn };
  }

  async verifyPlatformAccess(token: string): Promise<VerifiedPlatformClaims> {
    const payload = await this.verify(token, getEnv().SUPER_JWT_SECRET, JWT_AUDIENCE.platform);
    const claims = PlatformClaimsSchema.safeParse(payload);
    const times = TimesSchema.safeParse(payload);
    if (!claims.success || !times.success) throw invalid();
    return { ...claims.data, ...times.data };
  }

  signChallenge(adminId: string, jti: string): string {
    return this.jwt.sign({ jti }, { secret: getEnv().SUPER_JWT_SECRET, audience: CHALLENGE_AUDIENCE, subject: adminId, expiresIn: CHALLENGE_TTL_SEC, algorithm: 'HS256' });
  }

  async verifyChallenge(token: string): Promise<ChallengeClaims> {
    const payload = await this.verify(token, getEnv().SUPER_JWT_SECRET, CHALLENGE_AUDIENCE, 'This sign-in attempt expired. Enter your password again');
    const claims = ChallengeClaimsSchema.safeParse(payload);
    if (!claims.success) throw invalid();
    return claims.data;
  }

  private async verify(token: string, secret: string, audience: string, expiredMessage = 'Your session expired. Sign in again'): Promise<Record<string, unknown>> {
    // Audience first: wrong-audience tokens are always INVALID (never EXPIRED), whatever their state.
    const decoded: unknown = this.jwt.decode(token);
    if (!decoded || typeof decoded !== 'object' || (decoded as { aud?: unknown }).aud !== audience) throw invalid();
    try {
      return await this.jwt.verifyAsync<Record<string, unknown>>(token, { secret, audience, algorithms: ['HS256'] });
    } catch (err) {
      if ((err as Error).name === 'TokenExpiredError') throw new AppException('AUTH_TOKEN_EXPIRED', expiredMessage);
      throw invalid();
    }
  }
}
