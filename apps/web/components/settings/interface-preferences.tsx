'use client';

import { Check, Info } from 'lucide-react';
import { RadioGroup } from 'radix-ui';
import { cn } from '@/lib/cn';
import {
  INTERFACE_STYLE_LABEL,
  stylesForPanel,
  useInterface,
  type InterfaceStyle,
  type MotionIntensity,
} from '@/lib/theme';
import { useDocumentTheme } from '@/lib/use-document-theme';
import { SettingsCard } from './settings-card';

export const INTERFACE_STYLE_HINT: Record<InterfaceStyle, string> = {
  classic: 'Plain panels, the standard look',
  depth: 'Glass panels over a soft space background',
  neon: 'Dark space with glowing edges; pastel Aurora in the light theme',
};

const MOTION_OPTIONS: ReadonlyArray<{ value: MotionIntensity; label: string; hint: string }> = [
  { value: 'full', label: 'Full', hint: 'Page glides, parallax and moving backgrounds' },
  { value: 'reduced', label: 'Reduced', hint: 'Fades only; backgrounds stay still' },
  { value: 'off', label: 'Off', hint: 'No animation; changes happen instantly' },
];

/** Thumbnail of a style in the current theme. The tokens resolve from the attributes on the thumbnail. */
function StylePreview({ style }: { style: InterfaceStyle }) {
  const theme = useDocumentTheme();
  const glass = style !== 'classic';
  return (
    <span
      aria-hidden
      data-interface-style={style}
      data-theme={theme}
      className={cn('relative block h-14 w-full overflow-hidden rounded-md border border-border', glass ? 'vs-preview' : 'bg-bg')}
    >
      <span className={cn('absolute top-0 bottom-0 left-0 w-1/5 border-r', glass ? 'border-glass-border bg-glass' : 'border-border bg-surface')}>
        <span className={cn('absolute top-2.5 right-1.5 left-1.5 h-1.5 rounded-xs bg-accent-soft', style === 'neon' && 'edge-glow')} />
      </span>
      <span className={cn('absolute top-2 right-2 left-[28%] h-4 rounded-sm border', glass ? 'glass-panel' : 'border-border bg-surface shadow-card')} />
      <span className={cn('absolute right-[38%] bottom-2 left-[28%] h-4 rounded-sm border', glass ? 'glass-panel' : 'border-border bg-surface shadow-card')} />
    </span>
  );
}

interface InterfaceStyleRadioProps {
  /** A style, or 'default' to follow the workspace default (only when `defaultStyle` is given). */
  value: InterfaceStyle | 'default' | null;
  onValueChange: (value: InterfaceStyle | 'default') => void;
  styles: readonly InterfaceStyle[];
  /** Adds a "Workspace default" option that shows this style. */
  defaultStyle?: InterfaceStyle;
  label: string;
  disabled?: boolean;
}

/** Radio cards with a thumbnail per style. Arrow keys move and select (Radix RadioGroup). */
export function InterfaceStyleRadio({ value, onValueChange, styles, defaultStyle, label, disabled }: InterfaceStyleRadioProps) {
  const options: Array<{ value: InterfaceStyle | 'default'; label: string; hint: string; preview: InterfaceStyle }> = [
    ...(defaultStyle ? [{ value: 'default' as const, label: 'Workspace default', hint: `Currently ${INTERFACE_STYLE_LABEL[defaultStyle]}`, preview: defaultStyle }] : []),
    ...styles.map((s) => ({ value: s, label: INTERFACE_STYLE_LABEL[s], hint: INTERFACE_STYLE_HINT[s], preview: s })),
  ];
  return (
    <RadioGroup.Root
      value={value ?? ''}
      onValueChange={(v) => onValueChange(v as InterfaceStyle | 'default')}
      aria-label={label}
      disabled={disabled}
      className={cn('grid gap-2', options.length >= 4 ? 'grid-cols-2 lg:grid-cols-4' : options.length === 3 ? 'sm:grid-cols-3' : 'grid-cols-2')}
    >
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          className={cn(
            'focus-ring group flex min-h-11 flex-col items-stretch gap-2 rounded-md border border-border bg-surface p-2.5 text-left',
            'transition-[border-color,background-color] duration-150 ease-standard hover:border-border-strong hover:bg-surface-2',
            'data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          <StylePreview style={o.preview} />
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg group-data-[state=checked]:text-accent-soft-fg">{o.label}</span>
              <span className="block text-xs text-muted group-data-[state=checked]:text-muted-strong">{o.hint}</span>
            </span>
            <RadioGroup.Indicator className="mt-0.5 shrink-0">
              <Check aria-hidden className="size-4 text-accent-soft-fg" />
            </RadioGroup.Indicator>
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

/**
 * "Interface style" (Classic, Depth, Neon Space; Employee panel: Classic or Depth) and "Motion
 * intensity" (Full, Reduced, Off), applied instantly. Says when the device overrides the choice.
 */
export function InterfacePreferences({ touch = false }: { touch?: boolean }) {
  const { interfaceStyle, motionIntensity, defaultInterfaceStyle, setInterfaceStyle, setMotionIntensity, panel, override } = useInterface();
  const styles = stylesForPanel(panel);
  const shownDefault = styles.includes(defaultInterfaceStyle) ? defaultInterfaceStyle : 'depth';

  return (
    <SettingsCard
      title="Interface style and motion"
      description="How panels, backgrounds and page changes look. Phones, touch screens, older devices and reduced motion use Classic."
    >
      <div className="flex flex-col gap-5">
        <div>
          <p className="mb-2 text-xs font-medium text-fg-secondary">Interface style</p>
          <InterfaceStyleRadio
            label="Interface style"
            value={interfaceStyle ?? 'default'}
            styles={styles}
            defaultStyle={shownDefault}
            onValueChange={(v) => setInterfaceStyle(v === 'default' ? null : v)}
          />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-fg-secondary">Motion intensity</p>
          <RadioGroup.Root
            value={motionIntensity}
            onValueChange={(v) => setMotionIntensity(v as MotionIntensity)}
            aria-label="Motion intensity"
            className="grid gap-2 sm:grid-cols-3"
          >
            {MOTION_OPTIONS.map((m) => (
              <RadioGroup.Item
                key={m.value}
                value={m.value}
                className={cn(
                  'focus-ring group flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left',
                  touch ? 'min-h-12' : 'min-h-11',
                  'hover:bg-surface-2 data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft',
                )}
              >
                <span aria-hidden className="flex size-4 shrink-0 items-center justify-center rounded-full border border-input group-data-[state=checked]:border-accent">
                  <RadioGroup.Indicator className="size-2 rounded-full bg-accent" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-fg group-data-[state=checked]:text-accent-soft-fg">{m.label}</span>
                  <span className="block text-xs text-muted group-data-[state=checked]:text-muted-strong">{m.hint}</span>
                </span>
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>
        </div>
        <p role="status" className={cn('flex items-start gap-2 text-xs text-muted-strong', !override && 'sr-only')}>
          {override && <Info aria-hidden className="mt-px size-3.5 shrink-0" />}
          {override ?? 'Your interface style and motion apply as chosen.'}
        </p>
      </div>
    </SettingsCard>
  );
}
