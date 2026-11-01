'use client';

import { formatNumber, WORKFLOW_TEMPLATES } from '@vistar/shared';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ChevronRight, FilePlus2, Plus, Workflow } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable, columnClass, type DataColumn } from '@/components/common/data-table';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TableCell, TableRow } from '@/components/ui/table';
import { useReadOnly } from '@/lib/auth/use-auth';
import { useCan } from '@/lib/session/session';
import { MOCK_WORKFLOWS, triggerLabel, triggerOf, WORKFLOW_STATUS_LABEL, WORKFLOW_STATUS_TONE } from './mock-workflows';

const COLUMNS: DataColumn[] = [
  { key: 'name', label: 'Workflow' },
  { key: 'trigger', label: 'Trigger', hideBelow: 'md' },
  { key: 'status', label: 'Status' },
  { key: 'runs', label: 'Runs', align: 'right', hideBelow: 'sm' },
  { key: 'failed', label: 'Failed', align: 'right', hideBelow: 'lg' },
  { key: 'updated', label: 'Last edited', hideBelow: 'lg' },
];

/** Workflows list (mock from WORKFLOW_TEMPLATES until GET /workflows). */
export function WorkflowsList() {
  const router = useRouter();
  const canEdit = useCan('workflows.edit');
  const { readOnly } = useReadOnly();
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: ['workflows', 'list'],
    queryFn: async () => {
      await new Promise((r) => setTimeout(r, 250));
      return MOCK_WORKFLOWS;
    },
  });
  const rows = query.data ?? [];
  const status = query.isPending ? 'loading' : query.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';

  return (
    <RequirePermission anyOf={['workflows.read']}>
      <div className="max-w-6xl">
        <PageHeader
          title="Workflows"
          description="Automations that reply, assign, follow up and create tasks when something happens to a lead."
          actions={
            canEdit && (
              <Button variant="primary" onClick={() => setCreating(true)} disabled={readOnly} title={readOnly ? 'Read-only support session' : undefined}>
                <Plus aria-hidden />
                New workflow
              </Button>
            )
          }
        />
        <DataTable
          label="Workflows"
          columns={COLUMNS}
          status={status}
          onRetry={() => void query.refetch()}
          empty={{
            icon: <Workflow />,
            title: 'No workflows yet',
            description: 'Start from a template such as IndiaMART nurturing, then adjust the steps.',
            action: canEdit ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                New workflow
              </Button>
            ) : undefined,
          }}
        >
          {rows.map((w) => (
            <TableRow key={w.id} className="cursor-pointer" onClick={(e) => !(e.target as HTMLElement).closest('a,button') && router.push(`/app/workflows/${w.id}`)}>
              <TableCell className="w-full max-w-0 py-2 whitespace-normal">
                <Link href={`/app/workflows/${w.id}`} className="focus-ring block rounded-xs font-medium text-fg hover:underline">
                  {w.name}
                </Link>
                <span className="block truncate text-xs text-muted">{w.description}</span>
              </TableCell>
              <TableCell className={`${columnClass(COLUMNS[1]!)} text-fg-secondary`}>{triggerLabel(w.triggerType)}</TableCell>
              <TableCell>
                <Chip tone={WORKFLOW_STATUS_TONE[w.status]} dot>
                  {WORKFLOW_STATUS_LABEL[w.status]}
                </Chip>
              </TableCell>
              <TableCell className={`${columnClass(COLUMNS[3]!)} tabular`}>{formatNumber(w.stats.runs)}</TableCell>
              <TableCell className={`${columnClass(COLUMNS[4]!)} tabular ${w.stats.failed ? 'text-danger-text' : 'text-muted'}`}>{w.stats.failed}</TableCell>
              <TableCell className={`${columnClass(COLUMNS[5]!)} text-fg-secondary`}>{format(new Date(w.updatedAt), 'd MMM, h:mm a')}</TableCell>
            </TableRow>
          ))}
        </DataTable>
        {!canEdit && <p className="mt-3 text-xs text-muted-strong">You can view workflows and their runs. Ask a company admin to make changes.</p>}
        <NewWorkflowDialog open={creating} onOpenChange={setCreating} />
      </div>
    </RequirePermission>
  );
}

function NewWorkflowDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const start = (template?: string) => {
    onOpenChange(false);
    router.push(template ? `/app/workflows/new?template=${encodeURIComponent(template)}` : '/app/workflows/new');
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New workflow</DialogTitle>
          <DialogDescription>Start from a template that already handles common IndiaMART and WhatsApp follow-ups, or build from a blank canvas.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="flex flex-col gap-2">
            {WORKFLOW_TEMPLATES.map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => start(t.key)}
                  className="focus-ring flex w-full items-center gap-3 rounded-md border border-border bg-surface p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-fg">{t.name}</span>
                    <span className="block text-xs text-muted">
                      {triggerLabel(triggerOf(t.graph))} · {t.graph.nodes.length} steps
                    </span>
                    <span className="mt-0.5 block text-xs text-fg-secondary">{t.description}</span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => start()}
                className="focus-ring flex w-full items-center gap-3 rounded-md border border-dashed border-border-strong p-3 text-left transition-colors hover:bg-surface-2"
              >
                <FilePlus2 aria-hidden className="size-4 text-fg-secondary" />
                <span className="text-sm font-medium text-fg">Blank workflow</span>
              </button>
            </li>
          </ul>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
