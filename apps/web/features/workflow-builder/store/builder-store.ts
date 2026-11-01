import {
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowRunStatus,
  type WorkflowRunStep,
  type WorkflowStepStatus,
  type NodeType,
} from '@vistar/shared';
import { applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange } from '@xyflow/react';
import { createStore } from 'zustand/vanilla';
import { isTrigger, outputsOf } from '../lib/catalog';
import { GRID_X, GRID_Y, snap } from '../lib/geometry';
import {
  defaultConfig,
  edgeId,
  newNodeId,
  nodeAriaLabel,
  toFlowEdge,
  toFlowNode,
  toGraph,
  toWorkflowEdge,
  toWorkflowNode,
  type FlowEdge,
  type FlowNode,
  type FlowNodeData,
} from '../lib/graph';
import { computeIssues, type BuilderIssue } from '../lib/validation';

export interface Snapshot {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface LocalVersion {
  version: number;
  name: string;
  graph: WorkflowGraph;
  savedAt: string;
  savedBy: string | null;
  note: string | null;
}

export interface StepState {
  status: WorkflowStepStatus;
  branch: string | null;
  summary: string | null;
  error: string | null;
  visit: number;
}

export interface RunLogEntry {
  key: string;
  nodeId: string;
  nodeType: NodeType;
  status: WorkflowStepStatus;
  branch: string | null;
  summary: string | null;
  error: string | null;
  at: string;
}

export interface RunState {
  id: string;
  status: WorkflowRunStatus;
  leadName: string;
  startedAt: string;
  finishedAt: string | null;
  steps: Record<string, StepState>;
  log: RunLogEntry[];
  traversed: string[];
  activeEdgeId: string | null;
}

export interface Fragment {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface BuilderState {
  workflowId: string;
  name: string;
  status: 'draft' | 'active';
  templateKey: string | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
  issues: BuilderIssue[];
  aiEnabled: boolean;
  past: Snapshot[];
  future: Snapshot[];
  coalesce: { key: string; at: number } | null;
  revision: number;
  savedRevision: number;
  versions: LocalVersion[];
  activeVersion: number | null;
  dragSnapshot: Snapshot | null;
  run: RunState | null;
  /** Incremented to ask the inspector to move focus into its first field. */
  focusToken: number;
  dock: 'issues' | 'run' | null;
  /** Polite live-region text for screen readers. */
  announcement: { text: string; n: number };

  announce: (text: string) => void;
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void;
  setAiEnabled: (v: boolean) => void;
  connect: (c: Connection) => void;
  addNode: (type: NodeType, position: { x: number; y: number }, opts?: { after?: string }) => string;
  deleteSelection: () => number;
  deleteEdge: (id: string) => void;
  updateNodeData: (id: string, patch: Partial<Pick<FlowNodeData, 'label' | 'notes'>>) => void;
  updateConfig: (id: string, update: (config: Record<string, unknown>) => Record<string, unknown>, opts?: { coalesceKey?: string; renameHandles?: Record<string, string> }) => void;
  setPositions: (positions: Map<string, { x: number; y: number }>, opts?: { coalesceKey?: string; checkpoint?: boolean }) => void;
  beginDrag: () => void;
  endDrag: (finals: Map<string, { x: number; y: number }>) => void;
  undo: () => boolean;
  redo: () => boolean;
  select: (nodeIds: string[], edgeIds?: string[]) => void;
  selectAll: () => void;
  copySelection: () => Fragment | null;
  paste: (fragment: Fragment, offset: { x: number; y: number }) => void;
  replaceGraph: (graph: WorkflowGraph, opts?: { checkpoint?: boolean }) => void;
  setName: (name: string) => void;
  setStatus: (status: 'draft' | 'active') => void;
  markSaved: (version: LocalVersion, opts?: { activate?: boolean }) => void;
  setVersions: (versions: LocalVersion[], activeVersion: number | null) => void;
  requestFocus: () => void;
  setDock: (dock: 'issues' | 'run' | null) => void;
  startRun: (id: string, leadName: string) => void;
  applyStep: (step: WorkflowRunStep, nextEdgeId: string | null) => void;
  finishRun: (status: WorkflowRunStatus) => void;
  clearRun: () => void;
}

const HISTORY_LIMIT = 100;
const COALESCE_MS = 1200;

function snapshotOf(nodes: FlowNode[], edges: FlowEdge[]): Snapshot {
  return { nodes: nodes.map((n) => toWorkflowNode(n)), edges: edges.map(toWorkflowEdge) };
}

/** Restore a snapshot, keeping React Flow measurements so nodes do not flash while re-measuring. */
function fromSnapshot(s: Snapshot, current: FlowNode[]): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const measured = new Map(current.map((n) => [n.id, n.measured]));
  return {
    nodes: s.nodes.map((n) => {
      const f = toFlowNode(n);
      const m = measured.get(n.id);
      return m ? { ...f, measured: m } : f;
    }),
    edges: s.edges.map(toFlowEdge),
  };
}

function freePosition(nodes: FlowNode[], want: { x: number; y: number }): { x: number; y: number } {
  const taken = (p: { x: number; y: number }) => nodes.some((n) => Math.abs(n.position.x - p.x) < GRID_X * 0.8 && Math.abs(n.position.y - p.y) < GRID_Y * 0.6);
  let p = { x: snap(want.x), y: snap(want.y) };
  for (let i = 0; i < 12 && taken(p); i++) p = { x: p.x + GRID_X, y: p.y };
  return p;
}

/** All nodes reachable from `start` following edges. */
function downstream(start: string, edges: FlowEdge[]): Set<string> {
  const out = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of edges) {
      if (e.source === id && !out.has(e.target)) {
        out.add(e.target);
        queue.push(e.target);
      }
    }
  }
  return out;
}

