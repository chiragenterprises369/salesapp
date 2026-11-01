'use client';

import { NODE_TYPES, type NodeType } from '@vistar/shared';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  useStore as useFlowStore,
  type Connection,
  type EdgeTypes,
  type IsValidConnection,
  type NodeTypes,
  type OnNodeDrag,
} from '@xyflow/react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, type DragEvent, type FocusEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useDocumentTheme } from '@/lib/use-document-theme';
import { categoryOf, isTrigger, TONE_CLASSES } from '../lib/catalog';
import { SNAP } from '../lib/geometry';
import type { FlowEdge, FlowNode } from '../lib/graph';
import type { Commands } from '../hooks/use-commands';
import { useBuilder, useBuilderApi, useEnv, useWorld } from '../store/context';
import { ConnectionLine, RopeEdge } from './rope-edge';
import { WorkflowNodeComponent } from './workflow-node';

export const PALETTE_MIME = 'application/vistar-node';

const nodeTypes = Object.fromEntries(NODE_TYPES.map((t) => [t, WorkflowNodeComponent])) as NodeTypes;
const edgeTypes = { rope: RopeEdge } as EdgeTypes;

export function Canvas({ commands }: { commands: Commands }) {
  const store = useBuilderApi();
  const world = useWorld();
  const env = useEnv();
  const theme = useDocumentTheme();
  const nodes = useBuilder((s) => s.nodes);
  const edges = useBuilder((s) => s.edges);
  const onNodesChange = useBuilder((s) => s.onNodesChange);
  const onEdgesChange = useBuilder((s) => s.onEdgesChange);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    world.setStatusElement(wrapperRef.current);
    return () => world.setStatusElement(null);
  }, [world]);

  const dragStart = useCallback(
    (dragged: FlowNode[]) => {
      store.getState().beginDrag();
      world.startDrag(dragged.map((n) => n.id));
    },
    [store, world],
  );
  const dragStop = useCallback(
    (dragged: FlowNode[]) => {
      const finals = world.endDrag(dragged.map((n) => n.id));
      store.getState().endDrag(finals);
    },
    [store, world],
  );
  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback((_e, _n, dragged) => dragStart(dragged), [dragStart]);
  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback((_e, _n, dragged) => dragStop(dragged), [dragStop]);

  const isValidConnection: IsValidConnection<FlowEdge> = useCallback(
    (c) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      const target = store.getState().nodes.find((n) => n.id === c.target);
      return !!target && !isTrigger(target.type) && (c.targetHandle ?? 'in') === 'in';
    },
    [store],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      store.getState().connect(c);
      store.getState().announce('Steps connected');
    },
    [store],
  );

  // Keyboard focus selects the step, so Tab walks the graph and the settings panel follows.
  const onFocusCapture = useCallback(
    (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (!el.classList.contains('react-flow__node') || !el.matches(':focus-visible')) return;
      const id = el.dataset.id;
      if (!id) return;
      if (!store.getState().nodes.find((n) => n.id === id)?.selected) store.getState().select([id]);
      commands.reveal(id);
    },
    [store, commands],
  );

  const onDragOver = useCallback(
    (e: DragEvent) => {
      if (!env.canEdit || !e.dataTransfer.types.includes(PALETTE_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    [env.canEdit],
  );
  const onDrop = useCallback(
    (e: DragEvent) => {
      const type = e.dataTransfer.getData(PALETTE_MIME) as NodeType;
      if (!env.canEdit || !type || !(NODE_TYPES as string[]).includes(type)) return;
      e.preventDefault();
      commands.addAt(type, { x: e.clientX, y: e.clientY });
    },
    [commands, env.canEdit],
  );

  return (
    <div ref={wrapperRef} className="vistar-flow relative h-full min-h-0 w-full overflow-clip" data-physics="idle" onDragOver={onDragOver} onDrop={onDrop} onFocusCapture={onFocusCapture}>
      <ReactFlow<FlowNode, FlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStart={(_e, dragged) => dragStart(dragged)}
        onSelectionDragStop={(_e, dragged) => dragStop(dragged)}
        onNodeDoubleClick={(_e, n) => env.canEdit && commands.openSettings(n.id)}
        connectionLineComponent={ConnectionLine}
        defaultEdgeOptions={{ type: 'rope' }}
        colorMode={theme}
        nodesDraggable={env.canEdit}
        nodesConnectable={env.canEdit}
        elementsSelectable
        nodesFocusable
        edgesFocusable
        disableKeyboardA11y
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        selectionMode={SelectionMode.Partial}
        snapToGrid={!env.physics}
        snapGrid={[SNAP, SNAP]}
        nodeDragThreshold={2}
        zoomOnDoubleClick={false}
        minZoom={0.2}
        maxZoom={1.75}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
        attributionPosition="top-right"
        aria-label="Workflow canvas"
      >
        <Background variant={BackgroundVariant.Dots} gap={SNAP} size={1.6} color="var(--border-strong)" bgColor="var(--bg)" />
        <MiniMap<FlowNode>
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(n) => TONE_CLASSES[categoryOf(n.type)].mini}
          nodeBorderRadius={8}
          nodeStrokeWidth={0}
          bgColor="var(--surface)"
          maskColor="color-mix(in srgb, var(--bg) 70%, transparent)"
          maskStrokeColor="var(--border-strong)"
          ariaLabel="Workflow overview map"
          style={{ width: 168, height: 112 }}
        />
        <Panel position="bottom-left">
          <ZoomControls onFit={commands.fitView} />
        </Panel>
      </ReactFlow>
    </div>
  );
}

function ZoomControls({ onFit }: { onFit: () => void }) {
  const rf = useReactFlow();
  const zoom = useFlowStore((s) => s.transform[2]);
  const env = useEnv();
  const duration = env.reducedMotion ? 0 : 200;
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5 shadow-raised">
      <Button size="icon-sm" variant="ghost" aria-label="Zoom out" title="Zoom out (-)" onClick={() => void rf.zoomOut({ duration })}>
        <Minus aria-hidden />
      </Button>
      <span className="w-11 text-center text-2xs font-medium text-fg-secondary tabular" aria-live="off">
        {Math.round(zoom * 100)}%
      </span>
      <Button size="icon-sm" variant="ghost" aria-label="Zoom in" title="Zoom in (+)" onClick={() => void rf.zoomIn({ duration })}>
        <Plus aria-hidden />
      </Button>
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
      <Button size="icon-sm" variant="ghost" aria-label="Fit view" title="Fit view (F)" onClick={onFit}>
        <Maximize aria-hidden />
      </Button>
    </div>
  );
}
