'use client';

import { NAV_COMPANY, type MeResponse } from '@vistar/shared';
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { TooltipProvider } from '@/components/common/tooltip';
import { Tooltip } from '@/components/common/tooltip';
import { useMediaQuery } from '@/components/common/use-media-query';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useNavExtensions } from '@/lib/packs';
import { useMe } from '@/lib/session/session';
import { CommandMenu, SearchTrigger } from './command-menu';
import { ImpersonationBanner } from './impersonation-banner';
import { LogoMark } from './logo';
import { NavDrawer } from './nav-drawer';
import { companyNav } from './nav-utils';
import { NotificationsMenu } from './notifications-menu';
import { useShellStore } from './shell-store';
import { SidebarNav } from './sidebar-nav';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

const PLAN_LABEL: Record<MeResponse['workspace']['plan'], string> = { free: 'Free', starter: 'Starter', growth: 'Growth', enterprise: 'Enterprise' };

function WorkspaceHeader({ me, expanded }: { me: MeResponse; expanded: boolean }) {
  return (
    <Link href="/app" className={cn('focus-ring flex min-w-0 items-center gap-2 rounded-md', !expanded && 'mx-auto')} aria-label={`${me.workspace.name} dashboard`}>
      <LogoMark />
      {expanded && (
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-fg">{me.workspace.name}</span>
          <span className="block text-2xs text-muted">{PLAN_LABEL[me.workspace.plan]} plan</span>
        </span>
      )}
    </Link>
  );
}

/**
 * Company panel shell: grouped sidebar (expanded / icon rail, collapse persisted on this device), icon
 * rail on tablets, drawer on phones, top bar with search, theme, notifications and the avatar menu.
 * The impersonation banner sits above everything.
 */
export function CompanyShell({ children }: { children: ReactNode }) {
  const me = useMe()!;
  const { company } = useNavExtensions();
  // Compose custom objects, pack pages and configurable labels first, then filter for this user.
  const groups = useMemo(() => companyNav(me, company(NAV_COMPANY)), [me, company]);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const collapsed = useShellStore((s) => s.collapsed);
  const toggleCollapsed = useShellStore((s) => s.toggleCollapsed);
  const mobileNavOpen = useShellStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useShellStore((s) => s.setMobileNavOpen);
  const expanded = isDesktop && !collapsed;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-dvh flex-col overflow-hidden">
        <ImpersonationBanner />
        <div className="flex min-h-0 flex-1">
          <aside
            className={cn(
              'hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 ease-standard md:flex',
              expanded ? 'w-60' : 'w-14',
            )}
          >
            <div className={cn('flex h-14 shrink-0 items-center border-b border-border', expanded ? 'px-3' : 'px-2')}>
              <WorkspaceHeader me={me} expanded={expanded} />
            </div>
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-3">
              <SidebarNav groups={groups} expanded={expanded} label="Main" />
            </div>
            <div className={cn('hidden shrink-0 border-t border-border p-2 lg:flex', !expanded && 'justify-center')}>
              {expanded ? (
                <Button variant="ghost" size="sm" onClick={toggleCollapsed} aria-expanded className="w-full justify-start">
                  <PanelLeftClose aria-hidden />
                  Collapse sidebar
                </Button>
              ) : (
                <Tooltip content="Expand sidebar">
                  <Button variant="ghost" size="icon" onClick={toggleCollapsed} aria-expanded={false} aria-label="Expand sidebar">
                    <PanelLeftOpen aria-hidden />
                  </Button>
                </Tooltip>
              )}
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 sm:px-4">
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>
                <Menu aria-hidden />
              </Button>
              <Link href="/app" aria-label={`${me.workspace.name} dashboard`} className="focus-ring rounded-md md:hidden">
                <LogoMark />
              </Link>
              <div className="flex min-w-0 flex-1 items-center">
                <SearchTrigger />
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <ThemeToggle />
                <NotificationsMenu base="/app" />
                <UserMenu panel="company" triggerClassName="ml-1" />
              </div>
            </header>
            <main id="main" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-6">{children}</div>
            </main>
          </div>
        </div>

        <NavDrawer open={mobileNavOpen} onOpenChange={setMobileNavOpen} title={`${me.workspace.name} navigation`} header={<WorkspaceHeader me={me} expanded />}>
          <SidebarNav groups={groups} expanded label="Main" onNavigate={() => setMobileNavOpen(false)} />
        </NavDrawer>
        <CommandMenu groups={groups} />
      </div>
    </TooltipProvider>
  );
}
