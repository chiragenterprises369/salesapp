'use client';

import { LoginRequestSchema } from '@vistar/shared';
import Link from 'next/link';
import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { login, type AuthFailure } from '@/lib/auth/actions';
import { SUPER_LOGIN_PATH } from '@/lib/auth/redirect';
import { isCustomHost } from '@/lib/branding/boot';
import { useRedirectWhenSignedIn } from '@/lib/auth/use-auth';
import { useSessionEndReason, useSessionStore } from '@/lib/session/session';
import { AuthCard, FormAlert } from './auth-frame';
import { DemoAccounts } from './demo-accounts';
import { fieldErrors, focusFirstInvalid } from './form-errors';
import { GoogleButton } from './google-button';
import { PasswordInput } from './password-input';
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
    <>
      <AuthCard title="Sign in to Vistar" description="Use the email your company added you with.">
        <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {!failure && endReason && endReason.code !== 'AUTH_UNAUTHENTICATED' && (
            <FormAlert tone="info">
              <div className="flex items-center justify-between gap-3">
                <span className="flex-1">{endReason.message.replace(/\.?$/, '.')}</span>
                <button
                  type="button"
                  onClick={() => {
                    useSessionStore.setState({ endReason: null });
                    window.location.reload();
                  }}
                  className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-2xs font-bold text-accent-ink hover:brightness-110 active:scale-95 transition-all"
                >
                  Retry
                </button>
              </div>
            </FormAlert>
          )}
          {failure && (
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
            </FormAlert>
          )}
          <FormField label="Work email" error={errors.email} required>
            <Input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="priya@company.in"
            />
          </FormField>
          <FormField label="Password" error={errors.password} required>
            <PasswordInput name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormField>
          {/* ---- change #20: config (password reset by e-mail) */}
          <p className="-mt-2 text-right text-sm">
            <Link href="/forgot-password" className="focus-ring rounded-xs text-accent-text underline-offset-4 hover:underline">
              Forgot password?
            </Link>
          </p>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting}>
            Sign in
          </Button>
        </form>
        <GoogleButton />
      </AuthCard>
      {!brandedHost && (
        <p className="text-center text-sm text-muted-strong">
          New to Vistar?{' '}
          <Link href="/signup" className="focus-ring rounded-xs font-medium text-accent-text underline-offset-4 hover:underline">
            Create a workspace
          </Link>
        </p>
      )}
      <DemoAccounts
        disabled={submitting}
        onPick={(e, p) => {
          setEmail(e);
          setPassword(p);
          void signIn({ email: e, password: p });
        }}
      />
    </>
  );
}
