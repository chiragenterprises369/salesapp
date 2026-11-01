'use client';

import { NODE_CATALOG } from '@vistar/shared';
import { ChevronDown, ChevronUp, CircleAlert, CircleCheck, Play, Square, TriangleAlert, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/cn';
import { displayLabel } from '../lib/graph';
import { renderNodeMessage, type TemplateContext } from '../lib/preview';
import { issueCounts } from '../lib/validation';
import type { Commands } from '../hooks/use-commands';
import { useBuilder, useBuilderApi } from '../store/context';
import { STEP_STATUS_META } from './workflow-node';

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export function Dock({ commands, runContext, onStop, onRunAgain }: { commands: Commands; runContext: TemplateContext | null; onStop: () => void; onRunAgain: () => void }) {
  const store = useBuilderApi();
  const dock = useBuilder((s) => s.dock);
  const issues = useBuilder((s) => s.issues);
  const run = useBuilder((s) => s.run);
  const { errors, warnings } = issueCounts(issues);
  const tabsId = useId();
  const open = dock !== null;
  const panelRef = useRef<HTMLDivElement>(null);
  const logLength = run?.log.length ?? 0;
  // Keep the newest run step in view unless the user scrolled up to read earlier ones.
  useEffect(() => {
    const el = panelRef.current;
    if (!el || dock !== 'run') return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom || logLength <= 1) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [logLength, dock]);
  const setDock = (d: typeof dock) => store.getState().setDock(d);

  const runLabel = run ? (run.status === 'running' ? 'Test run · running' : run.status === 'completed' ? 'Test run · completed' : run.status === 'failed' ? 'Test run · failed' : `Test run · ${run.status}`) : null;

  return (
    <div className="shrink-0 border-t border-border bg-surface">
      <div className="flex h-9 items-center gap-1 px-2" role="tablist" aria-label="Issues and test run">
        <button
          role="tab"
          id={`${tabsId}-issues`}
          aria-selected={dock === 'issues'}
          aria-controls={`${tabsId}-panel`}
          onClick={() => setDock(dock === 'issues' ? null : 'issues')}
          className={cn('focus-ring flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors hover:bg-surface-2', dock === 'issues' ? 'bg-surface-3 text-fg' : 'text-fg-secondary')}
        >
          {errors > 0 ? <CircleAlert className="size-3.5 text-danger-text" aria-hidden /> : warnings > 0 ? <TriangleAlert className="size-3.5 text-warning-text" aria-hidden /> : <CircleCheck className="size-3.5 text-success-text" aria-hidden />}
          {errors === 0 && warnings === 0 ? 'No issues' : [errors && `${errors} ${errors === 1 ? 'error' : 'errors'}`, warnings && `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`].filter(Boolean).join(', ')}
        </button>
        {run && runLabel && (
          <button
            role="tab"
            id={`${tabsId}-run`}
            aria-selected={dock === 'run'}
            aria-controls={`${tabsId}-panel`}
            onClick={() => setDock(dock === 'run' ? null : 'run')}
            className={cn('focus-ring flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors hover:bg-surface-2', dock === 'run' ? 'bg-surface-3 text-fg' : 'text-fg-secondary')}
          >
            <span aria-hidden className={cn('size-1.5 rounded-full', run.status === 'running' ? 'animate-pulse bg-accent' : run.status === 'failed' ? 'bg-danger' : 'bg-success')} />
            {runLabel}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          {run && dock === 'run' && (
            <>
              {run.status === 'running' ? (
                <Button size="sm" variant="ghost" onClick={onStop}>
                  <Square aria-hidden />
                  Stop
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={onRunAgain}>
                  <Play aria-hidden />
                  Run again
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => store.getState().clearRun()} disabled={run.status === 'running'}>
                <X aria-hidden />
                Clear run
              </Button>
            </>
          )}
          <Button size="icon-sm" variant="ghost" aria-label={open ? 'Collapse panel' : 'Expand panel'} onClick={() => setDock(open ? null : run ? 'run' : 'issues')}>
            {open ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
          </Button>
        </div>
      </div>
      {open && (
        <div ref={panelRef} id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${dock}`} className="h-44 overflow-y-auto border-t border-border">
          {dock === 'issues' ? <IssuesList commands={commands} /> : <RunLog commands={commands} runContext={runContext} />}
        </div>
      )}
    </div>
  );
}

function IssuesList({ commands }: { commands: Commands }) {
  const issues = useBuilder((s) => s.issues);
  if (issues.length === 0) return <p className="px-4 py-4 text-xs text-muted">No issues. The workflow can be tested and activated.</p>;
  return (
    <ul className="divide-y divide-border">
      {issues.map((i) => (
        <li key={i.key}>
          <button
            type="button"
            disabled={!i.nodeId}
            onClick={() => i.nodeId && commands.focusNode(i.nodeId, { openSettings: true })}
            className="focus-ring flex w-full items-start gap-2 px-4 py-2 text-left text-xs hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent"
          >
            {i.severity === 'error' ? <CircleAlert className="mt-px size-3.5 shrink-0 text-danger-text" aria-hidden /> : <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning-text" aria-hidden />}
            <span className="sr-only">{i.severity === 'error' ? 'Error:' : 'Warning:'}</span>
            <span className="text-fg">{i.text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function RunLog({ commands, runContext }: { commands: Commands; runContext: TemplateContext | null }) {
  const run = useBuilder((s) => s.run);
  const nodes = useBuilder((s) => s.nodes);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  if (!run) return null;
  return (
    <div>
      <p className="px-4 pt-2 pb-1 text-2xs text-muted">
        Test lead {run.leadName} · started {time(run.startedAt)} · dry run, nothing was sent
      </p>
      {run.log.length === 0 && <p className="px-4 py-2 text-xs text-muted">Starting…</p>}
      <ol className="divide-y divide-border" aria-live="polite" aria-relevant="additions">
        {run.log.map((entry) => {
          const node = byId.get(entry.nodeId);
          const meta = STEP_STATUS_META[entry.status];
          const Icon = meta.icon;
          const message = node && runContext && NODE_CATALOG[node.type].sendsMessage && entry.status === 'succeeded' ? renderNodeMessage(node.type, node.data.config, runContext) : null;
          return (
            <li key={entry.key}>
              <button type="button" onClick={() => node && commands.focusNode(node.id)} className="focus-ring grid w-full grid-cols-[64px_96px_minmax(0,1fr)] items-start gap-3 px-4 py-2 text-left hover:bg-surface-2">
                <span className="pt-0.5 text-2xs text-muted tabular">{time(entry.at)}</span>
                <span className={cn('inline-flex h-5 w-fit items-center gap-1 rounded-full border px-1.5 text-2xs font-medium', meta.tone)}>
                  <Icon className="size-3" aria-hidden />
                  {meta.label}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-fg">
                    <span className="truncate">{node ? displayLabel(node.type, node.data) : entry.nodeId}</span>
                    {entry.branch && entry.branch !== 'out' && <Chip tone="neutral">{entry.branch.replace(/_/g, ' ')}</Chip>}
                    {entry.error && <Chip tone={entry.status === 'failed' ? 'red' : 'grey'}>{entry.error}</Chip>}
                  </span>
                  {entry.summary && <span className="block text-xs text-fg-secondary">{entry.summary}</span>}
                  {message && <span className="mt-1 block rounded-md border border-border bg-surface-2 px-2 py-1 text-xs whitespace-pre-wrap text-fg">{message}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
