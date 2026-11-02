'use client';

import { Check, ChevronDown, Columns3Cog, ListFilter, Search, Trash2, UserRound, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/leads/primitives/menu';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { useScopedUserList } from '@/lib/api/directory';
import { cn } from '@/lib/cn';
import { useMe } from '@/lib/session/session';
import type { ColumnSet } from './table-prefs';

/** Same emphasis the Leads toolbar uses for a filter that is on. */
export const ACTIVE_FILTER = 'border-accent bg-accent-soft text-accent-soft-fg hover:bg-accent-soft';

const DEBOUNCE_MS = 250;

/** Debounced search box (Enter commits now, Esc clears). External value changes win over the draft. */
export function CrmSearch({ value, onChange, placeholder, label, className }: { value: string; onChange: (q: string) => void; placeholder: string; label: string; className?: string }) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const commit = (next: string, delay = DEBOUNCE_MS) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const t = next.trim();
      if (t !== value) onChange(t);
    }, delay);
  };
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
      <Input
        type="search"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(draft, 0);
          if (e.key === 'Escape' && draft) {
            e.preventDefault();
            setDraft('');
            commit('', 0);
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {draft && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setDraft('');
            commit('', 0);
          }}
          className="focus-ring absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted hover:bg-surface-3 hover:text-fg"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export interface FacetOption {
  value: string;
  label: string;
}

/** Multi-select filter ("Status: Sent, Accepted"). Empty value = no filter. */
export function FacetFilter({ label, options, value, onChange, icon }: { label: string; options: readonly FacetOption[]; value: readonly string[] | undefined; onChange: (next: string[] | undefined) => void; icon?: ReactNode }) {
  const chosen = value ?? [];
  const summary = chosen.length === 0 ? label : chosen.length === 1 ? (options.find((o) => o.value === chosen[0])?.label ?? label) : `${label}: ${chosen.length}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={chosen.length ? `${label} filter: ${summary}` : `${label} filter`} className={chosen.length ? ACTIVE_FILTER : undefined}>
          {icon ?? <ListFilter aria-hidden />}
          <span className="max-w-36 truncate">{summary}</span>
          <ChevronDown aria-hidden className="text-muted" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={chosen.includes(o.value)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(on) => {
              const next = on === true ? [...chosen, o.value] : chosen.filter((v) => v !== o.value);
              onChange(next.length ? next : undefined);
            }}
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
        {chosen.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(undefined)}>Clear filter</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ALL = '__all';

/**
 * Owner filter in the caller's data scope (All, Me, Unassigned, then the people they may see).
 * Hidden for "own" scope: those people only ever see their own records.
 */
export function OwnerFilter({ value, onChange }: { value: readonly string[] | undefined; onChange: (next: string[] | undefined) => void }) {
  const me = useMe();
  const users = useScopedUserList();
  if (!me || me.role.dataScope === 'own') return null;
  const others = users.filter((u) => u.id !== me.user.id);
  const current = !value?.length ? ALL : value.length === 1 ? value[0]! : 'multi';
  const label =
    current === ALL ? 'All owners' : current === 'me' ? 'Me' : current === 'unassigned' ? 'Unassigned' : current === 'multi' ? `${value!.length} owners` : (users.find((u) => u.id === current)?.name ?? 'Owner');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={`Owner: ${label}`} className={current !== ALL ? ACTIVE_FILTER : undefined}>
          <UserRound aria-hidden />
          <span className="max-w-32 truncate">{label}</span>
          <ChevronDown aria-hidden className="text-muted" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuRadioGroup value={current} onValueChange={(v) => onChange(v === ALL ? undefined : [v])}>
          <DropdownMenuRadioItem value={ALL}>All owners</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="me">Me</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="unassigned">Unassigned</DropdownMenuRadioItem>
          {others.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{me.role.dataScope === 'team' ? 'Your team' : 'Team members'}</DropdownMenuLabel>
              {others.map((u) => (
                <DropdownMenuRadioItem key={u.id} value={u.id}>
                  <Avatar name={u.name} size="xs" aria-hidden />
                  <span className="truncate">{u.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </>
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Column chooser with saved column sets: toggle columns, save the current choice under a name,
 * switch between sets, delete a set, or go back to the defaults.
 */
export function ColumnSetsMenu({
  columns,
  visible,
  sets,
  activeSetId,
  onToggle,
  onReset,
  onSaveSet,
  onApplySet,
  onDeleteSet,
}: {
  columns: ReadonlyArray<{ id: string; label: string; hideable?: boolean }>;
  visible: readonly string[];
  sets: readonly ColumnSet[];
  activeSetId: string | null;
  onToggle: (id: string, on: boolean) => void;
  onReset: () => void;
  onSaveSet: (name: string) => void;
  onApplySet: (id: string) => void;
  onDeleteSet: (id: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const active = sets.find((s) => s.id === activeSetId);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label={active ? `Columns: ${active.name}` : 'Choose columns'}>
            <Columns3Cog aria-hidden />
            <span className="hidden max-w-28 truncate md:inline">{active?.name ?? 'Columns'}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {sets.length > 0 && (
            <>
              <DropdownMenuLabel>Column sets</DropdownMenuLabel>
              {sets.map((s) => (
                <DropdownMenuItem key={s.id} onSelect={() => onApplySet(s.id)}>
                  <span className={cn('inline-flex size-4 items-center justify-center', s.id !== activeSetId && 'invisible')}>
                    <Check aria-hidden className="!text-accent-text" />
                  </span>
                  <span className="truncate">{s.name}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuLabel>Columns</DropdownMenuLabel>
          {columns
            .filter((c) => c.hideable !== false)
            .map((c) => (
              <DropdownMenuCheckboxItem key={c.id} checked={visible.includes(c.id)} onSelect={(e) => e.preventDefault()} onCheckedChange={(v) => onToggle(c.id, v === true)}>
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSaving(true)}>Save as column set…</DropdownMenuItem>
          {sets.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Delete a column set</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                {sets.map((s) => (
                  <DropdownMenuItem key={s.id} destructive onSelect={() => onDeleteSet(s.id)}>
                    <Trash2 aria-hidden />
                    <span className="truncate">{s.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuItem onSelect={onReset}>Default columns</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SaveSetDialog open={saving} onOpenChange={setSaving} existing={sets.map((s) => s.name)} onSave={onSaveSet} />
    </>
  );
}

function SaveSetDialog({ open, onOpenChange, existing, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; existing: string[]; onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError('Enter a name for this column set.');
    if (n.length > 40) return setError('Use 40 characters or fewer.');
    onSave(n);
    setName('');
    setError(null);
    onOpenChange(false);
  };
  const replaces = existing.some((x) => x.toLowerCase() === name.trim().toLowerCase());
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setError(null);
      }}
    >
      <DialogContent size="sm">
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Save column set</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <FormField label="Name" required error={error} hint={replaces ? 'A set with this name exists; saving replaces it.' : 'Saved on this device for your account.'}>
              <Input
                value={name}
                autoFocus
                maxLength={60}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary">
              Save set
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Clear filters" link shown when any filter is on. */
export function ClearFilters({ active, onClear }: { active: boolean; onClear: () => void }) {
  if (!active) return null;
  return (
    <Button variant="ghost" onClick={onClear}>
      <X aria-hidden />
      Clear filters
    </Button>
  );
}

/** Toolbar row above a list: search grows, filters wrap. */
export function ListToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-3 flex flex-wrap items-center gap-2', className)}>{children}</div>;
}
