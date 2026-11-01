'use client';

import { WORKFLOW_TEMPLATES, type WorkflowGraph } from '@vistar/shared';
import { ArrowLeft, Eye } from 'lucide-react';
import Link from 'next/link';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { toast } from '@/components/ui/toast';
import { WorkflowBuilder } from '@/features/workflow-builder';
import { useReadOnly } from '@/lib/auth/use-auth';
import { useCan } from '@/lib/session/session';
import { MOCK_WORKFLOWS, WORKFLOW_STATUS_LABEL, WORKFLOW_STATUS_TONE } from '../mock-workflows';

/** Workflow builder page: header + the frontend-physics builder (read-only without workflows.edit). */
export function WorkflowEditor({ id, templateKey }: { id: string; templateKey: string | null }) {
  const canEdit = useCan('workflows.edit');
  const { readOnly: supportSession } = useReadOnly();
  const isNew = id === 'new';
  const existing = MOCK_WORKFLOWS.find((w) => w.id === id);
  const template = isNew && templateKey ? WORKFLOW_TEMPLATES.find((t) => t.key === templateKey) : undefined;
  const readOnly = !canEdit || supportSession;

  if (!isNew && !existing) {
    return (
      <RequirePermission anyOf={['workflows.read']}>
        <EmptyState
          title="Workflow not found"
          description="It may have been deleted, or the link is incomplete."
          action={
            <Button asChild variant="primary">
              <Link href="/app/workflows">Back to workflows</Link>
            </Button>
          }
        />
      </RequirePermission>
    );
  }

  const name = existing?.name ?? (template ? `${template.name} (copy)` : 'Untitled workflow');
  const graph: WorkflowGraph | undefined = existing?.graph ?? template?.graph;
  const onSave = async () => {
    await new Promise((r) => setTimeout(r, 200));
    toast.success('Draft saved');
  };

  return (
    <RequirePermission anyOf={isNew ? ['workflows.edit'] : ['workflows.read']}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/app/workflows">
              <ArrowLeft aria-hidden />
              Workflows
            </Link>
          </Button>
          <h1 className="text-lg font-semibold tracking-tight text-fg">{name}</h1>
          {existing ? (
            <Chip tone={WORKFLOW_STATUS_TONE[existing.status]} dot>
              {WORKFLOW_STATUS_LABEL[existing.status]}
            </Chip>
          ) : (
            <Chip tone="grey" dot>
              Draft
            </Chip>
          )}
          {readOnly && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-strong">
              <Eye aria-hidden className="size-3.5" />
              {supportSession ? 'Read-only support session' : 'View only. Your role cannot edit workflows.'}
            </span>
          )}
        </div>
        <WorkflowBuilder workflowId={id} initialGraph={graph} readOnly={readOnly} onSave={onSave} />
      </div>
    </RequirePermission>
  );
}
