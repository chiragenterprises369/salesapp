'use client';

import type { AttentionItem, TeamFloorMode } from '@vistar/shared';
import dynamic from 'next/dynamic';
import { Component, useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useCan, useMe, useSessionActions } from '@/lib/session/session';
import { useDocumentTheme } from '@/lib/use-document-theme';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { employeeDomId, EmployeeList } from './flat/employee-list';
import { FloorPlan } from './flat/floor-plan';
import { LiveAnnouncer } from './flat/live-announcer';
import { EmployeePanel } from './panel/employee-panel';
import { KpiStrip } from './panel/kpi-strip';
import { NeedsYouList } from './panel/needs-you-list';
import { FloorToolbar } from './panel/toolbar';
import { detectGpu, readDevParams, useIsClient, useMediaQuery } from './state/env';
import { firstName } from './state/reducer';
import { attentionByUser, employeeById, locationOf, selectKpis, selectNeedsYou } from './state/selectors';
import type { TemplateId } from './state/template';
import type { FloorViewMode, QualityTier } from './state/types';
import { useFloorFeed } from './state/use-floor-feed';

/**
 * PUBLIC API of features/team-floor (contract; owner frontend-3d replaces the implementation,
 * keeps the export name and props). The three.js bundle must stay lazy (next/dynamic inside).
 * Mounted at /app/team-floor (full) and /me/team-floor (readOnly, flat default) by frontend-app.
 */
export interface TeamFloorProps {
  /** 'auto' = 3D on capable desktops, flat on mobile/low-end/reduced motion. User setting teamFloorMode. */
  mode?: TeamFloorMode;
  /** Employee panel: no reassign/resolve actions. */
  readOnly?: boolean;
  /** Manager scope: only these users (null = whole workspace). */
  userIds?: string[] | null;
  /** Floor template override (dev, screenshots). Default: by head count (<=8 small, <=20 medium, else large). */
  template?: TemplateId;
}

// three, @react-three/fiber and drei live only in this lazily loaded chunk.
const FloorScene = dynamic(() => import('./scene/floor-scene'), {
  ssr: false,
  loading: () => <Skeleton className="absolute inset-0 rounded-none" aria-label="Loading the 3D floor" />,
});

function FloorSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Team floor loading">
      <Skeleton className="h-[74px] w-full rounded-lg" />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-[calc(100dvh-14rem)] min-h-[420px] w-full rounded-lg" />
        <Skeleton className="hidden h-[calc(100dvh-14rem)] min-h-[420px] w-full rounded-lg lg:block" />
      </div>
    </div>
  );
}

/** Falls back to the flat view if the 3D scene throws (driver issues, context creation failures). */
class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onError();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function TeamFloor(props: TeamFloorProps) {
  const isClient = useIsClient();
  if (!isClient) return <FloorSkeleton />;
  return <TeamFloorClient {...props} />;
}

/** Flat-only floor (2D plan + accessible list), e.g. for narrow embeds. */
export function TeamFloorFlat(props: Omit<TeamFloorProps, 'mode'>) {
  const isClient = useIsClient();
  if (!isClient) return <FloorSkeleton />;
  return <TeamFloorClient {...props} lockMode="flat" />;
}

const NEXT_TIER: Record<QualityTier, QualityTier> = { high: 'medium', medium: 'low', low: 'low' };

