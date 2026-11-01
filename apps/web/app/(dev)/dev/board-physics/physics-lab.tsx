'use client';

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { formatNumber } from '@vistar/shared';
import { MOCK_PIPELINE_ID } from '@vistar/shared/fixtures';
import { Copy, RotateCcw } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { boardPhysics, useBoardPhysics, type BoardPhysicsConfig } from '@/features/pipeline/board-physics.config';
import { BoardView } from '@/features/pipeline/board-view';
import { setBoardFlatMode, useBoardFlatMode } from '@/features/pipeline/motion-prefs';
import { physicsClock, QualityMonitor, QUALITY_TIERS, useFrameRate, usePageVisible, useQuality, useTimeScale, type QualityTier } from '@/features/shared/physics';
import { cn } from '@/lib/cn';
import { leadKeys, useLeadsBoard } from '@/lib/leads/data';
import { useLeadsViewState } from '@/lib/leads/state';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { buildStressBoard, createRealtimeSim, stressCommit } from './simulation';

const STRESS_COUNT = 2500;
const SLOW_MOTION = 0.2;

type NumKey = { [K in keyof BoardPhysicsConfig]: BoardPhysicsConfig[K] extends number ? K : never }[keyof BoardPhysicsConfig];
type SpringKey = 'spring' | 'follow' | 'tilt' | 'land' | 'springBack' | 'gap' | 'flight';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}

function Slider({ label, value, min, max, step, unit = '', onChange }: SliderProps) {
  const id = useId();
  const decimals = step < 1 ? String(step).split('.')[1]?.length ?? 2 : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-fg-secondary">
          {label}
        </label>
        <output htmlFor={id} className="text-xs text-fg tabular">
          {value.toFixed(decimals)}
          {unit}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="focus-ring h-5 w-full cursor-pointer accent-accent"
      />
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-b border-border px-4 py-4 last:border-b-0">
      <h2 id={id} className="text-xs font-semibold tracking-wide text-muted-strong uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (on: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="flex flex-col">
        <span className="text-sm text-fg">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('focus-ring relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors duration-150', checked ? 'border-accent bg-accent' : 'border-input bg-surface-3')}
      >
        <span aria-hidden className={cn('ml-0.5 size-4 rounded-full bg-surface shadow-card transition-transform duration-150', checked && 'translate-x-4')} />
      </button>
    </div>
  );
}

function SpringSliders({ name, k, cfg }: { name: string; k: SpringKey; cfg: BoardPhysicsConfig }) {
  const s = cfg[k];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-fg">{name}</p>
      <Slider label="Stiffness" value={s.stiffness} min={60} max={2000} step={10} onChange={(v) => boardPhysics.set({ [k]: { stiffness: v } })} />
      <Slider label="Damping" value={s.damping} min={4} max={120} step={1} onChange={(v) => boardPhysics.set({ [k]: { damping: v } })} />
      <Slider label="Mass" value={s.mass ?? 1} min={0.3} max={4} step={0.1} onChange={(v) => boardPhysics.set({ [k]: { mass: v } })} />
    </div>
  );
}

/** Stress board: isolated query client seeded with 2,500 leads (moves stay on this page). */
function StressBoard({ quality }: { quality: QualityMonitor }) {
  const main = useQueryClient();
  const base = main.getQueryData<{ pipeline: Parameters<typeof buildStressBoard>[0] }>(leadKeys.board(MOCK_PIPELINE_ID, useLeadsViewState.getState().filters));
  const [client] = useState(() => {
    const c = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false, retry: false } } });
    if (base) c.setQueryData(leadKeys.board(MOCK_PIPELINE_ID, useLeadsViewState.getState().filters), buildStressBoard(base.pipeline, STRESS_COUNT));
    return c;
  });
  const commit = useMemo(() => stressCommit(client, MOCK_PIPELINE_ID), [client]);
  return (
    <QueryClientProvider client={client}>
      <SimBinding persist={false} />
      <BoardView pipelineId={MOCK_PIPELINE_ID} quality={quality} devCommit={commit} />
    </QueryClientProvider>
  );
}

