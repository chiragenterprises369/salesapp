'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { AttentionItem, ResolvedTheme } from '@vistar/shared';
import { formatDuration, initials } from '@vistar/shared';
import { Minus, Plus, Scan } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import * as THREE from 'three';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { qaEnabled, useNow } from '../state/env';
import { getLayout } from '../state/layout';
import { firstName, OUTCOME_LABEL, OUTCOME_TONE } from '../state/reducer';
import type { FloorTemplate } from '../state/template';
import type { FloorEmployee, FloorState, QualityTier } from '../state/types';
import type { LodLevel } from './characters';
import { FloorEngine, type EngineCallbacks } from './engine';
import type { LabelKind } from './label-layout';

/**
 * Lazily loaded 3D Team Floor (three + R3F live only in this chunk).
 * R3F owns the canvas, sizing and the on-demand frame loop; FloorEngine owns the scene graph and
 * places the DOM label layer (name tags, "Needs you" and call outcome bubbles) without overlaps.
 */

export interface BubbleHit {
  userId: string | null;
  itemIds: string[];
}

export interface FloorSceneProps {
  state: FloorState;
  template: FloorTemplate;
  theme: ResolvedTheme;
  tier: QualityTier;
  /** Tier at mount (shadow map type and antialiasing cannot change later). */
  initialTier: QualityTier;
  reducedMotion: boolean;
  selectedId: string | null;
  focusRequest: { id: string; nonce: number } | null;
  readOnly: boolean;
  onSelect: (id: string | null) => void;
  onBubble: (hit: BubbleHit) => void;
  onTierDrop: () => void;
  onContextLost: () => void;
  className?: string;
}

const signatures = new WeakMap<object, string>();
/** Changes only when the floor is re-initialised (new snapshot, scope or template). */
function signature(state: FloorState) {
  let s = signatures.get(state.index);
  if (!s) {
    s = `${state.templateId}:${state.homeCount}:${Object.keys(state.index).join(',')}`;
    signatures.set(state.index, s);
  }
  return s;
}

type Registry = Map<string, { kind: LabelKind; el: HTMLElement | null; line: SVGLineElement | null }>;

