'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { TooltipProvider } from '@/components/common/tooltip';
import { useMediaQuery } from '@/components/common/use-media-query';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session/session';
import { IdleTimeout } from './idle-timeout';
import { LogoMark } from './logo';
import { NavDrawer } from './nav-drawer';
import { superAdminNav } from './nav-utils';
import { useShellStore } from './shell-store';
import { SidebarNav } from './sidebar-nav';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

function ConsoleHeader({ expanded }: { expanded: boolean }) {
  return (
    <Link href="/super-admin" aria-label="Platform overview" className={cn('focus-ring flex min-w-0 items-center gap-2 rounded-md', !expanded && 'mx-auto')}>
      <LogoMark className="size-6" />
      {expanded && (
        <>
          <span className="text-sm font-semibold">Vistar</span>
          <Chip tone="indigo">Platform</Chip>
        </>
      )}
    </Link>
  );
}

/** Super Admin console shell: dense sidebar (NAV_SUPER_ADMIN), slim top bar, idle timeout. */
export function SuperAdminShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const admin = session?.audience === 'platform' ? session.admin : null;
  const groups = useMemo(() => (admin ? superAdminNav(admin) : []), [admin]);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const mobileNavOpen = useShellStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useShellStore((s) => s.setMobileNavOpen);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-dvh overflow-hidden">
        <aside className={cn('hidden shrink-0 flex-col border-r border-border bg-surface md:flex', isDesktop ? 'w-52' : 'w-14')}>
          <div className={cn('flex h-12 shrink-0 items-center border-b border-border', isDesktop ? 'px-3' : 'px-2')}>
            <ConsoleHeader expanded={isDesktop} />
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-2">
            <SidebarNav groups={groups} expanded={isDesktop} density="dense" label="Platform" />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 lg:px-4">
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>
              <Menu aria-hidden />
            </Button>
            <span className="md:hidden">
              <ConsoleHeader expanded />
            </span>
            <span className="flex-1" />
            <ThemeToggle />
            <UserMenu panel="super-admin" />
          </header>
          <main id="main" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            <div className="px-4 py-4 lg:px-6">{children}</div>
          </main>
        </div>
        <NavDrawer open={mobileNavOpen} onOpenChange={setMobileNavOpen} title="Platform navigation" header={<ConsoleHeader expanded />}>
          <SidebarNav groups={groups} expanded density="dense" label="Platform" onNavigate={() => setMobileNavOpen(false)} />
        </NavDrawer>
        <IdleTimeout />
      </div>
    </TooltipProvider>
  );
}
