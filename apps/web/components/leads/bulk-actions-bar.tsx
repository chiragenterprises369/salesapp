'use client';

import { useQueryClient } from '@tanstack/react-query';
import { stageTone, type BulkResult, type LeadBulkAction } from '@vistar/shared';
import { ArrowRightLeft, MessageCircle, Tag, Trash2, UserRoundPlus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
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
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { useBulkLeads } from '@/lib/leads/data';
import { useLeadsViewState } from '@/lib/leads/state';
import { useCan, useMe } from '@/lib/session/session';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { findCachedLeads } from './cached-leads';
import { KNOWN_TAGS, TONE_DOT_CLASS, useScopedUsers } from './lead-meta';
import { useLeadWords } from './use-lead-words';
import { usePipelineStages } from './use-stages';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './primitives/menu';
import { WhatsAppDialog } from './whatsapp-dialog';

function reportResult(
  message: (n: number) => string,
  res: BulkResult,
  plural: (n: number) => string,
) {
  if (res.failed.length === 0) {
    toast.success(message(res.succeeded));
    return;
  }
  const reasons = [...new Set(res.failed.map((f) => f.message))].slice(0, 2).join('; ');
  const fn = res.succeeded === 0 ? toast.error : toast.warning;
  fn(message(res.succeeded), { description: `${plural(res.failed.length)} skipped: ${reasons}` });
}

/**
 * Bulk actions for the current selection (Board select mode or Table checkboxes). Shown while
 * `selectedIds.size > 0`. Every action goes through POST /leads/bulk (`useBulkLeads`).
 */
export function BulkActionsBar({ panel }: { panel: 'company' | 'employee' }) {
  const selectedIds = useLeadsViewState((s) => s.selectedIds);
  const clearSelection = useLeadsViewState((s) => s.clearSelection);
  const canBulk = useCan('leads.bulk');
  const canAssign = useCan('leads.assign');
  const canDelete = useCan('leads.delete');
  const canSend = useCan('messages.send');
  const canUpdate = useCan('leads.update');
  const me = useMe();
  const users = useScopedUsers();
  const bulk = useBulkLeads();
  const qc = useQueryClient();
  const reduced = useReducedMotion();
  const { stages } = usePipelineStages();
  const w = useLeadWords();
  const plural = w.count;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const count = selectedIds.size;
  const visible = canBulk && count > 0;

  const run = async (
    message: (n: number) => string,
    action: LeadBulkAction,
    after?: () => void,
  ) => {
    try {
      const res = await bulk.mutateAsync(action);
      reportResult(message, res, plural);
      after?.();
    } catch {
      toast.error(`No ${w.leads} were changed. Check your connection and try again.`);
    }
  };
  const ids = () => [...selectedIds];

  return (
    <>
      <AnimatePresence>
        {visible && (
          <motion.div
            key="bulk"
            role="region"
            aria-label="Bulk actions"
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 12 }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            className={cn(
              'fixed inset-x-2 z-30 mx-auto flex w-auto max-w-max items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1.5 shadow-overlay',
              panel === 'employee' ? 'bottom-20 md:bottom-4' : 'bottom-4',
            )}
          >
            <span className="tabular px-2 text-sm font-medium whitespace-nowrap" aria-live="polite">
              {count} selected
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Clear selection"
              onClick={clearSelection}
            >
              <X aria-hidden />
            </Button>
            <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />

            {canAssign && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" aria-label={`Assign selected ${w.leads}`}>
                    <UserRoundPlus aria-hidden />
                    <span className="hidden sm:inline">Assign</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" className="w-56">
                  <DropdownMenuLabel>Assign to</DropdownMenuLabel>
                  {users.map((u) => (
                    <DropdownMenuItem
                      key={u.id}
                      onSelect={() =>
                        void run((n) => `Assigned ${plural(n)} to ${u.name}`, {
                          action: 'assign',
                          leadIds: ids(),
                          ownerId: u.id,
                        })
                      }
                    >
                      <Avatar name={u.name} size="xs" status={u.status} aria-hidden />
                      <span className="truncate">
                        {u.id === me?.user.id ? `${u.name} (you)` : u.name}
                      </span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() =>
                      void run((n) => `Unassigned ${plural(n)}`, {
                        action: 'assign',
                        leadIds: ids(),
                        ownerId: null,
                      })
                    }
                  >
                    Unassign
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {canUpdate && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Change stage of selected ${w.leads}`}
                  >
                    <ArrowRightLeft aria-hidden />
                    <span className="hidden sm:inline">Stage</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" className="w-48">
                  <DropdownMenuLabel>Move to stage</DropdownMenuLabel>
                  {stages.map((s) => (
                    <DropdownMenuItem
                      key={s.id}
                      onSelect={() =>
                        void run((n) => `Moved ${plural(n)} to ${s.name}`, {
                          action: 'change_stage',
                          leadIds: ids(),
                          stageId: s.id,
                        })
                      }
                    >
                      <span
                        aria-hidden
                        className={cn('size-2 rounded-full', TONE_DOT_CLASS[stageTone(s)])}
                      />
                      {s.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {canUpdate && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" aria-label={`Tag selected ${w.leads}`}>
                    <Tag aria-hidden />
                    <span className="hidden sm:inline">Tag</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" className="w-48">
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Add tag</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-48">
                      {KNOWN_TAGS.map((t) => (
                        <DropdownMenuItem
                          key={t}
                          onSelect={() =>
                            void run((n) => `Tagged ${plural(n)} "${t}"`, {
                              action: 'add_tags',
                              leadIds: ids(),
                              tags: [t],
                            })
                          }
                        >
                          {t}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Remove tag</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-48">
                      {KNOWN_TAGS.map((t) => (
                        <DropdownMenuItem
                          key={t}
                          onSelect={() =>
                            void run((n) => `Removed "${t}" from ${plural(n)}`, {
                              action: 'remove_tags',
                              leadIds: ids(),
                              tags: [t],
                            })
                          }
                        >
                          {t}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {canSend && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Send WhatsApp template to selected ${w.leads}`}
                onClick={() => setWhatsappOpen(true)}
              >
                <MessageCircle aria-hidden />
                <span className="hidden sm:inline">WhatsApp</span>
              </Button>
            )}

            {canDelete && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete selected ${w.leads}`}
                className="text-danger-text hover:text-danger-text"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 aria-hidden />
                <span className="hidden sm:inline">Delete</span>
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <WhatsAppDialog
        open={whatsappOpen}
        onOpenChange={setWhatsappOpen}
        leads={whatsappOpen ? findCachedLeads(qc, selectedIds) : []}
        count={count}
        sending={bulk.isPending}
        onSend={(t) =>
          run(
            (n) => `Sent "${t.label}" to ${plural(n)}`,
            { action: 'whatsapp_template', leadIds: ids(), templateId: t.id, variables: {} },
            () => setWhatsappOpen(false),
          )
        }
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete {plural(count)}?</DialogTitle>
            <DialogDescription>
              They disappear from the board, table and reports. An admin can restore them from the
              audit log.
            </DialogDescription>
          </DialogHeader>
          <DialogBody />
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={bulk.isPending}
              onClick={() =>
                void run(
                  (n) => `Deleted ${plural(n)}`,
                  { action: 'delete', leadIds: ids() },
                  () => {
                    setConfirmDelete(false);
                    clearSelection();
                  },
                )
              }
            >
              Delete {plural(count)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
