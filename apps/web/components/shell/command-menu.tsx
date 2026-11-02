'use client';

import type { NavGroup, ThemeMode } from '@vistar/shared';
import { Command } from 'cmdk';
import { CornerDownLeft, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { THEME_MODE_OPTIONS } from '@/components/common/theme-mode-picker';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';
import { NavIcon } from './nav-icon';
import { flattenNav } from './nav-utils';
import { useShellStore } from './shell-store';

const itemClass =
  'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm text-fg data-[selected=true]:bg-surface-3 [&_svg]:text-fg-secondary';

/**
 * Top-bar search: opens with the search field, Ctrl+K or Cmd+K. Wave 1 jumps to pages and changes the
 * theme; searching leads and people plugs in here when the search API ships.
 */
export function CommandMenu({ groups }: { groups: readonly NavGroup[] }) {
  const router = useRouter();
  const open = useShellStore((s) => s.commandOpen);
  const setOpen = useShellStore((s) => s.setCommandOpen);
  const { setPreference } = useTheme();
  const pages = flattenNav(groups);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!useShellStore.getState().commandOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const theme = (mode: ThemeMode) => {
    setOpen(false);
    void setPreference({ mode });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="lg" hideClose className="top-[15%] translate-y-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Search and jump to</DialogTitle>
        <DialogDescription className="sr-only">Type to filter pages and actions. Use the arrow keys and Enter to choose.</DialogDescription>
        <Command label="Search and jump to" loop className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search aria-hidden className="size-4 text-muted" />
            <Command.Input
              autoFocus
              placeholder="Jump to a page or action"
              className="h-11 w-full bg-transparent text-sm text-fg outline-none placeholder:text-muted"
            />
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No pages match. Lead and people search is coming soon.</Command.Empty>
            <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted">
              {pages.map((p) => (
                <Command.Item key={p.id} value={`${p.label} ${p.group ?? ''}`} onSelect={() => go(p.href)} className={itemClass}>
                  <NavIcon name={p.icon} />
                  <span className="flex-1 truncate">{p.label}</span>
                  {p.group && <span className="text-xs text-muted">{p.group}</span>}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Theme" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted">
              {THEME_MODE_OPTIONS.map(({ mode, label, icon: Icon }) => (
                <Command.Item key={mode} value={`Theme ${label}`} onSelect={() => theme(mode)} className={itemClass}>
                  <Icon aria-hidden className="size-4" />
                  <span className="flex-1">Use {label.toLowerCase()} theme</span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
          <div className={cn('flex items-center gap-1.5 border-t border-border px-3 py-2 text-xs text-muted')}>
            <CornerDownLeft aria-hidden className="size-3.5" /> to open, Esc to close
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** Field-shaped trigger in the top bar (icon button on small screens). */
export function SearchTrigger() {
  const setOpen = useShellStore((s) => s.setCommandOpen);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring hidden h-8 w-full max-w-md min-w-0 items-center gap-2 rounded-md border border-input bg-surface-2 px-2.5 text-left text-sm text-muted-strong transition-colors hover:border-fg-secondary sm:flex premium:h-9 premium:max-w-none premium:rounded-lg premium:bg-surface premium:shadow-card"
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="flex-1 truncate">
          Search or jump to<span className="hidden premium:inline"> pages, settings and actions</span>
        </span>
        <kbd className="rounded-xs border border-border bg-surface px-1.5 font-sans text-2xs text-muted premium:bg-surface-2 premium:font-medium premium:text-muted-strong">Ctrl K</kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search or jump to"
        className="focus-ring inline-flex size-8 items-center justify-center rounded-md text-fg-secondary hover:bg-surface-3 sm:hidden"
      >
        <Search aria-hidden className="size-4" />
      </button>
    </>
  );
}
