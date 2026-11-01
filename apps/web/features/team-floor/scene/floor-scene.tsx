'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { ResolvedTheme } from '@vistar/shared';
import { formatDuration } from '@vistar/shared';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type * as THREE from 'three';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useNow } from '../state/env';
import { getLayout } from '../state/layout';
import { firstName } from '../state/reducer';
import type { FloorEmployee, FloorState, QualityTier } from '../state/types';
import type { LodLevel } from './characters';
import type { BubbleHit } from './effects';
import { FloorEngine, type EngineCallbacks } from './engine';

/**
 * Lazily loaded 3D Team Floor (three + R3F + drei live only in this chunk).
 * R3F owns the canvas, sizing and the on-demand frame loop; FloorEngine owns the scene graph.
 */

export interface FloorSceneProps {
  state: FloorState;
  theme: ResolvedTheme;
  tier: QualityTier;
  /** Tier at mount (shadow map type and antialiasing cannot change later). */
  initialTier: QualityTier;
  reducedMotion: boolean;
  selectedId: string | null;
  focusRequest: { id: string; nonce: number } | null;
  onSelect: (id: string | null) => void;
  onBubble: (hit: BubbleHit) => void;
  onTierDrop: () => void;
  onContextLost: () => void;
  className?: string;
}

const signatures = new WeakMap<object, string>();
/** Changes only when the floor is re-initialised (new snapshot or scope). */
function signature(state: FloorState) {
  let s = signatures.get(state.index);
  if (!s) {
    s = `${state.deskCount}:${Object.keys(state.index).join(',')}`;
    signatures.set(state.index, s);
  }
  return s;
}

export default function FloorScene(props: FloorSceneProps) {
  const { state, tier, initialTier, className } = props;
  const engineRef = useRef<FloorEngine | null>(null);
  const tagEls = useRef(new Map<string, HTMLElement>());
  const callbacksRef = useRef<EngineCallbacks>({ onSelect: () => {}, onBubble: () => {}, onLod: () => {}, onTierDrop: () => {} });
  const [lod, setLod] = useState<{ level: LodLevel; tags: boolean }>({ level: 'near', tags: true });

  const { onSelect, onBubble, onTierDrop } = props;
  useEffect(() => {
    callbacksRef.current = {
      onSelect,
      onBubble,
      onTierDrop,
      onLod: (level, tags) => setLod((prev) => (prev.level === level && prev.tags === tags ? prev : { level, tags })),
    };
  }, [onSelect, onBubble, onTierDrop]);

  const onEngine = useCallback((engine: FloorEngine | null) => {
    engineRef.current = engine;
    if (engine) {
      for (const [id, el] of tagEls.current) engine.registerTag(id, el);
      const { level, tagsVisible } = engine.currentLod;
      setLod({ level, tags: tagsVisible });
    }
  }, []);

  const registerTag = useCallback((id: string, el: HTMLElement | null) => {
    if (el) tagEls.current.set(id, el);
    else tagEls.current.delete(id);
    engineRef.current?.registerTag(id, el);
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
      '+': () => engine.zoomBy(1.2),
      '=': () => engine.zoomBy(1.2),
      '-': () => engine.zoomBy(1 / 1.2),
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
    <div className={cn('relative h-full w-full overflow-hidden', className)} data-tier={tier} data-lod={lod.level}>
      <div
        tabIndex={0}
        role="region"
        aria-label="3D team floor. Arrow keys pan, plus and minus zoom, 0 resets the view. The employee list just before this has the same information as text."
        onKeyDown={onKeyDown}
        className="focus-ring absolute inset-0 rounded-lg"
      >
        <Canvas
          orthographic
          flat
          shadows={shadows}
          dpr={dpr}
          frameloop="demand"
          gl={{ antialias: initialTier !== 'low', alpha: true, powerPreference: 'high-performance' }}
          camera={{ position: [40, 40, 40], zoom: 20, near: 0.1, far: 300 }}
          aria-hidden
          fallback={<p className="p-4 text-sm text-muted">The 3D view needs WebGL. Switch to Flat to see the floor plan.</p>}
        >
          <EngineBridge key={key} {...props} callbacksRef={callbacksRef} onEngine={onEngine} />
        </Canvas>
      </div>

      {initialTier === 'high' && (
        <TagLayer employees={state.employees} enabled={tier === 'high'} visible={lod.tags} selectedId={props.selectedId} register={registerTag} />
      )}

      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
        <div className="pointer-events-auto flex gap-1 rounded-md border border-border bg-surface p-1 shadow-card">
          <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => engineRef.current?.zoomBy(1.25)}>
            <Plus aria-hidden />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => engineRef.current?.zoomBy(1 / 1.25)}>
            <Minus aria-hidden />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Reset view" onClick={() => engineRef.current?.resetView()}>
            <Maximize2 aria-hidden />
          </Button>
        </div>
        {lod.level !== 'near' && (
          <p className="rounded-md border border-border bg-surface px-2 py-1 text-2xs text-muted shadow-card">Zoom in to see names</p>
        )}
      </div>
    </div>
  );
}