/** Live realtime simulation (toggle) and manual triggers, bound to the nearest query client. */
let simApi: { move: () => void; create: () => void } | null = null;
let simAuto = false;
const simListeners = new Set<() => void>();

function SimBinding({ persist }: { persist: boolean }) {
  const client = useQueryClient();
  const visible = usePageVisible();
  const [auto, setAuto] = useState(simAuto);
  useEffect(() => {
    const sim = createRealtimeSim(client, MOCK_PIPELINE_ID, persist);
    simApi = { move: sim.moveByTeammate, create: sim.newLead };
    const onChange = () => setAuto(simAuto);
    simListeners.add(onChange);
    return () => {
      simListeners.delete(onChange);
      simApi = null;
    };
  }, [client, persist]);
  useEffect(() => {
    if (!auto || !visible) return;
    const t = window.setInterval(() => {
      if (Math.random() < 0.6) simApi?.move();
      else simApi?.create();
    }, physicsClock.ms(2600));
    return () => window.clearInterval(t);
  }, [auto, visible]);
  return null;
}

function setSimAuto(on: boolean) {
  simAuto = on;
  for (const l of simListeners) l();
}

/** The mock data layer's failure switch (window.__vistarMockFailRate). */
function setMockFailRate(rate: number) {
  (window as unknown as { __vistarMockFailRate?: number }).__vistarMockFailRate = rate;
}

