'use client';

import { InviteAcceptSchema } from '@vistar/shared';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { acceptInvite, lookupInvite, type AuthFailure, type InviteDetails } from '@/lib/auth/actions';
import { DEMO_ACCOUNTS, DEMO_WORKSPACE_NAME } from '@/lib/auth/demo-accounts';
import { useRedirectWhenSignedIn } from '@/lib/auth/use-auth';
import { AuthCard, FormAlert } from './auth-frame';
import { fieldErrors, focusFirstInvalid } from './form-errors';
import { PasswordInput } from './password-input';
import { SigningIn } from './signing-in';

type Field = 'name' | 'password' | 'email';
const MESSAGES: Partial<Record<Field, string>> = { name: 'Enter your name', password: 'Use at least 8 characters', email: 'Enter a valid email, like priya@company.in' };

/** Invite shown by the test-only mock layer (the API answers GET /invites/lookup). */
const MOCK_INVITE: InviteDetails = { workspaceName: DEMO_WORKSPACE_NAME, email: null, roleName: 'Employee' };
const MOCK_INVITER = DEMO_ACCOUNTS.find((a) => a.persona === 'company_admin')!;

type Lookup = { state: 'loading' } | { state: 'ok'; invite: InviteDetails } | { state: 'invalid'; failure: AuthFailure | null };

/** Accept an invite: choose a name and password, then land in the panel for the invited role. */
export function InviteForm({ token }: { token: string }) {
  const status = useRedirectWhenSignedIn(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState({ name: '', password: '', email: '' });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const validToken = InviteAcceptSchema.shape.token.safeParse(token).success;
  const [lookup, setLookup] = useState<Lookup>(validToken ? { state: 'loading' } : { state: 'invalid', failure: null });

  useEffect(() => {
    if (!validToken) return;
    let alive = true;
    void lookupInvite(token, MOCK_INVITE).then((r) => {
      if (!alive) return;
      setLookup(r.ok ? { state: 'ok', invite: r.invite } : { state: 'invalid', failure: r.code === 'INVITE_INVALID' ? null : r });
    });
    return () => {
      alive = false;
    };
  }, [token, validToken]);

  const invite = lookup.state === 'ok' ? lookup.invite : null;
  const needsEmail = !!invite && !invite.email;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    const parsed = InviteAcceptSchema.safeParse({ token, name: values.name, password: values.password, ...(needsEmail ? { email: values.email } : {}) });
    const emailMissing = needsEmail && !values.email.trim();
    if (!parsed.success || emailMissing) {
      const errs = parsed.success ? {} : fieldErrors<Field>(parsed.error, MESSAGES);
      if (emailMissing) errs.email = MESSAGES.email;
      setErrors(errs);
      focusFirstInvalid(formRef.current);
      return;
    }
    setErrors({});
    setSubmitting(true);
    const result = await acceptInvite(parsed.data);
    if (!result.ok) {
      setSubmitting(false);
      setFailure(result);
      const fromApi: Partial<Record<Field, string>> = {};
      for (const d of result.details ?? []) fromApi[d.path as Field] ??= d.message;
      if (result.code === 'EMAIL_TAKEN') fromApi.email = 'This email already has a Vistar account. Sign in instead.';
      setErrors(fromApi);
      return;
    }
    toast.success(`Welcome to ${result.workspaceName || invite?.workspaceName || 'Vistar'}`);
  }

  if (status === 'authenticated') return <SigningIn />;

  if (lookup.state === 'invalid') {
    return (
      <AuthCard
        title="This invite link does not work"
        description={lookup.failure?.message ?? 'The link is incomplete, was already used or has expired. Ask the person who invited you to send a new one.'}
      >
        <Button asChild variant="primary" size="lg" className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  if (!invite) {
    return (
      <AuthCard title="Checking your invite" description="One moment.">
        <div role="status" aria-busy="true" aria-label="Loading invite" className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </AuthCard>
    );
  }

  const isMockInvite = invite === MOCK_INVITE;
  return (
    <AuthCard
      title={`Join ${invite.workspaceName}`}
      description={
        <>
          {isMockInvite ? `${MOCK_INVITER.name} invited you` : 'You were invited'} as {/^[aeiou]/i.test(invite.roleName) ? 'an' : 'a'}{' '}
          <span className="font-medium text-fg-secondary">{invite.roleName}</span>
          {invite.email ? (
            <>
              {' '}
              with <span className="font-medium text-fg-secondary">{invite.email}</span>
            </>
          ) : null}
          . Choose your name and a password to finish.
        </>
      }
    >
      <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {failure && <FormAlert>{failure.message}</FormAlert>}
        <FormField label="Your name" error={errors.name} hint="Shown to your team and on the Team Floor" required>
          <Input name="name" autoComplete="name" autoFocus value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} />
        </FormField>
        {needsEmail && (
          <FormField label="Work email" error={errors.email} required>
            <Input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              value={values.email}
              onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
              placeholder="priya@company.in"
            />
          </FormField>
        )}
        <FormField label="Password" error={errors.password} hint="At least 8 characters" required>
          <PasswordInput
            name="password"
            autoComplete="new-password"
            value={values.password}
            onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
          />
        </FormField>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting}>
          Join workspace
        </Button>
      </form>
    </AuthCard>
  );
}
