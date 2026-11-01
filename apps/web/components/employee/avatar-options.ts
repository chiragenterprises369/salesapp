import type { AvatarConfig } from '@vistar/shared';
import { EMPLOYEE_FIXTURES } from '@vistar/shared/fixtures';

/**
 * Avatar customisation choices. These hex values are avatar DATA (AvatarConfigSchema, rendered by the
 * Team Floor), not UI colours, so they are taken from the seed avatars rather than design tokens.
 */
const unique = (pick: (a: AvatarConfig) => string) => [...new Set(EMPLOYEE_FIXTURES.map((e) => pick(e.avatar)))];

const SKIN_NAMES: Record<string, string> = { '#F1C27D': 'Light', '#E0AC69': 'Medium light', '#C68642': 'Medium', '#8D5524': 'Deep' };
const HAIR_NAMES: Record<string, string> = { '#111111': 'Black', '#0F0B08': 'Soft black', '#1F1A17': 'Dark brown', '#2B1D14': 'Brown', '#3B2A1E': 'Light brown' };
const OUTFIT_NAMES: Record<string, string> = {
  '#334155': 'Slate',
  '#4F46E5': 'Indigo',
  '#0EA5E9': 'Sky',
  '#10B981': 'Emerald',
  '#F59E0B': 'Amber',
  '#E11D48': 'Rose',
  '#64748B': 'Grey',
  '#7C3AED': 'Violet',
  '#0F766E': 'Teal',
  '#DB2777': 'Pink',
  '#2563EB': 'Blue',
  '#475569': 'Charcoal',
};

const named = (values: string[], names: Record<string, string>) => values.map((value, i) => ({ value, label: names[value] ?? `Option ${i + 1}` }));

export const SKIN_TONES = named(
  unique((a) => a.skinTone).sort((a, b) => Object.keys(SKIN_NAMES).indexOf(a) - Object.keys(SKIN_NAMES).indexOf(b)),
  SKIN_NAMES,
);
export const HAIR_COLORS = named(unique((a) => a.hairColor), HAIR_NAMES);
export const OUTFIT_COLORS = named(unique((a) => a.outfitColor), OUTFIT_NAMES);
export const HAIR_STYLES: ReadonlyArray<{ value: AvatarConfig['hairStyle']; label: string }> = [
  { value: 'short', label: 'Short' },
  { value: 'long', label: 'Long' },
  { value: 'bun', label: 'Bun' },
  { value: 'curly', label: 'Curly' },
  { value: 'bald', label: 'None' },
];

export const DEFAULT_AVATAR: AvatarConfig = EMPLOYEE_FIXTURES[0]!.avatar;
