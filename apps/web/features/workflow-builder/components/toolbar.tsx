'use client';

import {
  CircleAlert,
  Copy,
  FileClock,
  Keyboard,
  LayoutGrid,
  Maximize,
  Play,
  Redo2,
  Save,
  Spline,
  Undo2,
} from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/cn';
import { issueCounts } from '../lib/validation';
import type { Commands } from '../hooks/use-commands';
import { useBuilder, useBuilderApi, useEnv } from '../store/context';

export interface ToolbarProps {
  commands: Commands;
  saving: boolean;
  flat: boolean;
  flatForced: boolean;
  narrow: boolean;
  running: boolean;
  onToggleFlat: () => void;
  onSave: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onTestRun: () => void;
  onDuplicate: () => void;
  onShowHistory: () => void;
  onShowShortcuts: () => void;
}

function Tool({
  label,
  shortcut,
  children,
  ...props
}: { label: string; shortcut?: string; children: ReactNode } & Omit<
  ComponentProps<typeof Button>,
  'children'
>) {
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      {...props}
    >
      {children}
    </Button>
  );
}

export function Toolbar(p: ToolbarProps) {
  const store = useBuilderApi();
  const env = useEnv();
  const name = useBuilder((s) => s.name);
  const status = useBuilder((s) => s.status);
  const canUndo = useBuilder((s) => s.past.length > 0);
  const canRedo = useBuilder((s) => s.future.length > 0);
  const dirty = useBuilder((s) => s.revision !== s.savedRevision);
  const activeVersion = useBuilder((s) => s.activeVersion);
  const { errors } = issueCounts(useBuilder((s) => s.issues));
  const nameId = useId();

  const activateBlocked =
    errors > 0
      ? `Fix ${errors} ${errors === 1 ? 'error' : 'errors'} to activate`
      : !env.canPublish
        ? 'You need publish access to activate'
        : null;
  const statusLabel =
    status === 'active' ? `Active${activeVersion ? ` · v${activeVersion}` : ''}` : 'Draft';

  return (
    <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-surface px-3 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <label htmlFor={nameId} className="sr-only">
          Workflow name
        </label>
        {env.canEdit ? (
          <input
            id={nameId}
            value={name}
            maxLength={100}
            onChange={(e) => store.getState().setName(e.target.value)}
            onBlur={(e) => !e.target.value.trim() && store.getState().setName('Untitled workflow')}
            className="focus-ring h-8 w-56 min-w-0 truncate rounded-md border border-transparent bg-transparent px-2 text-base font-semibold text-fg hover:border-border focus-visible:border-ring"
          />
        ) : (
          <h2 id={nameId} className="truncate px-1 text-base font-semibold text-fg">
            {name}
          </h2>
        )}
        {env.canEdit && !p.narrow ? (
          <StatusSwitch
            status={status}
            blocked={activateBlocked}
            onActivate={p.onActivate}
            onDeactivate={p.onDeactivate}
          />
        ) : (
          <Chip tone={status === 'active' ? 'green' : 'neutral'} dot size="md">
            {statusLabel}
          </Chip>
        )}
        {env.canEdit && !p.narrow && (
          <span className="hidden text-2xs text-muted-strong xl:inline" aria-live="polite">
            {dirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
        )}
        {!env.canEdit && !p.narrow && <Chip tone="neutral">View only</Chip>}
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        {env.canEdit && (
          <>
            <Tool label="Undo" shortcut="Ctrl+Z" onClick={p.commands.undo} disabled={!canUndo}>
              <Undo2 aria-hidden />
            </Tool>
            <Tool
              label="Redo"
              shortcut="Ctrl+Shift+Z"
              onClick={p.commands.redo}
              disabled={!canRedo}
            >
              <Redo2 aria-hidden />
            </Tool>
            <Tool label="Auto-layout" shortcut="Shift+L" onClick={p.commands.autoLayout}>
              <LayoutGrid aria-hidden />
            </Tool>
          </>
        )}
        <Tool
          label={p.flatForced ? 'Flat mode (reduced motion is on)' : 'Flat mode'}
          shortcut={p.flatForced ? undefined : 'Shift+P'}
          aria-pressed={p.flat}
          disabled={p.flatForced}
          onClick={p.onToggleFlat}
          className={cn(p.flat && 'bg-surface-3 text-fg')}
        >
          <Spline aria-hidden />
        </Tool>
        <Tool label="Fit view" shortcut="F" onClick={p.commands.fitView}>
          <Maximize aria-hidden />
        </Tool>
        <Tool label="Keyboard shortcuts" shortcut="?" onClick={p.onShowShortcuts}>
          <Keyboard aria-hidden />
        </Tool>
        {!p.narrow && (
          <>
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />
            <Button size="sm" variant="ghost" onClick={p.onShowHistory}>
              <FileClock aria-hidden />
              Versions
            </Button>
          </>
        )}
        {env.canEdit && (
          <>
            <Button size="sm" variant="ghost" onClick={p.onDuplicate}>
              <Copy aria-hidden />
              Duplicate
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={p.onTestRun}
              disabled={errors > 0 || p.running}
              title={
                errors > 0
                  ? `Fix ${errors} ${errors === 1 ? 'error' : 'errors'} to run a test`
                  : 'Run the draft with a test lead'
              }
            >
              <Play aria-hidden />
              {p.running ? 'Running…' : 'Test run'}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={p.onSave}
              loading={p.saving}
              title="Save (Ctrl+S)"
            >
              <Save aria-hidden />
              Save
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function StatusSwitch({
  status,
  blocked,
  onActivate,
  onDeactivate,
}: {
  status: 'draft' | 'active';
  blocked: string | null;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  const reasonId = useId();
  const name = useId();
  const options = [
    { value: 'draft', label: 'Draft' },
    { value: 'active', label: 'Active' },
  ] as const;
  return (
    <div className="flex items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Workflow status"
        aria-describedby={blocked ? reasonId : undefined}
        className="flex rounded-md border border-input bg-surface-2 p-0.5"
      >
        {options.map((o) => {
          const disabled = o.value === 'active' && status !== 'active' && !!blocked;
          return (
            <label
              key={o.value}
              className={cn('relative', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={status === o.value}
                disabled={disabled}
                onChange={() => (o.value === 'active' ? onActivate() : onDeactivate())}
                className="peer sr-only"
              />
              <span
                className={cn(
                  'flex h-6 items-center gap-1 rounded-sm px-2 text-xs text-fg-secondary transition-colors duration-150 ease-standard peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-ring',
                  'peer-checked:bg-surface peer-checked:font-medium peer-checked:text-fg peer-checked:shadow-card',
                  disabled && 'opacity-50',
                )}
              >
                {o.value === 'active' && (
                  <span
                    aria-hidden
                    className={cn(
                      'size-1.5 rounded-full',
                      status === 'active' ? 'bg-success' : 'bg-border-strong',
                    )}
                  />
                )}
                {o.label}
              </span>
            </label>
          );
        })}
      </div>
      {blocked && status !== 'active' && (
        <span id={reasonId} className="hidden items-center gap-1 text-2xs text-danger-text lg:flex">
          <CircleAlert className="size-3" aria-hidden />
          {blocked}
        </span>
      )}
    </div>
  );
}
