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

/** CSS colour for a stage: its own colour when set, else the soft tone's foreground. */
export function stageColorVar(stage: { color?: string | null }, tone: ChipTone): string {
  if (stage.color && /^#[0-9a-f]{3,8}$/i.test(stage.color)) return stage.color;
  return tone === 'neutral' ? 'var(--muted-strong)' : `var(--status-${tone}-fg)`;
}
