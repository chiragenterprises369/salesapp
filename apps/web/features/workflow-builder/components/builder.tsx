'use client';

import { DEFAULT_BUSINESS_HOURS, type WorkflowGraph } from '@vistar/shared';
import { ReactFlowProvider } from '@xyflow/react';
import { MonitorSmartphone } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useCan, useMe } from '@/lib/session/session';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { SNAP } from '../lib/geometry';
import { displayLabel, resolveInitialGraph } from '../lib/graph';
import {
  PACKET_MS,
  runContext,
  startMockRun,
  type RunEvent,
  type TestRunInput,
} from '../lib/mock-runner';
import {
  loadFlatMode,
  loadMeta,
  loadVersions,
  saveDuplicate,
  saveFlatMode,
  saveMeta,
  saveVersions,
  subscribeFlatMode,
} from '../lib/storage';
import { issueCounts } from '../lib/validation';
import { useCommands, type Commands } from '../hooks/use-commands';
import { PhysicsWorld } from '../physics/world';
import {
  createBuilderStore,
  graphFromState,
  type BuilderStore,
  type LocalVersion,
} from '../store/builder-store';
import {
  BuilderProvider,
  useBuilder,
  useBuilderApi,
  useEnv,
  useWorld,
  type BuilderEnv,
} from '../store/context';
import { Canvas } from './canvas';
import { DEFAULT_TEST_INPUT, ShortcutsDialog, TestRunDialog, VersionsDialog } from './dialogs';
import { Dock } from './dock';
import { Inspector } from './inspector/inspector';
import { Palette } from './palette';
import { STEP_STATUS_META } from './workflow-node';
import { Toolbar } from './toolbar';

export interface BuilderProps {
  workflowId: string;
  initialGraph?: WorkflowGraph;
  readOnly?: boolean;
  onSave?: (graph: WorkflowGraph) => Promise<void> | void;
}

const WIDE_QUERY = '(min-width: 1024px)';
function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(WIDE_QUERY);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

export function BuilderRoot(props: BuilderProps) {
  const me = useMe();
  const canEditPerm = useCan('workflows.edit');
  const canPublish = useCan('workflows.publish');
  const reducedMotion = useReducedMotion();
  const wide = useWide();
  const flatPref = useSyncExternalStore(subscribeFlatMode, loadFlatMode, () => false);
  const aiEnabled = me?.workspace.features.ai_node ?? false;

  const [store] = useState<BuilderStore>(() => {
    const init = resolveInitialGraph(props.workflowId, props.initialGraph);
    return createBuilderStore({
      workflowId: props.workflowId,
      name: init.name,
      templateKey: init.templateKey,
      graph: init.graph,
      status: 'draft',
      versions: [],
      activeVersion: null,
      aiEnabled,
    });
  });
  const [world] = useState(() => new PhysicsWorld(store));
  useLayoutEffect(() => {
    world.attach();
    return () => world.detach();
  }, [world]);

  // Local (mock) persistence loads after mount so server and client markup agree.
  useEffect(() => {
    const versions = loadVersions(props.workflowId);
    const meta = loadMeta(props.workflowId);
    store.getState().setVersions(versions, meta?.activeVersion ?? null);
    if (meta?.status) store.getState().setStatus(meta.status);
  }, [props.workflowId, store]);

  useEffect(() => store.getState().setAiEnabled(aiEnabled), [aiEnabled, store]);

  const physics = !flatPref && !reducedMotion;
  useLayoutEffect(
    () => world.configure({ physics, motion: !reducedMotion }),
    [world, physics, reducedMotion],
  );

  const env = useMemo<BuilderEnv>(
    () => ({
      canEdit: !props.readOnly && canEditPerm && wide,
      canPublish,
      physics,
      reducedMotion,
      aiEnabled,
      workspaceName: me?.workspace.name ?? 'Your business',
      userName: me?.user.name ?? null,
    }),
    [props.readOnly, canEditPerm, wide, canPublish, physics, reducedMotion, aiEnabled, me],
  );

  const toggleFlat = useCallback(() => saveFlatMode(!loadFlatMode()), []);

  return (
    <BuilderProvider value={{ store, world, env }}>
      <ReactFlowProvider>
        <BuilderShell
          {...props}
          narrow={!wide}
          flat={!physics}
          flatForced={reducedMotion}
          onToggleFlat={toggleFlat}
          viewOnlyReason={!props.readOnly && !canEditPerm}
        />
      </ReactFlowProvider>
    </BuilderProvider>
  );
}

