'use client';

import type { WorkflowStepStatus } from '@vistar/shared';
import { NODE_CATALOG } from '@vistar/shared';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  LoaderCircle,
  SkipForward,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';
import {
  CATEGORY_META,
  categoryOf,
  handleLabel,
  isTrigger,
  outputsOf,
  TONE_CLASSES,
} from '../lib/catalog';
import { NodeIcon } from './node-icon';
import { nodeSize, sourceHandleFraction } from '../lib/geometry';
import { displayLabel, type FlowNode } from '../lib/graph';
import { configSummary } from '../lib/summary';
import { useBuilder, useEnv, useWorld } from '../store/context';

export const STEP_STATUS_META: Record<
  WorkflowStepStatus,
  { label: string; tone: string; icon: LucideIcon; spin?: boolean }
> = {
  pending: {
    label: 'Pending',
    tone: 'border-status-grey-border bg-status-grey-bg text-status-grey-fg',
    icon: Clock,
  },
  running: {
    label: 'Running',
    tone: 'border-status-blue-border bg-status-blue-bg text-status-blue-fg',
    icon: LoaderCircle,
    spin: true,
  },
  waiting: {
    label: 'Waiting',
    tone: 'border-status-amber-border bg-status-amber-bg text-status-amber-fg',
    icon: Clock,
  },
  succeeded: {
    label: 'Succeeded',
    tone: 'border-status-green-border bg-status-green-bg text-status-green-fg',
    icon: CircleCheck,
  },
  failed: {
    label: 'Failed',
    tone: 'border-status-red-border bg-status-red-bg text-status-red-fg',
    icon: CircleX,
  },
  skipped: {
    label: 'Skipped',
    tone: 'border-status-grey-border bg-status-grey-bg text-status-grey-fg',
    icon: SkipForward,
  },
};

