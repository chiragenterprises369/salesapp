'use client';

import { MANUAL_PRESENCE_STATUSES, type ManualPresenceStatus } from '@vistar/shared';
import { Command } from 'cmdk';
import { CircleDot, CornerDownLeft, Expand, Info, Keyboard, Pause, Play, Search, Shrink, UserRound, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useSessionActions } from '@/lib/session/session';
import { PRESENCE_LABEL, statusView, type LiveFloorEmployee, type LiveState } from './live-presence';
import type { ModuleDef } from './modules';
import type { ModuleId } from './store';

const itemClass = 'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm text-fg data-[selected=true]:bg-surface-3 [&_svg]:size-4 [&_svg]:text-fg-secondary';
const groupClass = '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-strong';

/**
 * Floor command bar ("/"): find a person and show them on the floor, open a module panel, full screen,
 * pause updates, set your own status. The shell's Ctrl+K search stays the way to jump to other pages.
 */
export function CommandBar({
  open,
  onOpenChange,
  people,
  live,
  modules,
  openModules,
  fullscreen,
  paused,
  onPerson,
  onModule,
  onCloseModules,
  onFullscreen,
  onPause,
  onHelp,
  onStatusNote,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: readonly LiveFloorEmployee[];
  live: LiveState;
  modules: readonly ModuleDef[];
  openModules: readonly ModuleId[];
  fullscreen: boolean;
  paused: boolean;
  onPerson: (id: string) => void;
  onModule: (m: ModuleId) => void;
  onCloseModules: () => void;
  onFullscreen: () => void;
  onPause: (paused: boolean) => void;
  onHelp: () => void;
  onStatusNote: () => void;
}) {
  const { setStatus } = useSessionActions();
  const run = (fn: () => void) => {
    onOpenChange(false);
    // Let the dialog close (focus returns) before the action moves focus elsewhere.
    requestAnimationFrame(fn);
  };
  const changeStatus = (s: ManualPresenceStatus) =>
    run(() => {
      setStatus(s)
        .then(() => toast.success(`Your status: ${PRESENCE_LABEL[s]}`))
        .catch(() => toast.error('Your status did not change. Check your connection, then try again.'));
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" hideClose className="top-[15%] translate-y-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Floor commands</DialogTitle>
        <DialogDescription className="sr-only">Type to find a person or an action. Use the arrow keys and Enter to choose.</DialogDescription>
        <Command label="Floor commands" loop className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search aria-hidden className="size-4 text-muted" />
            <Command.Input autoFocus placeholder="Find a person, open a panel, change your status" className="h-11 w-full bg-transparent text-sm text-fg outline-none placeholder:text-muted" />
          </div>
          <Command.List className="max-h-96 overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted">Nothing matches. Try a first name or a panel name.</Command.Empty>
            {people.length > 0 && (
              <Command.Group heading="People on the floor" className={groupClass}>
                {people.map((p) => {
                  const lp = live.people[p.id];
                  const s = statusView(lp, p.status);
                  const where = lp?.zone?.zoneName ?? null;
                  return (
                    <Command.Item key={p.id} value={`person ${p.name} ${s.label} ${where ?? ''}`} onSelect={() => run(() => onPerson(p.id))} className={itemClass}>
                      <UserRound aria-hidden />
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="text-xs text-muted-strong">{[s.label, where].filter(Boolean).join(' · ')}</span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}
            <Command.Group heading="Panels" className={groupClass}>
              {modules.map((m) => {
                const Icon = m.icon;
                return (
                  <Command.Item key={m.id} value={`open ${m.label} panel`} onSelect={() => run(() => onModule(m.id))} className={itemClass}>
                    <Icon aria-hidden />
                    <span className="flex-1">
                      {openModules.includes(m.id) ? 'Show' : 'Open'} {m.label}
                    </span>
                    <kbd className="rounded border border-border px-1.5 text-2xs text-muted-strong">{m.key}</kbd>
                  </Command.Item>
                );
              })}
              {openModules.length > 0 && (
                <Command.Item value="close all panels" onSelect={() => run(onCloseModules)} className={itemClass}>
                  <X aria-hidden />
                  <span className="flex-1">Close all panels</span>
                </Command.Item>
              )}
            </Command.Group>
            <Command.Group heading="Floor" className={groupClass}>
              <Command.Item value="full screen fullscreen" onSelect={() => run(onFullscreen)} className={itemClass}>
                {fullscreen ? <Shrink aria-hidden /> : <Expand aria-hidden />}
                <span className="flex-1">{fullscreen ? 'Exit full screen' : 'Full screen'}</span>
                <kbd className="rounded border border-border px-1.5 text-2xs text-muted-strong">F</kbd>
              </Command.Item>
              <Command.Item value="pause resume live updates" onSelect={() => run(() => onPause(!paused))} className={itemClass}>
                {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
                <span className="flex-1">{paused ? 'Resume live updates' : 'Pause live updates'}</span>
              </Command.Item>
              <Command.Item value="how status works accuracy" onSelect={() => run(onStatusNote)} className={itemClass}>
                <Info aria-hidden />
                <span className="flex-1">How live status works</span>
              </Command.Item>
              <Command.Item value="keyboard shortcuts help" onSelect={() => run(onHelp)} className={itemClass}>
                <Keyboard aria-hidden />
                <span className="flex-1">Keyboard shortcuts</span>
                <kbd className="rounded border border-border px-1.5 text-2xs text-muted-strong">?</kbd>
              </Command.Item>
            </Command.Group>
            <Command.Group heading="My status" className={groupClass}>
              {MANUAL_PRESENCE_STATUSES.map((s) => (
                <Command.Item key={s} value={`set my status ${PRESENCE_LABEL[s]}`} onSelect={() => changeStatus(s)} className={itemClass}>
                  <CircleDot aria-hidden />
                  <span className="flex-1">Set my status: {PRESENCE_LABEL[s]}</span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
          <div className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-xs text-muted-strong">
            <CornerDownLeft aria-hidden className="size-3.5" /> to choose, Esc to close
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

const SHORTCUTS: ReadonlyArray<[string, string]> = [
  ['F', 'Full screen on or off'],
  ['Esc', 'Close the panel you are in; leave full screen'],
  ['/', 'Floor commands: find a person, open a panel'],
  ['1 to 5', 'Open or show a panel (see the buttons)'],
  ['?', 'This list'],
  ['Ctrl K', 'Search and jump to another page (leaves the floor)'],
  ['Left / Right on the panel edge', 'Make the panel wider or narrower'],
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <div className="px-5 pt-5">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription className="mt-1">They work anywhere on the floor except while you type in a field.</DialogDescription>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-5 pt-3 pb-5 text-sm">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs text-fg">{k}</kbd>
              </dt>
              <dd className="text-fg-secondary">{v}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