function TeamFloorClient({ mode: modeProp = 'auto', readOnly: readOnlyProp = false, userIds = null, template: templateProp, lockMode }: TeamFloorProps & { lockMode?: FloorViewMode }) {
  const me = useMe();
  const { updateSettings } = useSessionActions();
  const canRecordings = useCan('calls.recordings');
  const canAssign = useCan('leads.assign');
  const canSeeTeam = useCan('team.read');
  // Employees (no team or assignment rights) always get the read-only floor.
  const readOnly = readOnlyProp || !(canAssign || canSeeTeam);
  const theme = useDocumentTheme();
  const reducedMotion = useReducedMotion();
  const coarse = useMediaQuery('(pointer: coarse)');
  const small = useMediaQuery('(max-width: 767px)');
  const wide = useMediaQuery('(min-width: 1024px)', true);
  const idPrefix = useId().replace(/:/g, '');

  const [dev] = useState(readDevParams);
  const [gpu] = useState(detectGpu);
  const [initialTier] = useState<QualityTier>(() => dev.tier ?? gpu.tier);
  const [tier, setTier] = useState<QualityTier>(initialTier);
  const [localMode, setLocalMode] = useState<FloorViewMode | null>(null);
  const [sceneFailed, setSceneFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);

  const feed = useFloorFeed({ userIds, stress: dev.stress, template: dev.template ?? templateProp ?? null });
  const { state, dispatch } = feed;

  // Mode: this session's toggle > dev override > saved setting (if not auto) > prop.
  const saved = me?.settings.teamFloorMode;
  const requested: TeamFloorMode = lockMode ?? localMode ?? dev.mode ?? (saved && saved !== 'auto' ? saved : modeProp);
  const canRender3d = gpu.webgl && !sceneFailed;
  const autoFlat = coarse || small || reducedMotion || initialTier === 'low';
  const view: FloorViewMode = requested === 'flat' || !canRender3d ? 'flat' : requested === '3d' ? '3d' : autoFlat ? 'flat' : '3d';
  const notice =
    requested === '3d' && !canRender3d
      ? sceneFailed
        ? 'The 3D view stopped working on this device, so you are seeing the floor plan.'
        : 'The 3D view needs WebGL, which is off on this device. You are seeing the floor plan.'
      : null;

  const chooseView = useCallback(
    (next: FloorViewMode) => {
      setLocalMode(next);
      if (me) updateSettings({ teamFloorMode: next }).catch(() => toast.error('Your view choice was not saved. It applies until you leave this page.'));
    },
    [me, updateSettings],
  );

  const kpis = useMemo(() => (state ? selectKpis(state) : null), [state]);
  const needsYou = useMemo(() => (state ? selectNeedsYou(state) : []), [state]);
  const byUser = useMemo(() => (state ? attentionByUser(state) : new Map()), [state]);
  const selected = state ? employeeById(state, selectedId) : null;

  const nameOf = useCallback((id: string | null) => (state && id ? (employeeById(state, id)?.name ?? null) : 'Team'), [state]);

  /** Select from a list or "Show on floor": also pans the 3D camera to the person. */
  const open = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setFocusRequest({ id, nonce: Date.now() });
  }, []);
  /** Select by clicking the canvas: the person is already in view, keep the camera still. */
  const selectOnCanvas = useCallback((id: string | null) => setSelectedId(id), []);

  const closePanel = useCallback(() => {
    const id = selectedId;
    setSelectedId(null);
    if (id) requestAnimationFrame(() => document.getElementById(employeeDomId(idPrefix, id))?.focus({ preventScroll: true }));
  }, [selectedId, idPrefix]);

  const resolve = useCallback(
    (item: AttentionItem) => {
      dispatch({ kind: 'resolve', id: item.id });
      toast.success(`Resolved: ${item.title}`, {
        action: { label: 'Undo', onClick: () => dispatch({ kind: 'restore', item }) },
      });
    },
    [dispatch],
  );

  const onBubble = useCallback(
    (hit: { userId: string | null; itemIds: string[] }) => {
      const items = state?.attention.filter((a) => hit.itemIds.includes(a.id)) ?? [];
      const only = items.length === 1 ? items[0] : undefined;
      if (!readOnly && only) {
        resolve(only);
        return;
      }
      if (hit.userId) selectOnCanvas(hit.userId);
    },
    [state, readOnly, resolve, selectOnCanvas],
  );

  const onTierDrop = useCallback(() => setTier((t) => NEXT_TIER[t]), []);
  const onContextLost = useCallback(() => setSceneFailed(true), []);

  if (feed.status === 'loading' || (!state && feed.status !== 'error')) return <FloorSkeleton />;
  if (feed.status === 'error' || !state || !kpis || !feed.template) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-16 text-center shadow-card">
        <p className="text-sm font-medium text-fg">The team floor did not load.</p>
        <p className="text-xs text-muted">Check your connection, then try again.</p>
        <Button onClick={feed.retry}>Try again</Button>
      </div>
    );
  }

  const panel = selected ? (
    <EmployeePanel
      employee={selected}
      location={locationOf(state, selected)}
      attention={byUser.get(selected.id) ?? []}
      teammates={state.employees}
      readOnly={readOnly}
      canReassign={canAssign}
      canRecordings={canRecordings}
      onClose={closePanel}
      onResolve={resolve}
      onReassign={(toUserId) => {
        const to = employeeById(state, toUserId);
        if (!selected.currentLeadId || !to) return;
        // Wave 1: local event. Wave 3: PATCH /leads/{id} { ownerId } and the socket echoes lead.assigned.
        dispatch({
          kind: 'reassign',
          leadId: selected.currentLeadId,
          leadName: selected.currentLeadName ?? 'Lead',
          fromUserId: selected.id,
          toUserId,
          now: Date.now(),
        });
        toast.success(`${selected.currentLeadName ?? 'Lead'} reassigned to ${to.name}`);
      }}
      onMessage={() => toast.success(`Message sent to ${firstName(selected.name)}`)}
      embedded={!wide}
    />
  ) : null;

  const empty = state.employees.length === 0;

  return (
    <section aria-labelledby={`${idPrefix}-title`} className="flex flex-col gap-3 lg:h-[calc(100dvh-11.5rem)] lg:min-h-[560px]">
      <h2 id={`${idPrefix}-title`} className="sr-only">
        Live team floor
      </h2>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <KpiStrip kpis={kpis} className="min-w-0 xl:flex-1" />
        <FloorToolbar view={view} onView={chooseView} canChooseView={!lockMode} paused={feed.paused} onPause={feed.setPaused} stress={dev.stress} />
      </div>
      {notice && <p className="text-xs text-muted-strong">{notice}</p>}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div
          className={
            view === '3d'
              ? 'relative h-[max(320px,min(70dvh,80vw))] overflow-hidden rounded-lg border border-border bg-surface shadow-card lg:h-auto lg:min-h-[420px]'
              : 'relative min-h-0 lg:overflow-y-auto'
          }
        >
          {empty ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface px-6 text-center">
              <p className="text-sm font-medium text-fg">Nobody is on this floor yet</p>
              <p className="text-xs text-muted">Add people to your team in Team and roles, and they appear at their desks here.</p>
            </div>
          ) : view === '3d' ? (
            <>
              {/* Text equivalent first in tab order; it appears as an overlay while focused. */}
              <EmployeeList state={state} attention={byUser} selectedId={selectedId} onOpen={open} variant="hidden" idPrefix={idPrefix} />
              <SceneBoundary onError={onContextLost}>
                <FloorScene
                  state={state}
                  template={feed.template}
                  readOnly={readOnly}
                  theme={theme}
                  tier={tier}
                  initialTier={initialTier}
                  reducedMotion={reducedMotion}
                  selectedId={selectedId}
                  focusRequest={focusRequest}
                  onSelect={selectOnCanvas}
                  onBubble={onBubble}
                  onTierDrop={onTierDrop}
                  onContextLost={onContextLost}
                  className="absolute inset-0"
                />
              </SceneBoundary>
              <Legend />
            </>
          ) : (
            <FloorPlan state={state} attention={byUser} selectedId={selectedId} onOpen={open} idPrefix={idPrefix} />
          )}
        </div>

        <aside aria-label="Floor details" className="flex min-h-0 flex-col">
          {wide && panel ? (
            panel
          ) : (
            <NeedsYouList
              items={needsYou}
              nameOf={nameOf}
              readOnly={readOnly}
              onResolve={resolve}
              onShow={(item) => {
                if (!item.userId) return;
                open(item.userId);
                if (view === 'flat') {
                  requestAnimationFrame(() => {
                    const el = document.getElementById(employeeDomId(idPrefix, item.userId ?? ''));
                    el?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
                  });
                }
              }}
              className="lg:flex-1"
            />
          )}
        </aside>
      </div>

      {!wide && (
        <Dialog open={!!panel} onOpenChange={(o) => !o && closePanel()}>
          <DialogContent size="md" className="p-0">
            <DialogTitle className="sr-only">{selected ? `${selected.name} details` : 'Employee details'}</DialogTitle>
            {panel}
          </DialogContent>
        </Dialog>
      )}

      <LiveAnnouncer log={state.log} paused={feed.paused} />
    </section>
  );
}

const LEGEND = [
  ['bg-status-blue-fg', 'On call'],
  ['bg-status-green-fg', 'Available'],
  ['bg-status-amber-fg', 'Busy'],
  ['bg-status-grey-fg', 'Break or offline'],
] as const;

function Legend() {
  return (
    <ul aria-hidden data-floor-ui="" className="pointer-events-none absolute top-3 right-3 hidden gap-2 rounded-md border border-border bg-surface px-2 py-1 shadow-card sm:flex">
      {LEGEND.map(([dot, label]) => (
        <li key={label} className="flex items-center gap-1 text-2xs text-muted">
          <span className={`size-1.5 rounded-full ${dot}`} />
          {label}
        </li>
      ))}
    </ul>
  );
}
