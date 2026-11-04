'use client';

import type { BoardSkin, LeadsViewMode, ThemeMode } from '@vistar/shared';
import { Check, Columns3, Layers, Sparkles, Square, Table2 } from 'lucide-react';
import { RadioGroup } from 'radix-ui';
import { useState, type FormEvent } from 'react';
import { ThemeModeRadio } from '@/components/common/theme-mode-picker';
import { toast } from '@/components/ui/toast';
import { BOARD_SKIN_HINT, BOARD_SKIN_LABEL } from '@/features/pipeline/skins/skin-model';
import { cn } from '@/lib/cn';
import { useReadOnly } from '@/lib/auth/use-auth';
import { useMe, useSessionActions } from '@/lib/session/session';
import { INTERFACE_STYLES, useInterfaceSettings, type InterfaceStyle } from '@/lib/theme';
import { InterfaceStyleRadio } from './interface-preferences';
import { SaveBar, SettingsCard } from './settings-card';

type ViewChoice = LeadsViewMode | 'none';

const VIEW_OPTIONS: ReadonlyArray<{ value: ViewChoice; label: string; hint: string; icon?: typeof Columns3 }> = [
  { value: 'board', label: 'Board', hint: 'Columns per stage, drag cards to move', icon: Columns3 },
  { value: 'table', label: 'Table', hint: 'Dense rows with sorting and bulk edits', icon: Table2 },
  { value: 'none', label: 'No default', hint: 'Board until each person picks a view' },
];

/** Leads Board skins (SPEC 28.1); labels and hints come from the board feature. */
const SKIN_OPTIONS: ReadonlyArray<{ value: BoardSkin; icon: typeof Columns3 }> = [
  { value: 'flat', icon: Square },
  { value: 'depth', icon: Layers },
  { value: 'neon', icon: Sparkles },
];

const RADIO_CARD = cn(
  'focus-ring group flex min-h-11 flex-col items-start gap-1 rounded-md border border-border bg-surface p-3 text-left',
  'transition-[border-color,background-color] duration-150 ease-standard hover:border-border-strong hover:bg-surface-2',
  'data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60',
);

/**
 * Workspace defaults for people who have not chosen for themselves: theme (`defaultTheme`), interface
 * style (`ui.defaultInterfaceStyle`, D-052, adapter until the contract lands), the Leads board skin
 * (`defaultBoardSkin`, setting key leads.defaultBoardSkin) and the Leads page view
 * (`defaultLeadsViewMode`, setting key leads.defaultViewMode). PATCH /workspace.
 */