export function PhysicsLab() {
  const cfg = useBoardPhysics();
  const timeScale = useTimeScale();
  const flat = useBoardFlatMode();
  const reducedMotion = useReducedMotion();
  const [quality] = useState(() => new QualityMonitor({ fpsFloor: cfg.fpsFloor }));
  const q = useQuality(quality);
  const fps = useFrameRate(true);
  const [stress, setStress] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('stress'));
  const [reducedPref, setReducedPref] = useState(false);
  const [auto, setAuto] = useState(false);
  const [failRate, setFailRate] = useState(0);
  // Loads the pipeline (and the normal board) through the shared cache; the stress board reuses the stages.
  const base = useLeadsBoard(MOCK_PIPELINE_ID, useLeadsViewState((s) => s.filters));

  // ?slow=1 starts in slow motion.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('slow')) physicsClock.setTimeScale(SLOW_MOTION);
  }, []);

  // Restore global switches when leaving the page.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.getAttribute('data-reduced-motion');
    return () => {
      physicsClock.setTimeScale(1);
      if (prev === null) root.removeAttribute('data-reduced-motion');
      else root.setAttribute('data-reduced-motion', prev);
      setMockFailRate(0);
      quality.dispose();
    };
  }, [quality]);

  const toggleReduced = (on: boolean) => {
    setReducedPref(on);
    if (on) document.documentElement.setAttribute('data-reduced-motion', 'on');
    else document.documentElement.removeAttribute('data-reduced-motion');
  };
  const chooseFail = (rate: number) => {
    setFailRate(rate);
    setMockFailRate(rate);
  };
  const num = (k: NumKey) => (v: number) => boardPhysics.set({ [k]: v });
  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(boardPhysics.get(), null, 2));
      toast.success('Config copied. Paste it into board-physics.config.ts');
    } catch {
      toast.error('Could not copy. Your browser blocked clipboard access.');
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-4 lg:flex-row" data-physics-lab="">
      <div className="min-w-0 flex-1">
        {stress && base.data ? <StressBoard key="stress" quality={quality} /> : <NormalBoard quality={quality} />}
      </div>

      <aside aria-label="Physics controls" className="flex w-full shrink-0 flex-col rounded-lg border border-border bg-surface lg:max-h-[calc(100dvh-6rem)] lg:w-80 lg:overflow-y-auto">
        <Group title="Readout">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted">Frame rate</dt>
            <dd className="text-right font-medium text-fg tabular" data-fps={fps?.fps ?? ''}>
              {fps ? `${fps.fps} fps · ${fps.avgMs} ms` : 'Measuring…'}
            </dd>
            <dt className="text-muted">Worst frame</dt>
            <dd className="text-right text-fg tabular">{fps ? `${fps.worstMs} ms` : '–'}</dd>
            <dt className="text-muted">Quality tier</dt>
            <dd className="text-right font-medium text-fg capitalize" data-tier={q.tier}>
              {q.tier}
              {q.forced ? ' (pinned)' : ''}
            </dd>
            <dt className="text-muted">Last drag</dt>
            <dd className="text-right text-fg tabular" data-drag-fps={q.fps ?? ''}>
              {q.fps === null ? '–' : `${q.fps} fps · worst ${q.worstMs} ms`}
            </dd>
            <dt className="text-muted">Motion</dt>
            <dd className="text-right text-fg">{flat ? 'Flat' : reducedMotion ? 'Reduced' : 'Full'}</dd>
          </dl>
        </Group>

        <Group title="Modes">
          <Toggle label="Slow motion" hint={`${SLOW_MOTION}x time scale`} checked={timeScale < 1} onChange={(on) => physicsClock.setTimeScale(on ? SLOW_MOTION : 1)} />
          <Toggle label="Reduced motion" hint="Same as the OS setting" checked={reducedPref || reducedMotion} onChange={toggleReduced} />
          <Toggle label="Flat mode" hint="Plain cards, no physics" checked={flat} onChange={setBoardFlatMode} />
          <Toggle label={`Stress: ${formatNumber(STRESS_COUNT)} leads`} hint="Local data, long columns virtualise" checked={stress} onChange={setStress} />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-fg" id="tier-label">
              Quality tier
            </span>
            <div role="radiogroup" aria-labelledby="tier-label" className="grid grid-cols-4 gap-1">
              {(['auto', ...QUALITY_TIERS] as const).map((t) => {
                const on = t === 'auto' ? q.forced === null : q.forced === t;
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => quality.force(t === 'auto' ? null : (t as QualityTier))}
                    className={cn('focus-ring h-8 rounded-md border text-xs font-medium capitalize', on ? 'border-accent bg-accent-soft text-accent-soft-fg' : 'border-border bg-surface text-fg-secondary hover:bg-surface-2')}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        </Group>

        <Group title="Realtime and errors">
          <Toggle
            label="Live simulation"
            hint="Teammate moves and new leads"
            checked={auto}
            onChange={(on) => {
              setAuto(on);
              setSimAuto(on);
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" onClick={() => simApi?.move()}>
              Teammate move
            </Button>
            <Button size="sm" onClick={() => simApi?.create()}>
              New lead
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-fg" id="fail-label">
              Save failures
            </span>
            <div role="radiogroup" aria-labelledby="fail-label" className="grid grid-cols-3 gap-1">
              {[0, 0.5, 1].map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={failRate === r}
                  onClick={() => chooseFail(r)}
                  className={cn('focus-ring h-8 rounded-md border text-xs font-medium', failRate === r ? 'border-accent bg-accent-soft text-accent-soft-fg' : 'border-border bg-surface text-fg-secondary hover:bg-surface-2')}
                >
                  {r * 100}%
                </button>
              ))}
            </div>
          </div>
        </Group>

        <Group title="Card">
          <Slider label="Lift scale" value={cfg.liftScale} min={1} max={1.12} step={0.01} onChange={num('liftScale')} />
          <Slider label="Tilt limit" value={cfg.tiltMax} min={0} max={15} step={0.5} unit="°" onChange={num('tiltMax')} />
          <Slider label="Tilt gain" value={cfg.tiltGain} min={0} max={24} step={0.5} unit="°/(px/ms)" onChange={num('tiltGain')} />
          <Slider label="Neighbour opacity" value={cfg.neighbourOpacity} min={0.5} max={1} step={0.01} onChange={num('neighbourOpacity')} />
          <Slider label="Perspective" value={cfg.perspective} min={400} max={2400} step={50} unit=" px" onChange={num('perspective')} />
          <Slider label="Thickness" value={cfg.cardThickness} min={0} max={8} step={1} unit=" px" onChange={num('cardThickness')} />
          <Slider label="Sheen" value={cfg.sheen} min={0} max={1} step={0.05} onChange={num('sheen')} />
          <Slider label="Hover lift" value={cfg.hoverLift} min={0} max={16} step={1} unit=" px" onChange={num('hoverLift')} />
          <Slider label="Drag lift (Z)" value={cfg.liftZ} min={0} max={60} step={1} unit=" px" onChange={num('liftZ')} />
        </Group>

        <Group title="Springs">
          <SpringSliders name="Pick-up" k="spring" cfg={cfg} />
          <SpringSliders name="Follow pointer" k="follow" cfg={cfg} />
          <SpringSliders name="Drop (snap)" k="land" cfg={cfg} />
          <SpringSliders name="Spring back" k="springBack" cfg={cfg} />
          <SpringSliders name="Gap" k="gap" cfg={cfg} />
          <SpringSliders name="Arc flight" k="flight" cfg={cfg} />
        </Group>

        <Group title="Timing">
          <Slider label="Entrance stagger" value={cfg.entranceStaggerMs} min={0} max={120} step={5} unit=" ms" onChange={num('entranceStaggerMs')} />
          <Slider label="Gap wave" value={cfg.gapStaggerMs} min={0} max={40} step={1} unit=" ms" onChange={num('gapStaggerMs')} />
          <Slider label="Ring pulse" value={cfg.ringPulseMs} min={100} max={1000} step={10} unit=" ms" onChange={num('ringPulseMs')} />
          <Slider label="Number tick" value={cfg.numberTickMs} min={0} max={1000} step={10} unit=" ms" onChange={num('numberTickMs')} />
          <Slider label="Arc height" value={cfg.arcHeight} min={0} max={200} step={5} unit=" px" onChange={num('arcHeight')} />
          <Slider label="Long-press" value={cfg.longPressMs} min={100} max={600} step={10} unit=" ms" onChange={num('longPressMs')} />
          <Slider label="Mouse threshold" value={cfg.mouseSlop} min={1} max={12} step={1} unit=" px" onChange={num('mouseSlop')} />
        </Group>

        <Group title="Auto-scroll and quality">
          <Slider label="Board edge" value={cfg.autoScroll.boardEdge} min={24} max={160} step={4} unit=" px" onChange={(v) => boardPhysics.set({ autoScroll: { boardEdge: v } })} />
          <Slider label="Column edge" value={cfg.autoScroll.columnEdge} min={24} max={160} step={4} unit=" px" onChange={(v) => boardPhysics.set({ autoScroll: { columnEdge: v } })} />
          <Slider label="Top speed" value={cfg.autoScroll.maxSpeed} min={4} max={40} step={1} unit=" px/frame" onChange={(v) => boardPhysics.set({ autoScroll: { maxSpeed: v } })} />
          <Slider label="Speed ramp" value={cfg.autoScroll.rampMs} min={0} max={1200} step={50} unit=" ms" onChange={(v) => boardPhysics.set({ autoScroll: { rampMs: v } })} />
          <Slider label="FPS floor" value={cfg.fpsFloor} min={20} max={58} step={1} unit=" fps" onChange={num('fpsFloor')} />
          <Slider label="Virtualise over" value={cfg.virtualizeOver} min={10} max={200} step={5} unit=" cards" onChange={num('virtualizeOver')} />
        </Group>

        <div className="flex gap-2 px-4 py-4">
          <Button size="sm" onClick={() => void copyConfig()}>
            <Copy aria-hidden />
            Copy config
          </Button>
          <Button size="sm" variant="ghost" onClick={() => boardPhysics.reset()}>
            <RotateCcw aria-hidden />
            Reset
          </Button>
        </div>
      </aside>
    </div>
  );
}

function NormalBoard({ quality }: { quality: QualityMonitor }) {
  return (
    <>
      <SimBinding persist />
      <BoardView pipelineId={MOCK_PIPELINE_ID} quality={quality} />
    </>
  );
}
