'use client';

import type { AttentionItem, TeamFloorMode } from '@vistar/shared';
import { Building2, Command as CommandIcon, Expand, Shrink, WifiOff } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useLeadDrawer } from '@/components/lead-detail/use-lead-drawer';
import { Sheet, SheetContent, SheetTitle } from '@/components/leads/primitives/sheet';
import { Tooltip } from '@/components/common/tooltip';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { isMockData } from '@/lib/api/data-source';
import { cn } from '@/lib/cn';
import { filtersToSearchParams, searchParamsToFilters, useLeadsViewState } from '@/lib/leads/state';
import { registerScreenSource, screenChanged, screenForFloorModule } from '@/lib/realtime/logic';
import { useCan } from '@/lib/session/session';
import { TeamFloor } from '../index';
import { readDevParams, useIsClient, useMediaQuery } from '../state/env';
import { useFloorFeed } from '../state/use-floor-feed';
import { CommandBar, ShortcutsDialog } from './command-bar';
import { linkTarget, type LinkTarget, type PanelKind } from './links';
import type { LiveFloorEmployee } from './live-presence';
import { ModuleDock } from './module-dock';
import { useModules } from './modules';
import { PersonPanel } from './person-panel';
import { ResizeHandle } from './resize-handle';
import { StatusNote } from './status-note';
import { FLOOR_MIN_WIDTH, PANEL_MIN_WIDTH, useWorkspaceUi, type DockLayout, type ModuleId } from './store';
import { isTypingTarget, modalOpen, useFullscreen } from './use-fullscreen';

const LeadDrawer = dynamic(() => import('@/components/lead-detail/lead-drawer').then((m) => m.LeadDrawer), { ssr: false });
// FLOOR's company floor request (reference photos, status timeline); loaded only when shown.
const FloorRequestPanel = dynamic(() => import('../request').then((m) => m.FloorRequestPanel), {
  ssr: false,
  loading: () => <Skeleton className="h-40 w-full rounded-lg" aria-label="Loading your office floor" />,
});

/** Width the Team Floor keeps for its own side column (people panel or Needs you) on wide screens. */
const FLOOR_ASIDE = 352;
/** Docked panels only on very wide areas by default; otherwise they float over the floor. */
const AUTO_DOCK_FROM = 1700;

export interface FloorWorkspaceProps {
  panel: PanelKind;
  title: string;
  description: string;
  mode: TeamFloorMode;
  /** Employee floor: status only, no team actions. */
  readOnly?: boolean;
  /** Manager scope (dataScope team); null = everyone the API returns. */
  userIds?: string[] | null;
}

/**
 * LIVE TEAM FLOOR WORKSPACE (SPEC 29.11): operate everything from the floor in one tab.
 * - The floor (3D or flat) keeps running while panels are open; it shares one feed with the person panel.
 * - Clicking a person opens the person panel (status, zone, activity, numbers, actions).
 * - Module panels (the existing Leads, Inbox, Tasks, Calls, Dashboard pages) open as tabs in a panel
 *   that floats over the floor or docks beside it, resizable; a sheet on small screens. Links inside stay
 *   on the floor (module links open panels, lead links open the lead drawer).
 * - Command bar (/), full screen (F, Esc), digits 1 to 5 for the panels, ? for the list.
 */
export function FloorWorkspace(props: FloorWorkspaceProps) {
  const isClient = useIsClient();
  if (!isClient) return <WorkspaceSkeleton />;
  return <FloorWorkspaceClient {...props} />;
}

function WorkspaceSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Team floor loading">
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-[74px] w-full rounded-lg" />
      <Skeleton className="h-[calc(100dvh-16rem)] min-h-[420px] w-full rounded-lg" />
    </div>
  );
}

