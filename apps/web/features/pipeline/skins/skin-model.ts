import { BOARD_SKINS, DEFAULT_STAGES, resolveBoardSkin, type BoardSkin, type DeviceCaps, type ResolvedTheme } from '@vistar/shared';
import type { QualitySnapshot, QualityTier } from '@/features/shared/physics';

/**
 * Leads Board skins (SPEC 28.1, D-052): Flat, Depth (default) and Neon Space. Pure, framework free.
 *
 * Effective skin, in order:
 * 1. requested = the user's `leads.boardSkin`, else the workspace's `leads.defaultBoardSkin`, else depth;
 * 2. device: resolveBoardSkin() turns Neon into Flat on phones, touch screens, low-end devices and
 *    with reduced motion (a board that "gave up" on performance counts as low-end, see 3);
 * 3. performance (Neon only): when the adaptive quality tier drops, the glow goes first (medium),
 *    then Neon renders as Depth (low), then Flat when the frame rate still stays under the floor.
 * Neon Space in the Light theme is the "Aurora" variant (pastel glass, coloured edges, no glow).
 */

export { BOARD_SKINS };
export type { BoardSkin };

export const BOARD_SKIN_LABEL: Record<BoardSkin, string> = { flat: 'Flat', depth: 'Depth', neon: 'Neon Space' };
export const BOARD_SKIN_HINT: Record<BoardSkin, string> = {
  flat: 'Plain cards, no physics',
  depth: 'Cards with depth and spring physics',
  neon: 'Glass columns with neon edges',
};

export type BoardVariant = 'neon' | 'aurora';

/** Why the painted skin differs from the requested one, most important first. */
export type SkinFallbackReason = 'reduced-motion' | 'small-screen' | 'touch' | 'low-end' | 'performance';

/** What the device allows (the web app's measurements, mapped onto the shared DeviceCaps). */
export interface BoardDeviceSignals {
  narrowScreen: boolean;
  coarsePointer: boolean;
  lowEnd: boolean;
  reducedMotion: boolean;
}

/**
 * Performance level of a Neon board: 0 everything, 1 no glow or pulses, 2 painted as Depth,
 * 3 gave up (painted as Flat, treated like a low-end device).
 */
export type SkinPerfLevel = 0 | 1 | 2 | 3;

export interface ResolvedBoardSkin {
  /** What the person (or the workspace default) asked for. */
  requested: BoardSkin;
  /** What the board paints: `data-board-skin`. */
  skin: BoardSkin;
  /** Neon edge glow, hot-lead pulse and the slow grid drift. */
  glow: boolean;
  /** Neon only: `neon` in the Dark theme, `aurora` in the Light theme. */
  variant: BoardVariant | null;
  /** Set when `skin` differs from `requested`. */
  reason: SkinFallbackReason | null;
}

export interface ResolveBoardSkinInput {
  user: BoardSkin | null | undefined;
  workspaceDefault: BoardSkin | null | undefined;
  device: BoardDeviceSignals;
  perfLevel: SkinPerfLevel;
  theme: ResolvedTheme;
}

function deviceReason(d: BoardDeviceSignals): SkinFallbackReason | null {
  if (d.reducedMotion) return 'reduced-motion';
  if (d.narrowScreen) return 'small-screen';
  if (d.coarsePointer) return 'touch';
  if (d.lowEnd) return 'low-end';
  return null;
}

export function resolveBoardAppearance({ user, workspaceDefault, device, perfLevel, theme }: ResolveBoardSkinInput): ResolvedBoardSkin {
  const requested = user ?? workspaceDefault ?? 'depth';
  const gaveUp = perfLevel >= 3;
  const caps: DeviceCaps = {
    coarsePointer: device.coarsePointer,
    smallScreen: device.narrowScreen,
    lowEnd: device.lowEnd || gaveUp,
    reducedMotion: device.reducedMotion,
  };
  let skin = resolveBoardSkin(user, workspaceDefault, caps);
  let reason: SkinFallbackReason | null = null;
  if (skin !== requested) reason = deviceReason(device) ?? 'performance';
  if (skin === 'neon' && perfLevel >= 2) {
    skin = 'depth';
    reason = 'performance';
  }
  const neon = skin === 'neon';
  return { requested, skin, glow: neon && perfLevel === 0, variant: neon ? (theme === 'dark' ? 'neon' : 'aurora') : null, reason };
}

const REASON_TEXT: Record<SkinFallbackReason, string> = {
  'reduced-motion': 'reduced motion is on',
  'small-screen': 'the screen is small',
  touch: 'this is a touch screen',
  'low-end': 'this device has limited processing power',
  performance: 'the board was running slowly',
};

