import { z } from 'zod';
import { DataScopeSchema, RoleKindSchema } from '../enums.js';
import { PermissionSchema, PlatformPermissionSchema } from '../rbac.js';
import { IdSchema, IsoDateTimeSchema } from './common.js';

/**
 * AUTH CONTRACT. Two separate audiences; a token for one is rejected by the other.
 *
 * Workspace (Company + Employee panels), API prefix /api/v1:
 *  - Access JWT (aud "vistar:workspace", 15 min) in `Authorization: Bearer`, kept in memory.
 *  - Refresh: httpOnly cookie `vistar_rt`, path /api/v1/auth, rotated on every refresh.
 *  - Socket.IO: access token in handshake `auth.token`.
 *
 * Platform (Super Admin panel), API prefix /api/super:
 *  - Login = password + MANDATORY TOTP 2FA (enrol on first login).
 *  - Access JWT (aud "vistar:platform", 10 min), different signing secret.
 *  - Refresh: httpOnly cookie `vistar_srt`, path /api/super/auth; idle timeout 30 min, absolute 12 h.
 *  - Optional per-admin IP allowlist. Every action is audit logged.
 *  - A workspace token can never call /api/super (audience + secret mismatch), and vice versa.
 */
export const REFRESH_COOKIE = 'vistar_rt';
export const SUPER_REFRESH_COOKIE = 'vistar_srt';

export const JWT_AUDIENCE = {
  workspace: 'vistar:workspace',
  platform: 'vistar:platform',
} as const;

export const SUPER_SESSION = {
  accessTtlSec: 600,
  idleTimeoutSec: 1800,
  absoluteTimeoutSec: 43_200,
} as const;

export const PasswordSchema = z.string().min(8, { error: 'At least 8 characters' }).max(128);

export const SignupRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().transform((e) => e.toLowerCase()),
  password: PasswordSchema,
  workspaceName: z.string().trim().min(2).max(80),
  timezone: z.string().default('Asia/Kolkata'),
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const GoogleAuthRequestSchema = z.object({
  idToken: z.string().min(10).describe('Google Identity Services credential'),
  workspaceName: z.string().trim().min(2).max(80).optional().describe('Required when signing up'),
  inviteToken: z.string().optional(),
});
export type GoogleAuthRequest = z.infer<typeof GoogleAuthRequestSchema>;

/** Body of login/signup/refresh responses. Refresh tokens are cookies, never returned in JSON. */
export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().describe('Seconds until the access token expires'),
});
export type AuthTokens = z.infer<typeof AuthTokensSchema>;

/** Impersonation claim inside a workspace token minted for a Super Admin. */
export const ImpersonationClaimSchema = z.object({
  sid: IdSchema.describe('ImpersonationSession id'),
  adminId: IdSchema,
  readOnly: z.boolean(),
  exp: z.number().int().describe('Unix seconds; the token never outlives the session'),
});

/** Decoded workspace access-token claims; the auth guard maps these to AuthContext. */
export const WorkspaceClaimsSchema = z.object({
  aud: z.literal(JWT_AUDIENCE.workspace),
  sub: IdSchema.describe('User id (for impersonation: the company admin user being viewed as)'),
  wid: IdSchema.describe('Workspace id'),
  rid: IdSchema.describe('Role id'),
  kind: RoleKindSchema,
  scope: DataScopeSchema,
  perms: z.array(PermissionSchema),
  sid: z.string().describe('Session id (refresh token family)'),
  imp: ImpersonationClaimSchema.optional(),
});
export type WorkspaceClaims = z.infer<typeof WorkspaceClaimsSchema>;

/** Decoded platform (Super Admin) access-token claims. */
export const PlatformClaimsSchema = z.object({
  aud: z.literal(JWT_AUDIENCE.platform),
  sub: IdSchema.describe('PlatformAdmin id'),
  role: z.literal('super_admin'),
  perms: z.array(PlatformPermissionSchema),
  sid: z.string(),
  mfa: z.literal(true),
});
export type PlatformClaims = z.infer<typeof PlatformClaimsSchema>;

export const InviteCreateSchema = z.object({
  email: z.email().optional().describe('Omit to create a shareable link'),
  roleId: IdSchema.describe('System or custom role'),
  teamId: IdSchema.optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});
export type InviteCreate = z.infer<typeof InviteCreateSchema>;

export const InviteSchema = z.object({
  id: IdSchema,
  email: z.email().nullable(),
  roleId: IdSchema,
  roleName: z.string(),
  url: z.string().url().optional().describe('Only returned once, at creation'),
  expiresAt: IsoDateTimeSchema,
  acceptedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type Invite = z.infer<typeof InviteSchema>;

export const InviteAcceptSchema = z.object({
  token: z.string().min(16),
  name: z.string().trim().min(1).max(80),
  password: PasswordSchema,
});
export type InviteAccept = z.infer<typeof InviteAcceptSchema>;

// ---------------------------------------------------------------- Super Admin auth

export const SuperLoginRequestSchema = LoginRequestSchema;

/** Step 1 result: password OK, 2FA required. */
export const SuperLoginChallengeSchema = z.object({
  challengeToken: z.string().describe('Short-lived (5 min), single use'),
  enrollmentRequired: z.boolean(),
  /** Only when enrolling: otpauth:// URL to show as a QR code. */
  otpauthUrl: z.string().nullable(),
});
export type SuperLoginChallenge = z.infer<typeof SuperLoginChallengeSchema>;

export const SuperVerifyRequestSchema = z.object({
  challengeToken: z.string(),
  code: z.string().regex(/^\d{6}$/, { error: 'Enter the 6-digit code' }),
});

export const PlatformAdminSchema = z.object({
  id: IdSchema,
  email: z.email(),
  name: z.string(),
  permissions: z.array(PlatformPermissionSchema),
  mfaEnabled: z.boolean(),
  ipAllowlist: z.array(z.string()).describe('CIDR or exact IPs; empty = any'),
  isActive: z.boolean(),
  lastLoginAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type PlatformAdmin = z.infer<typeof PlatformAdminSchema>;

export const SuperSessionSchema = AuthTokensSchema.extend({
  admin: PlatformAdminSchema,
  idleTimeoutSec: z.number().int(),
});
export type SuperSession = z.infer<typeof SuperSessionSchema>;
