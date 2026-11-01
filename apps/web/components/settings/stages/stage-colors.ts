import { lightPalette, stageTone, type ChipTone, type Stage } from '@vistar/shared';

/**
 * Stage colours are stored as hex (StageSchema.color) but always DISPLAYED through the soft chip
 * tokens, so both themes keep AA contrast. The hex values are the light-theme chip text colours.
 */
export const STAGE_COLORS: ReadonlyArray<{ tone: ChipTone; label: string; hex: string }> = [
  { tone: 'grey', label: 'Grey', hex: lightPalette['status-grey-fg'] },
  { tone: 'blue', label: 'Blue', hex: lightPalette['status-blue-fg'] },
  { tone: 'indigo', label: 'Indigo', hex: lightPalette['status-indigo-fg'] },
  { tone: 'amber', label: 'Amber', hex: lightPalette['status-amber-fg'] },
  { tone: 'green', label: 'Green', hex: lightPalette['status-green-fg'] },
  { tone: 'red', label: 'Red', hex: lightPalette['status-red-fg'] },
];

export function toneOfStage(stage: Pick<Stage, 'key' | 'type' | 'color'>): ChipTone {
  const c = stage.color?.toLowerCase();
  return STAGE_COLORS.find((x) => x.hex.toLowerCase() === c)?.tone ?? stageTone(stage);
}

export const colorLabel = (color: string | null) => STAGE_COLORS.find((x) => x.hex.toLowerCase() === color?.toLowerCase())?.label ?? 'Automatic';

export const STAGE_TYPE_LABELS = { open: 'Open', won: 'Won', lost: 'Lost' } as const;
