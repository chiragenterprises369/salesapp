'use client';

import { LoginRequestSchema, SuperVerifyRequestSchema, type SuperLoginChallenge } from '@vistar/shared';
import { Check, Copy, ShieldCheck } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { DEMO_PASSWORD, DEMO_SUPER_ADMIN } from '@/lib/auth/demo-accounts';
import { superLogin, superVerify, type AuthFailure } from '@/lib/auth/actions';
import { qrMatrix, qrSvgPath } from '@/lib/auth/qr';
import { isMockData } from '@/lib/api/data-source';
import { useRedirectWhenSignedIn } from '@/lib/auth/use-auth';
import { AuthCard, FormAlert } from './auth-frame';
import { fieldErrors, focusFirstInvalid } from './form-errors';
import { PasswordInput } from './password-input';
import { SigningIn } from './signing-in';

const isDev = process.env.NODE_ENV !== 'production';

type Step = { kind: 'password' } | { kind: 'code'; challenge: SuperLoginChallenge; secret: string | null; email: string };

/**
 * Super Admin sign-in: password, then a mandatory 6-digit TOTP code. First sign-in shows the
 * enrolment screen with a QR code and the authenticator key (POST /api/super/auth/login, then /verify).
 */
export function SuperLoginFlow({ next, reason }: { next: string | null; reason: string | null }) {
  // A workspace session may exist; only a platform session counts as "signed in" here.
  const status = useRedirectWhenSignedIn(next, 'platform');
  const [step, setStep] = useState<Step>({ kind: 'password' });

  if (status === 'authenticated') return <SigningIn label="Opening the platform console" />;

  return (
    <>
      {reason === 'idle' && step.kind === 'password' && (
        <FormAlert tone="info">You were signed out after 30 minutes without activity. Sign in again to continue.</FormAlert>
      )}
      {step.kind === 'password' ? (
        <PasswordStep onChallenge={(challenge, secret, email) => setStep({ kind: 'code', challenge, secret, email })} />
      ) : (
        <CodeStep step={step} onRestart={() => setStep({ kind: 'password' })} />
      )}
    </>
  );
}

function PasswordStep({ onChallenge }: { onChallenge: (c: SuperLoginChallenge, secret: string | null, email: string) => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'email' | 'password', string>>>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(values: { email: string; password: string }) {
    setFailure(null);
    const parsed = LoginRequestSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error, { email: 'Enter a valid email', password: 'Enter your password' }));
      focusFirstInvalid(formRef.current);
      return;
    }
    setErrors({});
    setSubmitting(true);
    const result = await superLogin(parsed.data);
    setSubmitting(false);
    if (!result.ok) return setFailure(result);
    onChallenge(result.challenge, result.secret, parsed.data.email);
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit({ email, password });
  };

  return (
    <>
      <AuthCard title="Super Admin sign-in" description="Platform staff only. Every action in the console is recorded in the audit log.">
        <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {failure && <FormAlert>{failure.message}</FormAlert>}
          <FormField label="Email" error={errors.email} required>
            <Input type="email" name="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <FormField label="Password" error={errors.password} required>
            <PasswordInput name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormField>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting}>
            Continue
          </Button>
        </form>
      </AuthCard>
      {isDev && (
        <section aria-labelledby="demo-super" className="card rounded-[18px] border border-hair bg-gradient-to-b from-[var(--card-top,#191c20)] to-[var(--card,#121517)] p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 id="demo-super" className="text-sm font-bold text-ink">
              Demo account
            </h2>
            <span className="text-2xs font-semibold text-faint uppercase tracking-wider">Dev</span>
          </div>
          <p className="mt-1 text-xs text-faint">
            <span className="font-semibold text-ink">{DEMO_SUPER_ADMIN.email}</span> with password <code className="rounded-[4px] bg-well-2 px-1.5 py-0.5 font-mono text-ink text-2xs">{DEMO_PASSWORD}</code>.{' '}
            {isMockData() ? 'Any 6-digit code passes the second step.' : 'The first sign-in sets up two-step verification with an authenticator app.'}
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3.5"
            disabled={submitting}
            onClick={() => {
              setEmail(DEMO_SUPER_ADMIN.email);
              setPassword(DEMO_PASSWORD);
              void submit({ email: DEMO_SUPER_ADMIN.email, password: DEMO_PASSWORD });
            }}
          >
            Use demo account
          </Button>
        </section>
      )}
    </>
  );
}

