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
import { brandName } from '@/lib/branding/workspace-branding';
import { useMe } from '@/lib/session/session';
import { BrandMark } from './brand-mark';
import { ImpersonationBanner } from './impersonation-banner';
import { NavIcon } from './nav-icon';
import { employeeBottomNav, isActivePath } from './nav-utils';
import { PageTransitionMain } from './page-transition';
import { GlassSheen, SpaceBackdrop } from './space-backdrop';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

/** Pages reached from "More" (incl. pack pages at /me/x/...) keep the More tab active. */
const MORE_PATHS = ['/me/more', '/me/x', ...NAV_EMPLOYEE_MORE.map((i) => i.href)];

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
  const [status] = useMyStatus();
  const isManager = me.role.kind === 'manager';

  return (
    <div className="relative isolate flex h-dvh flex-col overflow-hidden">
      <SpaceBackdrop />
      <ImpersonationBanner />
      <div className="flex min-h-0 flex-1">
        <aside
          data-slot="sidebar"
          className="relative isolate hidden w-[248px] shrink-0 flex-col border-r border-border bg-side lg:flex"
        >
          <GlassSheen />
          <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-4">
            <BrandMark />
            <span className="min-w-0">
              <span className="block truncate text-base font-bold tracking-tight text-ink">{brandName(me.workspace)}</span>
              <span className="block truncate text-2xs font-semibold text-faint">My workspace</span>
            </span>
          </div>
          <nav aria-label="Main" className="flex-1 overflow-y-auto p-3">
            <ul className="flex flex-col gap-1">
              {items.map((item) => {
                const active = isActive(item.id, item.href);
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      data-slot="nav-item"
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'focus-ring flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors duration-200',
                        'text-dim hover:bg-well hover:text-ink',
                        active && 'bg-well text-ink shadow-[inset_3px_0_0_var(--accent-text),inset_0_0_0_1px_var(--hair)]',
                      )}
                    >
                      <NavIcon name={item.icon} className={cn('size-5', active ? 'text-accent-text' : 'text-faint')} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {isManager && (
            <div className="border-t border-border p-3">
              <Button asChild variant="ghost" className="h-10 w-full justify-start font-semibold text-faint hover:text-ink">
                <Link href="/app">
                  <Building2 aria-hidden />
                  Company panel
                </Link>
              </Button>
            </div>
          )}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header
            data-slot="topbar"
            className="relative isolate flex h-16 shrink-0 items-center gap-2 border-b border-border bg-bg px-4 pt-[env(safe-area-inset-top)] lg:px-6"
          >
            <GlassSheen />
            <Link href="/me" aria-label="Home" className="focus-ring rounded-md lg:hidden">
              <BrandMark />
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

          <PageTransitionMain className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
            {/* Full width on every screen (D-066): pages lay out more columns instead of leaving side bands. */}
            <div className="w-full px-4 py-4 sm:px-6 lg:px-8 lg:py-6">{children}</div>
          </PageTransitionMain>

          <nav aria-label="Main" className="relative isolate shrink-0 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
            <GlassSheen />
            <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
              {items.map((item) => {
                const active = isActive(item.id, item.href);
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'focus-ring relative flex h-14 min-h-11 flex-col items-center justify-center gap-0.5 text-2xs font-semibold text-faint outline-offset-[-2px] transition-colors',
                        'hover:text-ink aria-[current=page]:text-ink',
                      )}
                    >
                      {active && <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" />}
                      <NavIcon name={item.icon} className={cn('size-5', active ? 'text-accent-text' : 'text-faint')} />
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
