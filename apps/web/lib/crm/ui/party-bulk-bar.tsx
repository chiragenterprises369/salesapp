'use client';

import type { BulkResult, CrmBulkAction } from '@vistar/shared';
import { Tag, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/leads/primitives/menu';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { useScopedUserList } from '@/lib/api/directory';
import { useCan } from '@/lib/session/session';
import { BulkBar, reportBulkResult } from './bulk-bar';
import { ConfirmDialog } from './confirm-dialog';

/** Bulk assign, add tag and delete for contacts and accounts (POST /<entity>/bulk). */
export function PartyBulkBar({
  noun,
  selected,
  onClear,
  canUpdate,
  canDelete,
  bulk,
  pending,
  deleteNote,
}: {
  noun: { one: string; many: string };
  selected: ReadonlySet<string>;
  onClear: () => void;
  canUpdate: boolean;
  canDelete: boolean;
  bulk: (action: CrmBulkAction) => Promise<BulkResult>;
  pending: boolean;
  deleteNote: string;
}) {
  const users = useScopedUserList();
  const canAssign = useCan('leads.assign');
  const [confirm, setConfirm] = useState(false);
  const [tagging, setTagging] = useState(false);
  const ids = [...selected];
  const word = (n: number) => (n === 1 ? noun.one : noun.many);
  const run = async (action: CrmBulkAction, done: (n: number) => string) => {
    try {
      reportBulkResult(await bulk(action), done);
      onClear();
    } catch (e) {
      reportBulkResult({ succeeded: 0, failed: [{ message: e instanceof Error ? e.message : 'Try again.' }] }, done);
    }
  };
  return (
    <>
      <BulkBar count={selected.size} onClear={onClear}>
        {canUpdate && canAssign && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                <UserRound aria-hidden />
                Assign
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" className="w-56">
              <DropdownMenuLabel>Assign to</DropdownMenuLabel>
              {users.map((u) => (
                <DropdownMenuItem key={u.id} onSelect={() => void run({ action: 'assign', ids, ownerId: u.id }, (n) => `${n} ${word(n)} assigned to ${u.name}.`)}>
                  {u.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={() => void run({ action: 'assign', ids, ownerId: null }, (n) => `${n} ${word(n)} unassigned.`)}>Unassigned</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {canUpdate && (
          <Button size="sm" variant="ghost" onClick={() => setTagging(true)}>
            <Tag aria-hidden />
            Add tag
          </Button>
        )}
        {canDelete && (
          <Button size="sm" variant="ghost" className="text-danger-text" onClick={() => setConfirm(true)}>
            <Trash2 aria-hidden />
            Delete
          </Button>
        )}
      </BulkBar>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${selected.size} ${word(selected.size)}?`}
        description={deleteNote}
        confirmLabel="Delete"
        loading={pending}
        onConfirm={() => void run({ action: 'delete', ids }, (n) => `${n} ${word(n)} deleted.`).then(() => setConfirm(false))}
      />
      {tagging && <TagDialog onClose={() => setTagging(false)} loading={pending} onSave={(tag) => void run({ action: 'add_tags', ids, tags: [tag] }, (n) => `Tag added to ${n} ${word(n)}.`).then(() => setTagging(false))} />}
    </>
  );
}

function TagDialog({ onClose, onSave, loading }: { onClose: () => void; onSave: (tag: string) => void; loading: boolean }) {
  const [tag, setTag] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <form
          className="contents"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const t = tag.trim().toLowerCase();
            if (!t) return setError('Enter a tag.');
            if (t.length > 40) return setError('Tags can be up to 40 characters.');
            onSave(t);
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a tag</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <FormField label="Tag" required error={error}>
              <Input
                autoFocus
                value={tag}
                placeholder="e.g. distributor"
                onChange={(e) => {
                  setTag(e.target.value);
                  setError(null);
                }}
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary" loading={loading}>
              Add tag
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