function BuilderShell({
  workflowId,
  onSave,
  narrow,
  flat,
  flatForced,
  onToggleFlat,
  viewOnlyReason,
}: BuilderProps & {
  narrow: boolean;
  flat: boolean;
  flatForced: boolean;
  onToggleFlat: () => void;
  viewOnlyReason: boolean;
}) {
  const store = useBuilderApi();
  const world = useWorld();
  const env = useEnv();
  const me = useMe();
  const commands = useCommands();
  const rootRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [lastInput, setLastInput] = useState<TestRunInput>(DEFAULT_TEST_INPUT);
  const cancelRun = useRef<(() => void) | null>(null);
  const running = useBuilder((s) => s.run?.status === 'running');
  const announcement = useBuilder((s) => s.announcement);

  useEffect(() => () => cancelRun.current?.(), []);

  const persistMeta = useCallback(() => {
    const s = store.getState();
    saveMeta(workflowId, { status: s.status, activeVersion: s.activeVersion });
    saveVersions(workflowId, s.versions);
  }, [store, workflowId]);

  const save = useCallback(
    async (opts: { activate?: boolean } = {}) => {
      if (!env.canEdit) return false;
      const s = store.getState();
      const version = Math.max(0, ...s.versions.map((v) => v.version)) + 1;
      const graph = graphFromState(s, version, true);
      setSaving(true);
      try {
        await onSave?.(graph);
      } catch {
        toast.error('Could not save the workflow. Check your connection and try again.');
        return false;
      } finally {
        setSaving(false);
      }
      const entry: LocalVersion = {
        version,
        name: s.name,
        graph,
        savedAt: new Date().toISOString(),
        savedBy: env.userName,
        note: opts.activate ? 'Activated' : null,
      };
      store.getState().markSaved(entry, { activate: opts.activate });
      persistMeta();
      const { errors } = issueCounts(store.getState().issues);
      if (opts.activate) toast.success(`Workflow activated with version ${version}`);
      else
        toast.success(
          `Saved version ${version}`,
          errors
            ? {
                description: `${errors} ${errors === 1 ? 'error needs' : 'errors need'} fixing before you can activate.`,
              }
            : undefined,
        );
      return true;
    },
    [env.canEdit, env.userName, onSave, persistMeta, store],
  );

  const activate = useCallback(() => {
    const { errors } = issueCounts(store.getState().issues);
    if (errors > 0 || !env.canPublish) return;
    void save({ activate: true });
  }, [env.canPublish, save, store]);

  const deactivate = useCallback(() => {
    store.getState().setStatus('draft');
    persistMeta();
    toast('Workflow set to draft', {
      description: 'New leads will not start it until you activate it again.',
    });
  }, [persistMeta, store]);

  const duplicate = useCallback(() => {
    const s = store.getState();
    const name = `${s.name} (copy)`;
    saveDuplicate({
      id: `${workflowId}-copy-${Date.now().toString(36)}`,
      name,
      graph: graphFromState(s, 0, true),
    });
    toast.success(`Duplicated as “${name}”`, { description: 'Find the copy in Workflows.' });
  }, [store, workflowId]);

  const restore = useCallback(
    (v: LocalVersion) => {
      const prev = new Map(store.getState().nodes.map((n) => [n.id, { ...n.position }]));
      store.getState().replaceGraph(v.graph);
      store.getState().setName(v.name);
      world.glide(prev);
      setHistoryOpen(false);
      toast.success(`Restored version ${v.version}`, {
        description: 'Save to keep it. Undo brings back your previous draft.',
      });
    },
    [store, world],
  );

  const onRunEvent = useCallback(
    (e: RunEvent) => {
      const s = store.getState();
      if (e.type === 'workflow.step_updated') {
        const { step, nextEdgeId } = e.payload;
        s.applyStep(step, nextEdgeId);
        if (nextEdgeId) world.sendPacket(nextEdgeId, PACKET_MS);
        if (step.status === 'running') commands.follow(step.nodeId);
        else {
          const node = s.nodes.find((n) => n.id === step.nodeId);
          if (node)
            s.announce(
              `${displayLabel(node.type, node.data)}: ${STEP_STATUS_META[step.status].label.toLowerCase()}`,
            );
        }
      } else if (e.payload.status !== 'running') {
        s.finishRun(e.payload.status);
        s.announce(`Test run ${e.payload.status}`);
      }
    },
    [commands, store, world],
  );

  const startRun = useCallback(
    (input: TestRunInput) => {
      cancelRun.current?.();
      setLastInput(input);
      setTestOpen(false);
      const s = store.getState();
      if (issueCounts(s.issues).errors > 0) return;
      const { runId, cancel } = startMockRun({
        graph: graphFromState(s),
        workflowId,
        workspaceId: me?.workspace.id ?? '',
        workspaceName: env.workspaceName,
        businessHours: me?.workspace.businessHours ?? DEFAULT_BUSINESS_HOURS,
        timeZone: me?.workspace.timezone ?? 'Asia/Kolkata',
        input,
        onEvent: onRunEvent,
      });
      s.startRun(runId, input.lead.name);
      cancelRun.current = cancel;
    },
    [env.workspaceName, me, onRunEvent, store, workflowId],
  );

  const stopRun = useCallback(() => {
    cancelRun.current?.();
    cancelRun.current = null;
    store.getState().finishRun('cancelled');
  }, [store]);

  useShortcuts({
    rootRef,
    commands,
    canEdit: env.canEdit,
    onSave: () => void save(),
    onShortcuts: () => setShortcutsOpen(true),
    onToggleFlat: flatForced ? undefined : onToggleFlat,
  });

  const ctx = useMemo(
    () => runContext(lastInput, env.workspaceName, null),
    [lastInput, env.workspaceName],
  );

  return (
    <div
      ref={rootRef}
      className="flex h-[calc(100dvh-8rem)] min-h-[520px] w-full flex-col overflow-clip rounded-lg border border-border bg-surface shadow-card"
    >
      <Toolbar
        commands={commands}
        saving={saving}
        flat={flat}
        flatForced={flatForced}
        narrow={narrow}
        running={running}
        onToggleFlat={onToggleFlat}
        onSave={() => void save()}
        onActivate={activate}
        onDeactivate={deactivate}
        onTestRun={() => setTestOpen(true)}
        onDuplicate={duplicate}
        onShowHistory={() => setHistoryOpen(true)}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />
      {narrow && (
        <div
          className="flex items-start gap-2 border-b border-border bg-status-blue-bg px-3 py-2 text-xs text-status-blue-fg"
          role="note"
        >
          <MonitorSmartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            Editing workflows needs a wider screen (1024 px or more). You can view this workflow
            here.
          </p>
          <Button size="sm" variant="secondary" onClick={commands.fitView}>
            Fit view
          </Button>
        </div>
      )}
      {!narrow && viewOnlyReason && (
        <p
          className="border-b border-border bg-surface-2 px-3 py-1.5 text-xs text-muted-strong"
          role="note"
        >
          You can view this workflow. Ask a company admin for edit access to change it.
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        {env.canEdit && <Palette commands={commands} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <Canvas commands={commands} />
          </div>
          {!narrow && (
            <Dock
              commands={commands}
              runContext={ctx}
              onStop={stopRun}
              onRunAgain={() => startRun(lastInput)}
            />
          )}
        </div>
        {!narrow && <Inspector commands={commands} />}
      </div>
      <div aria-live="polite" className="sr-only">
        {announcement.text}
        {announcement.n % 2 ? '\u200b' : ''}
      </div>
      {env.canEdit && (
        <TestRunDialog
          open={testOpen}
          onOpenChange={setTestOpen}
          initial={lastInput}
          onStart={startRun}
        />
      )}
      <VersionsDialog open={historyOpen} onOpenChange={setHistoryOpen} onRestore={restore} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

function useShortcuts({
  rootRef,
  commands,
  canEdit,
  onSave,
  onShortcuts,
  onToggleFlat,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  commands: Commands;
  canEdit: boolean;
  onSave: () => void;
  onShortcuts: () => void;
  onToggleFlat?: () => void;
}) {
  const store = useBuilderApi();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current;
      const t = e.target as HTMLElement | null;
      if (!root || !t) return;
      const inRoot = root.contains(t);
      if (!inRoot && t !== document.body && t !== document.documentElement) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const nodeEl = t.closest<HTMLElement>('.react-flow__node');
      const focusedNodeId = nodeEl?.dataset.id ?? null;

      if (mod && key === 's') {
        e.preventDefault();
        onSave();
        return;
      }
      if (typing) return;

      if (mod) {
        if (key === 'z' && !e.shiftKey && canEdit) commands.undo();
        else if (((key === 'z' && e.shiftKey) || key === 'y') && canEdit) commands.redo();
        else if (key === 'c' && canEdit) {
          if (!commands.copy()) return;
        } else if (key === 'x' && canEdit) commands.cut();
        else if (key === 'v' && canEdit) commands.paste();
        else if (key === 'd' && canEdit) commands.duplicate();
        else if (key === 'a') store.getState().selectAll();
        else return;
        e.preventDefault();
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        onShortcuts();
        return;
      }
      if (e.key === 'Escape') {
        store.getState().select([]);
        return;
      }
      if (e.key === 'Enter' && (focusedNodeId || store.getState().nodes.some((n) => n.selected))) {
        e.preventDefault();
        commands.openSettings(focusedNodeId ?? undefined);
        return;
      }
      if (key === 'f' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        commands.fitView();
        return;
      }
      if (!canEdit) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (focusedNodeId && !store.getState().nodes.some((n) => n.selected))
          store.getState().select([focusedNodeId]);
        commands.deleteSelection();
        return;
      }
      if (e.shiftKey && key === 'l') {
        e.preventDefault();
        commands.autoLayout();
        return;
      }
      if (e.shiftKey && key === 'p' && onToggleFlat) {
        e.preventDefault();
        onToggleFlat();
        return;
      }
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const dir = arrows[e.key];
      if (dir) {
        if (focusedNodeId && !store.getState().nodes.some((n) => n.selected))
          store.getState().select([focusedNodeId]);
        if (!store.getState().nodes.some((n) => n.selected)) return;
        e.preventDefault();
        const step = SNAP * (e.shiftKey ? 4 : 1);
        commands.nudge(dir[0] * step, dir[1] * step);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [rootRef, commands, canEdit, onSave, onShortcuts, onToggleFlat, store]);
}