export default function FloorScene(props: FloorSceneProps) {
  const { state, tier, initialTier, className } = props;
  const engineRef = useRef<FloorEngine | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const registry = useRef<Registry>(new Map());
  const callbacksRef = useRef<EngineCallbacks>({ onSelect: () => {}, onBubble: () => {}, onLod: () => {}, onTierDrop: () => {}, onReady: () => {} });
  const [lod, setLod] = useState<{ level: LodLevel; tags: boolean }>({ level: 'near', tags: true });
  const [ready, setReady] = useState(false);

  const { onSelect, onBubble, onTierDrop } = props;
  useEffect(() => {
    callbacksRef.current = {
      onSelect,
      onBubble,
      onTierDrop,
      onLod: (level, tags) => setLod((prev) => (prev.level === level && prev.tags === tags ? prev : { level, tags })),
      onReady: (r) => setReady(r),
    };
  }, [onSelect, onBubble, onTierDrop]);

  const onEngine = useCallback((engine: FloorEngine | null) => {
    engineRef.current = engine;
    if (engine) {
      for (const [id, r] of registry.current) engine.registerLabel(id, r.kind, r.el, r.line);
      const { level, tagsVisible } = engine.currentLod;
      setLod({ level, tags: tagsVisible });
    }
  }, []);

  const register = useCallback((id: string, kind: LabelKind, part: 'el' | 'line', node: HTMLElement | SVGLineElement | null) => {
    const reg = registry.current;
    const cur = reg.get(id) ?? { kind, el: null, line: null };
    if (part === 'el') cur.el = node as HTMLElement | null;
    else cur.line = node as SVGLineElement | null;
    if (!cur.el && !cur.line) reg.delete(id);
    else reg.set(id, cur);
    engineRef.current?.registerLabel(id, kind, cur.el, cur.line);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const engine = engineRef.current;
    if (!engine) return;
    const step = 60;
    const handled: Record<string, () => void> = {
      ArrowLeft: () => engine.pan(step, 0),
      ArrowRight: () => engine.pan(-step, 0),
      ArrowUp: () => engine.pan(0, step),
      ArrowDown: () => engine.pan(0, -step),
      '+': () => engine.zoomBy(1.25),
      '=': () => engine.zoomBy(1.25),
      '-': () => engine.zoomBy(1 / 1.25),
      '0': () => engine.resetView(),
    };
    const fn = handled[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  };

  // three 0.187 removed PCFSoftShadowMap: high tier uses PCF with a blur radius (soft), medium plain PCF.
  const shadows = initialTier === 'low' ? false : 'percentage';
  const dpr: number | [number, number] = tier === 'high' ? [1, 2] : tier === 'medium' ? [1, 1.5] : 1;
  const key = signature(state);

  return (
    <div ref={containerRef} className={cn('relative h-full w-full overflow-hidden', className)} data-tier={tier} data-lod={lod.level} data-floor-canvas="" data-ready={ready || undefined}>
      <div
        tabIndex={0}
        role="region"
        aria-label="3D team floor. Arrow keys pan, plus and minus zoom, 0 fits the whole office. The employee list just before this has the same information as text."
        onKeyDown={onKeyDown}
        className="focus-ring absolute inset-0 rounded-lg"
      >
        <Canvas
          orthographic
          shadows={shadows}
          dpr={dpr}
          frameloop="demand"
          gl={{ antialias: initialTier !== 'low', alpha: true, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.NeutralToneMapping;
          }}
          camera={{ position: [40, 40, 40], zoom: 30, near: 1, far: 300 }}
          aria-hidden
          fallback={<p className="p-4 text-sm text-muted">The 3D view needs WebGL. Switch to Flat to see the floor plan.</p>}
        >
          <EngineBridge key={key} {...props} callbacksRef={callbacksRef} onEngine={onEngine} container={containerRef} />
        </Canvas>
      </div>

      <LabelLayer state={state} selectedId={props.selectedId} readOnly={props.readOnly} register={register} onBubble={onBubble} />

      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Skeleton className="absolute inset-0 rounded-none opacity-60" />
          <p className="relative rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-muted-strong shadow-card">Setting up the office…</p>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
        <div data-floor-ui="" className="pointer-events-auto flex items-center gap-1 rounded-md border border-border bg-surface p-1 shadow-card">
          <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => engineRef.current?.zoomBy(1.25)}>
            <Plus aria-hidden />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => engineRef.current?.zoomBy(1 / 1.25)}>
            <Minus aria-hidden />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => engineRef.current?.resetView()} aria-label="Fit the whole office in view">
            <Scan aria-hidden />
            Fit
          </Button>
        </div>
        {!lod.tags && (
          <p data-floor-ui="" className="rounded-md border border-border bg-surface px-2 py-1 text-2xs text-muted-strong shadow-card">
            Zoom in to see names
          </p>
        )}
      </div>
    </div>
  );
}

interface BridgeProps extends FloorSceneProps {
  callbacksRef: { current: EngineCallbacks };
  onEngine: (engine: FloorEngine | null) => void;
  container: { current: HTMLDivElement | null };
}

interface QaHook {
  ready(): boolean;
  info(): ReturnType<FloorEngine['info']>;
  labels(): ReturnType<FloorEngine['labelRects']>;
  overlaps(): [string, string][];
  benchmark(ms: number): ReturnType<FloorEngine['benchmark']>;
  zoomBy(f: number): void;
  fit(): void;
  focus(id: string): void;
  focusPoint(x: number, z: number, factor: number): void;
  rooms(): { id: string; x: number; z: number }[];
}

