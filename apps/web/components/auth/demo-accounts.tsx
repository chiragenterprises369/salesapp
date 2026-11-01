'use client';

import { ROLE_KIND_LABELS, type RoleKind } from '@vistar/shared';
import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '@/lib/auth/demo-accounts';

/** Development only: one-click sign-in for each mock role. Not rendered in production builds. */
export function DemoAccounts({ onPick, disabled }: { onPick: (email: string, password: string) => void; disabled?: boolean }) {
  if (process.env.NODE_ENV === 'production') return null;
  return (
    <section aria-labelledby="demo-accounts" className="rounded-lg border border-dashed border-border-strong bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="demo-accounts" className="text-sm font-semibold text-fg">
          Demo accounts
        </h2>
        <span className="text-xs text-muted">Development only</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Password for all: <code className="rounded-xs bg-surface-3 px-1 font-mono text-fg-secondary">{DEMO_PASSWORD}</code>. Any Shakti sales rep email signs in as
        an employee.
      </p>
      <ul className="mt-3 flex flex-col divide-y divide-border">
        {DEMO_ACCOUNTS.map((a) => (
          <li key={a.email} className="flex items-center gap-3 py-2">
            <Avatar name={a.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">{a.name}</span>
              <span className="block truncate text-xs text-muted">
                {ROLE_KIND_LABELS[a.persona as RoleKind]} · {a.email}
              </span>
            </span>
            <Button size="sm" disabled={disabled} onClick={() => onPick(a.email, DEMO_PASSWORD)} aria-label={`Sign in as ${a.name}, ${ROLE_KIND_LABELS[a.persona as RoleKind]}`}>
              Sign in
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">
        Platform team:{' '}
        <Link href="/super-admin/login" className="focus-ring rounded-xs text-accent-text underline-offset-4 hover:underline">
          Super Admin sign-in
        </Link>
      </p>
    </section>
  );
}
