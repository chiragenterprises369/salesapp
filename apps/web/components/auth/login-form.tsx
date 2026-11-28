'use client';

import { LoginRequestSchema } from '@vistar/shared';
import { Eye, EyeOff, Lock, User, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { LogoMark } from '@/components/shell/logo';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { login, type AuthFailure } from '@/lib/auth/actions';
import { DEMO_LOGIN_ENABLED } from '@/lib/auth/demo-accounts';
import { SUPER_LOGIN_PATH } from '@/lib/auth/redirect';
import { isCustomHost } from '@/lib/branding/boot';
import { useRedirectWhenSignedIn } from '@/lib/auth/use-auth';
import { useSessionEndReason, useSessionStore } from '@/lib/session/session';
import { FormAlert } from './auth-frame';
import { DemoAccounts } from './demo-accounts';
import { fieldErrors, focusFirstInvalid } from './form-errors';
import { GoogleButton } from './google-button';
import { SigningIn } from './signing-in';

type Field = 'email' | 'password';
const MESSAGES: Record<Field, string> = {
  email: 'Enter a valid email, like priya@company.in',
  password: 'Enter your password',
};

const noSubscribe = () => () => undefined;

/**
 * A company's custom domain or `<slug>.localhost` (D-060): no "Create a workspace" link there. Hidden
 * until hydration so a branded sign-in never flashes Vistar's sign-up link.
 */
function useBrandedHost(): boolean {
  return useSyncExternalStore(noSubscribe, () => isCustomHost(window.location.hostname), () => true);
}

/** Workspace sign-in (Company and Employee panels): POST /auth/login. */
export function LoginForm({ next }: { next: string | null }) {
  const status = useRedirectWhenSignedIn(next);
  const endReason = useSessionEndReason();
  const brandedHost = useBrandedHost();
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function signIn(values: { email: string; password: string }) {
    setFailure(null);
    useSessionStore.setState({ endReason: null });
    const parsed = LoginRequestSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors<Field>(parsed.error, MESSAGES));
      focusFirstInvalid(formRef.current);
      return;
    }
    setErrors({});
    setSubmitting(true);
    const result = await login(parsed.data);
    if (!result.ok) {
      setSubmitting(false);
      setFailure(result);
      return;
    }
    // The redirect hook sends the user to `next` or their panel once the session exists.
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void signIn({ email, password });
  };

  if (status === 'authenticated') return <SigningIn />;

  return (
    <div className="relative min-h-dvh flex items-center justify-center p-4 sm:p-6 lg:p-10 bg-gradient-to-br from-[#EAE4FE] via-[#E2D8FD] to-[#D9CDFE] overflow-hidden">
      {/* Top action bar: Home link & Theme Toggle */}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-30 flex items-center gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full bg-white/80 backdrop-blur-md px-3.5 py-1.5 text-xs font-semibold text-gray-700 shadow-sm border border-white/60 hover:bg-white hover:text-gray-900 transition-all"
        >
          <LogoMark className="size-4 shadow-none" />
          <span>Tootodo</span>
        </Link>
        <div className="rounded-full bg-white/80 backdrop-blur-md p-1 shadow-sm border border-white/60">
          <ThemeToggle />
        </div>
      </div>

      {/* Main Container with Floating Orbs */}
      <div className="relative w-full max-w-[960px]">
        {/* Floating circular disc - top left behind card */}
        <div
          aria-hidden="true"
          className="absolute -top-7 -left-7 size-28 rounded-full bg-[#533be9] z-0 shadow-xl shadow-indigo-950/20 max-sm:hidden"
        />

        {/* Floating circular translucent disc - bottom right behind card */}
        <div
          aria-hidden="true"
          className="absolute -bottom-8 -right-8 size-36 rounded-full bg-white/60 backdrop-blur-sm z-0 shadow-lg shadow-purple-900/10 max-sm:hidden"
        />

        {/* Central Card */}
        <div className="relative z-10 w-full rounded-[32px] overflow-hidden bg-white shadow-2xl shadow-indigo-950/15 border border-white/70 grid grid-cols-1 lg:grid-cols-2">
          {/* ================= LEFT SECTION: LOGIN FORM ================= */}
          <div className="p-8 sm:p-12 lg:p-14 flex flex-col justify-center bg-white">
            {/* Header / Title */}
            <div className="text-center mb-7">
              <h1 className="text-[26px] font-black tracking-[0.14em] text-gray-900 uppercase">
                LOGIN
              </h1>
              <p className="mt-1.5 text-[13px] text-gray-400">
                Sign in to manage your sales, leads, and team
              </p>
            </div>

            {/* Error / Alert Messages */}
            {!failure && endReason && endReason.code !== 'AUTH_UNAUTHENTICATED' && (
              <div className="mb-4">
                <FormAlert tone="info">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex-1">{endReason.message.replace(/\.?$/, '.')}</span>
                    <button
                      type="button"
                      onClick={() => {
                        useSessionStore.setState({ endReason: null });
                        window.location.reload();
                      }}
                      className="shrink-0 rounded-full bg-[#5945ED] px-3 py-1 text-2xs font-bold text-white hover:bg-[#4834dc] active:scale-95 transition-all"
                    >
                      Retry
                    </button>
                  </div>
                </FormAlert>
              </div>
            )}
            {failure && (
              <div className="mb-4">
                <FormAlert>
                  {failure.message}
                  {failure.code === 'PLATFORM_ACCOUNT' && (
                    <>
                      {' '}
                      <Link href={SUPER_LOGIN_PATH} className="font-medium underline underline-offset-4">
                        Go to Super Admin sign-in
                      </Link>
                    </>
                  )}
                  {/* The API says "incorrect" for Super Admin emails too (it never hints which accounts exist), so
                      point platform staff to their own page. Not on company custom domains. */}
                  {failure.code === 'BAD_CREDENTIALS' && !brandedHost && (
                    <span className="mt-1 block">
                      Super Admin account?{' '}
                      <Link href={SUPER_LOGIN_PATH} className="font-medium underline underline-offset-4">
                        Use the Super Admin sign-in
                      </Link>
                    </span>
                  )}
                </FormAlert>
              </div>
            )}

            {/* Form */}
            <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
              {/* Username / Work email Field */}
              <div className="flex flex-col gap-1">
                <div
                  className={`relative flex items-center rounded-xl bg-[#F4F3FF] border transition-all ${
                    errors.email ? 'border-red-400 ring-2 ring-red-100' : 'border-transparent focus-within:border-[#6355ED] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#6355ED]/20'
                  }`}
                >
                  <User className="ml-3.5 size-4 text-gray-400 shrink-0" />
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    inputMode="email"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Username or work email"
                    className="w-full bg-transparent px-3 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
                  />
                </div>
                {errors.email && <p className="text-[11px] font-medium text-red-500 pl-2">{errors.email}</p>}
              </div>

              {/* Password Field */}
              <div className="flex flex-col gap-1">
                <div
                  className={`relative flex items-center rounded-xl bg-[#F4F3FF] border transition-all ${
                    errors.password ? 'border-red-400 ring-2 ring-red-100' : 'border-transparent focus-within:border-[#6355ED] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#6355ED]/20'
                  }`}
                >
                  <Lock className="ml-3.5 size-4 text-gray-400 shrink-0" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    className="w-full bg-transparent px-3 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3.5 text-gray-400 hover:text-gray-600 focus:outline-none transition-colors"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-[11px] font-medium text-red-500 pl-2">{errors.password}</p>}
              </div>

              {/* Forgot password */}
              <div className="flex justify-end -mt-1">
                <Link
                  href="/forgot-password"
                  className="text-[12px] font-medium text-gray-500 hover:text-[#5945ED] transition-colors"
                >
                  Forgot password?
                </Link>
              </div>

              {/* Submit Button ("Login Now") */}
              <div className="pt-2 flex justify-center">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full sm:w-auto min-w-[150px] px-9 py-3 rounded-xl bg-[#5945ED] hover:bg-[#4834dc] active:scale-[0.98] text-white font-semibold text-sm shadow-lg shadow-[#5945ED]/30 disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {submitting ? (
                    <span className="inline-block size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <span>Login Now</span>
                      <ArrowRight className="size-3.5 opacity-80" />
                    </>
                  )}
                </button>
              </div>
            </form>

            {/* Google sign-in, drawn by Google itself, only when the Super Admin set up the Google OAuth client
                (Super Admin > Config). Without it the whole "Login with Others" section stays hidden. */}
            <GoogleButton
              buttonTheme="outline"
              divider={
                <div className="relative my-7 flex items-center justify-center">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-100" />
                  </div>
                  <span className="relative bg-white px-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    Login with Others
                  </span>
                </div>
              }
            />

            {/* Create Workspace Link */}
            {!brandedHost && (
              <p className="text-center text-xs text-gray-500 mt-6">
                Don&apos;t have an account?{' '}
                <Link href="/signup" className="font-semibold text-[#5945ED] hover:underline">
                  Create a workspace
                </Link>
              </p>
            )}

            {/* One-click demo sign-in: the demo site and development builds only, never production */}
            {DEMO_LOGIN_ENABLED && (
              <DemoAccounts
                busy={submitting}
                onPick={(e, p) => {
                  setEmail(e);
                  setPassword(p);
                  void signIn({ email: e, password: p });
                }}
              />
            )}
          </div>

          {/* ================= RIGHT SECTION: SIDE HERO VISUAL ================= */}
          <div className="relative hidden lg:flex flex-col items-center justify-center p-8 bg-gradient-to-br from-[#6251ee] via-[#5945ed] to-[#4531d8] overflow-hidden select-none">
            {/* Background Decorative Wavy Topography Lines */}
            <svg
              className="absolute inset-0 size-full pointer-events-none opacity-20"
              viewBox="0 0 500 700"
              fill="none"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d="M -50 120 C 120 40, 220 220, 550 100" stroke="#FFFFFF" strokeWidth="2.5" />
              <path d="M -50 280 C 160 200, 280 360, 550 240" stroke="#FFFFFF" strokeWidth="2.5" />
              <path d="M -50 440 C 140 340, 300 520, 550 400" stroke="#FFFFFF" strokeWidth="2.5" />
              <path d="M -50 600 C 180 500, 320 660, 550 540" stroke="#FFFFFF" strokeWidth="2.5" />
            </svg>

            {/* Floating Lightning Badge on the Left Edge */}
            <div
              aria-hidden="true"
              className="absolute top-1/2 -left-5 -translate-y-1/2 z-20 size-11 rounded-full bg-white shadow-xl shadow-indigo-950/25 flex items-center justify-center"
            >
              <svg viewBox="0 0 24 24" className="size-5 fill-amber-400 text-amber-500">
                <path
                  d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
                  stroke="#EAB308"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            {/* Translucent Frosted Glass Card Container with Floating Hero */}
            <div className="relative w-[86%] max-w-[360px] aspect-[4/5] flex items-center justify-center">
              {/* Frosted Glass Backdrop Card */}
              <div className="absolute inset-x-2 inset-y-3 rounded-[30px] border border-white/25 bg-white/10 backdrop-blur-md shadow-2xl overflow-hidden pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-t from-white/15 to-transparent pointer-events-none" />
              </div>

              {/* Growth CRM Laptop Hero Image */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/auth-hero-growth.webp"
                alt="Tootodo Sales CRM"
                className="relative z-10 w-auto h-auto max-w-[104%] max-h-[98%] object-contain select-none pointer-events-none drop-shadow-2xl transition-transform duration-500 hover:scale-[1.03]"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
