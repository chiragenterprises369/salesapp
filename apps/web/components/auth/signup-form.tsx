'use client';

import { SignupRequestSchema } from '@vistar/shared';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { COMMON_TIME_ZONES } from '@/components/common/timezones';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { signup, type AuthFailure } from '@/lib/auth/actions';
import { useRedirectWhenSignedIn } from '@/lib/auth/use-auth';
import { AuthCard, FormAlert } from './auth-frame';
import { fieldErrors, focusFirstInvalid } from './form-errors';
import { GoogleButton } from './google-button';
import { PasswordInput } from './password-input';
import { SigningIn } from './signing-in';

type Field = 'name' | 'email' | 'password' | 'workspaceName' | 'timezone';
const MESSAGES: Partial<Record<Field, string>> = {
  name: 'Enter your name',
  email: 'Enter a valid email, like anil@company.in',
  password: 'Use at least 8 characters',
  workspaceName: 'Enter your company name (2 to 80 characters)',
};

/** Create a workspace; the creator becomes its company admin (POST /auth/signup). */
export function SignupForm() {
  const status = useRedirectWhenSignedIn(null);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState({ name: '', email: '', password: '', workspaceName: '', timezone: 'Asia/Kolkata' });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const set = (k: Field) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = SignupRequestSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors<Field>(parsed.error, MESSAGES));
      focusFirstInvalid(formRef.current);
      return;
    }
    setErrors({});
    setFailure(null);
    setSubmitting(true);
    const result = await signup(parsed.data);
    if (!result.ok) {
      setSubmitting(false);
      setFailure(result);
      const fromApi: Partial<Record<Field, string>> = {};
      for (const d of result.details ?? []) fromApi[d.path as Field] ??= d.message;
      if (result.code === 'EMAIL_TAKEN') fromApi.email = 'This email already has a Vistar account. Sign in instead.';
      setErrors(fromApi);
      focusFirstInvalid(formRef.current);
      return;
    }
    toast.success('Workspace created', { description: `Welcome to ${result.workspaceName}. Invite your team from Settings.` });
  }

  if (status === 'authenticated') return <SigningIn />;

  return (
    <>
      <AuthCard title="Create your workspace" description="Set up Vistar for your company. You can invite your team next.">
        <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {failure && <FormAlert>{failure.message}</FormAlert>}
          <FormField label="Your name" error={errors.name} required>
            <Input name="name" autoComplete="name" autoFocus value={values.name} onChange={set('name')} placeholder="Anil Kapoor" />
          </FormField>
          <FormField label="Work email" error={errors.email} required>
            <Input type="email" name="email" autoComplete="email" inputMode="email" value={values.email} onChange={set('email')} placeholder="anil@company.in" />
          </FormField>
          <FormField label="Password" error={errors.password} hint="At least 8 characters" required>
            <PasswordInput name="password" autoComplete="new-password" value={values.password} onChange={set('password')} />
          </FormField>
          <FormField label="Company name" error={errors.workspaceName} required>
            <Input name="workspaceName" autoComplete="organization" value={values.workspaceName} onChange={set('workspaceName')} placeholder="Shakti Industries" />
          </FormField>
          <FormField label="Company timezone" hint="Used for business hours, reports and scheduled themes" error={errors.timezone}>
            <NativeSelect name="timezone" value={values.timezone} onChange={set('timezone')}>
              {COMMON_TIME_ZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace('_', ' ')}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting}>
            Create workspace
          </Button>
        </form>
        {/* ---- change #20: config (Google sign-up once the Super Admin configured the Google OAuth client) */}
        <GoogleButton
          label="signup_with"
          workspaceName={values.workspaceName}
          onBeforeSignIn={() => (values.workspaceName.trim().length >= 2 ? null : 'Enter your company name first, then continue with Google.')}
        />
      </AuthCard>
      <p className="text-center text-sm text-muted-strong">
        Already use Vistar?{' '}
        <Link href="/login" className="focus-ring rounded-xs font-medium text-accent-text underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
