'use client';

import type { FloorSeatKind, SeatMap } from '@vistar/shared';
import { Armchair, Minus, MousePointer2, Plus, Scan, SquareDashed } from 'lucide-react';
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { polygonCentroid } from '@/features/team-floor/state/layout';
import {
  addSeat,
  addZone,
  removeCorner,
  removeSeat,
  removeZone,
  SEAT_KIND_LABEL,
  snap,
  snapAngle,
  updateSeat,
  updateZone,
  type Selection,
  type SeatTool,
} from './seat-model';

/**
 * Seat tool (SPEC 29.5): seats and zones drawn over the floor plan (layout_json) or a top view of the
 * uploaded model. Select and drag seats, their rotation handle, zones and zone corners; add seats by
 * clicking, zones by dragging a rectangle. Keyboard: arrows move the selected seat or zone (Shift =
 * 50 cm), [ and ] turn a seat by 15 degrees, R by 90, Delete removes, Esc clears the selection.
 * The inspector next to it edits the same values as numbers (the non-pointer path).
 */

export interface Bounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

const KIND_COLOR: Record<FloorSeatKind, string> = {
  desk: 'var(--status-indigo-fg)',
  cabin: 'var(--status-amber-fg)',
  meeting: 'var(--status-blue-fg)',
  lounge: 'var(--status-green-fg)',
  reception: 'var(--status-grey-fg)',
};

type Drag =
  | { kind: 'seat'; id: string; dx: number; dz: number; moved: boolean }
  | { kind: 'rotate'; id: string; moved: boolean }
  | { kind: 'vertex'; id: string; vertex: number; moved: boolean }
  | { kind: 'zone'; id: string; start: [number, number]; poly: [number, number][]; moved: boolean }
  | { kind: 'rect'; start: [number, number]; end: [number, number] }
  | { kind: 'pan'; start: [number, number]; view: Bounds; px: number };

