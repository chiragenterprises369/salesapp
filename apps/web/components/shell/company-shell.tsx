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
import { brandName } from '@/lib/branding/workspace-branding';
import { BrandMark } from './brand-mark';
import { ShellBreadcrumbs } from './breadcrumbs';
import { CommandMenu, SearchTrigger } from './command-menu';
import { ImpersonationBanner } from './impersonation-banner';
import { NavDrawer } from './nav-drawer';
import { companyNav } from './nav-utils';
import { NotificationsMenu } from './notifications-menu';
import { PageTransitionMain } from './page-transition';
import { useShellStore } from './shell-store';
import { SidebarNav } from './sidebar-nav';
import { GlassSheen, SpaceBackdrop } from './space-backdrop';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

const PLAN_LABEL: Record<MeResponse['workspace']['plan'], string> = { free: 'Free', starter: 'Starter', growth: 'Growth', enterprise: 'Enterprise' };

function WorkspaceHeader({ me, expanded }: { me: MeResponse; expanded: boolean }) {
  const name = brandName(me.workspace);
  // Expanded: the visible name is the link text (WCAG 2.5.3 label in name). Icon rail: aria-label.
  return (
    <Link href="/app" className={cn('focus-ring flex min-w-0 items-center gap-2 rounded-md', !expanded && 'mx-auto')} aria-label={expanded ? undefined : `${name} dashboard`}>
      <BrandMark className={expanded ? undefined : 'max-w-8'} />
      {expanded && (
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-fg">{name}</span>
          <span className="block text-2xs text-muted">{PLAN_LABEL[me.workspace.plan]} plan</span>
          <span className="sr-only">, dashboard</span>
        </span>
      )}
    </Link>
  );
}

const COMPANY_ROOT = { label: 'Company', href: '/app' };

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
      <div className="relative isolate flex h-dvh flex-col overflow-hidden">
        <SpaceBackdrop />
        <ImpersonationBanner />
        <div className="flex min-h-0 flex-1">
          <aside
            data-slot="sidebar"
            className={cn(
              'relative isolate hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 ease-standard md:flex',
              'spatial:my-2 spatial:ml-2 spatial:rounded-lg spatial:border spatial:shadow-depth-2 spatial:glass-chrome',
              expanded ? 'w-60' : 'w-14',
            )}
          >
            <GlassSheen />
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
            <header
              data-slot="topbar"
              className="relative isolate flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 sm:px-4 spatial:mx-2 spatial:mt-2 spatial:rounded-lg spatial:border spatial:shadow-depth-2 spatial:glass-chrome premium:lg:gap-4"
            >
              <GlassSheen />
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>
                <Menu aria-hidden />
              </Button>
              <Link href="/app" aria-label={`${brandName(me.workspace)} dashboard`} className="focus-ring rounded-md md:hidden">
                <BrandMark />
              </Link>
              <ShellBreadcrumbs groups={groups} root={COMPANY_ROOT} className="hidden flex-1 premium:lg:flex" />
              <div className="flex min-w-0 flex-1 items-center premium:lg:w-[min(30rem,34vw)] premium:lg:flex-none">
                <SearchTrigger />
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <ThemeToggle />
                <NotificationsMenu base="/app" />
                <UserMenu panel="company" triggerClassName="ml-1" />
              </div>
            </header>
            <PageTransitionMain className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-6">{children}</div>
            </PageTransitionMain>
          </div>
        </div>

        <NavDrawer open={mobileNavOpen} onOpenChange={setMobileNavOpen} title={`${brandName(me.workspace)} navigation`} header={<WorkspaceHeader me={me} expanded />}>
          <SidebarNav groups={groups} expanded label="Main" onNavigate={() => setMobileNavOpen(false)} />
        </NavDrawer>
        <CommandMenu groups={groups} />
      </div>
    </TooltipProvider>
  );
}