export function ThemeDefaultsForm() {
  const me = useMe()!;
  const { updateWorkspace } = useSessionActions();
  const { defaultInterfaceStyle, setDefaultInterfaceStyle } = useInterfaceSettings();
  const { reason } = useReadOnly();
  const savedTheme = me.workspace.defaultTheme;
  const savedView: ViewChoice = me.workspace.defaultLeadsViewMode ?? 'none';
  const savedSkin: BoardSkin = me.workspace.defaultBoardSkin;
  const [theme, setTheme] = useState<ThemeMode>(savedTheme);
  const [style, setStyle] = useState<InterfaceStyle>(defaultInterfaceStyle);
  // The stored default can arrive after the first render (adapter load) or change in another tab.
  const [seenStyle, setSeenStyle] = useState<InterfaceStyle>(defaultInterfaceStyle);
  if (seenStyle !== defaultInterfaceStyle) {
    setSeenStyle(defaultInterfaceStyle);
    setStyle(defaultInterfaceStyle);
  }
  const [view, setView] = useState<ViewChoice>(savedView);
  const [skin, setSkin] = useState<BoardSkin>(savedSkin);
  const [saving, setSaving] = useState(false);
  const dirty = theme !== savedTheme || view !== savedView || style !== defaultInterfaceStyle || skin !== savedSkin;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (theme !== savedTheme || view !== savedView || skin !== savedSkin) {
        await updateWorkspace({ defaultTheme: theme, defaultLeadsViewMode: view === 'none' ? null : view, defaultBoardSkin: skin });
      }
      if (style !== defaultInterfaceStyle) setDefaultInterfaceStyle(style);
      toast.success('Workspace defaults saved');
    } catch {
      toast.error('Defaults not saved. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid items-start gap-4 2xl:grid-cols-2">
      <SettingsCard title="Theme" description="New members start with this theme. People who already picked a theme keep their choice.">
        <ThemeModeRadio variant="cards" label="Default theme" value={theme} onValueChange={setTheme} disabled={!!reason} />
        {theme === 'scheduled' && (
          <p className="mt-3 text-xs text-muted">Scheduled starts dark at 7:00 pm and light at 7:00 am in {me.workspace.timezone}. Each person can change the hours.</p>
        )}
      </SettingsCard>
      <SettingsCard
        title="Interface style"
        description="Used by everyone who has not picked a style. Phones, touch screens, older devices and reduced motion always use Classic; the employee app shows Neon Space as Depth."
      >
        <InterfaceStyleRadio
          label="Default interface style"
          value={style}
          styles={INTERFACE_STYLES}
          onValueChange={(v) => v !== 'default' && setStyle(v)}
          disabled={!!reason}
        />
      </SettingsCard>
      <SettingsCard
        title="Leads board skin"
        description="Used by everyone who has not picked a board skin. Phones, touch screens, older devices and reduced motion show Neon Space as Flat."
      >
        <RadioGroup.Root
          value={skin}
          onValueChange={(v) => setSkin(v as BoardSkin)}
          aria-label="Default board skin"
          disabled={!!reason}
          className="grid gap-2 sm:grid-cols-3"
        >
          {SKIN_OPTIONS.map(({ value, icon: Icon }) => (
            <RadioGroup.Item key={value} value={value} className={RADIO_CARD}>
              <span className="flex w-full items-center justify-between gap-2">
                <Icon aria-hidden className="size-4 text-fg-secondary group-data-[state=checked]:text-accent-soft-fg" />
                <RadioGroup.Indicator>
                  <Check aria-hidden className="size-4 text-accent-soft-fg" />
                </RadioGroup.Indicator>
              </span>
              <span className="text-sm font-medium text-fg group-data-[state=checked]:text-accent-soft-fg">{BOARD_SKIN_LABEL[value]}</span>
              <span className="text-xs text-muted group-data-[state=checked]:text-muted-strong">{BOARD_SKIN_HINT[value]}</span>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      </SettingsCard>
      <SettingsCard
        title="Leads page view"
        description="The view people see the first time they open Leads. Anyone can switch, and Tootodo remembers their choice."
        footer={
          <SaveBar
            dirty={dirty}
            saving={saving}
            readOnlyReason={reason}
            onDiscard={() => {
              setTheme(savedTheme);
              setView(savedView);
              setStyle(defaultInterfaceStyle);
              setSkin(savedSkin);
            }}
          />
        }
      >
        <RadioGroup.Root
          value={view}
          onValueChange={(v) => setView(v as ViewChoice)}
          aria-label="Default Leads view"
          disabled={!!reason}
          className="grid gap-2 sm:grid-cols-3"
        >
          {VIEW_OPTIONS.map(({ value, label, hint, icon: Icon }) => (
            <RadioGroup.Item
              key={value}
              value={value}
              className={cn(
                'focus-ring group flex min-h-11 flex-col items-start gap-1 rounded-md border border-border bg-surface p-3 text-left',
                'transition-[border-color,background-color] duration-150 ease-standard hover:border-border-strong hover:bg-surface-2',
                'data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              <span className="flex w-full items-center justify-between gap-2">
                {Icon ? <Icon aria-hidden className="size-4 text-fg-secondary group-data-[state=checked]:text-accent-soft-fg" /> : <span className="size-4" />}
                <RadioGroup.Indicator>
                  <Check aria-hidden className="size-4 text-accent-soft-fg" />
                </RadioGroup.Indicator>
              </span>
              <span className="text-sm font-medium text-fg group-data-[state=checked]:text-accent-soft-fg">{label}</span>
              <span className="text-xs text-muted group-data-[state=checked]:text-muted-strong">{hint}</span>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      </SettingsCard>
    </form>
  );
}
