import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/shell/logo';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { cn } from '@/lib/cn';

/** Page frame for sign-in, sign-up, invite and Super Admin sign-in: logo, theme toggle, centred column. */
export function AuthFrame({ children, badge }: { children: ReactNode; badge?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 sm:px-6">
        <span className="flex items-center gap-2">
          <Link href="/" className="focus-ring rounded-md" aria-label="Vistar home">
            <Logo />
          </Link>
          {badge}
        </span>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 justify-center px-4 pt-4 pb-12 sm:items-center sm:pt-0">
        <div className="flex w-full max-w-sm flex-col gap-4">{children}</div>
      </main>
    </div>
  );
}

/** The single card that holds an auth form. */
export function AuthCard({ title, description, children, className }: { title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-border bg-surface p-6 shadow-card', className)} aria-labelledby="auth-title">
      <h1 id="auth-title" className="text-xl font-semibold tracking-tight text-fg">
        {title}
      </h1>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** Form-level message (wrong password, expired challenge). Announced; paired with field errors, not a toast. */
export function FormAlert({ tone = 'danger', children }: { tone?: 'danger' | 'info'; children: ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'rounded-md border px-3 py-2 text-sm',
        tone === 'danger' ? 'border-status-red-border bg-status-red-bg text-status-red-fg' : 'border-status-blue-border bg-status-blue-bg text-status-blue-fg',
      )}
    >
      {children}
    </div>
  );
}

export function OrDivider() {
  return (
    <div className="my-4 flex items-center gap-3 text-xs text-muted" aria-hidden>
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
