'use client';

import { NODE_CATALOG, nodeConfigSchemas, WORKFLOW_TEMPLATES, type NodeType } from '@vistar/shared';
import { ArrowRight, CircleAlert, Copy, Trash, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { useMe } from '@/lib/session/session';
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  categoryOf,
  handleLabel,
  TONE_CLASSES,
} from '../../lib/catalog';
import { NodeIcon } from '../node-icon';
import { displayLabel, type FlowNode } from '../../lib/graph';
import { previewContext, renderNodeMessage } from '../../lib/preview';
import { configErrors } from '../../lib/validation';
import type { Commands } from '../../hooks/use-commands';
import { useBuilder, useBuilderApi, useEnv } from '../../store/context';
import {
  AssignOwnerEditor,
  ConditionEditor,
  ScheduleEditor,
  SwitchEditor,
  UpdateFieldEditor,
  WaitEditor,
  WhatsAppTemplateEditor,
  type Config,
  type EditorProps,
} from './editors';
import { MessagePreview, Section } from './fields';
import { SchemaFields, type ZodLike } from './schema-form';
import { cn } from '@/lib/cn';

export function Inspector({ commands }: { commands: Commands }) {
  // Primitive selector: dragging a selected step must not re-render the whole form.
  const view = useBuilder((s) => {
    let id: string | null = null;
    let count = 0;
    for (const n of s.nodes) {
      if (n.selected) {
        count++;
        id = n.id;
      }
    }
    if (count === 1) return `node:${id}`;
    if (count > 1) return `multi:${count}`;
    const sel = s.edges.filter((e) => e.selected);
    return sel.length === 1 ? `edge:${sel[0]!.id}` : 'none';
  });
  const [kind, ...rest] = view.split(':');
  const arg = rest.join(':');

  return (
    <aside
      className="flex w-80 shrink-0 flex-col border-l border-border bg-surface"
      aria-label="Step settings"
    >
      {kind === 'node' ? (
        <NodeInspectorById key={arg} id={arg} commands={commands} />
      ) : kind === 'multi' ? (
        <MultiInspector count={Number(arg)} commands={commands} />
      ) : kind === 'edge' ? (
        <EdgeInspector edgeId={arg} />
      ) : (
        <WorkflowOverview />
      )}
    </aside>
  );
}

function NodeInspectorById({ id, commands }: { id: string; commands: Commands }) {
  const type = useBuilder((s) => s.nodes.find((n) => n.id === id)?.type);
  const data = useBuilder((s) => s.nodes.find((n) => n.id === id)?.data);
  if (!type || !data) return null;
  return <NodeInspector node={{ id, type, data }} commands={commands} />;
}