function WorkflowNodeCard({ id, type, data, selected }: NodeProps<FlowNode>) {
  const world = useWorld();
  const env = useEnv();
  const updateNodeInternals = useUpdateNodeInternals();
  const bodyRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const raisedRef = useRef<HTMLDivElement>(null);
  const liftedRef = useRef<HTMLDivElement>(null);

  const outs = outputsOf(type, data.config);
  const outsKey = outs.join('|');
  const { w, h } = nodeSize(type, data.config);
  const category = categoryOf(type);
  const tone = TONE_CLASSES[category];
  const label = displayLabel(type, data);
  const secondary = data.label?.trim()
    ? `${CATEGORY_META[category].label} · ${typeLabel(type)}`
    : CATEGORY_META[category].label;
  const summary = configSummary(type, data.config);

  const issueKey = useBuilder((s) => {
    let e = 0;
    let wn = 0;
    for (const i of s.issues) {
      if (i.nodeId !== id) continue;
      if (i.severity === 'error') e++;
      else wn++;
    }
    return `${e}:${wn}`;
  });
  const [errors, warnings] = issueKey.split(':').map(Number) as [number, number];
  const step = useBuilder((s) => s.run?.steps[id]);
  const runDone = useBuilder((s) => !!s.run && s.run.status !== 'running');

  useEffect(() => {
    const body = bodyRef.current;
    const shadow = shadowRef.current;
    const raised = raisedRef.current;
    const lifted = liftedRef.current;
    if (!body || !shadow || !raised || !lifted) return;
    world.registerBody(id, { body, shadow, raised, lifted });
    return () => world.unregisterBody(id);
  }, [id, world]);

  // Re-measure handles when the outputs change (not on mount: React Flow measures new nodes itself,
  // and an early call would resolve the initial fitView before the other nodes are measured).
  const handlesKey = `${outsKey}:${w}:${h}`;
  const lastHandlesKey = useRef(handlesKey);
  useEffect(() => {
    if (lastHandlesKey.current === handlesKey) return;
    lastHandlesKey.current = handlesKey;
    updateNodeInternals(id);
  }, [id, handlesKey, updateNodeInternals]);

  const status = step ? STEP_STATUS_META[step.status] : null;
  const StatusIcon = status?.icon;
  const dimmed = runDone && !step;

  return (
    <div
      className="wf-node relative"
      style={{ width: w, height: h, perspective: 900 }}
      onPointerEnter={() => world.setHover(id, true)}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        world.setPointer(
          id,
          ((e.clientX - r.left) / r.width) * 2 - 1,
          ((e.clientY - r.top) / r.height) * 2 - 1,
        );
      }}
      onPointerLeave={() => world.setHover(id, false)}
      data-category={category}
    >
      {/* Ground shadows: follow the card's offset but stay on the canvas while it lifts. */}
      <div
        ref={shadowRef}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -bottom-1"
      >
        <div className="absolute inset-0 rounded-lg shadow-card" />
        <div ref={raisedRef} className="absolute inset-0 rounded-lg opacity-0 shadow-raised" />
        <div ref={liftedRef} className="absolute inset-0 rounded-lg opacity-0 shadow-lift" />
      </div>

      <div
        ref={bodyRef}
        className={cn('absolute inset-0 [transform-style:preserve-3d]', dimmed && 'opacity-55')}
      >
        {/* Thickness: a tinted lip under the card face. */}
        <div aria-hidden className={cn('absolute inset-0 translate-y-1 rounded-lg', tone.lip)} />
        <div
          className={cn(
            'wf-card relative flex h-full flex-col overflow-hidden rounded-lg border bg-surface transition-[border-color,box-shadow] duration-150 ease-standard',
            selected ? 'border-accent ring-1 ring-accent' : 'border-border',
          )}
        >
          <div className="flex items-start gap-2.5 px-3 pt-3">
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-md border',
                tone.chip,
              )}
            >
              <NodeIcon type={type} className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-2xs text-muted">{secondary}</p>
              <p className="truncate text-sm font-semibold text-fg" title={label}>
                {label}
              </p>
            </div>
          </div>
          <p className="truncate px-3 pt-2 text-xs text-fg-secondary" title={summary}>
            {summary}
          </p>
          {outs.length > 1 && (
            <div className="absolute inset-x-0 bottom-0 flex h-7 border-t border-border bg-surface-2">
              {outs.map((o) => (
                <span key={o} className="flex min-w-0 flex-1 justify-center px-1 pt-1">
                  <span
                    className="truncate text-2xs font-medium text-muted-strong"
                    title={handleLabel(type, data.config, o)}
                  >
                    {handleLabel(type, data.config, o)}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        {!isTrigger(type) && (
          <Handle
            type="target"
            position={Position.Top}
            id="in"
            isConnectable={env.canEdit}
            className="wf-handle"
            aria-label="Input"
          />
        )}
        {outs.map((o, i) => (
          <Handle
            key={o}
            type="source"
            position={Position.Bottom}
            id={o}
            isConnectable={env.canEdit}
            className="wf-handle"
            style={{ left: `${sourceHandleFraction(i, outs.length) * 100}%` }}
            aria-label={`Output ${handleLabel(type, data.config, o)}`}
          />
        ))}

        {(errors > 0 || warnings > 0) && (
          <span
            className={cn(
              'absolute -top-2.5 -left-2 flex h-5 items-center gap-0.5 rounded-full border px-1.5 text-2xs font-semibold',
              errors > 0
                ? 'border-status-red-border bg-status-red-bg text-status-red-fg'
                : 'border-status-amber-border bg-status-amber-bg text-status-amber-fg',
            )}
            title={
              errors > 0
                ? `${errors} ${errors === 1 ? 'error' : 'errors'}`
                : `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`
            }
          >
            {errors > 0 ? (
              <CircleAlert className="size-3" aria-hidden />
            ) : (
              <TriangleAlert className="size-3" aria-hidden />
            )}
            <span>{errors > 0 ? errors : warnings}</span>
            <span className="sr-only">
              {errors > 0
                ? errors === 1
                  ? ' error'
                  : ' errors'
                : warnings === 1
                  ? ' warning'
                  : ' warnings'}
            </span>
          </span>
        )}

        {status && StatusIcon && (
          <span
            className={cn(
              'absolute -top-2.5 right-3 flex h-5 items-center gap-1 rounded-full border px-1.5 text-2xs font-medium',
              status.tone,
            )}
            role="status"
          >
            <StatusIcon className={cn('size-3', status.spin && 'animate-spin')} aria-hidden />
            {status.label}
            {step && step.visit > 1 ? ` ×${step.visit}` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

function typeLabel(type: FlowNode['type']): string {
  return NODE_CATALOG[type].label;
}

export const WorkflowNodeComponent = memo(WorkflowNodeCard);
