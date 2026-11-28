'use client';

import { initials, ROLE_KIND_LABELS, type RoleKind } from '@vistar/shared';
import { Zap } from 'lucide-react';
import { useState } from 'react';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, DEMO_WORKSPACE_NAME } from '@/lib/auth/demo-accounts';
import { cn } from '@/lib/cn';

/**
 * One-click sign-in as a demo user, one button per role (Shakti Industries from the demo seed).
 * Render it only where DEMO_LOGIN_ENABLED is true (the demo site and development builds), never in production.
 */
export function DemoAccounts({ onPick, busy }: { onPick: (email: string, password: string) => void; busy: boolean }) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <section aria-labelledby="demo-accounts" className="mt-5 rounded-2xl border border-[#E6E1FF] bg-[#F8F7FF] p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="demo-accounts" className="flex items-center gap-1.5 text-[13px] font-bold text-gray-900">
          <Zap aria-hidden className="size-3.5 text-amber-500" />
          Try a demo account
        </h2>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#5945ED]">One click</span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
        Signs you in to {DEMO_WORKSPACE_NAME}, a sample company with dummy data.
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-2">
        {DEMO_ACCOUNTS.map((a) => {
          const role = ROLE_KIND_LABELS[a.persona as RoleKind];
          const pending = busy && picked === a.email;
          return (
            <li key={a.email}>
              <button
                type="button"
                disabled={busy}
                aria-busy={pending || undefined}
                aria-label={`Sign in as ${a.name}, ${role}`}
                onClick={() => {
                  setPicked(a.email);
                  onPick(a.email, DEMO_PASSWORD);
                }}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2.5 rounded-xl border bg-white px-2.5 py-2 text-left shadow-sm transition-all',
                  'hover:border-[#6355ED]/50 hover:bg-[#F4F3FF] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6355ED]/40',
                  'disabled:cursor-not-allowed disabled:active:scale-100',
                  pending ? 'border-[#6355ED]/50 bg-[#F4F3FF]' : 'border-gray-200/90 disabled:opacity-60',
                )}
              >
                <span
                  aria-hidden
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[#EEEBFF] text-[11px] font-bold text-[#5945ED]"
                >
                  {pending ? (
                    <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-[#5945ED]/30 border-t-[#5945ED]" />
                  ) : (
                    initials(a.name)
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-gray-900">{role}</span>
                  <span className="block truncate text-[11px] text-gray-500">{a.name}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