function EngineBridge({ state, template, theme, tier, reducedMotion, selectedId, focusRequest, onContextLost, callbacksRef, onEngine, container }: BridgeProps) {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const engineRef = useRef<FloorEngine | null>(null);
  const layout = useMemo(() => getLayout(template, state.homeCount), [template, state.homeCount]);
  const capacity = state.employees.length;

  useEffect(() => {
    const engine = new FloorEngine({
      scene,
      camera: camera as THREE.OrthographicCamera,
      gl,
      invalidate: () => invalidate(),
      layout,
      capacity,
      callbacks: callbacksRef,
      container: container.current,
    });
    engineRef.current = engine;
    onEngine(engine);
    // Reads the latest callbacks at cleanup time on purpose (the ref is updated on every render).
    const notifyUnready = () => callbacksRef.current.onReady(false);
    const w = window as unknown as { __vistarFloor?: QaHook };
    if (qaEnabled()) {
      w.__vistarFloor = {
        ready: () => engine.ready,
        info: () => engine.info(),
        labels: () => engine.labelRects(),
        overlaps: () => engine.labelOverlaps(),
        benchmark: (ms) => engine.benchmark(ms),
        zoomBy: (f) => engine.zoomBy(f),
        fit: () => engine.resetView(),
        focus: (id) => engine.focus(id),
        focusPoint: (x, z, f) => engine.focusPoint(x, z, f),
        rooms: () => template.rooms.map((r) => ({ id: r.id, x: r.outline.reduce((a, p) => a + p[0], 0) / r.outline.length, z: r.outline.reduce((a, p) => a + p[1], 0) / r.outline.length })),
      };
    }
    return () => {
      onEngine(null);
      engineRef.current = null;
      notifyUnready();
      engine.dispose();
      if (w.__vistarFloor) delete w.__vistarFloor;
    };
  }, [scene, camera, gl, invalidate, layout, capacity, callbacksRef, onEngine, container, template]);

  useEffect(() => {
    const lost = (e: Event) => {
      e.preventDefault();
      onContextLost();
    };
    const el = gl.domElement;
    el.addEventListener('webglcontextlost', lost);
    return () => el.removeEventListener('webglcontextlost', lost);
  }, [gl, onContextLost]);

  useEffect(() => engineRef.current?.resize(width, height), [width, height]);
  useEffect(() => engineRef.current?.setTier(tier), [tier]);
  useEffect(() => engineRef.current?.setReducedMotion(reducedMotion), [reducedMotion]);
  useEffect(() => engineRef.current?.setTheme(theme, true), [theme]);
  useEffect(() => engineRef.current?.setFloorState(state), [state]);
  useEffect(() => engineRef.current?.setSelected(selectedId), [selectedId]);
  useEffect(() => {
    if (focusRequest) engineRef.current?.focus(focusRequest.id);
  }, [focusRequest]);

  useFrame((_, delta) => {
    if (engineRef.current?.frame(delta)) invalidate();
  });

  return null;
}

// ---------------------------------------------------------------- DOM label layer

const DOT: Record<FloorEmployee['status'], string> = {
  on_call: 'bg-status-blue-fg',
  idle: 'bg-status-green-fg',
  busy: 'bg-status-amber-fg',
  away: 'bg-status-grey-fg',
  offline: 'bg-status-grey-fg',
};

const TONE: Record<string, string> = {
  red: 'border-status-red-border bg-status-red-bg text-status-red-fg',
  amber: 'border-status-amber-border bg-status-amber-bg text-status-amber-fg',
  blue: 'border-status-blue-border bg-status-blue-bg text-status-blue-fg',
  green: 'border-status-green-border bg-status-green-bg text-status-green-fg',
  grey: 'border-status-grey-border bg-status-grey-bg text-status-grey-fg',
  indigo: 'border-status-indigo-border bg-status-indigo-bg text-status-indigo-fg',
  neutral: 'border-border bg-surface-2 text-fg-secondary',
};
const SEVERITY_RANK: Record<AttentionItem['severity'], number> = { critical: 2, warning: 1, info: 0 };
const SEVERITY_TONE: Record<AttentionItem['severity'], string> = { critical: 'red', warning: 'amber', info: 'blue' };
const POPUP_MS = 3200;

