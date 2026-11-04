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
    <section aria-labelledby="demo-accounts" className="card rounded-[18px] border border-hair bg-gradient-to-b from-[var(--card-top,#191c20)] to-[var(--card,#121517)] p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="demo-accounts" className="text-sm font-bold text-ink">
          Demo accounts
        </h2>
        <span className="text-2xs font-semibold text-faint uppercase tracking-wider">Dev</span>
      </div>
      <p className="mt-1 text-xs text-faint">
        Password for all: <code className="rounded-[4px] bg-well-2 px-1.5 py-0.5 font-mono text-ink text-2xs">{DEMO_PASSWORD}</code>
      </p>
      <ul className="mt-3 flex flex-col divide-y divide-hair">
        {DEMO_ACCOUNTS.map((a) => (
          <li key={a.email} className="flex items-center gap-3 py-2.5">
            <Avatar name={a.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{a.name}</span>
              <span className="block truncate text-xs text-faint">
                {ROLE_KIND_LABELS[a.persona as RoleKind]} · {a.email}
              </span>
            </span>
            <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onPick(a.email, DEMO_PASSWORD)} aria-label={`Sign in as ${a.name}, ${ROLE_KIND_LABELS[a.persona as RoleKind]}`}>
              Sign in
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-faint">
        Platform team:{' '}
        <Link href="/super-admin/login" className="focus-ring rounded-[4px] text-accent-text font-semibold underline-offset-4 hover:underline">
          Super Admin sign-in
        </Link>
      </p>
    </section>
  );
}
