'use client';

import type { BoardSkin } from '@vistar/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import type { QualityMonitor } from '@/features/shared/physics';
import { useMe, useSessionActions } from '@/lib/session/session';
import { useDeviceCapabilities } from '@/lib/theme';
import { useDocumentTheme } from '@/lib/use-document-theme';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { clearLegacyFlatMode, readLegacyFlatMode } from '../motion-prefs';
import { resolveBoardAppearance, SkinPerformance, type ResolvedBoardSkin, type SkinPerfLevel } from './skin-model';

/** Sticky performance fallback for this page load, so a Board/Table switch does not retry Neon. */
let sessionStickyLevel: SkinPerfLevel = 0;

export interface BoardAppearance extends ResolvedBoardSkin {
  /** The person's own choice; null follows the workspace default. */
  userChoice: BoardSkin | null;
  workspaceDefault: BoardSkin;
  /** Performance level behind `skin` and `glow` (0 = full Neon). */
  perfLevel: SkinPerfLevel;
  /** Save the person's choice (null = follow the workspace default). Applies instantly, rolls back with a toast. */
  setSkin: (skin: BoardSkin | null) => void;
}

/**
 * The Board's skin for this person on this device (SPEC 28.1, D-052): saved choice (session
 * settings), workspace default, device fallbacks and the performance fallback fed by the board's
 * QualityMonitor. Also migrates the old Flat mode toggle once.
 */
export function useBoardAppearance(quality: QualityMonitor, fpsFloor: number): BoardAppearance {
  const me = useMe();
  const { updateSettings } = useSessionActions();
  const device = useDeviceCapabilities();
  const reducedMotion = useReducedMotion();
  const theme = useDocumentTheme();
  const saved = me?.settings.boardSkin ?? null;
  const workspaceDefault = me?.workspace.defaultBoardSkin ?? 'depth';

  // Optimistic choice while the settings PATCH is in flight. An unmigrated Flat mode shows as Flat
  // from the first frame (no Depth flash before the migration below has saved it).
  const [pending, setPending] = useState<{ skin: BoardSkin | null } | null>(() => (saved === null && readLegacyFlatMode() ? { skin: 'flat' } : null));
  const token = useRef(0);
  const userChoice = pending ? pending.skin : saved;
  const requested = userChoice ?? workspaceDefault;

  // One-time migration of the old per-device Flat mode. An explicit skin choice wins over it; a
  // failed save keeps the old key so the next visit tries again.
  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current || !me) return;
    migrated.current = true;
    if (!readLegacyFlatMode()) return;
    if (me.settings.boardSkin !== null) {
      clearLegacyFlatMode();
      return;
    }
    const t = ++token.current;
    const settle = () => {
      if (t === token.current) setPending(null);
    };
    updateSettings({ boardSkin: 'flat' }).then(() => {
      clearLegacyFlatMode();
      settle();
    }, settle);
  }, [me, updateSettings]);

  // Performance fallback (Neon only): glow first, then Depth, then Flat.
  const [perf] = useState(() => new SkinPerformance({ fpsFloor, initial: sessionStickyLevel }));
  const [measured, setMeasured] = useState<SkinPerfLevel>(() => perf.update(quality.getSnapshot()));
  useEffect(() => {
    if (requested !== 'neon') return;
    return quality.subscribe(() => {
      setMeasured(perf.update(quality.getSnapshot()));
      sessionStickyLevel = perf.stickyLevel;
    });
  }, [quality, perf, requested]);
  const perfLevel: SkinPerfLevel = requested === 'neon' ? measured : 0;

  const setSkin = useCallback(
    (skin: BoardSkin | null) => {
      // A deliberate pick starts the performance fallback over (other apps may have been closed).
      perf.reset();
      sessionStickyLevel = 0;
      quality.reset();
      setMeasured(perf.update(quality.getSnapshot()));
      const t = ++token.current;
      setPending({ skin });
      updateSettings({ boardSkin: skin }).then(
        () => {
          if (t === token.current) setPending(null);
        },
        () => {
          if (t !== token.current) return;
          setPending(null);
          toast.error('Board skin not saved. Check your connection and try again.');
        },
      );
    },
    [perf, quality, updateSettings],
  );

  const resolved = useMemo(
    () =>
      resolveBoardAppearance({
        user: userChoice,
        workspaceDefault,
        device: { narrowScreen: device.narrowScreen, coarsePointer: device.coarsePointer, lowEnd: device.lowEnd, reducedMotion },
        perfLevel,
        theme,
      }),
    [userChoice, workspaceDefault, device, reducedMotion, perfLevel, theme],
  );

  return { ...resolved, userChoice, workspaceDefault, perfLevel, setSkin };
}
