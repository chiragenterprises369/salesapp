'use client';

import { TEMPLATE_STATUSES, type TemplateStatus, type WhatsAppTemplate } from '@vistar/shared';
import { MessageCircle, MoreHorizontal, Plus, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/common/menu';
import { formatDateTimeIn } from '@/components/common/time';
import { FilterPills, SearchField } from '@/components/reports/page-kit';
import { InlineAlert } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TableCell, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { useWhatsAppTemplateMutations, useWhatsAppTemplates } from '@/lib/config/company';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { cn } from '@/lib/cn';
import { useCan, useMe } from '@/lib/session/session';
import { WhatsAppTemplateEditor } from './whatsapp-template-editor';
import { CATEGORY_LABEL, languageLabel, WA_STATUS, WhatsAppStatusChip } from './whatsapp-status';

const COLUMNS: DataColumn[] = [
  { key: 'name', label: 'Template' },
  { key: 'category', label: 'Category', hideBelow: 'sm' },
  { key: 'status', label: 'Meta status' },
  { key: 'body', label: 'Message', hideBelow: 'lg' },
  { key: 'synced', label: 'Last sync', hideBelow: 'md' },
  { key: 'actions', label: 'Actions', align: 'right' },
];

type Filter = 'all' | TemplateStatus;
type Editing = { mode: 'new'; copyOf?: WhatsAppTemplate } | { mode: 'edit'; id: string } | null;

/**
 * Company > Settings > WhatsApp templates (change #20): message templates with their Meta status
 * (draft, in review, approved, rejected with the reason, paused), create and edit with numbered
 * variables and sample values, a WhatsApp bubble preview, submit for review and sync now. Meta calls go
 * through the company's connected WhatsApp integration (a mock in development). `?id=<id>|new` opens the editor.
 */
export function WhatsAppTemplates({ initialId }: { initialId: string | null }) {
  const [editing, setEditing] = useState<Editing>(initialId === 'new' ? { mode: 'new' } : initialId ? { mode: 'edit', id: initialId } : null);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (editing) url.searchParams.set('id', editing.mode === 'new' ? 'new' : editing.id);
    else url.searchParams.delete('id');
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url.href);
  }, [editing]);

  if (editing) {
    return (
      <WhatsAppTemplateEditor
        key={editing.mode === 'new' ? `new:${editing.copyOf?.id ?? ''}` : editing.id}
        id={editing.mode === 'edit' ? editing.id : null}
        copyOf={editing.mode === 'new' ? (editing.copyOf ?? null) : null}
        onClose={() => setEditing(null)}
        onCreated={(t) => setEditing({ mode: 'edit', id: t.id })}
        onDuplicate={(t) => setEditing({ mode: 'new', copyOf: t })}
      />
    );
  }
  return <TemplateList onNew={() => setEditing({ mode: 'new' })} onOpen={(id) => setEditing({ mode: 'edit', id })} onDuplicate={(t) => setEditing({ mode: 'new', copyOf: t })} />;
}

