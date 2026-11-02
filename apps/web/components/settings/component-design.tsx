'use client';

import { Check, Lock } from 'lucide-react';
import { RadioGroup } from 'radix-ui';
import { useState, type FormEvent } from 'react';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { COMPONENT_STYLE_LABEL, COMPONENT_STYLES, useComponentStyleSetting, type ComponentStyle } from '@/lib/branding';
import { cn } from '@/lib/cn';
import { SaveBar, SettingsCard } from './settings-card';

export const COMPONENT_STYLE_HINT: Record<ComponentStyle, string> = {
  standard: 'The current Vistar components: rounded pills, soft cards, roomy tables.',
  premium: 'Enterprise look: crisp hairlines, layered shadows, denser tables with small-caps headers, breadcrumbs and a prominent search.',
};

/**
 * Miniature of a screen in each design, drawn with explicit classes (not the live design rules) so
 * both thumbnails stay true whichever design is active. Uses the current theme and brand colours.
 */
export function ComponentDesignPreview({ variant }: { variant: ComponentStyle }) {
  const p = variant === 'premium';
  return (
    <span aria-hidden className={cn('relative flex h-28 w-full overflow-hidden border border-border bg-bg text-left', p ? 'rounded-[6px]' : 'rounded-md')}>
      {/* sidebar */}
      <span className={cn('flex w-[26%] shrink-0 flex-col gap-1 border-r border-border p-1.5', p ? 'bg-surface-2' : 'bg-surface')}>
        <span className="mb-1 flex items-center gap-1">
          <span className={cn('size-2.5 bg-accent', p ? 'rounded-[2px]' : 'rounded-xs')} />
          <span className="h-1 w-8 rounded-full bg-fg/70" />
        </span>
        {p && <span className="h-0.5 w-5 rounded-full bg-muted-strong/60" />}
        <span className={cn('relative h-2.5 bg-accent-soft', p ? 'rounded-[2px]' : 'rounded-xs')}>
          {p && <span className="absolute top-0.5 bottom-0.5 -left-1.5 w-0.5 rounded-r bg-accent" />}
        </span>
        <span className="h-1 w-10 rounded-full bg-fg-secondary/40" />
        <span className="h-1 w-8 rounded-full bg-fg-secondary/40" />
        {p && <span className="mt-1 h-0.5 w-5 rounded-full bg-muted-strong/60" />}
        <span className="h-1 w-9 rounded-full bg-fg-secondary/40" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        {/* top bar */}
        <span className="flex h-4 shrink-0 items-center gap-1 border-b border-border bg-surface px-1.5">
          {p ? (
            <>
              <span className="h-1 w-4 rounded-full bg-muted-strong/60" />
              <span className="h-1 w-1 rounded-full bg-muted-strong/60" />
              <span className="h-1 w-6 rounded-full bg-fg/70" />
              <span className="ml-auto h-2.5 w-[42%] rounded-[3px] border border-input bg-surface shadow-card" />
            </>
          ) : (
            <span className="h-2.5 w-[46%] rounded-xs border border-input bg-surface-2" />
          )}
        </span>
        <span className="flex min-h-0 flex-1 flex-col gap-1 p-1.5">
          <span className={cn('flex items-center justify-between', p && 'border-b border-border pb-1')}>
            <span className={cn('rounded-full bg-fg', p ? 'h-1.5 w-12' : 'h-1.5 w-10')} />
            <span
              className={cn(
                'h-2.5 w-7 bg-accent',
                p ? 'rounded-[3px] shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_0_1px_rgba(0,0,0,0.18)]' : 'rounded-xs',
              )}
            />
          </span>
          {/* table */}
          <span className={cn('flex flex-1 flex-col overflow-hidden border border-border bg-surface', p ? 'rounded-[4px] shadow-card' : 'rounded-sm shadow-card')}>
            <span className={cn('flex h-2.5 items-center gap-2 border-b border-border px-1', p ? 'bg-surface-2' : 'bg-surface')}>
              {[8, 6, 5].map((w, i) => (
                <span key={i} className={cn('rounded-full', p ? 'h-0.5 bg-muted-strong' : 'h-1 bg-muted/60')} style={{ width: w * 2 }} />
              ))}
            </span>
            {[0, 1, 2].map((r) => (
              <span key={r} className={cn('flex items-center gap-2 border-b border-border px-1 last:border-b-0', p ? 'h-2.5' : 'h-3', p && r % 2 === 1 && 'bg-fg/[0.03]')}>
                <span className="h-1 w-6 rounded-full bg-fg/60" />
                <span className={cn('h-1.5 w-5 border border-status-green-border bg-status-green-bg', p ? 'rounded-[2px]' : 'rounded-full')} />
                <span className="ml-auto h-1 w-3 rounded-full bg-fg-secondary/50" />
              </span>
            ))}
          </span>
        </span>
      </span>
    </span>
  );
}

export function ComponentDesignRadio({
  value,
  onValueChange,
  disabled,
  label,
}: {
  value: ComponentStyle;
  onValueChange: (v: ComponentStyle) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <RadioGroup.Root value={value} onValueChange={(v) => onValueChange(v as ComponentStyle)} aria-label={label} disabled={disabled} className="grid gap-3 sm:grid-cols-2">
      {COMPONENT_STYLES.map((s) => (
        <RadioGroup.Item
          key={s}
          value={s}
          className={cn(
            'focus-ring group flex flex-col items-stretch gap-2.5 rounded-md border border-border bg-surface p-3 text-left',
            'transition-[border-color,background-color] duration-150 ease-standard hover:border-border-strong hover:bg-surface-2',
            'data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          <ComponentDesignPreview variant={s} />
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg group-data-[state=checked]:text-accent-soft-fg">{COMPONENT_STYLE_LABEL[s]}</span>
              <span className="block text-xs text-muted group-data-[state=checked]:text-muted-strong">{COMPONENT_STYLE_HINT[s]}</span>
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
 * Settings > Component design (D-059): Standard or Premium for the whole company. Company admins only;
 * everyone else sees the choice read-only. Saving applies it at once for everyone on their next screen.
 */
export function ComponentDesignForm() {
  const { value, setValue, canChange } = useComponentStyleSetting();
  const { reason } = useReadOnly();
  const [draft, setDraft] = useState<ComponentStyle>(value);
  const [seen, setSeen] = useState<ComponentStyle>(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const [saving, setSaving] = useState(false);
  const blocked = reason ?? (canChange ? null : 'Only company admins can change the component design.');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await setValue(draft);
      toast.success(`${COMPONENT_STYLE_LABEL[draft]} components are now used across the company`);
    } catch {
      toast.error('Design not saved. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsCard
        title="Component design"
        description="How buttons, tables, cards, menus and navigation look for everyone in the company. People keep their own theme and interface style."
        footer={<SaveBar dirty={draft !== value} saving={saving} readOnlyReason={blocked} onDiscard={() => setDraft(value)} label="Apply to company" />}
      >
        <ComponentDesignRadio label="Component design" value={draft} onValueChange={setDraft} disabled={!!blocked} />
        <p className="mt-3 flex items-start gap-2 text-xs text-muted-strong">
          <Lock aria-hidden className="mt-px size-3.5 shrink-0" />
          Employees and managers cannot change this. Both designs work with Classic, Depth and Neon Space and with light and dark themes.
        </p>
      </SettingsCard>
    </form>
  );
}
