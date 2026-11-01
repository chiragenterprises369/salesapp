'use client';

import type { AvatarConfig } from '@vistar/shared';
import { Check } from 'lucide-react';
import { RadioGroup } from 'radix-ui';
import { useId } from 'react';
import { cn } from '@/lib/cn';
import { HAIR_COLORS, HAIR_STYLES, OUTFIT_COLORS, SKIN_TONES } from './avatar-options';

/** Live preview of the Team Floor avatar. Colours come from the avatar config (data), not the theme. */
export function AvatarPreview({ avatar, className }: { avatar: AvatarConfig; className?: string }) {
  const { skinTone, hairColor, hairStyle, outfitColor } = avatar;
  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={`Avatar preview: ${HAIR_STYLES.find((h) => h.value === hairStyle)?.label.toLowerCase()} hair`} className={cn('size-32', className)}>
      <circle cx="60" cy="60" r="58" className="fill-surface-3" />
      {hairStyle === 'long' && <path d="M35 50C35 28 47 21 60 21s25 7 25 29l2 34c-6 3-11 1-13-3V47c-4-6-8-8-14-8s-10 2-14 8v34c-2 4-7 6-13 3Z" fill={hairColor} />}
      <path d="M18 120c0-27 18-40 42-40s42 13 42 40Z" fill={outfitColor} />
      <rect x="52" y="64" width="16" height="20" rx="5" fill={skinTone} />
      <circle cx="60" cy="50" r="22" fill={skinTone} />
      {(hairStyle === 'short' || hairStyle === 'bun' || hairStyle === 'long') && (
        <path d="M37 49c0-19 10-26 23-26s23 7 23 26c-4-8-12-12-23-12s-19 4-23 12Z" fill={hairColor} />
      )}
      {hairStyle === 'bun' && <circle cx="60" cy="21" r="9" fill={hairColor} />}
      {hairStyle === 'curly' &&
        [
          [40, 42, 8],
          [47, 32, 9],
          [58, 27, 9],
          [70, 29, 9],
          [79, 39, 8],
        ].map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill={hairColor} />)}
      <circle cx="52" cy="52" r="2.2" fill={hairColor} />
      <circle cx="68" cy="52" r="2.2" fill={hairColor} />
      <path d="M53 60c4 4 10 4 14 0" fill="none" stroke={hairColor} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SwatchGroup({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-fg-secondary" id={id}>
        {label}
      </span>
      <RadioGroup.Root value={value} onValueChange={onChange} aria-labelledby={id} disabled={disabled} className="flex flex-wrap gap-2" loop>
        {options.map((o) => (
          <RadioGroup.Item
            key={o.value}
            value={o.value}
            aria-label={o.label}
            title={o.label}
            className="focus-ring relative flex size-11 items-center justify-center rounded-full border border-border data-[state=checked]:border-2 data-[state=checked]:border-accent disabled:opacity-60"
          >
            <span aria-hidden className="size-8 rounded-full border border-border" style={{ backgroundColor: o.value }} />
            <RadioGroup.Indicator className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-accent text-accent-fg">
              <Check aria-hidden className="size-3" />
            </RadioGroup.Indicator>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}

/** Avatar pickers (AvatarConfigSchema): skin tone, hair colour, hair style, outfit colour, with live preview. */
export function AvatarEditor({ value, onChange, disabled }: { value: AvatarConfig; onChange: (next: AvatarConfig) => void; disabled?: boolean }) {
  const set = (patch: Partial<AvatarConfig>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <div className="flex shrink-0 flex-col items-center gap-2 self-center sm:self-start">
        <AvatarPreview avatar={value} />
        <span className="text-xs text-muted">How you appear on the Team Floor</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <SwatchGroup label="Skin tone" options={SKIN_TONES} value={value.skinTone} onChange={(skinTone) => set({ skinTone })} disabled={disabled} />
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-fg-secondary" id="hair-style-label">
            Hair style
          </span>
          <RadioGroup.Root
            value={value.hairStyle}
            onValueChange={(v) => set({ hairStyle: v as AvatarConfig['hairStyle'] })}
            aria-labelledby="hair-style-label"
            disabled={disabled}
            className="flex flex-wrap gap-2"
            loop
          >
            {HAIR_STYLES.map((h) => (
              <RadioGroup.Item
                key={h.value}
                value={h.value}
                className={cn(
                  'focus-ring inline-flex h-11 min-w-16 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm text-fg-secondary',
                  'hover:bg-surface-2 data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft data-[state=checked]:font-medium data-[state=checked]:text-accent-soft-fg',
                )}
              >
                {h.label}
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>
        </div>
        <SwatchGroup label="Hair colour" options={HAIR_COLORS} value={value.hairColor} onChange={(hairColor) => set({ hairColor })} disabled={disabled} />
        <SwatchGroup label="Outfit colour" options={OUTFIT_COLORS} value={value.outfitColor} onChange={(outfitColor) => set({ outfitColor })} disabled={disabled} />
      </div>
    </div>
  );
}
