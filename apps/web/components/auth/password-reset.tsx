'use client';

import { PasswordForgotSchema } from '@vistar/shared';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiRequestError } from '@/lib/api-error';
import { api } from '@/lib/api/client';
import { AuthCard, FormAlert } from './auth-frame';
import { focusFirstInvalid } from './form-errors';
import { PasswordInput } from './password-input';

const failureText = (e: unknown, fallback: string) => (isApiRequestError(e) ? e.message : fallback);

function BackToSignIn() {
  return (
    <p className="text-center text-sm text-muted-strong">
      <Link href="/login" className="focus-ring rounded-xs font-medium text-accent-text underline-offset-4 hover:underline">
        Back to sign in
      </Link>
    </p>
  );
}

/** /forgot-password: asks for the e-mail and always answers the same way (no account enumeration). */
export function ForgotPasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    const parsed = PasswordForgotSchema.safeParse({ email: email.trim() });
    if (!parsed.success) {
      setError('Enter a valid email, like priya@company.in');
      focusFirstInvalid(formRef.current);
      return;
    }
    setError(null);
    setSending(true);
    try {
      await api.call('authPasswordForgot', { body: parsed.data });
      setSentTo(parsed.data.email);
    } catch (err) {
      setFailure(failureText(err, 'The link was not sent. Check your connection and try again.'));
    } finally {
      setSending(false);
    }
  }

  if (sentTo)
    return (
      <>
        <AuthCard title="Check your e-mail" description={`If ${sentTo} has a Vistar account, a link to choose a new password is on its way. It works once and expires in an hour.`}>
          <div className="flex flex-col items-start gap-3 text-sm text-muted-strong">
            <MailCheck aria-hidden className="size-6 text-success-text" />
            <p>No e-mail after a few minutes? Check spam, or ask your company admin to confirm the address you were added with.</p>
            <Button onClick={() => setSentTo(null)}>Use another e-mail</Button>
          </div>
        </AuthCard>
        <BackToSignIn />
      </>
    );

  return (
    <>
      <AuthCard title="Reset your password" description="Enter the e-mail you sign in with. We send you a link to choose a new password.">
        <form ref={formRef} noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
          {failure && <FormAlert>{failure}</FormAlert>}
          <FormField label="Work email" error={error} required>
            <Input type="email" name="email" autoComplete="email" inputMode="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="priya@company.in" />
          </FormField>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={sending}>
            Send the link
          </Button>
        </form>
      </AuthCard>
      <BackToSignIn />
    </>
  );
}

/** /reset-password?token=: checks the link, then sets a new password (signs out every session). */
export function ResetPasswordForm({ token }: { token: string | null }) {
  const formRef = useRef<HTMLFormElement>(null);
  const lookup = useQuery({
    queryKey: ['auth', 'password-reset', token],
    queryFn: ({ signal }) => api.call('authPasswordResetLookup', { query: { token: token! }, signal }),
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
  });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const min = lookup.data?.passwordMinLength ?? 8;

  if (!token || lookup.isError || (lookup.data && !lookup.data.valid))
    return (
      <>
        <AuthCard title="This link does not work" description="Password links work once and expire after an hour. Ask for a new one.">
          <Button asChild variant="primary" className="w-full">
            <Link href="/forgot-password">Send a new link</Link>
          </Button>
        </AuthCard>
        <BackToSignIn />
      </>
    );
  if (lookup.isPending)
    return (
      <AuthCard title="Choose a new password">
        <div role="status" aria-label="Checking the link" className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </AuthCard>
    );
  if (done)
    return (
      <AuthCard title="Password changed" description="Every device was signed out. Sign in with your new password.">
        <div className="flex flex-col items-start gap-3">
          <CheckCircle2 aria-hidden className="size-6 text-success-text" />
          <Button asChild variant="primary" className="w-full">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </AuthCard>
    );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    const errs: { password?: string; confirm?: string } = {};
    if (password.length < min) errs.password = `Use at least ${min} characters.`;
    else if (password.length > 128) errs.password = 'Use at most 128 characters.';
    if (confirm !== password) errs.confirm = 'The two passwords do not match.';
    setErrors(errs);
    if (errs.password || errs.confirm) {
      focusFirstInvalid(formRef.current);
      return;
    }
    setSaving(true);
    try {
      await api.call('authPasswordReset', { body: { token: token!, password } });
      setDone(true);
    } catch (err) {
      if (isApiRequestError(err) && err.details.some((d) => d.path === 'password')) setErrors({ password: err.details.find((d) => d.path === 'password')!.message });
      setFailure(failureText(err, 'The password was not changed. Try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <AuthCard title="Choose a new password" description={lookup.data?.email ? `For ${lookup.data.email}.` : undefined}>
        <form ref={formRef} noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
          {failure && <FormAlert>{failure}</FormAlert>}
          <FormField label="New password" error={errors.password} hint={`At least ${min} characters`} required>
            <PasswordInput name="new-password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormField>
          <FormField label="Repeat the password" error={errors.confirm} required>
            <PasswordInput name="confirm-password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </FormField>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={saving}>
            Change password
          </Button>
        </form>
      </AuthCard>
      <BackToSignIn />
    </>
  );
}

type VerifyState = { kind: 'working' } | { kind: 'done' } | { kind: 'failed'; message: string };

/** /verify-email?token=: confirms the address once (the request runs in the browser, so link scanners do not use the token up). */
export function VerifyEmail({ token }: { token: string | null }) {
  const [state, setState] = useState<VerifyState>(token ? { kind: 'working' } : { kind: 'failed', message: 'The link is incomplete. Open it again from the e-mail.' });
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    api
      .call('authEmailVerify', { body: { token } })
      .then(() => setState({ kind: 'done' }))
      .catch((err: unknown) => setState({ kind: 'failed', message: failureText(err, 'The e-mail was not confirmed. Try the link again.') }));
  }, [token]);

  if (state.kind === 'working')
    return (
      <AuthCard title="Confirming your e-mail">
        <div role="status" aria-label="Confirming" className="flex flex-col gap-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-10 w-full" />
        </div>
      </AuthCard>
    );
  if (state.kind === 'done')
    return (
      <AuthCard title="E-mail confirmed" description="Thank you. Your workspace is ready.">
        <div className="flex flex-col items-start gap-3">
          <CheckCircle2 aria-hidden className="size-6 text-success-text" />
          <Button asChild variant="primary" className="w-full">
            <Link href="/login">Continue</Link>
          </Button>
        </div>
      </AuthCard>
    );
  return (
    <>
      <AuthCard title="This link does not work" description={`${state.message} Verification links expire after 24 hours; sign in to send a new one.`}>
        <Button asChild variant="primary" className="w-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </AuthCard>
    </>
  );
}
