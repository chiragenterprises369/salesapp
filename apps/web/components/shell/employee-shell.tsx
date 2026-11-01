'use client';

import { EMPLOYEE_STATUS_LABEL, NAV_EMPLOYEE_BOTTOM, NAV_EMPLOYEE_MORE } from '@vistar/shared';
import { Building2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import { useMyStatus } from '@/components/employee/status-store';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/ui/chip';
import { cn } from '@/lib/cn';
import { useNavExtensions } from '@/lib/packs';
import { useMe } from '@/lib/session/session';
import { ImpersonationBanner } from './impersonation-banner';
import { LogoMark } from './logo';
import { NavIcon } from './nav-icon';
import { employeeBottomNav, isActivePath } from './nav-utils';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

/** Pages reached from "More" (incl. pack pages at /me/x/...) keep the More tab active. */
const MORE_PATHS = ['/me/more', '/me/x', ...NAV_EMPLOYEE_MORE.map((i) => i.href)];
const WIDE_PATHS = ['/me/leads', '/me/team-floor'];

function useActive() {
  const pathname = usePathname();
  return (id: string, href: string) => (id === 'more' ? MORE_PATHS.some((p) => isActivePath(pathname, p)) : isActivePath(pathname, href));
}

/**
 * Employee panel shell, mobile first: compact header (status pill + theme), bottom navigation with
 * 44px+ targets and safe-area padding; from 1024px the same items move to a left rail.
 * Only the main area scrolls, so the header and bottom nav stay put and nothing scrolls sideways.
 */
export function EmployeeShell({ children }: { children: ReactNode }) {
  const me = useMe()!;
  const { employeeBottom } = useNavExtensions();
  const items = useMemo(() => employeeBottomNav(me, employeeBottom(NAV_EMPLOYEE_BOTTOM)), [me, employeeBottom]);
  const isActive = useActive();
  const pathname = usePathname();
  const [status] = useMyStatus();
  const isManager = me.role.kind === 'manager';
  // Board columns and the floor need the full width; reading pages stay at a comfortable measure.
  const wide = WIDE_PATHS.some((p) => isActivePath(pathname, p));

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <ImpersonationBanner />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface lg:flex">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
            <LogoMark />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{me.workspace.name}</span>
              <span className="block truncate text-2xs text-muted">My workspace</span>
            </span>
          </div>
          <nav aria-label="Main" className="flex-1 overflow-y-auto p-2">
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const active = isActive(item.id, item.href);
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className="focus-ring flex h-10 items-center gap-3 rounded-md px-3 text-sm text-fg-secondary transition-colors hover:bg-surface-3 hover:text-fg aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium aria-[current=page]:text-accent-soft-fg"
                    >
                      <NavIcon name={item.icon} className="size-5" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {isManager && (
            <div className="border-t border-border p-2">
              <Button asChild variant="ghost" className="h-10 w-full justify-start">
                <Link href="/app">
                  <Building2 aria-hidden />
                  Company panel
                </Link>
              </Button>
            </div>
          )}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-1 border-b border-border bg-surface px-3 pt-[env(safe-area-inset-top)] lg:px-6">
            <Link href="/me" aria-label="Home" className="focus-ring rounded-md lg:hidden">
              <LogoMark />
            </Link>
            <span className="ml-1.5 min-w-0 flex-1 truncate text-sm font-semibold lg:ml-0">
              <span className="lg:hidden">{me.user.name.split(' ')[0]}</span>
              <span className="hidden lg:inline">Hi, {me.user.name.split(' ')[0]}</span>
            </span>
            <Link
              href="/me/status"
              aria-label={`My status: ${EMPLOYEE_STATUS_LABEL[status]}. Change status`}
              className="focus-ring inline-flex h-11 items-center rounded-full px-1"
            >
              <StatusChip status={status} size="md" aria-hidden />
            </Link>
            <ThemeToggle size="icon-touch" />
            <UserMenu panel="employee" triggerClassName="size-11" />
          </header>

          <main id="main" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
            <div className={cn('mx-auto w-full px-4 py-4 sm:px-6 lg:px-8 lg:py-6', !wide && 'max-w-5xl')}>{children}</div>
          </main>

          <nav aria-label="Main" className="shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
            <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
              {items.map((item) => {
                const active = isActive(item.id, item.href);
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'focus-ring relative flex h-14 min-h-11 flex-col items-center justify-center gap-0.5 text-2xs font-medium text-muted outline-offset-[-2px]',
                        'aria-[current=page]:text-accent-text',
                      )}
                    >
                      {active && <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" />}
                      <NavIcon name={item.icon} className="size-5" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </div>
    </div>
  );
}