function FloorWorkspaceClient({ panel, title, description, mode, readOnly = false, userIds = null }: FloorWorkspaceProps) {
  const uid = useId().replace(/:/g, '');
  const [dev] = useState(readDevParams);
  const feed = useFloorFeed({ userIds, stress: dev.stress, template: dev.template });
  const fs = useFullscreen();
  const modules = useModules(panel);
  const ui = useWorkspaceUi();
  const drawer = useLeadDrawer();
  const desktop = useMediaQuery('(min-width: 1024px)', true);
  const canManageFloor = useCan('settings.manage');
  // Company panel: everyone who sees the floor sees the office request status; admins may submit.
  const canFloorRequest = panel === 'company';

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [tab, setTab] = useState<'floor' | 'office'>('floor');
  const [officeOpen, setOfficeOpen] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  const [areaWidth, setAreaWidth] = useState(0);
  const areaRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const launchers = useRef(new Map<ModuleId, HTMLButtonElement>());

  // In full screen the shell (sidebar, top bar, bottom nav) is covered: take it out of the tab order and
  // the accessibility tree so keyboard and screen reader users stay on the floor. Undone on exit.
  useEffect(() => {
    if (!fs.active) return;
    const main = rootRef.current?.closest('main');
    const column = main?.parentElement;
    const chrome = [
      ...Array.from(column?.children ?? []).filter((el) => el !== main && (el.tagName === 'HEADER' || el.tagName === 'NAV')),
      ...Array.from(column?.parentElement?.children ?? []).filter((el) => el.tagName === 'ASIDE'),
    ] as HTMLElement[];
    const before = chrome.map((el) => el.inert);
    for (const el of chrome) el.inert = true;
    return () => chrome.forEach((el, i) => (el.inert = before[i] ?? false));
  }, [fs.active]);

  // Width of the floor area (decides dock vs float and the panel's width limits).
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setAreaWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab]);

  const tabs = ui.tabs.filter((t) => modules.some((m) => m.id === t));
  const active = ui.active && tabs.includes(ui.active) ? ui.active : (tabs[0] ?? null);
  const dockMax = Math.max(0, areaWidth - FLOOR_MIN_WIDTH - (desktop ? FLOOR_ASIDE : 0));
  const floatMax = Math.max(0, areaWidth - (desktop ? FLOOR_ASIDE : 0) - 24);
  const canDock = dockMax >= PANEL_MIN_WIDTH;
  const layout: DockLayout | 'sheet' = !desktop ? 'sheet' : (ui.layout ?? (areaWidth >= AUTO_DOCK_FROM ? 'dock' : 'float')) === 'dock' && canDock ? 'dock' : 'float';
  const max = layout === 'dock' ? dockMax : floatMax;
  const defaultWidth = layout === 'dock' ? Math.min(640, dockMax) : Math.min(720, Math.round(areaWidth * 0.55), floatMax);
  const width = Math.max(PANEL_MIN_WIDTH, Math.min(max, layout === 'sheet' ? 0 : (ui.widths[layout] ?? defaultWidth)));
  const dockOpen = !!active && areaWidth > 0;

  // Heartbeat screen (D-062): while a panel is open over the floor, report that module's screen
  // (Leads, Inbox, ...) instead of "team floor" (lib/realtime/logic screen sources).
  const shownModule = useRef<ModuleId | null>(null);
  useEffect(
    () => registerScreenSource(window.location.pathname, () => (shownModule.current ? screenForFloorModule(shownModule.current, window.location.search) : null)),
    [],
  );
  useEffect(() => {
    shownModule.current = dockOpen ? active : null;
    screenChanged();
  }, [active, dockOpen]);

  const openModule = useCallback(
    (m: ModuleId) => {
      setTab('floor');
      ui.open(m);
      setFocusKey((k) => k + 1);
    },
    [ui],
  );
  const closeModule = useCallback(
    (m: ModuleId) => {
      const last = useWorkspaceUi.getState().tabs.length <= 1;
      ui.close(m);
      if (last) requestAnimationFrame(() => launchers.current.get(m)?.focus({ preventScroll: true }));
    },
    [ui],
  );

  /** Follow a link on the floor: module links open panels, lead links open the drawer. */
  const follow = useCallback(
    (t: LinkTarget) => {
      if (t.module === 'leads') {
        const filters = searchParamsToFilters(t.search);
        const url = new URL(window.location.href);
        const next = filtersToSearchParams(filters, url.searchParams);
        const view = t.search.get('view');
        if (view) next.set('view', view);
        const qs = next.toString();
        window.history.replaceState(null, '', qs ? `${url.pathname}?${qs}` : url.pathname);
        useLeadsViewState.getState().replaceFilters(filters);
        ui.remountLeads();
      }
      if (t.module === 'inbox') {
        const c = t.search.get('c');
        if (c) {
          const url = new URL(window.location.href);
          url.searchParams.set('c', c);
          window.history.replaceState(null, '', `${url.pathname}?${url.searchParams}`);
        }
      }
      if (t.module) openModule(t.module);
      if (t.leadId) drawer.open(t.leadId);
    },
    [drawer, openModule, ui],
  );

  const onClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null;
    // Dialogs and the lead drawer keep their links (explicit "open full page" and the like); the panel
    // sheet on small screens is a dialog too, but its links stay on the floor.
    const inDialog = !!a?.closest('[role="dialog"]') && !a?.closest('[data-floor-dock]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.closest('[data-floor-leave]') || inDialog) return;
    const t = linkTarget(a.getAttribute('href') ?? '', panel, window.location.origin);
    if (!t || (t.module && !modules.some((m) => m.id === t.module))) return;
    e.preventDefault();
    e.stopPropagation();
    follow(t);
  };

  const showPerson = useCallback((id: string) => {
    setTab('floor');
    setSelectedId(id);
    setFocusRequest({ id, nonce: Date.now() });
  }, []);

  const resolve = useCallback(
    (item: AttentionItem) => {
      feed.dispatch({ kind: 'resolve', id: item.id });
      toast.success(`Resolved: ${item.title}`, { action: { label: 'Undo', onClick: () => feed.dispatch({ kind: 'restore', item }) } });
    },
    [feed],
  );

  // Keyboard: F full screen, / commands, ? shortcuts, 1..5 panels, Esc leaves the immersive fallback.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (fs.active && !fs.native && !modalOpen() && !isTypingTarget(e.target)) fs.exit();
        return;
      }
      if (isTypingTarget(e.target) || modalOpen()) return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        fs.toggle();
      } else if (e.key === '/') {
        e.preventDefault();
        setCommandOpen(true);
      } else if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
      } else {
        const m = modules.find((x) => x.key === e.key);
        if (m) {
          e.preventDefault();
          openModule(m.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fs, modules, openModule]);

  const showLeadsOf = useCallback((userId: string) => follow({ module: 'leads', leadId: null, search: new URLSearchParams({ ownerId: userId }) }), [follow]);

  const people = useMemo(() => (feed.state?.employees ?? []) as LiveFloorEmployee[], [feed.state]);
  const attentionOf = useCallback((id: string) => feed.state?.attention.filter((a) => a.userId === id) ?? [], [feed.state]);
  const notCustom = !!feed.floorRef && feed.floorRef.source !== 'custom';
  const leadsPanelShown = dockOpen && active === 'leads';

  const dock = active ? (
    <ModuleDock
      id={`${uid}-dock`}
      modules={modules}
      tabs={tabs}
      active={active}
      layout={layout === 'dock' ? 'dock' : 'float'}
      onActivate={(m) => ui.open(m)}
      onClose={closeModule}
      onLayout={(l) => ui.setLayout(l)}
      leadsKey={ui.leadsKey}
      autoFocusKey={focusKey}
      showLayoutToggle={layout !== 'sheet' && canDock}
      className={layout === 'sheet' ? 'h-full rounded-none border-0 shadow-none' : 'h-full flex-1'}
    />
  ) : null;

  const handle = (
    <ResizeHandle
      value={width}
      min={PANEL_MIN_WIDTH}
      max={Math.max(PANEL_MIN_WIDTH, max)}
      grow="right"
      controls={`${uid}-dock`}
      onChange={(w) => layout !== 'sheet' && ui.setWidth(layout, w)}
      onReset={() => layout !== 'sheet' && ui.setWidth(layout, defaultWidth)}
      label="Resize the panel"
    />
  );

  return (
    <div
      ref={rootRef}
      data-floor-workspace={panel}
      data-fullscreen={fs.active ? (fs.native ? 'native' : 'immersive') : undefined}
      onClickCapture={onClickCapture}
      className={cn(
        'flex min-w-0 flex-col gap-3',
        fs.active
          ? 'fixed inset-0 z-30 overflow-y-auto bg-bg p-2 sm:p-3 lg:overflow-hidden'
          : 'lg:h-[calc(100dvh-6.5rem-var(--impersonation-banner-h,0px))] lg:min-h-[620px]',
      )}
    >
      <header data-slot="page-header" className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 data-slot="page-title" className={cn('font-semibold tracking-tight text-fg', fs.active ? 'text-base' : 'text-xl')}>
              {title}
            </h1>
            {!feed.connected && feed.status === 'ready' && (
              <Chip tone="amber" dot>
                <WifiOff aria-hidden className="size-3" />
                <span role="status">Reconnecting, the floor may be behind</span>
              </Chip>
            )}
          </div>
          {!fs.active && <p className="mt-0.5 text-sm text-muted-strong">{description}</p>}
        </div>
        <div role="group" aria-label="Floor workspace" className="flex flex-wrap items-center gap-1.5">
          {canFloorRequest && (
            <div role="tablist" aria-label="Team floor views" className="mr-1 inline-flex rounded-md border border-border bg-surface p-0.5 shadow-card">
              {(
                [
                  ['floor', 'Live floor'],
                  ['office', 'Your office'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  aria-controls={`${uid}-${value}`}
                  id={`${uid}-tab-${value}`}
                  onClick={() => setTab(value)}
                  className={cn(
                    'focus-ring inline-flex h-7 items-center rounded-sm px-2.5 text-xs font-medium transition-colors duration-150 ease-standard',
                    tab === value ? 'bg-accent-soft text-accent-soft-fg' : 'text-fg-secondary hover:bg-surface-2 hover:text-fg',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {modules.map((m) => {
            const Icon = m.icon;
            const shown = active === m.id && dockOpen;
            return (
              <Tooltip key={m.id} content={`${m.label} panel (${m.key})`} side="bottom">
                <Button
                  ref={(el: HTMLButtonElement | null) => {
                    if (el) launchers.current.set(m.id, el);
                    else launchers.current.delete(m.id);
                  }}
                  size="sm"
                  variant={shown ? 'secondary' : 'ghost'}
                  aria-pressed={shown}
                  aria-keyshortcuts={m.key}
                  onClick={() => (shown ? closeModule(m.id) : openModule(m.id))}
                >
                  <Icon aria-hidden />
                  <span className="hidden 2xl:inline">{m.label}</span>
                  <span className="sr-only 2xl:hidden">{m.label}</span>
                </Button>
              </Tooltip>
            );
          })}
          <Tooltip content="Floor commands (/)" side="bottom">
            <Button size="sm" variant="ghost" aria-keyshortcuts="/" onClick={() => setCommandOpen(true)}>
              <CommandIcon aria-hidden />
              <span className="hidden xl:inline">Commands</span>
              <span className="sr-only xl:hidden">Floor commands</span>
            </Button>
          </Tooltip>
          <StatusNote open={noteOpen} onOpenChange={setNoteOpen} compact={fs.active} />
          <Tooltip content={fs.active ? 'Exit full screen (F or Esc)' : 'Full screen (F)'} side="bottom">
            <Button size="sm" variant={fs.active ? 'secondary' : 'ghost'} aria-pressed={fs.active} aria-keyshortcuts="F" onClick={fs.toggle}>
              {fs.active ? <Shrink aria-hidden /> : <Expand aria-hidden />}
              <span className="hidden xl:inline">{fs.active ? 'Exit full screen' : 'Full screen'}</span>
              <span className="sr-only xl:hidden">{fs.active ? 'Exit full screen' : 'Full screen'}</span>
            </Button>
          </Tooltip>
        </div>
      </header>

      {tab === 'office' && canFloorRequest ? (
        <div role="tabpanel" id={`${uid}-office`} aria-labelledby={`${uid}-tab-office`} className="min-h-0 flex-1 overflow-y-auto">
          <FloorRequestPanel canManage={canManageFloor} />
        </div>
      ) : (
        <div role={canFloorRequest ? 'tabpanel' : undefined} id={`${uid}-floor`} aria-labelledby={canFloorRequest ? `${uid}-tab-floor` : undefined} className="flex min-h-0 flex-1 flex-col gap-3">
          {canFloorRequest && notCustom && (
            <div className="rounded-lg border border-border bg-surface px-3 py-2 shadow-card">
              <div className="flex flex-wrap items-center gap-2">
                <Building2 aria-hidden className="size-4 text-muted" />
                <p className="min-w-0 flex-1 text-sm text-fg-secondary">You are seeing the default office. Your own floor replaces it once Vistar publishes it.</p>
                <Button size="sm" variant="ghost" aria-expanded={officeOpen} aria-controls={`${uid}-office-strip`} onClick={() => setOfficeOpen((o) => !o)}>
                  {officeOpen ? 'Hide' : 'Your office floor'}
                </Button>
              </div>
              {officeOpen && (
                <div id={`${uid}-office-strip`} className="mt-2">
                  <FloorRequestPanel canManage={canManageFloor} />
                </div>
              )}
            </div>
          )}
          <div ref={areaRef} className="relative flex min-h-0 min-w-0 flex-1">
            {dockOpen && layout === 'dock' && (
              <>
                <div className="flex min-h-0 shrink-0" style={{ width }}>
                  {dock}
                </div>
                {handle}
              </>
            )}
            <div className="min-h-0 min-w-0 flex-1">
              <TeamFloor
                fill
                mode={mode}
                readOnly={readOnly}
                userIds={userIds}
                feed={feed}
                selectedId={selectedId}
                onPersonSelect={setSelectedId}
                focusRequest={focusRequest}
                renderPersonPanel={({ employee, onClose, embedded }) => (
                  <PersonPanel
                    employee={employee as LiveFloorEmployee}
                    live={feed.live.people[employee.id]}
                    attention={attentionOf(employee.id)}
                    readOnly={readOnly}
                    onClose={onClose}
                    embedded={embedded}
                    onResolve={resolve}
                    onOpenLead={(id) => drawer.open(id)}
                    onShowLeads={showLeadsOf}
                    onOpenModule={openModule}
                    onAssigned={(lead, from, to) => {
                      // API mode: the socket's lead.assigned animates it on every floor.
                      if (isMockData()) feed.dispatch({ kind: 'reassign', leadId: lead.id, leadName: lead.name, fromUserId: from, toUserId: to, now: Date.now() });
                    }}
                  />
                )}
              />
            </div>
            {dockOpen && layout === 'float' && (
              <div className="absolute inset-y-0 left-0 z-20 flex min-h-0" style={{ width: width + 12 }}>
                <div className="flex min-h-0 min-w-0 flex-1">{dock}</div>
                {handle}
              </div>
            )}
          </div>
        </div>
      )}

      {dockOpen && layout === 'sheet' && (
        <Sheet open onOpenChange={(o) => !o && ui.closeAll()}>
          <SheetContent size="xl" aria-describedby={undefined}>
            <SheetTitle className="sr-only">Panels</SheetTitle>
            {dock}
          </SheetContent>
        </Sheet>
      )}

      {!leadsPanelShown && drawer.leadId && <LeadDrawer panel={panel} />}

      <CommandBar
        open={commandOpen}
        onOpenChange={setCommandOpen}
        people={people}
        live={feed.live}
        modules={modules}
        openModules={tabs}
        fullscreen={fs.active}
        paused={feed.paused}
        onPerson={showPerson}
        onModule={openModule}
        onCloseModules={() => ui.closeAll()}
        onFullscreen={fs.toggle}
        onPause={feed.setPaused}
        onHelp={() => setHelpOpen(true)}
        onStatusNote={() => setNoteOpen(true)}
      />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
