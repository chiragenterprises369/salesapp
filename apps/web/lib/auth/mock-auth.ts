import type { InviteAccept, LoginRequest, RoleKind, SignupRequest, SuperLoginChallenge } from '@vistar/shared';
import { DEMO_PASSWORD, isSuperAdminEmail, personaForEmail } from './demo-accounts';

/**
 * Wave 1 mock auth backend. Same inputs as the real routes (POST /auth/login, /auth/signup,
 * /auth/invites/accept, /api/super/auth/login + /verify); Wave 3 swaps these for HTTP calls.
 * Never stores passwords; the "enrolled" flag only drives which Super Admin screen shows.
 */
export type AuthFailureCode = 'UNKNOWN_ACCOUNT' | 'BAD_CREDENTIALS' | 'PLATFORM_ACCOUNT' | 'CHALLENGE_EXPIRED' | 'BAD_CODE';

export interface AuthFailure {
  ok: false;
  code: AuthFailureCode;
  message: string;
}

const wait = (ms = 450) => new Promise((r) => setTimeout(r, ms));
const fail = (code: AuthFailureCode, message: string): AuthFailure => ({ ok: false, code, message });

export async function mockLogin(input: LoginRequest): Promise<{ ok: true; persona: RoleKind } | AuthFailure> {
  await wait();
  if (isSuperAdminEmail(input.email)) {
    return fail('PLATFORM_ACCOUNT', 'This is a platform account. Sign in on the Super Admin page instead.');
  }
  const persona = personaForEmail(input.email);
  if (!persona) return fail('UNKNOWN_ACCOUNT', 'This build only has demo accounts. Use a demo account to sign in.');
  if (input.password !== DEMO_PASSWORD) return fail('BAD_CREDENTIALS', 'Email or password is incorrect.');
  return { ok: true, persona };
}

export async function mockSignup(_input: SignupRequest): Promise<{ ok: true; persona: 'company_admin' }> {
  await wait(650);
  return { ok: true, persona: 'company_admin' };
}

export async function mockAcceptInvite(_input: InviteAccept): Promise<{ ok: true; persona: 'employee' }> {
  await wait(550);
  return { ok: true, persona: 'employee' };
}

// ---------------------------------------------------------------- Super Admin (password, then TOTP)

const KEY_ENROLLED = 'vistar.mock.super.enrolled';
const CHALLENGE_TTL_MS = 5 * 60_000;
let activeChallenge: { token: string; expiresAt: number } | null = null;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function randomBase32(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => BASE32[b % 32]).join('');
}

function isEnrolled(): boolean {
  try {
    return window.localStorage.getItem(KEY_ENROLLED) === '1';
  } catch {
    return false;
  }
}

export interface SuperLoginStep {
  ok: true;
  challenge: SuperLoginChallenge;
  /** Base32 secret for manual entry while enrolling (mock only; the API returns it inside otpauthUrl). */
  secret: string | null;
}

export async function mockSuperLogin(input: LoginRequest): Promise<SuperLoginStep | AuthFailure> {
  await wait();
  if (!isSuperAdminEmail(input.email) || input.password !== DEMO_PASSWORD) {
    return fail('BAD_CREDENTIALS', 'Email or password is incorrect.');
  }
  const token = randomBase32(24);
  activeChallenge = { token, expiresAt: Date.now() + CHALLENGE_TTL_MS };
  const enrollmentRequired = !isEnrolled();
  const secret = enrollmentRequired ? randomBase32(32) : null;
  return {
    ok: true,
    secret,
    challenge: {
      challengeToken: token,
      enrollmentRequired,
      otpauthUrl: secret ? `otpauth://totp/Vistar:${encodeURIComponent(input.email)}?secret=${secret}&issuer=Vistar&digits=6&period=30` : null,
    },
  };
}

/** Mock accepts any 6 digits for a live challenge. */
export async function mockSuperVerify(input: { challengeToken: string; code: string }): Promise<{ ok: true } | AuthFailure> {
  await wait(400);
  if (!activeChallenge || activeChallenge.token !== input.challengeToken || Date.now() > activeChallenge.expiresAt) {
    activeChallenge = null;
    return fail('CHALLENGE_EXPIRED', 'This sign-in attempt expired. Enter your password again.');
  }
  if (!/^\d{6}$/.test(input.code)) return fail('BAD_CODE', 'Enter the 6-digit code from your authenticator app.');
  activeChallenge = null;
  try {
    window.localStorage.setItem(KEY_ENROLLED, '1');
  } catch {
    /* private mode: enrolment screen shows again next time */
  }
  return { ok: true };
}
