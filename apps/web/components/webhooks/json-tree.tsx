'use client';

import { ChevronRight } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/cn';
import { formatPath, previewValue } from '@/lib/hub/json-paths';

interface Node {
  id: string;
  path: string;
  label: string;
  value: unknown;
  kind: 'object' | 'array' | 'leaf';
  level: number;
  parent: string | null;
  childCount: number;
  posInSet: number;
  setSize: number;
}

const MAX_CHILDREN = 50;

function childrenOf(value: unknown): Array<[string | number, unknown]> {
  if (Array.isArray(value)) return value.slice(0, MAX_CHILDREN).map((v, i) => [i, v]);
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).slice(0, MAX_CHILDREN);
  return [];
}

const kindOf = (v: unknown): Node['kind'] => (Array.isArray(v) ? 'array' : v && typeof v === 'object' ? 'object' : 'leaf');

/** Visible rows for the expanded set (depth-first, flat, with ARIA level and position). */
function visibleNodes(value: unknown, expanded: ReadonlySet<string>): Node[] {
  const out: Node[] = [];
  const walk = (v: unknown, segs: Array<string | number>, parent: string | null, level: number) => {
    const kids = childrenOf(v);
    kids.forEach(([k, child], i) => {
      const s = [...segs, k];
      const path = formatPath(s);
      const kind = kindOf(child);
      const node: Node = { id: path, path, label: typeof k === 'number' ? `[${k}]` : k, value: child, kind, level, parent, childCount: childrenOf(child).length, posInSet: i + 1, setSize: kids.length };
      out.push(node);
      if (kind !== 'leaf' && expanded.has(path)) walk(child, s, path, level + 1);
    });
  };
  walk(value, [], null, 1);
  return out;
}

/** Paths of every container up to `depth` levels (opened at first render). */
function initialExpanded(value: unknown, depth = 3): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown, segs: Array<string | number>, d: number) => {
    if (d > depth) return;
    for (const [k, child] of childrenOf(v)) {
      if (kindOf(child) === 'leaf') continue;
      const s = [...segs, k];
      out.add(formatPath(s));
      // Arrays: open only the first item so long lists stay short.
      if (Array.isArray(child)) {
        if (child.length) {
          out.add(formatPath([...s, 0]));
          walk(child[0], [...s, 0], d + 2);
        }
      } else walk(child, s, d + 1);
    }
  };
  walk(value, [], 1);
  return out;
}

/**
 * Sample payload as a keyboard-operable tree (WAI-ARIA tree pattern, one tab stop): Up and Down
 * move, Right opens or goes to the first child, Left closes or goes to the parent, Home and End
 * jump, Enter or Space picks a value. Picked values show the lead field they map to.
 */
export function JsonTree({ value, label, mapped, onPick }: { value: unknown; label: string; mapped: ReadonlyMap<string, string>; onPick: (path: string, value: unknown) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded(value));
  const nodes = useMemo(() => visibleNodes(value, expanded), [value, expanded]);
  const [active, setActive] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const activeId = nodes.some((n) => n.id === active) ? active : (nodes[0]?.id ?? null);

  const focus = (id: string | null | undefined) => {
    if (!id) return;
    setActive(id);
    requestAnimationFrame(() => refs.current.get(id)?.focus());
  };
  const toggle = (id: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      const want = open ?? !next.has(id);
      if (want) next.add(id);
      else next.delete(id);
      return next;
    });

  const onKeyDown = (e: KeyboardEvent, n: Node, i: number) => {
    const container = n.kind !== 'leaf';
    switch (e.key) {
      case 'ArrowDown':
        focus(nodes[i + 1]?.id);
        break;
      case 'ArrowUp':
        focus(nodes[i - 1]?.id);
        break;
      case 'Home':
        focus(nodes[0]?.id);
        break;
      case 'End':
        focus(nodes[nodes.length - 1]?.id);
        break;
      case 'ArrowRight':
        if (container && !expanded.has(n.id)) toggle(n.id, true);
        else if (container) focus(nodes[i + 1]?.parent === n.id ? nodes[i + 1]!.id : undefined);
        break;
      case 'ArrowLeft':
        if (container && expanded.has(n.id)) toggle(n.id, false);
        else focus(n.parent);
        break;
      case 'Enter':
      case ' ':
        if (container) toggle(n.id);
        else onPick(n.path, n.value);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  if (!nodes.length) return <p className="px-3 py-4 text-sm text-muted-strong">The payload has no fields to map.</p>;

  return (
    <div role="tree" aria-label={label} className="flex max-h-96 flex-col overflow-auto py-1 font-mono text-xs">
      {nodes.map((n, i) => {
        const container = n.kind !== 'leaf';
        const open = container && expanded.has(n.id);
        const target = mapped.get(n.path);
        return (
          <div
            key={n.id}
            ref={(el) => {
              if (el) refs.current.set(n.id, el);
              else refs.current.delete(n.id);
            }}
            role="treeitem"
            aria-level={n.level}
            aria-posinset={n.posInSet}
            aria-setsize={n.setSize}
            aria-expanded={container ? open : undefined}
            aria-selected={target ? true : undefined}
            aria-label={container ? `${n.label}, ${n.kind === 'array' ? `${n.childCount} items` : `${n.childCount} fields`}` : `${n.label}: ${previewValue(n.value, 120)}${target ? `, mapped to ${target}` : ''}`}
            tabIndex={n.id === activeId ? 0 : -1}
            data-path={n.path}
            onKeyDown={(e) => onKeyDown(e, n, i)}
            onFocus={() => setActive(n.id)}
            onClick={() => (container ? toggle(n.id) : onPick(n.path, n.value))}
            style={{ paddingLeft: `${(n.level - 1) * 14 + 8}px` }}
            className={cn(
              'focus-ring flex min-h-7 cursor-pointer items-center gap-1.5 rounded-sm pr-2 hover:bg-surface-3',
              target && 'bg-accent-soft text-accent-soft-fg hover:bg-accent-soft',
            )}
          >
            {container ? (
              <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-muted-strong transition-transform duration-150', open && 'rotate-90')} />
            ) : (
              <span aria-hidden className="inline-block size-3.5 shrink-0" />
            )}
            <span className="shrink-0 font-semibold text-fg">{n.label}</span>
            <span aria-hidden className="text-muted-strong">
              :
            </span>
            <span className={cn('min-w-0 truncate', container ? 'text-muted-strong' : typeof n.value === 'string' ? 'text-success-text' : 'text-accent-text')}>{previewValue(n.value)}</span>
            {target && (
              <Chip tone="indigo" className="ml-auto font-sans">
                {target}
              </Chip>
            )}
          </div>
        );
      })}
    </div>
  );
}
