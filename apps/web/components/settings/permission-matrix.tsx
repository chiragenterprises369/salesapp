'use client';

import { PERMISSION_MATRIX, type Permission, type PermissionResource } from '@vistar/shared';
import { Lock } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { ACTION_LABELS, PERMISSION_RESOURCES, RESOURCE_LABELS } from './roles-store';

/** Fixed columns; any other action goes to "More". `edit` (workflows) shares the Edit column. */
const FIXED = [
  { key: 'read', label: 'View' },
  { key: 'create', label: 'Create' },
  { key: 'update', label: 'Edit', also: 'edit' },
  { key: 'delete', label: 'Delete' },
  { key: 'manage', label: 'Manage' },
] as const;

interface Cell {
  permission: Permission;
  resource: PermissionResource;
  action: string;
  /** Visual column position (0-4 fixed, 5+ in "More"), used for up/down movement. */
  pos: number;
}

function buildRows(): Cell[][] {
  return PERMISSION_RESOURCES.map((resource) => {
    const actions = PERMISSION_MATRIX[resource] as readonly string[];
    const cells: Cell[] = [];
    FIXED.forEach((col, i) => {
      const action = actions.find((a) => a === col.key || ('also' in col && a === col.also));
      if (action) cells.push({ permission: `${resource}.${action}` as Permission, resource, action, pos: i });
    });
    actions
      .filter((a) => !FIXED.some((c) => c.key === a || ('also' in c && c.also === a)))
      .forEach((action, i) => cells.push({ permission: `${resource}.${action}` as Permission, resource, action, pos: FIXED.length + i }));
    return cells;
  });
}

const ROWS = buildRows();

interface PermissionMatrixProps {
  roleName: string;
  value: readonly Permission[];
  onChange: (next: Permission[]) => void;
  /** Always on and not editable (admin lock-out guard). */
  locked?: readonly Permission[];
  /** No edits (read-only session); the grid stays navigable. */
  disabled?: boolean;
}

/**
 * Resource x action permission grid (PERMISSION_MATRIX). Keyboard: one tab stop; arrow keys move
 * between checkboxes (up/down keep the column), Home/End jump within a row, Ctrl+Home/End to the
 * corners, Space toggles. On small screens it becomes a list of fieldsets in normal tab order.
 */