function TemplateList({ onNew, onOpen, onDuplicate }: { onNew: () => void; onOpen: (id: string) => void; onDuplicate: (t: WhatsAppTemplate) => void }) {
  const q = useWhatsAppTemplates();
  const m = useWhatsAppTemplateMutations();
  const me = useMe();
  const canManage = useCan('templates.manage');
  const { readOnly, reason } = useReadOnly();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const whatsappOn = me?.workspace.features.whatsapp !== false;
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const needle = useDeferredValue(search).trim().toLowerCase();
  const [confirmDelete, setConfirmDelete] = useState<WhatsAppTemplate | null>(null);
  const all = useMemo(() => q.data ?? [], [q.data]);
  const counts = useMemo(() => Object.fromEntries(TEMPLATE_STATUSES.map((s) => [s, all.filter((t) => t.status === s).length])) as Record<TemplateStatus, number>, [all]);
  const rows = all.filter((t) => (filter === 'all' || t.status === filter) && (!needle || `${t.name} ${t.body}`.toLowerCase().includes(needle)));
  const lastSync = all.reduce<string | null>((acc, t) => (t.lastSyncedAt && (!acc || t.lastSyncedAt > acc) ? t.lastSyncedAt : acc), null);
  const mock = all.some((t) => t.mode === 'mock');
  const status = q.isPending ? 'loading' : q.isError ? 'error' : all.length === 0 ? 'empty' : 'ready';
  const writable = canManage && !readOnly;

  const sync = () =>
    m.sync.mutate(undefined, {
      onSuccess: (r) => toast.success(`Synced with Meta${r.mode === 'mock' ? ' (development mock)' : ''}: ${r.created} new, ${r.updated} updated`),
      onError: (e) => toast.error(formErrorMessage(e, 'The sync did not run. Check the WhatsApp integration and try again.')),
    });
  const submit = (t: WhatsAppTemplate) =>
    m.submit.mutate(t.id, {
      onSuccess: (r) => toast.success(`${r.name} sent to Meta for review`),
      onError: (e) => toast.error(formErrorMessage(e, 'The template was not submitted. Try again.')),
    });
  const remove = (t: WhatsAppTemplate) =>
    m.remove.mutate(t.id, {
      onSuccess: () => {
        toast.success(`${t.name} deleted`);
        setConfirmDelete(null);
      },
      onError: (e) => toast.error(formErrorMessage(e, 'The template was not deleted. Try again.')),
    });

  const pills = [{ value: 'all' as Filter, label: 'All', count: all.length }, ...TEMPLATE_STATUSES.filter((s) => counts[s] > 0).map((s) => ({ value: s as Filter, label: WA_STATUS[s].label, count: counts[s] }))];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {!whatsappOn && (
        <InlineAlert tone="warning" title="WhatsApp is not part of your plan">
          You can prepare templates, but sending and Meta review need the WhatsApp feature. Ask Vistar support or change your plan in Billing.
        </InlineAlert>
      )}
      {mock && <InlineAlert tone="info">These templates went to the development mock, not to Meta. Connect WhatsApp in Integrations on the production server to submit them for real.</InlineAlert>}
      {readOnly && reason && <InlineAlert tone="info">{reason}</InlineAlert>}
      <DataTable
        label="WhatsApp templates"
        columns={COLUMNS}
        status={status}
        onRetry={() => void q.refetch()}
        toolbar={
          <>
            <SearchField label="Search templates" value={search} onChange={setSearch} className="w-full max-w-xs" />
            {all.length > 0 && <FilterPills label="Meta status" value={filter} options={pills} onChange={setFilter} />}
            <span className="ml-auto text-xs text-muted-strong" aria-live="polite">
              {lastSync ? `Last sync ${formatDateTimeIn(lastSync, tz)}` : 'Not synced yet'}
            </span>
            {writable && (
              <>
                <Button size="sm" onClick={sync} loading={m.sync.isPending}>
                  <RefreshCw aria-hidden />
                  Sync now
                </Button>
                <Button size="sm" variant="primary" onClick={onNew}>
                  <Plus aria-hidden />
                  New template
                </Button>
              </>
            )}
          </>
        }
        empty={{
          icon: <MessageCircle />,
          title: 'No WhatsApp templates yet',
          description: (
            <>
              Templates are the only messages you can send outside the 24-hour window. Create one and submit it to Meta, or press Sync now to bring in the ones you made in Meta. Connect your number first in{' '}
              <Link href="/app/integrations" className="text-accent-text underline">
                Integrations
              </Link>
              .
            </>
          ),
          action: writable ? (
            <Button variant="primary" onClick={onNew}>
              <Plus aria-hidden />
              New template
            </Button>
          ) : undefined,
        }}
      >
        {rows.length === 0 ? (
          <TableRow className="hover:bg-surface">
            <TableCell colSpan={COLUMNS.length} className="py-6 text-center text-sm text-muted">
              No template matches. Clear the search or the filter.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="max-w-xs py-2">
                <button type="button" onClick={() => onOpen(t.id)} className="focus-ring rounded-sm text-left font-mono text-xs font-medium text-fg hover:underline">
                  {t.name}
                </button>
                <span className="block text-xs text-muted">{languageLabel(t.language)}</span>
              </TableCell>
              <TableCell className={cn(columnClass(COLUMNS[1]!), 'py-2 text-fg-secondary')}>{CATEGORY_LABEL[t.category]}</TableCell>
              <TableCell className="py-2">
                <WhatsAppStatusChip status={t.status} />
                {t.status === 'rejected' && t.rejectionReason && <span className="mt-0.5 block max-w-48 truncate text-xs text-danger-text" title={t.rejectionReason}>{t.rejectionReason}</span>}
              </TableCell>
              <TableCell className={cn(columnClass(COLUMNS[3]!), 'max-w-md truncate py-2 text-fg-secondary')}>{t.body}</TableCell>
              <TableCell className={cn(columnClass(COLUMNS[4]!), 'py-2 text-fg-secondary')}>{t.lastSyncedAt ? formatDateTimeIn(t.lastSyncedAt, tz) : '–'}</TableCell>
              <TableCell className={cn(columnClass(COLUMNS[5]!), 'py-2')}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${t.name}`}>
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => onOpen(t.id)}>{t.editable && writable ? 'Edit' : 'View'}</DropdownMenuItem>
                    {writable && (t.status === 'draft' || t.status === 'rejected') && <DropdownMenuItem onSelect={() => submit(t)}>Submit to Meta</DropdownMenuItem>}
                    {writable && <DropdownMenuItem onSelect={() => onDuplicate(t)}>Duplicate as a new template</DropdownMenuItem>}
                    {writable && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-danger-text" onSelect={() => setConfirmDelete(t)}>
                          Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))
        )}
      </DataTable>

      <Dialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{`Delete ${confirmDelete?.name ?? 'this template'}?`}</DialogTitle>
            <DialogDescription>
              {confirmDelete && confirmDelete.status !== 'draft'
                ? 'It is also deleted at Meta. Workflows and quick sends that use it stop working, and Meta blocks the same name for 30 days.'
                : 'The draft is deleted. Nothing was sent to Meta.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmDelete(null)}>Keep it</Button>
            <Button variant="danger" loading={m.remove.isPending} onClick={() => confirmDelete && remove(confirmDelete)}>
              Delete template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
