import type { ChipTone, LeadTemperature } from '@vistar/shared';

/**
 * Static class maps (Tailwind only sees literal class names). Column tint = status-<tone>-bg,
 * dot = status-<tone>-fg; neutral stages fall back to surface-2 / muted-strong.
 */
export const COLUMN_TINT: Record<ChipTone, string> = {
  neutral: 'bg-surface-2 border-border',
  indigo: 'bg-status-indigo-bg border-status-indigo-border',
  blue: 'bg-status-blue-bg border-status-blue-border',
  green: 'bg-status-green-bg border-status-green-border',
  amber: 'bg-status-amber-bg border-status-amber-border',
  grey: 'bg-status-grey-bg border-status-grey-border',
  red: 'bg-status-red-bg border-status-red-border',
};

export const STAGE_DOT: Record<ChipTone, string> = {
  neutral: 'bg-muted-strong',
  indigo: 'bg-status-indigo-fg',
  blue: 'bg-status-blue-fg',
  green: 'bg-status-green-fg',
  amber: 'bg-status-amber-fg',
  grey: 'bg-status-grey-fg',
  red: 'bg-status-red-fg',
};

/** Count chip border matches the column edge. */
export const COUNT_BORDER: Record<ChipTone, string> = {
  neutral: 'border-border',
  indigo: 'border-status-indigo-border',
  blue: 'border-status-blue-border',
  green: 'border-status-green-border',
  amber: 'border-status-amber-border',
  grey: 'border-status-grey-border',
  red: 'border-status-red-border',
};

export const TEMPERATURE_DOT: Record<LeadTemperature, string> = {
  hot: 'bg-status-red-fg',
  warm: 'bg-status-amber-fg',
  cold: 'bg-status-blue-fg',
};

/** Temperature word; the Board appends the configured label ("Hot lead", "Hot enquiry"). */
export const TEMPERATURE_NAME: Record<LeadTemperature, string> = {
  hot: 'Hot',
  warm: 'Warm',
  cold: 'Cold',
};

export type TavolaTone = 'amber' | 'ember' | 'mint' | 'ink';

export interface TavolaTheme {
  tone: TavolaTone;
  cardClass: string;
  colClass: string;
  gradient: string;
  ink: string;
  glow: string;
  accent: string;
}

export const TAVOLA_THEMES: Record<TavolaTone, TavolaTheme> = {
  amber: {
    tone: 'amber',
    cardClass: 'ob-t--amber',
    colClass: 'ob-col--amber',
    gradient: 'linear-gradient(135deg, #f4e2b8, #e8cc91)',
    ink: '#2b2110',
    glow: 'rgba(232, 204, 145, 0.55)',
    accent: '#ecd29a',
  },
  ember: {
    tone: 'ember',
    cardClass: 'ob-t--ember',
    colClass: 'ob-col--ember',
    gradient: 'linear-gradient(135deg, #f5c8bc, #eaa999)',
    ink: '#2e1813',
    glow: 'rgba(234, 169, 153, 0.55)',
    accent: '#eeb2a3',
  },
  mint: {
    tone: 'mint',
    cardClass: 'ob-t--mint',
    colClass: 'ob-col--mint',
    gradient: 'linear-gradient(135deg, #c3e9da, #9fd6c1)',
    ink: '#10291f',
    glow: 'rgba(159, 214, 193, 0.55)',
    accent: '#a8dcc8',
  },
  ink: {
    tone: 'ink',
    cardClass: 'ob-t--ink',
    colClass: 'ob-col--ink',
    gradient: 'linear-gradient(135deg, #3d4a6c, #263150)',
    ink: '#eef2fb',
    glow: 'rgba(0, 0, 0, 0.65)',
    accent: '#9aa6c2',
  },
};

export function getTavolaTheme(stageIndex: number, stage?: { type?: 'open' | 'won' | 'lost'; key?: string } | null): TavolaTheme {
  if (stage?.type === 'won' || stage?.type === 'lost') {
    return TAVOLA_THEMES.ink;
  }
  const tones: TavolaTone[] = ['amber', 'ember', 'mint', 'ink'];
  const idx = stageIndex >= 0 ? stageIndex : 0;
  const tone = tones[idx % tones.length] ?? 'amber';
  return TAVOLA_THEMES[tone];
}

/** CSS colour for a stage: its own colour when set, else the soft tone's foreground. */
export function stageColorVar(stage: { color?: string | null }, tone: ChipTone): string {
  if (stage.color && /^#[0-9a-f]{3,8}$/i.test(stage.color)) return stage.color;
  return tone === 'neutral' ? 'var(--muted-strong)' : `var(--status-${tone}-fg)`;
}
