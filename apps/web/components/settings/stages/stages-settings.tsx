'use client';

import type { Pipeline, Stage } from '@vistar/shared';
import { Columns3, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { NativeSelect } from '@/components/common/native-select';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { useReadOnly } from '@/lib/auth/use-auth';
import { usePipelines, useReorderStages } from '@/lib/customization';
import { PackBadge } from '../common/pack-badge';
import { ReorderList, useOptimisticOrder } from '../common/reorder-list';
import { errorMessage, InlineAlert, ListSkeleton, LoadError } from '../common/states';
import { TAP_BUTTON, TAP_ICON } from '../common/touch';
import { AddStageDialog, DeleteStageDialog, EditStageDialog } from './stage-dialogs';
import { STAGE_TYPE_LABELS, toneOfStage } from './stage-colors';

export function StagesSettings() {
  const q = usePipelines();
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  if (q.isPending) return <ListSkeleton rows={6} label="Loading stages" />;
  if (q.isError) return <LoadError title="Stages did not load" onRetry={() => void q.refetch()} />;
  const pipelines = q.data;
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines.find((p) => p.isDefault) ?? pipelines[0];
  if (!pipeline) return <EmptyState icon={<Columns3 />} title="No pipeline yet" description="Install the Generic Sales pack in Settings > Industry to get the default pipeline." />;
  return (
    <>
      {pipelines.length > 1 && (
        <div className="max-w-xs">
          <label htmlFor="pipeline-picker" className="mb-1 block text-xs font-medium text-fg-secondary">
            Pipeline
          </label>
          <NativeSelect id="pipeline-picker" value={pipeline.id} onChange={(e) => setPipelineId(e.target.value)}>
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      <PipelineStages key={pipeline.id} pipeline={pipeline} />
    </>
  );
}

function PipelineStages({ pipeline }: { pipeline: Pipeline }) {
  const reorderStages = useReorderStages();
  const { reason } = useReadOnly();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Stage | null>(null);
  const [deleting, setDeleting] = useState<Stage | null>(null);
  const { order, reorder } = useOptimisticOrder(
    (stageIds) => reorderStages.mutateAsync({ pipelineId: pipeline.id, stageIds }),
    (e) => setError(`Order not saved. ${errorMessage(e)}`),
  );

  const byId = new Map(pipeline.stages.map((s) => [s.id, s]));
  const stages = order ? order.map((id) => byId.get(id)).filter((s): s is Stage => !!s) : pipeline.stages;

  const onReorder = (ids: string[]) => {
    setError(null);
    void reorder(ids);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">{pipeline.name} pipeline</h2>
            {pipeline.isDefault && <Chip tone="indigo">Default</Chip>}
            {pipeline.packKey && <PackBadge packKey={pipeline.packKey} />}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {pipeline.stages.length} stages. Drag a stage or use the arrows to change the order on the Board.
          </p>
        </div>
        <Button variant="primary" className={TAP_BUTTON} onClick={() => setAdding(true)} disabled={!!reason}>
          <Plus aria-hidden />
          Add stage
        </Button>
      </div>
      <div className="flex flex-col gap-3 p-3 sm:p-4">
        {reason && <InlineAlert tone="info">{reason}</InlineAlert>}
        {error && <InlineAlert onDismiss={() => setError(null)}>{error}</InlineAlert>}
        <ReorderList
          items={stages}
          getId={(s) => s.id}
          getLabel={(s) => s.name}
          onReorder={onReorder}
          disabled={!!reason}
          label={`${pipeline.name} pipeline stages, in order`}
          renderItem={(s, c) => (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-3 py-2 shadow-card sm:flex-nowrap">
              {c.handle}
              <span className="w-5 shrink-0 text-right text-xs text-muted tabular" aria-hidden>
                {c.index + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <Chip tone={toneOfStage(s)} dot size="md" className="max-w-full truncate">
                    {s.name}
                  </Chip>
                </span>
                <span className="font-mono text-2xs text-muted">{s.key}</span>
              </div>
              <span className="w-14 shrink-0 text-xs text-fg-secondary">{STAGE_TYPE_LABELS[s.type]}</span>
              <span className="w-12 shrink-0 text-right text-xs text-fg-secondary tabular" title="Win probability">
                <span className="sr-only">Win probability </span>
                {s.probability}%
              </span>
              <span className="ml-auto flex shrink-0 items-center">
                {c.moveButtons}
                <Button variant="ghost" size="icon-sm" className={TAP_ICON} aria-label={`Edit stage ${s.name}`} onClick={() => setEditing(s)} disabled={!!reason}>
                  <Pencil aria-hidden />
                </Button>
                <Button variant="ghost" size="icon-sm" className={TAP_ICON} aria-label={`Delete stage ${s.name}`} onClick={() => setDeleting(s)} disabled={!!reason}>
                  <Trash2 aria-hidden />
                </Button>
              </span>
            </div>
          )}
        />
        <p className="text-xs text-muted">Workflows and reports refer to stages by key, so renaming a stage does not break them.</p>
      </div>
      <AddStageDialog open={adding} onOpenChange={setAdding} pipeline={pipeline} />
      {editing && <EditStageDialog key={editing.id} stage={editing} pipeline={pipeline} onClose={() => setEditing(null)} />}
      {deleting && <DeleteStageDialog key={deleting.id} stage={deleting} onClose={() => setDeleting(null)} />}
    </Card>
  );
}
