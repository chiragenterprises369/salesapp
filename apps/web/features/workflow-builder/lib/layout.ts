import { isTrigger, outputsOf } from './catalog';
import { GRID_X, GRID_Y } from './geometry';
import type { FlowEdge, FlowNode } from './graph';

type Pos = { x: number; y: number };

/**
 * Auto-layout: layered BFS from the trigger onto the 300 x 150 grid.
 * - Rows: longest path from the trigger over the graph without back edges (loops through Loop limit).
 * - Columns: tidy tree over the BFS spanning tree; children are fanned left to right in output-handle
 *   order (yes before no, switch cases before default), and a parent sits above the child nearest the
 *   centre of its span so the main path stays straight.
 * - Steps not reachable from the trigger are laid out as separate trees to the right.
 */
export function autoLayout(nodes: FlowNode[], edges: FlowEdge[]): Map<string, Pos> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const handleRank = (e: FlowEdge) => {
    const src = byId.get(e.source);
    if (!src) return 0;
    const outs = outputsOf(src.type, src.data.config);
    const i = outs.indexOf(e.sourceHandle ?? 'out');
    return i < 0 ? outs.length : i;
  };
  const children = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const n of nodes) children.set(n.id, []);
  const sorted = [...edges].filter((e) => byId.has(e.source) && byId.has(e.target)).sort((a, b) => handleRank(a) - handleRank(b));
  for (const e of sorted) {
    children.get(e.source)!.push(e.target);
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  }

  const result = new Map<string, Pos>();
  const placed = new Set<string>();
  let nextLeft = 0;

  const layoutFrom = (root: string, left: number): number => {
    // Back edges via DFS (iterative to keep stack shallow).
    const back = new Set<string>();
    const state = new Map<string, 1 | 2>();
    const dfs = (id: string) => {
      state.set(id, 1);
      for (const c of children.get(id) ?? []) {
        if (placed.has(c)) continue;
        const s = state.get(c);
        if (s === 1) back.add(`${id}>${c}`);
        else if (!s) dfs(c);
      }
      state.set(id, 2);
    };
    dfs(root);
    const reach = [...state.keys()];
    const fwd = (id: string) => (children.get(id) ?? []).filter((c) => state.has(c) && !back.has(`${id}>${c}`));

    // Rows: longest path (Kahn over the forward DAG).
    const indeg = new Map<string, number>(reach.map((id) => [id, 0]));
    for (const id of reach) for (const c of fwd(id)) indeg.set(c, (indeg.get(c) ?? 0) + 1);
    const row = new Map<string, number>([[root, 0]]);
    const queue = reach.filter((id) => (indeg.get(id) ?? 0) === 0);
    while (queue.length) {
      const id = queue.shift()!;
      for (const c of fwd(id)) {
        row.set(c, Math.max(row.get(c) ?? 0, (row.get(id) ?? 0) + 1));
        indeg.set(c, (indeg.get(c) ?? 1) - 1);
        if (indeg.get(c) === 0) queue.push(c);
      }
    }

    // Spanning tree from BFS (first discovering parent wins, handle order preserved).
    const treeKids = new Map<string, string[]>();
    const seen = new Set([root]);
    const bfs = [root];
    while (bfs.length) {
      const id = bfs.shift()!;
      const kids: string[] = [];
      for (const c of fwd(id)) {
        if (seen.has(c)) continue;
        seen.add(c);
        kids.push(c);
        bfs.push(c);
      }
      treeKids.set(id, kids);
    }

    // Columns: contour packing (Reingold-Tilford style). Subtrees sit side by side in handle order,
    // shifted right only as far as needed so they never share a cell on any row.
    type Contour = Map<number, [number, number]>;
    const col = new Map<string, number>();
    const rowOf = (id: string) => row.get(id) ?? 0;
    const place = (id: string): { cols: Map<string, number>; contour: Contour } => {
      const kids = treeKids.get(id) ?? [];
      if (kids.length === 0) return { cols: new Map([[id, 0]]), contour: new Map([[rowOf(id), [0, 0]]]) };
      const cols = new Map<string, number>();
      const contour: Contour = new Map();
      const kidCols: number[] = [];
      for (const k of kids) {
        const sub = place(k);
        let offset = 0;
        if (contour.size > 0) {
          offset = -Infinity;
          for (const [r, [min]] of sub.contour) {
            const taken = contour.get(r);
            if (taken) offset = Math.max(offset, taken[1] + 1 - min);
          }
          if (offset === -Infinity) offset = Math.max(...kidCols) + 1 - (sub.cols.get(k) ?? 0);
        }
        for (const [nid, c] of sub.cols) cols.set(nid, c + offset);
        for (const [r, [min, max]] of sub.contour) {
          const cur = contour.get(r);
          contour.set(r, cur ? [Math.min(cur[0], min + offset), Math.max(cur[1], max + offset)] : [min + offset, max + offset]);
        }
        kidCols.push(cols.get(k)!);
      }
      const centre = (kidCols[0]! + kidCols[kidCols.length - 1]!) / 2;
      let best = kidCols[0]!;
      for (const c of kidCols) if (Math.abs(c - centre) < Math.abs(best - centre) - 1e-6) best = c;
      cols.set(id, best);
      const r = rowOf(id);
      const cur = contour.get(r);
      contour.set(r, cur ? [Math.min(cur[0], best), Math.max(cur[1], best)] : [best, best]);
      return { cols, contour };
    };
    const placed1 = place(root);
    let minCol = Infinity;
    let maxCol = -Infinity;
    for (const c of placed1.cols.values()) {
      minCol = Math.min(minCol, c);
      maxCol = Math.max(maxCol, c);
    }
    for (const [nid, c] of placed1.cols) col.set(nid, c - minCol + left);
    const width = maxCol - minCol + 1;
    for (const id of reach) {
      placed.add(id);
      result.set(id, { x: (col.get(id) ?? left) * GRID_X, y: (row.get(id) ?? 0) * GRID_Y });
    }
    return width;
  };

  const trigger = nodes.find((n) => isTrigger(n.type));
  if (trigger) {
    layoutFrom(trigger.id, 0);
    // Shift so the trigger sits in column 0.
    const shift = result.get(trigger.id)!.x;
    for (const [id, p] of result) result.set(id, { x: p.x - shift, y: p.y });
    let maxCol = 0;
    for (const p of result.values()) maxCol = Math.max(maxCol, Math.round(p.x / GRID_X));
    nextLeft = maxCol + 1;
  }

  // Unreached steps: roots first (no incoming edges), then whatever remains (cycles).
  const remaining = () => nodes.filter((n) => !placed.has(n.id)).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  let rest = remaining();
  while (rest.length) {
    const root = rest.find((n) => (incoming.get(n.id) ?? 0) === 0) ?? rest[0]!;
    const before = new Set(result.keys());
    const w = layoutFrom(root.id, nextLeft);
    // Ensure the new tree starts at nextLeft.
    let minCol = Infinity;
    for (const [id, p] of result) if (!before.has(id)) minCol = Math.min(minCol, Math.round(p.x / GRID_X));
    const dx = (nextLeft - minCol) * GRID_X;
    for (const [id, p] of result) if (!before.has(id)) result.set(id, { x: p.x + dx, y: p.y });
    nextLeft += w;
    rest = remaining();
  }
  return result;
}