function PanelHeader({
  title,
  eyebrow,
  icon,
  onClose,
}: {
  title: string;
  eyebrow: string;
  icon?: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="flex items-start gap-2.5 border-b border-border px-4 py-3">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-2xs text-muted">{eyebrow}</p>
        <h2 className="truncate text-sm font-semibold text-fg">{title}</h2>
      </div>
      {onClose && (
        <Button size="icon-sm" variant="ghost" aria-label="Close settings" onClick={onClose}>
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}

type NodeView = Pick<FlowNode, 'id' | 'type' | 'data'>;

function NodeInspector({ node, commands }: { node: NodeView; commands: Commands }) {
  const store = useBuilderApi();
  const env = useEnv();
  const me = useMe();
  const focusRequest = useBuilder((s) => s.focusRequest);
  const issues = useBuilder((s) => s.issues);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const type = node.type;
  const def = NODE_CATALOG[type];
  const category = categoryOf(type);
  const config = node.data.config;
  const errors = useMemo(() => configErrors(type, config), [type, config]);
  const nodeIssues = issues.filter(
    (i) => i.nodeId === node.id && (i.path === null || !(i.path in errors)),
  );
  useEffect(() => {
    if (focusRequest !== node.id) return;
    store.getState().requestFocus(null);
    requestAnimationFrame(() => firstRef.current?.focus());
  }, [focusRequest, node.id, store]);

  const onConfig: EditorProps['onChange'] = (next, opts) =>
    store.getState().updateConfig(node.id, () => next, opts);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      commands.focusNode(node.id, { center: false });
    }
  };

  const message = def.sendsMessage
    ? renderNodeMessage(
        type,
        config,
        previewContext({ 'workspace.name': me?.workspace.name ?? 'Shakti Industries' }),
      )
    : null;
  const hours = me?.workspace.businessHours;
  const hoursText = hours
    ? businessHoursText(hours as Record<string, Array<{ start: string; end: string }>>)
    : 'Mon-Fri 09:30-18:30';

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <PanelHeader
        eyebrow={`${CATEGORY_META[category].label} · ${def.label}`}
        title={displayLabel(type, node.data)}
        icon={
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-md border',
              TONE_CLASSES[category].chip,
            )}
          >
            <NodeIcon type={type} className="size-4" />
          </span>
        }
        onClose={() => store.getState().select([])}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <fieldset disabled={!env.canEdit} className="contents">
          {nodeIssues.length > 0 && (
            <div className="px-4 pt-3">
              <ul
                className="flex flex-col gap-1.5 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2"
                aria-label="Problems with this step"
              >
                {nodeIssues.map((i) => (
                  <li key={i.key} className="flex items-start gap-1.5 text-xs text-status-red-fg">
                    {i.severity === 'error' ? (
                      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    ) : (
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    )}
                    <span>{i.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Section title="Step">
            <FormField label="Name" hint={`Shown on the canvas. Default: ${def.label}.`}>
              <Input
                ref={firstRef}
                value={node.data.label ?? ''}
                placeholder={def.label}
                maxLength={80}
                onChange={(e) =>
                  store.getState().updateNodeData(node.id, { label: e.target.value })
                }
              />
            </FormField>
            <FormField label="Notes" hint="For your team. Not sent to leads.">
              <Textarea
                rows={2}
                value={node.data.notes ?? ''}
                maxLength={500}
                onChange={(e) =>
                  store.getState().updateNodeData(node.id, { notes: e.target.value })
                }
              />
            </FormField>
          </Section>
          <Section title="Settings">
            <p className="-mt-1 text-xs text-muted">{def.description}</p>
            <ConfigForm
              type={type}
              config={config}
              errors={errors}
              onChange={onConfig}
              timeZone={me?.workspace.timezone ?? 'Asia/Kolkata'}
              hoursText={hoursText}
            />
            {def.sendsMessage && type !== 'action.send_whatsapp_template' && (
              <MessagePreview text={message} />
            )}
            {type === 'action.send_whatsapp_text' && (
              <p className="text-2xs text-muted">
                Free-form WhatsApp only sends within 24 hours of the lead’s last message. Otherwise
                this step is skipped.
              </p>
            )}
          </Section>
          <OutputsSection node={node} />
          {env.canEdit && (
            <div className="flex gap-2 border-t border-border px-4 py-3">
              <Button size="sm" variant="ghost" onClick={() => commands.duplicate()}>
                <Copy aria-hidden />
                Duplicate
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger-text hover:text-danger-text"
                onClick={() => commands.deleteSelection()}
              >
                <Trash aria-hidden />
                Delete step
              </Button>
            </div>
          )}
        </fieldset>
      </div>
    </div>
  );
}

function ConfigForm({
  type,
  config,
  errors,
  onChange,
  timeZone,
  hoursText,
}: {
  type: NodeType;
  config: Config;
  errors: Record<string, string>;
  onChange: EditorProps['onChange'];
  timeZone: string;
  hoursText: string;
}) {
  const props: EditorProps = { config, onChange, errors };
  switch (type) {
    case 'logic.switch':
      return <SwitchEditor {...props} />;
    case 'logic.condition':
      return <ConditionEditor {...props} />;
    case 'action.assign_owner':
      return <AssignOwnerEditor {...props} />;
    case 'trigger.schedule':
      return <ScheduleEditor {...props} timeZone={timeZone} />;
    case 'logic.wait':
      return (
        <WaitEditor {...props} hoursText={`Workspace hours: ${hoursText}. Holidays are skipped.`} />
      );
    case 'action.send_whatsapp_template':
      return <WhatsAppTemplateEditor {...props} />;
    case 'action.update_field':
      return <UpdateFieldEditor {...props} />;
    default: {
      const shape = (nodeConfigSchemas[type] as unknown as ZodLike).shape ?? {};
      if (Object.keys(shape).length === 0)
        return <p className="text-xs text-muted">Nothing to set up. This step runs as is.</p>;
      return (
        <SchemaFields
          type={type}
          shape={shape}
          value={config}
          errors={errors}
          onChange={(next, key) => onChange(next, { coalesceKey: `field:${key}` })}
        />
      );
    }
  }
}

function OutputsSection({ node }: { node: NodeView }) {
  const edges = useBuilder((s) => s.edges);
  const nodes = useBuilder((s) => s.nodes);
  const outs = NODE_CATALOG[node.type].outputs(node.data.config);
  if (outs.length === 0) return null;
  return (
    <Section title={outs.length > 1 ? 'Branches' : 'Next step'}>
      <ul className="flex flex-col gap-1">
        {outs.map((o) => {
          const e = edges.find((x) => x.source === node.id && (x.sourceHandle ?? 'out') === o);
          const t = e ? nodes.find((n) => n.id === e.target) : undefined;
          return (
            <li key={o} className="flex items-center gap-2 text-xs">
              {outs.length > 1 && (
                <Chip tone="neutral">{handleLabel(node.type, node.data.config, o)}</Chip>
              )}
              <ArrowRight className="size-3.5 shrink-0 text-muted" aria-hidden />
              {t ? (
                <span className="truncate text-fg">{displayLabel(t.type, t.data)}</span>
              ) : (
                <span className="text-muted">Not connected. Drag from the handle to a step.</span>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function MultiInspector({ count, commands }: { count: number; commands: Commands }) {
  const env = useEnv();
  return (
    <div className="flex flex-col">
      <PanelHeader eyebrow="Selection" title={`${count} steps selected`} />
      <div className="flex flex-col gap-3 px-4 py-4 text-xs text-muted">
        <p>Drag any selected step to move them together, or use the arrow keys.</p>
        {env.canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => commands.duplicate()}>
              <Copy aria-hidden />
              Duplicate
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger-text hover:text-danger-text"
              onClick={() => commands.deleteSelection()}
            >
              <Trash aria-hidden />
              Delete {count} steps
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function EdgeInspector({ edgeId }: { edgeId: string }) {
  const store = useBuilderApi();
  const env = useEnv();
  const edge = useBuilder((s) => s.edges.find((e) => e.id === edgeId));
  const source = useBuilder((s) => s.nodes.find((n) => n.id === edge?.source));
  const target = useBuilder((s) => s.nodes.find((n) => n.id === edge?.target));
  if (!edge || !source || !target) return null;
  const outs = NODE_CATALOG[source.type].outputs(source.data.config);
  return (
    <div className="flex flex-col">
      <PanelHeader
        eyebrow="Connection"
        title={`${displayLabel(source.type, source.data)} → ${displayLabel(target.type, target.data)}`}
        onClose={() => store.getState().select([])}
      />
      <div className="flex flex-col gap-3 px-4 py-4">
        {outs.length > 1 && (
          <p className="text-xs text-fg-secondary">
            Branch:{' '}
            <Chip tone="neutral">
              {handleLabel(source.type, source.data.config, edge.sourceHandle ?? 'out')}
            </Chip>
          </p>
        )}
        <p className="text-xs text-muted">
          To change where it goes, drag a new connection from the same output. Each output connects
          to one step.
        </p>
        {env.canEdit && (
          <Button
            size="sm"
            variant="ghost"
            className="self-start text-danger-text hover:text-danger-text"
            onClick={() => store.getState().deleteEdge(edge.id)}
          >
            <Trash aria-hidden />
            Delete connection
          </Button>
        )}
      </div>
    </div>
  );
}

function WorkflowOverview() {
  const nodes = useBuilder((s) => s.nodes);
  const templateKey = useBuilder((s) => s.templateKey);
  const env = useEnv();
  const tpl = WORKFLOW_TEMPLATES.find((t) => t.key === templateKey);
  const counts = CATEGORY_ORDER.map((c) => ({
    c,
    n: nodes.filter((x) => categoryOf(x.type) === c).length,
  })).filter((x) => x.n > 0);
  return (
    <div className="flex flex-col">
      <PanelHeader eyebrow="Workflow" title={tpl ? tpl.name : 'Overview'} />
      <div className="flex flex-col gap-4 px-4 py-4">
        {tpl && <p className="text-xs text-fg-secondary">{tpl.description}</p>}
        {nodes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-strong px-3 py-4 text-xs text-muted">
            <p className="font-medium text-fg">Start with a trigger</p>
            <p className="mt-1">
              {env.canEdit
                ? 'Pick a trigger from the steps list, for example IndiaMART lead, then add actions below it.'
                : 'This workflow has no steps yet.'}
            </p>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-2">
            {counts.map(({ c, n }) => (
              <div key={c} className="rounded-md border border-border px-2.5 py-2">
                <dt className="text-2xs text-muted">{CATEGORY_META[c].plural}</dt>
                <dd className="text-base font-semibold text-fg tabular">{n}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="text-xs text-muted">
          <p className="mb-1.5 font-medium text-fg-secondary">Tips</p>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {env.canEdit ? (
              <>
                <li>Select a step to edit its settings, or press Enter on a focused step.</li>
                <li>Drag from a step’s bottom handle to connect it.</li>
                <li>Shift-drag on the canvas to select several steps.</li>
              </>
            ) : (
              <li>Select a step to see its settings.</li>
            )}
            <li>Press ? for keyboard shortcuts.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_SHORT: Record<string, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

/** "Mon-Fri 09:30-18:30, Sat 10:00-14:00" */
export function businessHoursText(
  hours: Record<string, Array<{ start: string; end: string }>>,
): string {
  const groups: Array<{ from: string; to: string; slot: string }> = [];
  for (const d of DAY_ORDER) {
    const slots = hours[d] ?? [];
    if (slots.length === 0) continue;
    const slot = slots.map((s) => `${s.start}-${s.end}`).join(', ');
    const last = groups[groups.length - 1];
    const prevDay = DAY_ORDER[DAY_ORDER.indexOf(d) - 1];
    if (last && last.slot === slot && last.to === prevDay) last.to = d;
    else groups.push({ from: d, to: d, slot });
  }
  return (
    groups
      .map((g) => `${DAY_SHORT[g.from]}${g.to !== g.from ? `-${DAY_SHORT[g.to]}` : ''} ${g.slot}`)
      .join(', ') || 'Closed'
  );
}
