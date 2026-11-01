'use client';

import { InviteAcceptSchema } from '@vistar/shared';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { DEMO_ACCOUNTS, DEMO_WORKSPACE_NAME } from '@/lib/auth/demo-accounts';
import { mockAcceptInvite } from '@/lib/auth/mock-auth';
import { useRedirectWhenSignedIn } from '@/lib/auth/use-auth';
import { useSessionActions } from '@/lib/session/session';
import { AuthCard } from './auth-frame';
import { fieldErrors, focusFirstInvalid } from './form-errors';
import { PasswordInput } from './password-input';
import { SigningIn } from './signing-in';

type Field = 'name' | 'password';
const MESSAGES: Partial<Record<Field, string>> = { name: 'Enter your name', password: 'Use at least 8 characters' };

/** Mock invite details (Wave 3: GET /auth/invites/{token}). */
const INVITER = DEMO_ACCOUNTS.find((a) => a.persona === 'company_admin')!;

/** Accept an invite: choose a name and password, then land in the panel for the invited role. */
export function InviteForm({ token }: { token: string }) {
  const status = useRedirectWhenSignedIn(null);
  const { signInMock } = useSessionActions();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState({ name: '', password: '' });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const validToken = InviteAcceptSchema.shape.token.safeParse(token).success;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = InviteAcceptSchema.safeParse({ token, ...values });
    if (!parsed.success) {
      setErrors(fieldErrors<Field>(parsed.error, MESSAGES));
      focusFirstInvalid(formRef.current);
      return;
    }
    setErrors({});
    setSubmitting(true);
    const result = await mockAcceptInvite(parsed.data);
    toast.success(`Welcome to ${DEMO_WORKSPACE_NAME}`);
    signInMock(result.persona);
  }

  if (status === 'authenticated') return <SigningIn />;

  if (!validToken) {
    return (
      <AuthCard title="This invite link does not work" description="The link is incomplete or has expired. Ask the person who invited you to send a new one.">
        <Button asChild variant="primary" size="lg" className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={`Join ${DEMO_WORKSPACE_NAME}`}
      description={
        <>
          {INVITER.name} invited you as an <span className="font-medium text-fg-secondary">Employee</span>. Choose your name and a password to finish.
        </>
      }
    >
      <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormField label="Your name" error={errors.name} hint="Shown to your team and on the Team Floor" required>
          <Input name="name" autoComplete="name" autoFocus value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} />
        </FormField>
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
