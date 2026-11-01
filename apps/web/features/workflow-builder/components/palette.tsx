'use client';

import type { NodeDefinition } from '@vistar/shared';
import { Search } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { CATEGORY_META, CATEGORY_ORDER, isTrigger, paletteDefinitions, TONE_CLASSES } from '../lib/catalog';
import { NodeIcon } from './node-icon';
import { displayLabel } from '../lib/graph';
import type { Commands } from '../hooks/use-commands';
import { useBuilder, useEnv } from '../store/context';
import { PALETTE_MIME } from './canvas';

export function Palette({ commands }: { commands: Commands }) {
  const env = useEnv();
  const [query, setQuery] = useState('');
  const hasTrigger = useBuilder((s) => s.nodes.some((n) => isTrigger(n.type)));
  const selectedLabel = useBuilder((s) => {
    const sel = s.nodes.filter((n) => n.selected);
    return sel.length === 1 ? displayLabel(sel[0]!.type, sel[0]!.data) : null;
  });

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const defs = paletteDefinitions(env.aiEnabled).filter((d) => !q || `${d.label} ${d.description} ${d.type}`.toLowerCase().includes(q));
    return CATEGORY_ORDER.map((c) => ({ category: c, items: defs.filter((d) => d.category === c) })).filter((g) => g.items.length > 0);
  }, [query, env.aiEnabled]);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface" aria-label="Steps">
      <div className="border-b border-border p-3">
        <label className="relative block">
          <span className="sr-only">Search steps</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search steps" className="pl-8" type="search" />
        </label>
        <p className="mt-2 text-2xs text-muted">
          {selectedLabel ? (
            <>
              Click to add after <span className="font-medium text-fg-secondary">{selectedLabel}</span>, or drag onto the canvas.
            </>
          ) : (
            'Drag a step onto the canvas, or select a step and click to add after it.'
          )}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted">No steps match “{query}”. Try another word, like “wait” or “WhatsApp”.</p>}
        {groups.map((g) => (
          <section key={g.category} className="mb-3" aria-labelledby={`palette-${g.category}`}>
            <h3 id={`palette-${g.category}`} className="px-2 pt-1 pb-1.5 text-2xs font-semibold text-muted">
              {CATEGORY_META[g.category].plural}
            </h3>
            {g.category === 'trigger' && hasTrigger && <p className="px-2 pb-1.5 text-2xs text-muted">This workflow has a trigger. Delete it to pick another.</p>}
            <ul className="flex flex-col gap-0.5">
              {g.items.map((d) => (
                <li key={d.type}>
                  <PaletteItem def={d} disabled={d.category === 'trigger' && hasTrigger} onAdd={() => commands.add(d.type)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}

function PaletteItem({ def, disabled, onAdd }: { def: NodeDefinition; disabled: boolean; onAdd: () => void }) {
  const tone = TONE_CLASSES[def.category];
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(PALETTE_MIME, def.type);
    e.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <button
      type="button"
      draggable={!disabled}
      onDragStart={onDragStart}
      onClick={onAdd}
      disabled={disabled}
      title={def.description}
      className={cn(
        'focus-ring group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-150 ease-standard',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-grab hover:bg-surface-2 active:cursor-grabbing active:bg-surface-3',
      )}
    >
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-md border', tone.chip)}>
        <NodeIcon type={def.type} className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-fg">{def.label}</span>
        <span className="block truncate text-2xs text-muted">{def.description}</span>
      </span>
    </button>
  );
}
