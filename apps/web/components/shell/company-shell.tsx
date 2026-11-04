'use client';

import { NAV_COMPANY, type MeResponse } from '@vistar/shared';
import { Menu, PanelLeftClose, PanelLeftOpen, Zap } from 'lucide-react';
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
import { QuickCreateButton } from './quick-create-button';
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
    <Link href="/app" className={cn('focus-ring flex min-w-0 items-center gap-2.5 rounded-lg transition-transform active:scale-95', !expanded && 'mx-auto')} aria-label={expanded ? undefined : `${name} dashboard`}>
      <BrandMark className={expanded ? undefined : 'max-w-8'} />
      {expanded && (
        <span className="min-w-0">
          <span className="block truncate text-base font-bold tracking-tight text-ink">{name}</span>
          <span className="block text-2xs font-semibold text-faint">{PLAN_LABEL[me.workspace.plan]} plan</span>
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
              'relative isolate hidden shrink-0 flex-col border-r border-border bg-side transition-[width] duration-300 ease-[var(--ease)] md:flex',
              expanded ? 'w-[248px]' : 'w-[80px]',
            )}
          >
            <GlassSheen />
            <div className={cn('flex h-16 shrink-0 items-center border-b border-border', expanded ? 'px-4' : 'px-2')}>
              <WorkspaceHeader me={me} expanded={expanded} />
            </div>
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4">
              <SidebarNav groups={groups} expanded={expanded} label="Main" />
            </div>
            {expanded && (
              <div className="px-3 pb-2 pt-1">
                <div className="card relative rounded-[14px] border border-hair bg-[linear-gradient(180deg,var(--card-top),var(--card))] p-3.5 shadow-card">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="flex size-6 items-center justify-center rounded-md bg-accent-soft text-accent">
                      <Zap className="size-3.5 fill-current" />
                    </span>
                    <span className="text-xs font-bold text-ink">Go Premium</span>
                  </div>
                  <p className="text-2xs text-faint mb-3 leading-relaxed">
                    Forecasts, smart alerts & unlimited pipelines in one plan.
                  </p>
                  <Button variant="primary" size="sm" asChild className="w-full text-xs font-bold h-8">
                    <Link href="/app/billing">Upgrade plan</Link>
                  </Button>
                </div>
              </div>
            )}
            <div className={cn('hidden shrink-0 border-t border-hair p-3 lg:flex', !expanded && 'justify-center')}>
              {expanded ? (
                <Button variant="ghost" size="sm" onClick={toggleCollapsed} aria-expanded className="w-full justify-start text-faint hover:text-ink">
                  <PanelLeftClose aria-hidden />
                  Collapse sidebar
                </Button>
              ) : (
                <Tooltip content="Expand sidebar">
                  <Button variant="ghost" size="icon" onClick={toggleCollapsed} aria-expanded={false} aria-label="Expand sidebar" className="text-faint hover:text-ink">
                    <PanelLeftOpen aria-hidden />
                  </Button>
                </Tooltip>
              )}
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header
              data-slot="topbar"
              className="relative isolate flex h-16 shrink-0 items-center justify-between gap-3 border-b border-hair bg-bg px-4 sm:px-6"
            >
              <GlassSheen />
              <div className="flex items-center gap-3 min-w-0">
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>
                  <Menu aria-hidden />
                </Button>
                <Link href="/app" aria-label={`${brandName(me.workspace)} dashboard`} className="focus-ring rounded-md md:hidden">
                  <BrandMark />
                </Link>
                <div className="w-[min(380px,50vw)] min-w-[200px]">
                  <SearchTrigger />
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <NotificationsMenu base="/app" />
                <ThemeToggle />
                <QuickCreateButton />
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