function groupKey(secret: string) {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

/** Scannable QR of the otpauth URL. Dark modules on white in both themes so phone cameras read it. */
function EnrolmentQr({ url }: { url: string }) {
  const qr = useMemo(() => {
    try {
      return qrSvgPath(qrMatrix(url));
    } catch {
      return null;
    }
  }, [url]);
  if (!qr) return null;
  return (
    <figure className="flex flex-col items-center gap-2">
      <svg
        role="img"
        aria-label="QR code for your authenticator app"
        viewBox={`0 0 ${qr.size} ${qr.size}`}
        shapeRendering="crispEdges"
        className="size-44 rounded-md border border-border"
        data-totp-qr
      >
        <rect width={qr.size} height={qr.size} fill="#fff" />
        <path d={qr.d} fill="#000" />
      </svg>
      <figcaption className="text-xs text-muted-strong">Scan with Google Authenticator, Microsoft Authenticator or 1Password</figcaption>
    </figure>
  );
}

function CodeStep({ step, onRestart }: { step: Extract<Step, { kind: 'code' }>; onRestart: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const enrolling = step.challenge.enrollmentRequired;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    const parsed = SuperVerifyRequestSchema.safeParse({ challengeToken: step.challenge.challengeToken, code });
    if (!parsed.success) {
      setError('Enter the 6-digit code from your authenticator app');
      focusFirstInvalid(formRef.current);
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await superVerify(parsed.data);
    if (!result.ok) {
      setSubmitting(false);
      setFailure(result);
      return;
    }
    // The redirect hook opens the console once the platform session exists.
  }

  async function copyKey() {
    if (!step.secret) return;
    try {
      await navigator.clipboard.writeText(step.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <AuthCard
      title={enrolling ? 'Set up two-step verification' : 'Enter your verification code'}
      description={
        enrolling
          ? 'Two-step verification is required for platform accounts. Add Vistar to an authenticator app, then enter the code it shows.'
          : `Open your authenticator app and enter the 6-digit code for ${step.email}.`
      }
    >
      <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {failure && (
          <FormAlert>
            {failure.message}
            {failure.code === 'CHALLENGE_EXPIRED' && (
              <>
                {' '}
                <button type="button" onClick={onRestart} className="font-medium underline underline-offset-4">
                  Start again
                </button>
              </>
            )}
          </FormAlert>
        )}
        {enrolling && step.challenge.otpauthUrl && <EnrolmentQr url={step.challenge.otpauthUrl} />}
        {enrolling && step.secret && (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-fg-secondary">
              <ShieldCheck aria-hidden className="size-4 text-accent-text" />
              Authenticator key (time-based)
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 font-mono text-sm break-all text-fg tabular" aria-label="Authenticator key">
                {groupKey(step.secret)}
              </code>
              <Button size="sm" onClick={copyKey} aria-label={copied ? 'Key copied' : 'Copy key'}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            {step.challenge.otpauthUrl && (
              <details className="text-xs text-muted">
                <summary className="focus-ring cursor-pointer rounded-xs text-fg-secondary">Setup link for apps that accept otpauth URLs</summary>
                <p className="mt-1 font-mono break-all select-all">{step.challenge.otpauthUrl}</p>
              </details>
            )}
          </div>
        )}
        <FormField label="6-digit code" error={error ?? undefined} required>
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            pattern="\d{6}"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="h-11 text-center font-mono text-lg tracking-[0.5em] tabular"
            placeholder="000000"
          />
        </FormField>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting}>
          {enrolling ? 'Verify and finish setup' : 'Verify and sign in'}
        </Button>
        <Button variant="link" className="self-center text-sm" onClick={onRestart}>
          Use a different account
        </Button>
      </form>
    </AuthCard>
  );
}