export function PermissionMatrix({ roleName, value, onChange, locked = [], disabled }: PermissionMatrixProps) {
  const rows = ROWS;
  const lockNoteId = useId();
  const [focus, setFocus] = useState<[number, number]>([0, 0]);
  const refs = useRef(new Map<string, HTMLInputElement>());
  const granted = new Set(value);
  const lockedSet = new Set(locked);

  const toggle = (p: Permission) => {
    if (disabled || lockedSet.has(p)) return;
    const next = new Set(value);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    onChange([...next]);
  };

  const moveTo = (r: number, c: number) => {
    const cell = rows[r]?.[c];
    if (!cell) return;
    setFocus([r, c]);
    refs.current.get(cell.permission)?.focus();
  };

  const nearestIn = (r: number, pos: number) => {
    const row = rows[r] ?? [];
    let best = 0;
    row.forEach((cell, i) => {
      if (Math.abs(cell.pos - pos) < Math.abs((row[best]?.pos ?? 0) - pos)) best = i;
    });
    return best;
  };

  const onKeyDown = (e: KeyboardEvent, r: number, c: number) => {
    const row = rows[r]!;
    const pos = row[c]!.pos;
    const last = rows.length - 1;
    const handled = (() => {
      switch (e.key) {
        case 'ArrowRight':
          if (c < row.length - 1) moveTo(r, c + 1);
          return true;
        case 'ArrowLeft':
          if (c > 0) moveTo(r, c - 1);
          return true;
        case 'ArrowDown':
          if (r < last) moveTo(r + 1, nearestIn(r + 1, pos));
          return true;
        case 'ArrowUp':
          if (r > 0) moveTo(r - 1, nearestIn(r - 1, pos));
          return true;
        case 'Home':
          if (e.ctrlKey) moveTo(0, 0);
          else moveTo(r, 0);
          return true;
        case 'End':
          if (e.ctrlKey) moveTo(last, (rows[last]?.length ?? 1) - 1);
          else moveTo(r, row.length - 1);
          return true;
        default:
          return false;
      }
    })();
    if (handled) e.preventDefault();
  };

  const checkbox = (cell: Cell, r: number, c: number, withLabel: boolean) => {
    const isLocked = lockedSet.has(cell.permission);
    const name = `${RESOURCE_LABELS[cell.resource].label}: ${ACTION_LABELS[cell.action] ?? cell.action}`;
    const input = (
      <input
        type="checkbox"
        ref={(el) => {
          if (el) refs.current.set(cell.permission, el);
          else refs.current.delete(cell.permission);
        }}
        checked={granted.has(cell.permission) || isLocked}
        onChange={() => toggle(cell.permission)}
        onKeyDown={(e) => onKeyDown(e, r, c)}
        onFocus={() => setFocus([r, c])}
        tabIndex={focus[0] === r && focus[1] === c ? 0 : -1}
        aria-label={name}
        aria-disabled={isLocked || disabled || undefined}
        aria-describedby={isLocked ? lockNoteId : undefined}
        className={cn('size-4 shrink-0 cursor-pointer accent-accent', (isLocked || disabled) && 'cursor-not-allowed opacity-70')}
      />
    );
    return (
      <span className="inline-flex items-center gap-1">
        {withLabel ? (
          <label className={cn('inline-flex cursor-pointer items-center gap-1.5 text-xs text-fg-secondary', (isLocked || disabled) && 'cursor-not-allowed')}>
            {input}
            {ACTION_LABELS[cell.action] ?? cell.action}
          </label>
        ) : (
          input
        )}
        {isLocked && <Lock aria-hidden className="size-3 text-muted" />}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {/* md+: keyboard grid */}
      <div className="hidden overflow-hidden rounded-md border border-border md:block">
        <table role="grid" aria-label={`Permissions for ${roleName}`} className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-surface-2">
              <th scope="col" className="h-8 w-52 border-b border-border px-3 text-left text-xs font-medium text-muted">
                Area
              </th>
              {FIXED.map((col) => (
                <th key={col.key} scope="col" className="h-8 w-16 border-b border-border px-2 text-center text-xs font-medium text-muted">
                  {col.label}
                </th>
              ))}
              <th scope="col" className="h-8 border-b border-border px-3 text-left text-xs font-medium text-muted">
                More actions
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row[0]!.resource} className="hover:bg-surface-2">
                <th scope="row" className="border-b border-border px-3 py-2 text-left align-middle font-normal">
                  <span className="block text-sm font-medium text-fg">{RESOURCE_LABELS[row[0]!.resource].label}</span>
                  <span className="block text-xs text-muted">{RESOURCE_LABELS[row[0]!.resource].hint}</span>
                </th>
                {FIXED.map((_, pos) => {
                  const c = row.findIndex((cell) => cell.pos === pos);
                  return (
                    <td key={pos} className="border-b border-border px-2 text-center align-middle">
                      {c >= 0 ? (
                        checkbox(row[c]!, r, c, false)
                      ) : (
                        <span aria-hidden className="text-muted">
                          –
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="border-b border-border px-3 py-2 align-middle">
                  <span className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {row.map((cell, c) => (cell.pos >= FIXED.length ? <span key={cell.permission}>{checkbox(cell, r, c, true)}</span> : null))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Small screens: one fieldset per area */}
      <div className="flex flex-col gap-2 md:hidden">
        {rows.map((row, r) => (
          <fieldset key={row[0]!.resource} className="rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium text-fg">{RESOURCE_LABELS[row[0]!.resource].label}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2.5">
              {row.map((cell, c) => (
                <label key={cell.permission} className="inline-flex min-h-8 items-center gap-2 text-sm text-fg-secondary">
                  <input
                    type="checkbox"
                    checked={granted.has(cell.permission) || lockedSet.has(cell.permission)}
                    onChange={() => toggle(cell.permission)}
                    aria-disabled={lockedSet.has(cell.permission) || disabled || undefined}
                    aria-describedby={lockedSet.has(cell.permission) ? lockNoteId : undefined}
                    className="size-4 accent-accent"
                    data-row={r}
                    data-col={c}
                  />
                  {ACTION_LABELS[cell.action] ?? cell.action}
                  {lockedSet.has(cell.permission) && <Lock aria-hidden className="size-3 text-muted" />}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      {locked.length > 0 && (
        <p id={lockNoteId} className="flex items-start gap-1.5 text-xs text-muted-strong">
          <Lock aria-hidden className="mt-0.5 size-3 shrink-0" />
          Locked: {locked.map((p) => `${RESOURCE_LABELS[p.split('.')[0] as PermissionResource].label} (${ACTION_LABELS[p.split('.')[1]!]?.toLowerCase()})`).join(', ')} stay on for
          the Company admin role, so the workspace always has someone who can manage people, roles and settings.
        </p>
      )}
    </div>
  );
}
