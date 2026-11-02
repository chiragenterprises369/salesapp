'use client';

import { formatInr, type Board } from '@vistar/shared';
import { IndianRupee } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { usePageVisible, useTimeScale, type MotionProfile, type QualityMonitor } from '@/features/shared/physics';
import { AnimatedNumber } from '../animated-number';
import { useBoardPhysics } from '../board-physics.config';
import type { BoardController } from '../drag/controller';
import { CelebrationDirector, type LayerMode, type WonTotalLabel } from './director';
import { diffBoards, snapshotBoard, type BoardSnapshot } from './events';
import { useCelebrationSetting } from './settings';

export interface CelebrationLayerProps {
  /** What the board renders (cache plus local pending moves). */
  board: Board | undefined;
  /** Identity of the data's filters; null while placeholder data shows (filters changing: no events). */
  resetKey: unknown;
  controller: BoardController;
  quality: QualityMonitor;
  profile: MotionProfile;
  /** Board root: area to paint, columns and cards, and `data-board-skin` / `data-board-variant` / `data-board-glow` when the skin sets them. */
  rootRef: RefObject<HTMLElement | null>;
}

const subscribeNoop = () => () => undefined;
const formatTotal = (n: number) => formatInr(n, { compact: true });
const LABEL_MS = 1900;

/** Board skin from the root (`data-board-skin`, set by the skin) or the motion profile (Flat mode). */
function useBoardSkin(rootRef: RefObject<HTMLElement | null>, profile: MotionProfile): string {
  const [skin, setSkin] = useState<string | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const read = () => setSkin(root.dataset.boardSkin ?? null);
    read();
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ['data-board-skin'] });
    return () => mo.disconnect();
  }, [rootRef]);
  return skin ?? (profile.mode === 'flat' ? 'flat' : 'depth');
}

/**
 * Event celebrations over the Leads Board (SPEC 28.1): one capped canvas (portal, pointer events
 * off) plus DOM fades and the Won total count-up. Events come from diffs of the rendered board;
 * the controller supplies flight paths and landings. Full / Subtle from the user's setting and
 * motion; Off, reduced motion, Flat skin and Flat mode get simple fades instead.
 */
export function CelebrationLayer({ board, resetKey, controller, quality, profile, rootRef }: CelebrationLayerProps) {
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const { effective } = useCelebrationSetting();
  const skin = useBoardSkin(rootRef, profile);
  const physics = useBoardPhysics();
  const timeScale = useTimeScale();
  const visible = usePageVisible();
  const mode: LayerMode = effective === 'off' || profile.mode !== 'full' || skin === 'flat' ? 'fade' : effective;

  const layerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fadesRef = useRef<HTMLDivElement>(null);
  const snap = useRef<{ snap: BoardSnapshot; key: unknown } | null>(null);
  const [director, setDirector] = useState<CelebrationDirector | null>(null);
  const [labels, setLabels] = useState<WonTotalLabel[]>([]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const fades = fadesRef.current;
    if (!mounted || !layer || !fades) return;
    const d = new CelebrationDirector(layer, fades, () => rootRef.current, (l) => setLabels((ls) => [...ls.slice(-1), l]));
    setDirector(d);
    return () => {
      d.dispose();
      setDirector(null);
    };
  }, [mounted, rootRef]);

  useLayoutEffect(() => director?.attachCanvas(mode === 'fade' ? null : canvasRef.current, quality), [director, mode, quality]);

  useLayoutEffect(() => {
    director?.configure({ mode, tier: profile.tier, timeScale, arcHeight: physics.arcHeight, flight: physics.flight });
  }, [director, mode, profile.tier, timeScale, physics.arcHeight, physics.flight]);

  useLayoutEffect(() => director?.setHidden(!visible), [director, visible]);

  useLayoutEffect(() => (director ? controller.onMotion((e) => director.onMotion(e)) : undefined), [director, controller]);

  // Passive on purpose: runs after the board's layout pass, so this render's flights are known.
  useEffect(() => {
    if (!board || resetKey === null) return;
    const prev = snap.current;
    if (director && prev && prev.key === resetKey) director.onBoardDiff(diffBoards(prev.snap, board));
    snap.current = { snap: snapshotBoard(board), key: resetKey };
  }, [board, resetKey, director]);

  if (!mounted) return null;
  return createPortal(
    <div
      ref={layerRef}
      aria-hidden
      data-celebrations={mode === 'fade' ? 'off' : mode}
      data-celebrations-setting={effective}
      className="pointer-events-none fixed inset-0 overflow-hidden"
      style={{ zIndex: 40 }}
    >
      {mode !== 'fade' && <canvas ref={canvasRef} className="absolute top-0 left-0" style={{ width: 0, height: 0 }} />}
      <div ref={fadesRef} />
      {labels.map((l) => (
        <WonTotal key={l.key} label={l} onDone={() => setLabels((ls) => ls.filter((x) => x.key !== l.key))} />
      ))}
    </div>,
    document.body,
  );
}

/** "Won ₹12.4L" chip at the top of the column: counts up to the new total, fades in and out (opacity only). */
function WonTotal({ label, onDone }: { label: WonTotalLabel; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(label.from);
  const doneRef = useRef(onDone);
  useLayoutEffect(() => {
    doneRef.current = onDone;
  });

  useEffect(() => {
    // Count up from the old total once the chip is on screen.
    const raf = requestAnimationFrame(() => setValue(label.to));
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') {
      const t = window.setTimeout(() => doneRef.current(), LABEL_MS);
      return () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(t);
      };
    }
    const a = el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.78 }, { opacity: 0 }], { duration: LABEL_MS, easing: 'ease-out', fill: 'forwards' });
    a.onfinish = () => doneRef.current();
    return () => {
      cancelAnimationFrame(raf);
      a.cancel();
    };
  }, [label.to]);

  return (
    <div
      ref={ref}
      data-won-total={label.to}
      className="absolute flex items-center gap-1 rounded-full border bg-surface px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-fg shadow-raised tabular"
      style={{ left: label.x, top: label.y - 6, transform: 'translate(-50%, -100%)', borderColor: label.color, opacity: 0 }}
    >
      <IndianRupee aria-hidden className="size-3.5" style={{ color: label.color }} />
      <span className="text-fg-secondary">Won</span>
      <AnimatedNumber value={value} format={formatTotal} durationMs={label.animate ? 900 : 0} animate={label.animate} />
    </div>
  );
}
