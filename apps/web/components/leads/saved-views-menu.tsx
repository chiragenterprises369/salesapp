'use client';

import type { LeadsViewMode } from '@vistar/shared';
import { Bookmark, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useLeadsViewState } from '@/lib/leads/state';
import { useMe } from '@/lib/session/session';
import { countActiveFilters } from './filters-panel';
import { ACTIVE_FILTER_CLASS } from './lead-meta';
import { Checkbox } from './primitives/checkbox';
import {
  DropdownMenu,
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
} from './primitives/menu';
import { splitSavedView, useTablePrefs } from './stores';
import { useSavedViewList } from './use-saved-views';

/**
 * Saved views (GET/POST/DELETE /views; the mock data mode keeps them in localStorage). Applying one replaces
 * the shared filters (`replaceFilters(filters, id)`), the Table sort and, if set, the view mode.
 */
export function SavedViewsMenu({
  mode,
  onViewMode,
}: {
  mode: LeadsViewMode;
  onViewMode: (m: LeadsViewMode) => void;
}) {
  const me = useMe();
  const { views, add: addView, remove: removeView } = useSavedViewList();
  const activeId = useLeadsViewState((s) => s.activeSavedViewId);
  const filters = useLeadsViewState((s) => s.filters);
  const replaceFilters = useLeadsViewState((s) => s.replaceFilters);
  const sort = useTablePrefs((s) => s.sort);
  const setSort = useTablePrefs((s) => s.setSort);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [keepMode, setKeepMode] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const active = views.find((v) => v.id === activeId);
  const own = views.filter((v) => !v.isShared);
  const hasFilters = countActiveFilters(filters) > 0 || !!filters.q;

  const apply = (id: string) => {
    const view = views.find((v) => v.id === id);
    if (!view) return;
    const split = splitSavedView(view);
    replaceFilters(split.filters, view.id);
    if (split.sort) setSort(split.sort);
    if (view.viewMode && view.viewMode !== mode) onViewMode(view.viewMode);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a name for this view');
    if (trimmed.length > 60) return setError('Use 60 characters or fewer');
    if (views.some((v) => v.name.toLowerCase() === trimmed.toLowerCase()))
      return setError('A view with this name already exists');
    let view;
    try {
      view = await addView({
        name: trimmed,
        filters,
        sort,
        viewMode: keepMode ? mode : null,
        ownerId: me?.user.id ?? null,
      });
    } catch {
      return setError('The view was not saved. Check your connection and try again.');
    }
    replaceFilters(filters, view.id);
    setSaveOpen(false);
    toast.success(`Saved view "${trimmed}"`);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={`Saved views${active ? `: ${active.name}` : ''}`}
            className={active ? ACTIVE_FILTER_CLASS : undefined}
          >
            <Bookmark aria-hidden />
            <span className="max-w-36 truncate">{active ? active.name : 'Views'}</span>
            <ChevronDown aria-hidden className="text-muted" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="end">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={activeId ?? ''} onValueChange={apply}>
            {views.map((v) => (
              <DropdownMenuRadioItem key={v.id} value={v.id}>
                <span className="min-w-0 flex-1 truncate">{v.name}</span>
                {v.viewMode && (
                  <span className="text-2xs text-muted-strong capitalize">{v.viewMode}</span>
                )}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!hasFilters}
            onSelect={() => {
              setName('');
              setError(null);
              setKeepMode(true);
              setSaveOpen(true);
            }}
          >
            <Plus aria-hidden />
            Save current view…
          </DropdownMenuItem>
          {own.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Trash2 aria-hidden />
                Delete a view
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                {own.map((v) => (
                  <DropdownMenuItem
                    key={v.id}
                    destructive
                    onSelect={() => {
                      removeView(v.id).then(
                        () => {
                          if (activeId === v.id) replaceFilters(filters, null);
                          toast.success(`Deleted view "${v.name}"`);
                        },
                        () => toast.error(`"${v.name}" was not deleted. Try again.`),
                      );
                    }}
                  >
                    <span className="truncate">{v.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent size="sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="contents"
          >
            <DialogHeader>
              <DialogTitle>Save view</DialogTitle>
              <DialogDescription>
                Saves the current search, filters and sort so you can reopen them in one click.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4">
              <FormField label="Name" required error={error}>
                <Input
                  value={name}
                  autoFocus
                  maxLength={80}
                  placeholder="Hot leads in Gujarat"
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                />
              </FormField>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={keepMode} onCheckedChange={(c) => setKeepMode(c === true)} />
                Always open in {mode === 'board' ? 'Board' : 'Table'} view
              </label>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <Button type="submit" variant="primary">
                Save view
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