/** Short note for the toolbar, e.g. "Neon Space is off here because this is a touch screen. Showing Flat." */
export function describeSkinFallback(r: ResolvedBoardSkin): string | null {
  if (!r.reason || r.skin === r.requested) return null;
  return `${BOARD_SKIN_LABEL[r.requested]} is off ${r.reason === 'performance' ? 'for now' : 'on this device'} because ${REASON_TEXT[r.reason]}. Showing ${BOARD_SKIN_LABEL[r.skin]}.`;
}

// ---------------------------------------------------------------- performance fallback

const TIER_LEVEL: Record<QualityTier, SkinPerfLevel> = { high: 0, medium: 1, low: 2 };

/**
 * Turns the board's quality snapshots into a skin performance level.
 * - The glow follows the tier (medium and below: off), so it comes back when the board recovers.
 * - Painting Neon as Depth (tier low) and then Flat (still under the floor at tier low for
 *   `giveUpWindows` more measured windows) is sticky for the page session, so a recovering frame
 *   rate never flips the skin back and forth while someone drags. Picking a skin again resets it.
 * - A forced tier (demo page, tests) maps straight to its level and leaves the sticky state alone.
 */
export class SkinPerformance {
  private sticky: SkinPerfLevel = 0;
  private badAtLow = 0;
  private last: QualitySnapshot | null = null;
  private readonly fpsFloor: number;
  private readonly giveUpWindows: number;

  constructor(opts: { fpsFloor: number; giveUpWindows?: number; initial?: SkinPerfLevel }) {
    this.fpsFloor = opts.fpsFloor;
    this.giveUpWindows = opts.giveUpWindows ?? 2;
    this.sticky = opts.initial && opts.initial >= 2 ? opts.initial : 0;
  }

  /** Feed every snapshot (order matters); returns the current level. */
  update(s: QualitySnapshot): SkinPerfLevel {
    const prev = this.last;
    this.last = s;
    if (s.forced) return TIER_LEVEL[s.forced];
    // A measured window closed when the numbers changed (sampling on/off alone is not a window).
    const newWindow = s.fps !== null && (!prev || prev.fps !== s.fps || prev.frameMs !== s.frameMs || prev.worstMs !== s.worstMs);
    if (s.autoTier === 'low') {
      const wasLow = prev?.autoTier === 'low' && !prev.forced;
      if (this.sticky < 2) this.sticky = 2;
      // The window that stepped the tier down to low does not count twice.
      if (wasLow && newWindow && s.fps! < this.fpsFloor && this.sticky < 3 && ++this.badAtLow >= this.giveUpWindows) this.sticky = 3;
      if (wasLow && newWindow && s.fps! >= this.fpsFloor) this.badAtLow = 0;
    } else {
      this.badAtLow = 0;
    }
    return this.level(s.autoTier);
  }

  /** Current level for a tier, respecting the sticky fallback. */
  level(tier: QualityTier): SkinPerfLevel {
    return Math.max(TIER_LEVEL[tier], this.sticky) as SkinPerfLevel;
  }

  get stickyLevel(): SkinPerfLevel {
    return this.sticky;
  }

  reset() {
    this.sticky = 0;
    this.badAtLow = 0;
    this.last = null;
  }
}

// ---------------------------------------------------------------- neon edge colours

/** Default stage keys (DEFAULT_STAGES) with a spec colour: New blue, Contacted cyan, ... */
const NEON_KEYS = new Set(DEFAULT_STAGES.map((s) => s.key));
/** Fallback hues for custom stages without their own colour (cycled by column index). */
export const NEON_FALLBACK_COUNT = 6;

/**
 * CSS colour of a column's neon edge. Default stages use the spec palette (CSS variables that
 * switch between the Neon and Aurora tones), custom stages their own colour, else a fallback hue;
 * custom Won/Lost stages use green/red.
 */
export function neonEdge(stage: { key: string; type?: 'open' | 'won' | 'lost'; color?: string | null }, index: number): string {
  if (NEON_KEYS.has(stage.key)) return `var(--vn-edge-${stage.key.replace(/_/g, '-')})`;
  if (stage.color && /^#[0-9a-f]{3,8}$/i.test(stage.color)) return stage.color;
  if (stage.type === 'won') return 'var(--vn-edge-won)';
  if (stage.type === 'lost') return 'var(--vn-edge-lost)';
  return `var(--vn-edge-x${index % NEON_FALLBACK_COUNT})`;
}

/** Open stage with a follow-up in the past: the card gets the overdue edge pulse. */
export function isOverdue(lead: { nextFollowUpAt: string | null }, stageType: 'open' | 'won' | 'lost' | undefined, now: number): boolean {
  return stageType !== 'won' && stageType !== 'lost' && !!lead.nextFollowUpAt && Date.parse(lead.nextFollowUpAt) < now;
}