export function createBuilderStore(init: {
  workflowId: string;
  name: string;
  templateKey: string | null;
  graph: WorkflowGraph;
  status: 'draft' | 'active';
  versions: LocalVersion[];
  activeVersion: number | null;
  aiEnabled: boolean;
}) {
  const flow = { nodes: init.graph.nodes.map(toFlowNode), edges: init.graph.edges.map(toFlowEdge) };

  return createStore<BuilderState>()((set, get) => {
    /** Push the current graph to history (coalescing rapid edits with the same key). */
    const checkpoint = (key?: string) => {
      const s = get();
      const now = Date.now();
      if (key && s.coalesce && s.coalesce.key === key && now - s.coalesce.at < COALESCE_MS) {
        set({ coalesce: { key, at: now } });
        return;
      }
      const past = [...s.past, snapshotOf(s.nodes, s.edges)].slice(-HISTORY_LIMIT);
      set({ past, future: [], coalesce: key ? { key, at: now } : null });
    };

    /** Commit a structural change: history, issues, revision. */
    const commit = (nodes: FlowNode[], edges: FlowEdge[], key?: string, record = true) => {
      if (record) checkpoint(key);
      set((s) => ({ nodes, edges, issues: computeIssues(nodes, edges, s.aiEnabled), revision: s.revision + 1 }));
    };

    return {
      workflowId: init.workflowId,
      name: init.name,
      status: init.status,
      templateKey: init.templateKey,
      nodes: flow.nodes,
      edges: flow.edges,
      issues: computeIssues(flow.nodes, flow.edges, init.aiEnabled),
      aiEnabled: init.aiEnabled,
      past: [],
      future: [],
      coalesce: null,
      revision: 0,
      savedRevision: 0,
      versions: init.versions,
      activeVersion: init.activeVersion,
      dragSnapshot: null,
      run: null,
      focusToken: 0,
      dock: null,
      announcement: { text: '', n: 0 },

      announce: (text) => set((s) => ({ announcement: { text, n: s.announcement.n + 1 } })),
      onNodesChange: (changes) => {
        const relevant = changes.filter((c) => c.type !== 'remove' && c.type !== 'add' && c.type !== 'replace');
        if (relevant.length === 0) return;
        set((s) => ({ nodes: applyNodeChanges(relevant, s.nodes) }));
      },

      onEdgesChange: (changes) => {
        const relevant = changes.filter((c) => c.type === 'select');
        if (relevant.length === 0) return;
        set((s) => ({ edges: applyEdgeChanges(relevant, s.edges) }));
      },

      setAiEnabled: (v) => set((s) => (s.aiEnabled === v ? s : { aiEnabled: v, issues: computeIssues(s.nodes, s.edges, v) })),

      connect: (c) => {
        const { nodes, edges } = get();
        if (!c.source || !c.target || c.source === c.target) return;
        const target = nodes.find((n) => n.id === c.target);
        if (!target || isTrigger(target.type)) return;
        const handle = c.sourceHandle ?? 'out';
        const id = edgeId(c.source, handle, c.target);
        const kept = edges.filter((e) => !(e.source === c.source && (e.sourceHandle ?? 'out') === handle));
        const edge: FlowEdge = { id, source: c.source, target: c.target, sourceHandle: handle, targetHandle: 'in', type: 'rope' };
        commit(nodes, [...kept, edge]);
      },

      addNode: (type, position, opts = {}) => {
        const { nodes, edges } = get();
        const id = newNodeId(type, new Set(nodes.map((n) => n.id)));
        const data: FlowNodeData = { config: defaultConfig(type) };
        let nextNodes = nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
        let nextEdges = edges.map((e) => (e.selected ? { ...e, selected: false } : e));
        let pos = { x: snap(position.x), y: snap(position.y) };

        const after = opts.after ? nodes.find((n) => n.id === opts.after) : undefined;
        if (after && !isTrigger(type)) {
          const outs = outputsOf(after.type, after.data.config);
          const used = new Set(edges.filter((e) => e.source === after.id).map((e) => e.sourceHandle ?? 'out'));
          const free = outs.find((h) => !used.has(h));
          const below = { x: after.position.x, y: after.position.y + GRID_Y };
          if (free) {
            pos = freePosition(nextNodes, { x: below.x + (outs.length > 1 ? (outs.indexOf(free) - (outs.length - 1) / 2) * GRID_X : 0), y: below.y });
            nextEdges = [...nextEdges, { id: edgeId(after.id, free, id), source: after.id, target: id, sourceHandle: free, targetHandle: 'in', type: 'rope' }];
          } else if (outs.length > 0) {
            // Insert between the step and what follows its first output; push the rest down a row.
            const handle = outs[0]!;
            const old = edges.find((e) => e.source === after.id && (e.sourceHandle ?? 'out') === handle);
            pos = below;
            if (old) {
              const shift = downstream(old.target, edges);
              nextNodes = nextNodes.map((n) => (shift.has(n.id) ? { ...n, position: { x: n.position.x, y: n.position.y + GRID_Y } } : n));
              const newOuts = outputsOf(type, data.config);
              nextEdges = nextEdges.filter((e) => e.id !== old.id);
              nextEdges.push({ id: edgeId(after.id, handle, id), source: after.id, target: id, sourceHandle: handle, targetHandle: 'in', type: 'rope' });
              if (newOuts[0]) nextEdges.push({ id: edgeId(id, newOuts[0], old.target), source: id, target: old.target, sourceHandle: newOuts[0], targetHandle: 'in', type: 'rope' });
            }
          } else {
            pos = freePosition(nextNodes, below);
          }
        }
        const node: FlowNode = { id, type, position: pos, data, selected: true, ariaLabel: nodeAriaLabel(type, data) };
        commit([...nextNodes, node], nextEdges);
        return id;
      },

      deleteSelection: () => {
        const { nodes, edges } = get();
        const gone = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
        const edgeGone = new Set(edges.filter((e) => e.selected).map((e) => e.id));
        if (gone.size === 0 && edgeGone.size === 0) return 0;
        commit(
          nodes.filter((n) => !gone.has(n.id)),
          edges.filter((e) => !edgeGone.has(e.id) && !gone.has(e.source) && !gone.has(e.target)),
        );
        return gone.size + edgeGone.size;
      },

      deleteEdge: (id) => {
        const { nodes, edges } = get();
        commit(nodes, edges.filter((e) => e.id !== id));
      },

      updateNodeData: (id, patch) => {
        const { nodes, edges } = get();
        const next = nodes.map((n) => {
          if (n.id !== id) return n;
          const data = { ...n.data, ...patch };
          return { ...n, data, ariaLabel: nodeAriaLabel(n.type, data) };
        });
        commit(next, edges, `data:${id}:${Object.keys(patch).join(',')}`);
      },

      updateConfig: (id, update, opts = {}) => {
        const { nodes, edges } = get();
        const node = nodes.find((n) => n.id === id);
        if (!node) return;
        const config = update(node.data.config);
        const nextNodes = nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, config } } : n));
        const renames = opts.renameHandles ?? {};
        const outs = new Set(outputsOf(node.type, config));
        const seen = new Set<string>();
        const nextEdges: FlowEdge[] = [];
        for (const e of edges) {
          if (e.source !== id) {
            nextEdges.push(e);
            continue;
          }
          const handle = renames[e.sourceHandle ?? 'out'] ?? e.sourceHandle ?? 'out';
          // Drop connections whose output no longer exists (or became a duplicate).
          if (!outs.has(handle) || seen.has(handle)) continue;
          seen.add(handle);
          nextEdges.push(handle === e.sourceHandle ? e : { ...e, sourceHandle: handle, id: edgeId(e.source, handle, e.target) });
        }
        commit(nextNodes, nextEdges, opts.coalesceKey ?? `config:${id}`);
      },

      setPositions: (positions, opts = {}) => {
        const { nodes, edges } = get();
        const next = nodes.map((n) => {
          const p = positions.get(n.id);
          return p && (p.x !== n.position.x || p.y !== n.position.y) ? { ...n, position: { x: p.x, y: p.y } } : n;
        });
        if (opts.checkpoint !== false) checkpoint(opts.coalesceKey);
        set((s) => ({ nodes: next, edges, revision: s.revision + 1 }));
      },

      beginDrag: () => {
        const { nodes, edges } = get();
        set({ dragSnapshot: snapshotOf(nodes, edges) });
      },

      endDrag: (finals) => {
        const { nodes, dragSnapshot } = get();
        const next = nodes.map((n) => {
          const p = finals.get(n.id);
          return p ? { ...n, position: { x: p.x, y: p.y }, dragging: false } : n;
        });
        const before = dragSnapshot ? new Map(dragSnapshot.nodes.map((n) => [n.id, n.position])) : null;
        const changed = !before || next.some((n) => {
          const b = before.get(n.id);
          return !b || b.x !== n.position.x || b.y !== n.position.y;
        });
        if (changed && dragSnapshot) {
          set((s) => ({ past: [...s.past, dragSnapshot].slice(-HISTORY_LIMIT), future: [], coalesce: null, revision: s.revision + 1 }));
        }
        set({ nodes: next, dragSnapshot: null });
      },

      undo: () => {
        const s = get();
        const prev = s.past[s.past.length - 1];
        if (!prev) return false;
        const restored = fromSnapshot(prev, s.nodes);
        set({
          ...restored,
          past: s.past.slice(0, -1),
          future: [snapshotOf(s.nodes, s.edges), ...s.future].slice(0, HISTORY_LIMIT),
          coalesce: null,
          issues: computeIssues(restored.nodes, restored.edges, s.aiEnabled),
          revision: s.revision + 1,
        });
        return true;
      },

      redo: () => {
        const s = get();
        const next = s.future[0];
        if (!next) return false;
        const restored = fromSnapshot(next, s.nodes);
        set({
          ...restored,
          past: [...s.past, snapshotOf(s.nodes, s.edges)].slice(-HISTORY_LIMIT),
          future: s.future.slice(1),
          coalesce: null,
          issues: computeIssues(restored.nodes, restored.edges, s.aiEnabled),
          revision: s.revision + 1,
        });
        return true;
      },

      select: (nodeIds, edgeIds = []) => {
        const ns = new Set(nodeIds);
        const es = new Set(edgeIds);
        set((s) => ({
          nodes: s.nodes.map((n) => (!!n.selected === ns.has(n.id) ? n : { ...n, selected: ns.has(n.id) })),
          edges: s.edges.map((e) => (!!e.selected === es.has(e.id) ? e : { ...e, selected: es.has(e.id) })),
        }));
      },

      selectAll: () => set((s) => ({ nodes: s.nodes.map((n) => (n.selected ? n : { ...n, selected: true })) })),

      copySelection: () => {
        const { nodes, edges } = get();
        const picked = nodes.filter((n) => n.selected);
        if (picked.length === 0) return null;
        const ids = new Set(picked.map((n) => n.id));
        return {
          nodes: picked.map((n) => toWorkflowNode(n)),
          edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map(toWorkflowEdge),
        };
      },

      paste: (fragment, offset) => {
        const { nodes, edges } = get();
        const taken = new Set(nodes.map((n) => n.id));
        const hasTrigger = nodes.some((n) => isTrigger(n.type));
        const remap = new Map<string, string>();
        const added: FlowNode[] = [];
        for (const n of fragment.nodes) {
          if (isTrigger(n.type) && (hasTrigger || added.some((a) => isTrigger(a.type)))) continue;
          const id = newNodeId(n.type, taken);
          taken.add(id);
          remap.set(n.id, id);
          const f = toFlowNode({ ...n, id, position: { x: snap(n.position.x + offset.x), y: snap(n.position.y + offset.y) } });
          added.push({ ...f, selected: true });
        }
        if (added.length === 0) return;
        const newEdges: FlowEdge[] = fragment.edges
          .filter((e) => remap.has(e.source) && remap.has(e.target))
          .map((e) => {
            const source = remap.get(e.source)!;
            const target = remap.get(e.target)!;
            return { id: edgeId(source, e.sourceHandle ?? 'out', target), source, target, sourceHandle: e.sourceHandle ?? 'out', targetHandle: 'in', type: 'rope' };
          });
        commit(
          [...nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), ...added],
          [...edges.map((e) => (e.selected ? { ...e, selected: false } : e)), ...newEdges],
        );
      },

      replaceGraph: (graph, opts = {}) => {
        const s = get();
        const restored = fromSnapshot({ nodes: graph.nodes, edges: graph.edges }, s.nodes);
        commit(restored.nodes, restored.edges, undefined, opts.checkpoint !== false);
      },

      setName: (name) => set((s) => ({ name, revision: s.revision + 1 })),
      setStatus: (status) => set({ status }),

      markSaved: (version, opts = {}) =>
        set((s) => ({
          versions: [version, ...s.versions.filter((v) => v.version !== version.version)].slice(0, 30),
          savedRevision: s.revision,
          activeVersion: opts.activate ? version.version : s.activeVersion,
          status: opts.activate ? 'active' : s.status,
        })),

      setVersions: (versions, activeVersion) => set({ versions, activeVersion }),
      requestFocus: () => set((s) => ({ focusToken: s.focusToken + 1 })),
      setDock: (dock) => set({ dock }),

      startRun: (id, leadName) =>
        set({
          run: { id, status: 'running', leadName, startedAt: new Date().toISOString(), finishedAt: null, steps: {}, log: [], traversed: [], activeEdgeId: null },
          dock: 'run',
        }),

      applyStep: (step, nextEdgeId) =>
        set((s) => {
          if (!s.run) return s;
          const prev = s.run.steps[step.nodeId];
          const visit = prev && prev.status !== 'running' && step.status === 'running' ? prev.visit + 1 : (prev?.visit ?? 1);
          const steps = { ...s.run.steps, [step.nodeId]: { status: step.status, branch: step.branch, summary: step.summary, error: step.error, visit } };
          const final = step.status !== 'running';
          const log = final
            ? [
                ...s.run.log,
                {
                  key: `${step.id}:${step.status}`,
                  nodeId: step.nodeId,
                  nodeType: step.nodeType,
                  status: step.status,
                  branch: step.branch,
                  summary: step.summary,
                  error: step.error,
                  at: step.finishedAt ?? step.startedAt ?? new Date().toISOString(),
                },
              ]
            : s.run.log;
          const traversed = nextEdgeId && !s.run.traversed.includes(nextEdgeId) ? [...s.run.traversed, nextEdgeId] : s.run.traversed;
          return { run: { ...s.run, steps, log, traversed, activeEdgeId: nextEdgeId ?? s.run.activeEdgeId } };
        }),

      finishRun: (status) => set((s) => (s.run ? { run: { ...s.run, status, finishedAt: new Date().toISOString(), activeEdgeId: null } } : s)),
      clearRun: () => set((s) => ({ run: null, dock: s.dock === 'run' ? null : s.dock })),
    };
  });
}

export type BuilderStore = ReturnType<typeof createBuilderStore>;

export function graphFromState(s: Pick<BuilderState, 'nodes' | 'edges'>, version = 0, normalise = false): WorkflowGraph {
  return toGraph(s.nodes, s.edges, version, normalise);
}