function LabelLayer({
  state,
  selectedId,
  readOnly,
  register,
  onBubble,
}: {
  state: FloorState;
  selectedId: string | null;
  readOnly: boolean;
  register: (id: string, kind: LabelKind, part: 'el' | 'line', node: HTMLElement | SVGLineElement | null) => void;
  onBubble: (hit: BubbleHit) => void;
}) {
  const now = useNow();
  const groups = useMemo(() => {
    const map = new Map<string, AttentionItem[]>();
    for (const item of state.attention) {
      const key = item.userId ?? '';
      if (item.userId && state.index[item.userId] === undefined) continue;
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return [...map.entries()];
  }, [state.attention, state.index]);
  const popups = state.effects.filter((e): e is Extract<FloorState['effects'][number], { kind: 'call_outcome' }> => e.kind === 'call_outcome' && (now === 0 || now - e.at < POPUP_MS));
  const ids = [...state.employees.map((e) => `tag:${e.id}`), ...groups.map(([k]) => `bubble:${k}`), ...popups.map((p) => `popup:${p.id}`)];

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        {ids.map((id) => (
          <line
            key={id}
            ref={(node) => {
              const kind: LabelKind = id.startsWith('tag:') ? 'tag' : 'bubble';
              register(id, kind, 'line', node);
              return () => register(id, kind, 'line', null);
            }}
            className="stroke-border-strong"
            strokeWidth={1.25}
            style={{ visibility: 'hidden' }}
          />
        ))}
      </svg>
      {state.employees.map((e) => (
        <NameTag key={e.id} employee={e} selected={e.id === selectedId} register={register} />
      ))}
      {groups.map(([key, items]) => {
        const worst = items.reduce((m, i) => (SEVERITY_RANK[i.severity] > SEVERITY_RANK[m.severity] ? i : m), items[0]!);
        const tone = SEVERITY_TONE[worst.severity];
        const label = items.length > 1 ? `Needs you · ${items.length}` : 'Needs you';
        const id = `bubble:${key}`;
        return (
          <div
            key={id}
            ref={(node) => {
              register(id, 'bubble', 'el', node);
              return () => register(id, 'bubble', 'el', null);
            }}
            data-user={key}
            data-v={label}
            data-priority="0"
            className="invisible absolute top-0 left-0 will-change-transform"
          >
            <button
              type="button"
              tabIndex={-1}
              onClick={() => onBubble({ userId: key || null, itemIds: items.map((i) => i.id) })}
              title={readOnly ? items.map((i) => i.title).join(', ') : `Resolve: ${items.map((i) => i.title).join(', ')}`}
              className={cn('pointer-events-auto flex h-[22px] items-center gap-1 rounded-full border px-2 text-xs font-semibold whitespace-nowrap shadow-card', TONE[tone])}
            >
              <span className="flex size-3.5 items-center justify-center rounded-full bg-current text-[9px] leading-none">
                <span className="text-surface">!</span>
              </span>
              {label}
            </button>
          </div>
        );
      })}
      {popups.map((p) => {
        const id = `popup:${p.id}`;
        const tone = p.outcome ? OUTCOME_TONE[p.outcome] : 'grey';
        const text = p.outcome ? OUTCOME_LABEL[p.outcome] : 'Call ended';
        return (
          <div
            key={id}
            ref={(node) => {
              register(id, 'bubble', 'el', node);
              return () => register(id, 'bubble', 'el', null);
            }}
            data-user={p.userId}
            data-v={text}
            data-priority={p.outcome === 'missed' ? '1' : '2'}
            className="invisible absolute top-0 left-0 will-change-transform"
          >
            <span className={cn('flex h-[22px] items-center gap-1 rounded-full border px-2 text-xs font-semibold whitespace-nowrap shadow-card', TONE[tone])}>
              <span className="size-1.5 rounded-full bg-current" />
              {text}
              {p.durationSec > 0 && <span className="tabular font-medium opacity-80">{formatDuration(p.durationSec)}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const NameTag = memo(function NameTag({
  employee,
  selected,
  register,
}: {
  employee: FloorEmployee;
  selected: boolean;
  register: (id: string, kind: LabelKind, part: 'el' | 'line', node: HTMLElement | SVGLineElement | null) => void;
}) {
  const id = `tag:${employee.id}`;
  const first = firstName(employee.name);
  const startedAt = employee.status === 'on_call' && employee.activeCall ? employee.activeCall.startedAt : null;
  return (
    <div
      ref={(node) => {
        register(id, 'tag', 'el', node);
        return () => register(id, 'tag', 'el', null);
      }}
      data-user={employee.id}
      data-v={`${first}|${employee.status}|${startedAt ? 't' : ''}|${selected ? 's' : ''}`}
      data-live={startedAt !== null ? '' : undefined}
      className="group invisible absolute top-0 left-0 will-change-transform"
    >
      <span
        data-variant="full"
        className={cn(
          'absolute top-0 left-0 flex h-[22px] items-center gap-1.5 rounded-full border bg-surface pr-2 pl-1.5 text-xs font-medium whitespace-nowrap text-fg shadow-card group-data-[mode=compact]:invisible',
          selected ? 'border-ring ring-1 ring-ring' : 'border-border-strong',
        )}
      >
        <span className={cn('size-2 shrink-0 rounded-full', DOT[employee.status])} />
        {first}
        {startedAt !== null && <CallTimer startedAt={startedAt} />}
      </span>
      <span
        data-variant="compact"
        className={cn(
          'invisible absolute top-0 left-0 flex h-[18px] items-center gap-1 rounded-full border bg-surface pr-1.5 pl-1 text-[10px] leading-none font-semibold text-fg-secondary shadow-card group-data-[mode=compact]:visible',
          selected ? 'border-ring' : 'border-border-strong',
        )}
      >
        <span className={cn('size-1.5 shrink-0 rounded-full', DOT[employee.status])} />
        {initials(employee.name)}
      </span>
    </div>
  );
});

function CallTimer({ startedAt }: { startedAt: number }) {
  const now = useNow();
  return <span className="tabular min-w-[3ch] text-fg-secondary">{now ? formatDuration(Math.max(0, now - startedAt) / 1000) : ''}</span>;
}
