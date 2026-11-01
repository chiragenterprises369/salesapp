'use client';

import { NODE_CATALOG, type NodeType } from '@vistar/shared';
import { useReactFlow } from '@xyflow/react';
import { useMemo } from 'react';
import { isTrigger } from '../lib/catalog';
import { GRID_Y, nodeSize } from '../lib/geometry';
import { defaultConfig, displayLabel, type FlowEdge, type FlowNode } from '../lib/graph';
import { autoLayout } from '../lib/layout';
import type { Fragment } from '../store/builder-store';
import { useBuilderApi, useEnv, useWorld } from '../store/context';

/** In-memory clipboard shared by builder instances on the page. */
let clipboard: Fragment | null = null;
let pasteCount = 0;

/** Editor commands that need the store, the physics world and the React Flow instance together. */
export function useCommands() {
  const store = useBuilderApi();
  const world = useWorld();
  const env = useEnv();
  const rf = useReactFlow<FlowNode, FlowEdge>();

  return useMemo(() => {
    const positions = () => new Map(store.getState().nodes.map((n) => [n.id, { ...n.position }]));
    const duration = env.reducedMotion ? 0 : 320;
    const say = (t: string) => store.getState().announce(t);
    const selected = () => store.getState().nodes.filter((n) => n.selected);

    const focusNodeElement = (id: string) => {
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`.vistar-flow .react-flow__node[data-id="${CSS.escape(id)}"]`);
        el?.focus({ preventScroll: true });
      });
    };

    const cmd = {
      undo() {
        const prev = positions();
        if (store.getState().undo()) {
          world.glide(prev);
          say('Undone');
        }
      },
      redo() {
        const prev = positions();
        if (store.getState().redo()) {
          world.glide(prev);
          say('Redone');
        }
      },
      autoLayout() {
        const s = store.getState();
        if (s.nodes.length === 0) return;
        const prev = positions();
        s.setPositions(autoLayout(s.nodes, s.edges));
        world.glide(prev);
        say('Steps arranged');
        window.setTimeout(() => void rf.fitView({ padding: 0.15, maxZoom: 1, duration }), 60);
      },
      nudge(dx: number, dy: number) {
        const sel = selected();
        if (sel.length === 0) return;
        const prev = positions();
        store.getState().setPositions(new Map(sel.map((n) => [n.id, { x: n.position.x + dx, y: n.position.y + dy }])), { coalesceKey: 'nudge' });
        world.glide(prev);
        const dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
        say(`Moved ${sel.length === 1 ? displayLabel(sel[0]!.type, sel[0]!.data) : `${sel.length} steps`} ${dir}`);
      },
      fitView() {
        void rf.fitView({ padding: 0.15, maxZoom: 1, duration });
      },
      /** Select a node, centre it, and either focus it on the canvas or open its settings. */
      focusNode(id: string, opts: { openSettings?: boolean } = {}) {
        const n = store.getState().nodes.find((x) => x.id === id);
        if (!n) return;
        store.getState().select([id]);
        const { w, h } = nodeSize(n.type, n.data.config);
        void rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: Math.max(rf.getZoom(), 0.85), duration });
        if (opts.openSettings) store.getState().requestFocus();
        else focusNodeElement(id);
      },
      openSettings(id?: string) {
        const target = id ?? (selected().length === 1 ? selected()[0]!.id : null);
        if (!target) return;
        store.getState().select([target]);
        store.getState().requestFocus();
      },
      /** Palette click / Enter: add after the selected step, else at the viewport centre. */
      add(type: NodeType) {
        const s = store.getState();
        if (isTrigger(type) && s.nodes.some((n) => isTrigger(n.type))) return null;
        const sel = selected();
        let id: string;
        if (sel.length === 1 && !isTrigger(type)) {
          id = s.addNode(type, { x: sel[0]!.position.x, y: sel[0]!.position.y + GRID_Y }, { after: sel[0]!.id });
        } else {
          const el = document.querySelector('.vistar-flow');
          const rect = el?.getBoundingClientRect();
          const centre = rect ? rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 0, y: 0 };
          const { w, h } = nodeSize(type, defaultConfig(type));
          const top = s.nodes.length ? Math.min(...s.nodes.map((n) => n.position.y)) : 0;
          const pos = isTrigger(type) && s.nodes.length ? { x: centre.x - w / 2, y: top - GRID_Y } : { x: centre.x - w / 2, y: centre.y - h / 2 };
          id = s.addNode(type, pos);
        }
        say(`${NODE_CATALOG[type].label} added`);
        return id;
      },
      addAt(type: NodeType, screen: { x: number; y: number }) {
        const s = store.getState();
        if (isTrigger(type) && s.nodes.some((n) => isTrigger(n.type))) return null;
        const p = rf.screenToFlowPosition(screen);
        const { w } = nodeSize(type, defaultConfig(type));
        const id = s.addNode(type, { x: p.x - w / 2, y: p.y - 24 });
        say(`${NODE_CATALOG[type].label} added`);
        return id;
      },
      copy() {
        const frag = store.getState().copySelection();
        if (!frag) return false;
        clipboard = frag;
        pasteCount = 0;
        say(`Copied ${frag.nodes.length === 1 ? '1 step' : `${frag.nodes.length} steps`}`);
        return true;
      },
      cut() {
        if (cmd.copy()) {
          store.getState().deleteSelection();
          say('Cut');
        }
      },
      paste() {
        if (!clipboard) return;
        pasteCount++;
        store.getState().paste(clipboard, { x: 50 * pasteCount, y: 50 * pasteCount });
        say(`Pasted ${clipboard.nodes.length === 1 ? '1 step' : `${clipboard.nodes.length} steps`}`);
      },
      duplicate() {
        const frag = store.getState().copySelection();
        if (!frag) return;
        store.getState().paste(frag, { x: 50, y: 50 });
        say('Duplicated');
      },
      deleteSelection() {
        const n = store.getState().deleteSelection();
        if (n) say(n === 1 ? 'Deleted' : `Deleted ${n} items`);
      },
      hasClipboard: () => !!clipboard,
    };
    return cmd;
  }, [store, world, env.reducedMotion, rf]);
}

export type Commands = ReturnType<typeof useCommands>;