interface BridgeProps extends FloorSceneProps {
  callbacksRef: { current: EngineCallbacks };
  onEngine: (engine: FloorEngine | null) => void;
}

function EngineBridge({ state, theme, tier, reducedMotion, selectedId, focusRequest, onContextLost, callbacksRef, onEngine }: BridgeProps) {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const engineRef = useRef<FloorEngine | null>(null);
  const layout = useMemo(() => getLayout(state.deskCount), [state.deskCount]);
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
    });
    engineRef.current = engine;
    onEngine(engine);
    // Dev-only handle for QA scripts (tier, LOD, agents).
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __vistarFloor?: FloorEngine }).__vistarFloor = engine;
    return () => {
      onEngine(null);
      engineRef.current = null;
      engine.dispose();
    };
  }, [scene, camera, gl, invalidate, layout, capacity, callbacksRef, onEngine]);

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

/**
 * High-tier name tags: one DOM overlay (single React tree). The engine writes each tag's transform
 * in its frame loop, only when it changes. Medium/low tiers use canvas-texture sprites instead.
 */
function TagLayer({
  employees,
  enabled,
  visible,
  selectedId,
  register,
}: {
  employees: FloorEmployee[];
  enabled: boolean;
  visible: boolean;
  selectedId: string | null;
  register: (id: string, el: HTMLElement | null) => void;
}) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {employees.map((e) => (
        <div
          key={e.id}
          ref={(el) => {
            register(e.id, el);
            return () => register(e.id, null);
          }}
          className="invisible absolute top-0 left-0 will-change-transform"
        >
          <NameTag employee={e} selected={e.id === selectedId} hidden={!enabled || e.status === 'offline' || (!visible && e.id !== selectedId)} />
        </div>
      ))}
    </div>
  );
}

const DOT: Record<FloorEmployee['status'], string> = {
  on_call: 'bg-status-blue-fg',
  idle: 'bg-status-green-fg',
  busy: 'bg-status-amber-fg',
  away: 'bg-status-grey-fg',
  offline: 'bg-status-grey-fg',
};

function NameTag({ employee, selected, hidden }: { employee: FloorEmployee; selected: boolean; hidden: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        '-translate-x-1/2 -translate-y-full items-center gap-1 rounded-full border bg-surface px-1.5 text-2xs font-medium whitespace-nowrap text-fg shadow-card select-none',
        hidden ? 'hidden' : 'flex h-5',
        selected ? 'border-ring' : 'border-border-strong',
      )}
    >
      <span className={cn('size-1.5 rounded-full', DOT[employee.status])} />
      {firstName(employee.name)}
      {employee.status === 'on_call' && employee.activeCall && !hidden && <CallTimer startedAt={employee.activeCall.startedAt} />}
    </div>
  );
}

function CallTimer({ startedAt }: { startedAt: number }) {
  const now = useNow();
  return <span className="tabular text-fg-secondary">{formatDuration((now - startedAt) / 1000)}</span>;
}
