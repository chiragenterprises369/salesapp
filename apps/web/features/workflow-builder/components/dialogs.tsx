'use client';

import { LEAD_SOURCES, normalizeIndianPhone, type LeadSource } from '@vistar/shared';
import { formatDistanceToNow } from 'date-fns';
import { RotateCcw } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { SOURCE_LABELS } from '../lib/labels';
import type { TestRunInput } from '../lib/mock-runner';
import type { LocalVersion } from '../store/builder-store';
import { useBuilder, useEnv } from '../store/context';
import { CheckboxField, selectClass } from './inspector/fields';

// ---------------------------------------------------------------------------- test run

const QUICK_REPLIES = [
  { label: 'Asks for price', text: 'Please share price and GST' },
  { label: 'Wants catalogue', text: 'Send catalog and photos' },
  { label: 'Not interested', text: 'Not interested, no need' },
  { label: 'No reply', text: '' },
];

export const DEFAULT_TEST_INPUT: TestRunInput = {
  lead: { name: 'Rakesh Gupta', phone: '+919876543210', source: 'indiamart' },
  simulateReply: 'Please share price and GST',
  waitScale: 0,
  optedOut: false,
  recentInbound: false,
};

export function TestRunDialog({ open, onOpenChange, initial, onStart }: { open: boolean; onOpenChange: (o: boolean) => void; initial: TestRunInput; onStart: (input: TestRunInput) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">{open && <TestRunForm initial={initial} onStart={onStart} onCancel={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function TestRunForm({ initial, onStart, onCancel }: { initial: TestRunInput; onStart: (i: TestRunInput) => void; onCancel: () => void }) {
  const [input, setInput] = useState<TestRunInput>(initial);
  const [touched, setTouched] = useState(false);
  const phoneOk = normalizeIndianPhone(input.lead.phone) !== null;
  const nameOk = input.lead.name.trim().length > 0;
  const setLead = (patch: Partial<TestRunInput['lead']>) => setInput((s) => ({ ...s, lead: { ...s.lead, ...patch } }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!phoneOk || !nameOk) return;
    onStart({ ...input, lead: { ...input.lead, name: input.lead.name.trim(), phone: normalizeIndianPhone(input.lead.phone)! } });
  };
  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col" noValidate>
      <DialogHeader>
        <DialogTitle>Test run</DialogTitle>
        <DialogDescription>Runs the current draft with a test lead. Dry run: no messages are sent.</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Lead name" required error={touched && !nameOk ? 'Enter a name' : undefined}>
            <Input value={input.lead.name} onChange={(e) => setLead({ name: e.target.value })} autoFocus />
          </FormField>
          <FormField label="Phone" required error={touched && !phoneOk ? 'Enter a 10-digit Indian mobile number' : undefined}>
            <Input value={input.lead.phone} inputMode="tel" onChange={(e) => setLead({ phone: e.target.value })} />
          </FormField>
          <FormField label="Source">
            <select className={selectClass} value={input.lead.source} onChange={(e) => setLead({ source: e.target.value as LeadSource })}>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <div className="flex flex-col gap-2">
          <FormField label="Simulate reply" hint="What the lead replies after our first message. Leave empty for no reply.">
            <Input value={input.simulateReply} placeholder="No reply" maxLength={500} onChange={(e) => setInput((s) => ({ ...s, simulateReply: e.target.value }))} />
          </FormField>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick replies">
            {QUICK_REPLIES.map((q) => (
              <button
                key={q.label}
                type="button"
                aria-pressed={input.simulateReply === q.text}
                onClick={() => setInput((s) => ({ ...s, simulateReply: q.text }))}
                className="focus-ring h-6 rounded-full border border-border px-2 text-2xs text-fg-secondary transition-colors hover:bg-surface-2 aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-soft-fg"
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
        <FormField label={`Wait scale: ${input.waitScale === 0 ? 'skip waits' : `${Math.round(input.waitScale * 100)}%`}`} hint="0 skips waits. Higher values pause on each wait (up to 2.4 s in a test).">
          <input
            type="range"
            min={0}
            max={1}
            step={0.25}
            value={input.waitScale}
            onChange={(e) => setInput((s) => ({ ...s, waitScale: Number(e.target.value) }))}
            className="focus-ring w-full accent-[var(--accent)]"
          />
        </FormField>
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
          <p className="text-xs font-medium text-fg-secondary">Compliance checks</p>
          <CheckboxField label="Lead opted out (DND)" hint="Messaging steps are skipped with CONSENT_OPTED_OUT." checked={input.optedOut} onChange={(v) => setInput((s) => ({ ...s, optedOut: v }))} />
          <CheckboxField
            label="Lead messaged us in the last 24 hours"
            hint="Opens the WhatsApp window for free-form messages. Off: they are skipped with WHATSAPP_WINDOW_CLOSED."
            checked={input.recentInbound}
            onChange={(v) => setInput((s) => ({ ...s, recentInbound: v }))}
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Start test run
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------- versions

export function VersionsDialog({ open, onOpenChange, onRestore }: { open: boolean; onOpenChange: (o: boolean) => void; onRestore: (v: LocalVersion) => void }) {
  const versions = useBuilder((s) => s.versions);
  const activeVersion = useBuilder((s) => s.activeVersion);
  const env = useEnv();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>Every save creates a version. Restore one to load it into the editor, then save to keep it.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {versions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-strong px-4 py-6 text-center text-sm text-muted">
              No saved versions yet.{env.canEdit ? ' Save the workflow to create version 1.' : ''}
            </div>
          ) : (
            <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {versions.map((v) => (
                <li key={v.version} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-xs font-semibold text-fg tabular">v{v.version}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-fg">
                      <span className="truncate">{v.name}</span>
                      {activeVersion === v.version && (
                        <Chip tone="green" dot>
                          Active
                        </Chip>
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      Saved {formatDistanceToNow(new Date(v.savedAt), { addSuffix: true })}
                      {v.savedBy ? ` by ${v.savedBy}` : ''} · {v.graph.nodes.length} steps
                    </p>
                  </div>
                  {env.canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => onRestore(v)}>
                      <RotateCcw aria-hidden />
                      Restore
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------- shortcuts

const SHORTCUTS: Array<{ group: string; items: Array<[string, string]> }> = [
  {
    group: 'Edit',
    items: [
      ['Ctrl Z', 'Undo'],
      ['Ctrl Shift Z', 'Redo'],
      ['Ctrl C', 'Copy steps'],
      ['Ctrl X', 'Cut steps'],
      ['Ctrl V', 'Paste steps'],
      ['Ctrl D', 'Duplicate selection'],
      ['Delete', 'Delete selection'],
      ['Ctrl S', 'Save'],
    ],
  },
  {
    group: 'Select and move',
    items: [
      ['Tab', 'Move focus between steps'],
      ['Enter', 'Open the focused step’s settings'],
      ['Arrows', 'Nudge selected steps (Shift: 4×)'],
      ['Shift drag', 'Select several steps'],
      ['Ctrl A', 'Select all'],
      ['Esc', 'Clear selection / back to canvas'],
    ],
  },
  {
    group: 'View',
    items: [
      ['F', 'Fit view'],
      ['Shift L', 'Auto-layout'],
      ['Shift P', 'Flat mode'],
      ['?', 'This list'],
    ],
  },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>On a Mac, use Cmd instead of Ctrl.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {SHORTCUTS.map((g) => (
            <section key={g.group}>
              <h3 className="mb-2 text-xs font-semibold text-fg">{g.group}</h3>
              <dl className="flex flex-col gap-1.5">
                {g.items.map(([k, label]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3">
                    <dt className="text-xs text-fg-secondary">{label}</dt>
                    <dd className="shrink-0">
                      {k.split(' ').map((part, i) => (
                        <kbd key={i} className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-border-strong bg-surface-2 px-1 font-sans text-2xs font-medium text-fg">
                          {part}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