export function SeatToolCanvas({
  map,
  onChange,
  selection,
  onSelect,
  background,
  bounds,
  readOnly,
}: {
  map: SeatMap;
  onChange: (next: SeatMap, merge?: boolean) => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  background: ReactNode;
  bounds: Bounds;
  readOnly: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<SeatTool>('select');
  const [newKind, setNewKind] = useState<FloorSeatKind>('desk');
  const [drag, setDrag] = useState<Drag | null>(null);
  const pad = 0.8;
  const full = useMemo<Bounds>(
    () => ({
      minX: bounds.minX - pad,
      minZ: bounds.minZ - pad,
      maxX: bounds.maxX + pad,
      maxZ: bounds.maxZ + pad,
    }),
    [bounds],
  );
  const [view, setView] = useState<Bounds>(full);
  const [viewFor, setViewFor] = useState(full);
  if (viewFor !== full) {
    // New floor bounds (model placement changed): fit again.
    setViewFor(full);
    setView(full);
  }
  const vw = view.maxX - view.minX;
  const vh = view.maxZ - view.minZ;
  const unit = Math.max(vw, vh) / 60; // label and handle size follow the zoom

  const toFloor = (e: { clientX: number; clientY: number }): [number, number] => {
    const el = svg.current;
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return [p.x, p.y];
  };

  const zoom = (f: number) =>
    setView((v) => {
      const cx = (v.minX + v.maxX) / 2;
      const cz = (v.minZ + v.maxZ) / 2;
      const w = Math.min(full.maxX - full.minX, Math.max(3, (v.maxX - v.minX) / f));
      const h = (w * (full.maxZ - full.minZ)) / (full.maxX - full.minX);
      return { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - h / 2, maxZ: cz + h / 2 };
    });

  const begin = (e: ReactPointerEvent, d: Drag) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag(d);
  };

  const onBackgroundDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = toFloor(e);
    if (!readOnly && tool === 'seat') {
      const { map: next, id } = addSeat(map, newKind, p[0], p[1]);
      onChange(next);
      onSelect({ kind: 'seat', id });
      return;
    }
    if (!readOnly && tool === 'zone') {
      svg.current?.setPointerCapture(e.pointerId);
      setDrag({ kind: 'rect', start: p, end: p });
      return;
    }
    onSelect(null);
    const zoomed = vw < full.maxX - full.minX - 0.01;
    if (zoomed) {
      svg.current?.setPointerCapture(e.pointerId);
      const rect = svg.current!.getBoundingClientRect();
      setDrag({
        kind: 'pan',
        start: [e.clientX, e.clientY],
        view,
        px: vw / Math.max(1, rect.width),
      });
    }
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const [x, z] = toFloor(e);
    switch (drag.kind) {
      case 'seat': {
        onChange(
          updateSeat(map, drag.id, { position: [snap(x - drag.dx), 0, snap(z - drag.dz)] }),
          drag.moved,
        );
        if (!drag.moved) setDrag({ ...drag, moved: true });
        return;
      }
      case 'rotate': {
        const s = map.seats.find((q) => q.id === drag.id);
        if (!s) return;
        const deg = (Math.atan2(x - s.position[0], z - s.position[2]) * 180) / Math.PI;
        onChange(
          updateSeat(map, drag.id, { rotation: e.altKey ? Math.round(deg) : snapAngle(deg) }),
          drag.moved,
        );
        if (!drag.moved) setDrag({ ...drag, moved: true });
        return;
      }
      case 'vertex': {
        const zone = map.zones.find((q) => q.id === drag.id);
        if (!zone) return;
        const polygon = zone.polygon.map((p, i) =>
          i === drag.vertex ? ([snap(x, 0.1), snap(z, 0.1)] as [number, number]) : p,
        );
        onChange(updateZone(map, drag.id, { polygon }), drag.moved);
        if (!drag.moved) setDrag({ ...drag, moved: true });
        return;
      }
      case 'zone': {
        const dx = snap(x - drag.start[0], 0.1);
        const dz = snap(z - drag.start[1], 0.1);
        onChange(
          updateZone(map, drag.id, {
            polygon: drag.poly.map(([px, pz]) => [px + dx, pz + dz] as [number, number]),
          }),
          drag.moved,
        );
        if (!drag.moved) setDrag({ ...drag, moved: true });
        return;
      }
      case 'rect':
        setDrag({ ...drag, end: [x, z] });
        return;
      case 'pan': {
        const dx = (e.clientX - drag.start[0]) * drag.px;
        const dz = (e.clientY - drag.start[1]) * drag.px;
        setView({
          minX: drag.view.minX - dx,
          maxX: drag.view.maxX - dx,
          minZ: drag.view.minZ - dz,
          maxZ: drag.view.maxZ - dz,
        });
        return;
      }
    }
  };

  const onUp = () => {
    if (drag?.kind === 'seat' && drag.moved) {
      // Seats join the zone they were dropped in.
      onChange(updateSeat(map, drag.id, {}, true), true);
    }
    if (drag?.kind === 'rect') {
      const [x0, z0] = drag.start;
      const [x1, z1] = drag.end;
      if (Math.abs(x1 - x0) > 0.6 && Math.abs(z1 - z0) > 0.6) {
        const { map: next, id } = addZone(map, x0, z0, x1, z1);
        onChange(next);
        onSelect({ kind: 'zone', id });
        setTool('select');
      }
    }
    setDrag(null);
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'Escape') {
      onSelect(null);
      return;
    }
    if (readOnly || !selection) return;
    const step = e.shiftKey ? 0.5 : 0.1;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const m = move[e.key];
    if (selection.kind === 'seat') {
      const s = map.seats.find((q) => q.id === selection.id);
      if (!s) return;
      if (m)
        onChange(
          updateSeat(
            map,
            s.id,
            { position: [snap(s.position[0] + m[0]), 0, snap(s.position[2] + m[1])] },
            true,
          ),
        );
      else if (e.key === '[' || e.key === ']')
        onChange(
          updateSeat(map, s.id, { rotation: snapAngle(s.rotation + (e.key === ']' ? 15 : -15)) }),
        );
      else if (e.key === 'r' || e.key === 'R')
        onChange(updateSeat(map, s.id, { rotation: snapAngle(s.rotation + 90) }));
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        onChange(removeSeat(map, s.id));
        onSelect(null);
      } else return;
      e.preventDefault();
      return;
    }
    const zone = map.zones.find((q) => q.id === selection.id);
    if (!zone) return;
    if (m)
      onChange(
        updateZone(map, zone.id, {
          polygon: zone.polygon.map(([x, z], i) =>
            selection.vertex === undefined || selection.vertex === i
              ? ([snap(x + m[0], 0.1), snap(z + m[1], 0.1)] as [number, number])
              : [x, z],
          ),
        }),
      );
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selection.vertex !== undefined) onChange(removeCorner(map, zone.id, selection.vertex));
      else onChange(removeZone(map, zone.id));
      onSelect(selection.vertex !== undefined ? { kind: 'zone', id: zone.id } : null);
    } else return;
    e.preventDefault();
  };

  const rect = drag?.kind === 'rect' ? drag : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Seat tool">
        <div
          role="group"
          aria-label="Tool"
          className="flex gap-1 rounded-md border border-border bg-surface p-0.5"
        >
          <ToolButton
            active={tool === 'select'}
            onClick={() => setTool('select')}
            label="Select and move"
          >
            <MousePointer2 aria-hidden />
          </ToolButton>
          <ToolButton
            active={tool === 'seat'}
            disabled={readOnly}
            onClick={() => setTool('seat')}
            label="Add seats (click on the plan)"
          >
            <Armchair aria-hidden />
          </ToolButton>
          <ToolButton
            active={tool === 'zone'}
            disabled={readOnly}
            onClick={() => setTool('zone')}
            label="Add a zone (drag a rectangle)"
          >
            <SquareDashed aria-hidden />
          </ToolButton>
        </div>
        {tool === 'seat' && (
          <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
            New seats
            <NativeSelect
              size="sm"
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as FloorSeatKind)}
              wrapperClassName="w-36"
            >
              {(Object.keys(SEAT_KIND_LABEL) as FloorSeatKind[]).map((k) => (
                <option key={k} value={k}>
                  {SEAT_KIND_LABEL[k]}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => zoom(1.4)}>
            <Plus aria-hidden />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Zoom out"
            onClick={() => zoom(1 / 1.4)}
          >
            <Minus aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setView(full)}
            aria-label="Fit the whole floor"
          >
            <Scan aria-hidden />
            Fit
          </Button>
        </div>
      </div>
      <svg
        ref={svg}
        role="application"
        aria-label="Seat map editor. Select a seat or zone, then use the arrow keys to move it, [ and ] to turn a seat, Delete to remove it. The inspector has the same settings as fields."
        tabIndex={0}
        viewBox={`${view.minX} ${view.minZ} ${vw} ${vh}`}
        className={cn(
          'focus-ring block aspect-[3/2] max-h-[68dvh] w-full touch-none rounded-md border border-border bg-surface-2 select-none',
          tool !== 'select' && 'cursor-crosshair',
        )}
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
        data-seat-tool=""
      >
        <g pointerEvents="none">{background}</g>
        {map.zones.map((z) => {
          const selected = selection?.kind === 'zone' && selection.id === z.id;
          const [cx, cz] = polygonCentroid(z.polygon);
          return (
            <g key={z.id} data-zone={z.id}>
              <polygon
                points={z.polygon.map(([x, zz]) => `${x},${zz}`).join(' ')}
                fill="var(--accent)"
                fillOpacity={selected ? 0.16 : 0.06}
                stroke="var(--accent)"
                strokeWidth={unit * 0.12}
                strokeDasharray={selected ? undefined : `${unit * 0.4} ${unit * 0.25}`}
                className={tool === 'select' ? 'cursor-move' : undefined}
                onPointerDown={(e) => {
                  if (tool !== 'select' || e.button !== 0) return;
                  e.stopPropagation();
                  onSelect({ kind: 'zone', id: z.id });
                  if (!readOnly)
                    begin(e, {
                      kind: 'zone',
                      id: z.id,
                      start: toFloor(e),
                      poly: z.polygon,
                      moved: false,
                    });
                }}
              />
              <text
                x={cx}
                y={cz}
                textAnchor="middle"
                fontSize={unit * 0.9}
                fontWeight={600}
                fill="var(--accent-text)"
                stroke="var(--surface)"
                strokeWidth={unit * 0.25}
                paintOrder="stroke"
                pointerEvents="none"
              >
                {z.name}
              </text>
              {selected &&
                z.polygon.map(([x, zz], i) => (
                  <circle
                    key={i}
                    cx={x}
                    cy={zz}
                    r={unit * 0.45}
                    fill={selection.vertex === i ? 'var(--accent)' : 'var(--surface)'}
                    stroke="var(--accent)"
                    strokeWidth={unit * 0.12}
                    className="cursor-grab"
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      onSelect({ kind: 'zone', id: z.id, vertex: i });
                      if (!readOnly)
                        begin(e, { kind: 'vertex', id: z.id, vertex: i, moved: false });
                    }}
                  />
                ))}
            </g>
          );
        })}
        {map.seats.map((s) => {
          const selected = selection?.kind === 'seat' && selection.id === s.id;
          const x = s.position[0];
          const z = s.position[2];
          const rad = (s.rotation * Math.PI) / 180;
          const hx = x + Math.sin(rad) * 0.62;
          const hz = z + Math.cos(rad) * 0.62;
          return (
            <g key={s.id} data-seat={s.id} data-kind={s.kind}>
              <line
                x1={x}
                y1={z}
                x2={x + Math.sin(rad) * 0.45}
                y2={z + Math.cos(rad) * 0.45}
                stroke={KIND_COLOR[s.kind]}
                strokeWidth={0.07}
                strokeLinecap="round"
                pointerEvents="none"
              />
              <circle
                cx={x}
                cy={z}
                r={0.24}
                fill={KIND_COLOR[s.kind]}
                stroke={selected ? 'var(--fg)' : 'var(--surface)'}
                strokeWidth={selected ? 0.08 : 0.05}
                className={tool === 'select' ? 'cursor-grab' : undefined}
                onPointerDown={(e) => {
                  if (tool !== 'select' || e.button !== 0) return;
                  e.stopPropagation();
                  onSelect({ kind: 'seat', id: s.id });
                  const [px, pz] = toFloor(e);
                  if (!readOnly)
                    begin(e, { kind: 'seat', id: s.id, dx: px - x, dz: pz - z, moved: false });
                }}
              >
                <title>{`${s.label ?? s.id} (${SEAT_KIND_LABEL[s.kind]})`}</title>
              </circle>
              {(selected || unit < 0.35) && (
                <text
                  x={x}
                  y={z - 0.36}
                  textAnchor="middle"
                  fontSize={Math.min(0.32, unit * 0.75)}
                  fontWeight={600}
                  fill="var(--fg)"
                  stroke="var(--surface)"
                  strokeWidth={0.06}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {s.label ?? s.id}
                </text>
              )}
              {selected && !readOnly && (
                <circle
                  cx={hx}
                  cy={hz}
                  r={0.13}
                  fill="var(--surface)"
                  stroke="var(--fg)"
                  strokeWidth={0.05}
                  className="cursor-alias"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    begin(e, { kind: 'rotate', id: s.id, moved: false });
                  }}
                >
                  <title>Drag to turn the seat (Alt for free angles)</title>
                </circle>
              )}
            </g>
          );
        })}
        {rect && (
          <rect
            x={Math.min(rect.start[0], rect.end[0])}
            y={Math.min(rect.start[1], rect.end[1])}
            width={Math.abs(rect.end[0] - rect.start[0])}
            height={Math.abs(rect.end[1] - rect.start[1])}
            fill="var(--accent)"
            fillOpacity={0.12}
            stroke="var(--accent)"
            strokeWidth={unit * 0.12}
            pointerEvents="none"
          />
        )}
      </svg>
      <p className="text-xs text-muted-strong">
        {tool === 'seat'
          ? 'Click on the plan to place a seat. The small line shows where the person faces.'
          : tool === 'zone'
            ? 'Drag a rectangle for a room or area, then name it in the inspector and drag its corners.'
            : 'Drag seats, zones and corners. Drag the small handle in front of a selected seat to turn it.'}
      </p>
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  label,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      size="icon-sm"
      variant={active ? 'primary' : 'ghost'}
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}
