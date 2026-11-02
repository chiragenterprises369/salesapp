import type { FieldError, InviteAccept, LoginRequest, SignupRequest, SuperLoginChallenge } from '@vistar/shared';
import { api } from '../api/client';
import { isMockData } from '../api/data-source';
import { isApiRequestError } from '../api-error';
import { useSessionStore } from '../session/session';
import { mockAcceptInvite, mockLogin, mockSignup, mockSuperLogin, mockSuperVerify, type AuthFailure, type AuthFailureCode, type SuperLoginStep } from './mock-auth';

/**
 * Auth actions used by the sign-in, sign-up, invite and Super Admin pages. API mode calls the real
 * routes through the session store (which keeps the token and `me`); mock mode (tests) keeps the
 * Wave 1 mock backend. Errors come back as `AuthFailure` with the API's user-safe message.
 */
export type { AuthFailure, AuthFailureCode, SuperLoginStep };

const CODE_MAP: Record<string, AuthFailureCode> = {
  AUTH_INVALID_CREDENTIALS: 'BAD_CREDENTIALS',
  AUTH_ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  AUTH_EMAIL_TAKEN: 'EMAIL_TAKEN',
  AUTH_INVITE_INVALID: 'INVITE_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  VALIDATION_FAILED: 'INVALID',
  SERVICE_UNAVAILABLE: 'NETWORK',
  INTEGRATION_NOT_CONNECTED: 'NOT_CONFIGURED',
};

/** ApiRequestError (or anything thrown) -> AuthFailure with a message the user can act on. */
export function authFailureFrom(e: unknown, overrides: Partial<Record<string, AuthFailureCode>> = {}): AuthFailure {
  if (isApiRequestError(e)) {
    const code = overrides[e.code] ?? CODE_MAP[e.code] ?? 'UNKNOWN';
    const message = /[.!?]$/.test(e.message) ? e.message : `${e.message}.`;
    return { ok: false, code, message, details: e.details };
  }
  return { ok: false, code: 'UNKNOWN', message: 'Something went wrong. Try again.' };
}

export async function login(input: LoginRequest): Promise<{ ok: true } | AuthFailure> {
  if (isMockData()) {
    const r = await mockLogin(input);
    if (!r.ok) return r;
    useSessionStore.getState().signInMock(r.persona);
    return { ok: true };
  }
  try {
    await useSessionStore.getState().signIn(input.email, input.password);
    return { ok: true };
  } catch (e) {
    return authFailureFrom(e);
  }
}

export async function signup(input: SignupRequest): Promise<{ ok: true; workspaceName: string } | AuthFailure> {
  if (isMockData()) {
    const r = await mockSignup(input);
    useSessionStore.getState().signInMock(r.persona);
    return { ok: true, workspaceName: input.workspaceName };
  }
  try {
    const me = await useSessionStore.getState().signUp(input);
    return { ok: true, workspaceName: me.workspace.name };
  } catch (e) {
    return authFailureFrom(e);
  }
}

export interface InviteDetails {
  workspaceName: string;
  email: string | null;
  roleName: string;
}

/** GET /invites/lookup before showing the accept form. */
export async function lookupInvite(token: string, mock: InviteDetails): Promise<{ ok: true; invite: InviteDetails } | AuthFailure> {
  if (isMockData()) return { ok: true, invite: mock };
  try {
    return { ok: true, invite: await api.call('inviteLookup', { query: { token } }) };
  } catch (e) {
    return authFailureFrom(e);
  }
}

export async function acceptInvite(input: InviteAccept): Promise<{ ok: true; workspaceName: string } | AuthFailure> {
  if (isMockData()) {
    const r = await mockAcceptInvite(input);
    useSessionStore.getState().signInMock(r.persona);
    return { ok: true, workspaceName: '' };
  }
  try {
    const me = await useSessionStore.getState().acceptInvite(input);
    return { ok: true, workspaceName: me.workspace.name };
  } catch (e) {
    return authFailureFrom(e);
  }
}

/** Base32 secret inside an otpauth:// URL (shown for manual entry while enrolling). */
export function secretFromOtpauth(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get('secret');
  } catch {
    return /[?&]secret=([A-Z2-7]+)/i.exec(url)?.[1] ?? null;
  }
}

export async function superLogin(input: LoginRequest): Promise<SuperLoginStep | AuthFailure> {
  if (isMockData()) return mockSuperLogin(input);
  try {
    const challenge: SuperLoginChallenge = await useSessionStore.getState().superSignIn(input.email, input.password);
    return { ok: true, challenge, secret: secretFromOtpauth(challenge.otpauthUrl) };
  } catch (e) {
    return authFailureFrom(e);
  }
}

export async function superVerify(input: { challengeToken: string; code: string }): Promise<{ ok: true } | AuthFailure> {
  if (isMockData()) {
    const r = await mockSuperVerify(input);
    if (r.ok) useSessionStore.getState().signInMock('super_admin');
    return r;
  }
  try {
    await useSessionStore.getState().superVerify(input.challengeToken, input.code);
    return { ok: true };
  } catch (e) {
    // Expired, used or over-tried challenges need the password again; a wrong code can be retyped.
    return authFailureFrom(e, { AUTH_TOKEN_EXPIRED: 'CHALLENGE_EXPIRED', AUTH_TOKEN_INVALID: 'CHALLENGE_EXPIRED', AUTH_INVALID_CREDENTIALS: 'BAD_CODE' });
  }
}

export type { FieldError };
