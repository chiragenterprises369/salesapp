'use client';

import { EMPLOYEE_STATUS_LABEL, EMPLOYEE_STATUS_TONE, initials, type AttentionItem, type ResolvedTheme } from '@vistar/shared';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { getLayout, type FloorLayout } from '../state/layout';
import { firstName } from '../state/reducer';
import { locationOf } from '../state/selectors';
import type { FloorTemplate } from '../state/template';
import type { FloorEmployee, FloorState } from '../state/types';

/**
 * Flat floor plan (SPEC 12.1 item 7): the floor template drawn top-down as SVG with the same room
 * colours as the 3D office (honey oak, grey-blue carpet, walnut), furniture, seat dots and status
 * rings. Works for every template. The plan is a visual map (aria-hidden, pointer clicks open the
 * person); keyboard and screen-reader users get the same people and places from the accessible
 * employee list rendered next to it. No three.js here: this file is part of the light entry chunk.
 */

/** Plan colours per theme: the 3D art palette (look.ts ART), tinted so text and dots stay legible. */
const PLAN = {
  light: {
    oak: '#ecd8bb',
    carpet: '#d5dce5',
    walnut: '#cfae93',
    stone: '#e6e2dc',
    wall: '#3a5560',
    glass: '#8fbbdc',
    walnutWall: '#7a5232',
    partition: '#9aa4ad',
    window: '#bfe0f7',
    furniture: '#fbfaf8',
    furnitureEdge: '#c9b79e',
    walnutFurniture: '#8c6448',
    sofa: '#4f8f75',
    plant: '#86b874',
    marble: '#f4f2ee',
    chair: '#b9a68c',
    platform: '#dfe5ee',
    hub: '#3b82f6',
    label: '#4a5568',
    porch: '#cfd2d6',
  },
  dark: {
    oak: '#4a3a2b',
    carpet: '#25303f',
    walnut: '#2b1d15',
    stone: '#34373e',
    wall: '#5f7b88',
    glass: '#4f7699',
    walnutWall: '#8a6040',
    partition: '#5b6470',
    window: '#3f5f86',
    furniture: '#4a505e',
    furnitureEdge: '#5b6272',
    walnutFurniture: '#5a3e2c',
    sofa: '#2f6a56',
    plant: '#3f7048',
    marble: '#6b6f78',
    chair: '#5e5346',
    platform: '#27324a',
    hub: '#60a5fa',
    label: '#b8c2d9',
    porch: '#2b2f37',
  },
} as const satisfies Record<ResolvedTheme, Record<string, string>>;

type Palette = (typeof PLAN)[ResolvedTheme];

const PAD = 0.5;
/** Smallest on-screen person dot (px). Below it the plan drops initials and shows plain dots. */
const MIN_DOT_PX = 9;
const INITIALS_DOT_PX = 11;

export interface FloorMapProps {
  state: FloorState;
  template: FloorTemplate;
  theme: ResolvedTheme;
  attention: Map<string, AttentionItem[]>;
  selectedId: string | null;
  onOpen: (id: string) => void;
  className?: string;
}

interface Marker {
  emp: FloorEmployee;
  x: number;
  z: number;
  present: boolean;
}

export function FloorMap({ state, template, theme, attention, selectedId, onOpen, className }: FloorMapProps) {
  const layout = useMemo(() => getLayout(template, state.homeCount), [template, state.homeCount]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [pxPerM, setPxPerM] = useState(30);
  const c = PLAN[theme];
  const [minX, minZ] = template.bounds.min;
  const [maxX, maxZ] = template.bounds.max;
  const vb = { x: minX - PAD, z: minZ - PAD, w: maxX - minX + PAD * 2, h: maxZ - minZ + PAD * 2 + 1.0 };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // The SVG keeps its aspect (meet), so the scale is limited by the tighter side.
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setPxPerM(Math.min(width / vb.w, height / vb.h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [vb.w, vb.h]);

  const markers = useMemo(() => placeMarkers(state, layout), [state, layout]);
  // Person dot radius in metres: real size (0.36 m) or bigger on small screens, never under MIN_DOT_PX.
  const r = Math.max(0.36, MIN_DOT_PX / 2 / pxPerM);
  const withInitials = r * 2 * pxPerM >= INITIALS_DOT_PX * 1.6;
  const text = (px: number, min: number) => Math.max(min, px / pxPerM);
  const waiting = state.leadsWaiting.length + state.leadsWaitingExtra;

  return (
    <svg
      ref={svgRef}
      viewBox={`${vb.x} ${vb.z} ${vb.w} ${vb.h}`}
      className={cn('block h-auto w-full select-none', className)}
      aria-hidden
      data-floor-map={template.id}
      data-people={markers.length}
    >
      <StaticPlan template={template} c={c} label={text(11, 0.34)} />
      {/* Lead Hub */}
      <g>
        <circle cx={layout.hub.x} cy={layout.hub.z} r={template.hub.platformRadius} fill={c.platform} />
        <circle cx={layout.hub.x} cy={layout.hub.z} r={template.hub.ringRadius} fill="none" stroke={c.hub} strokeWidth={0.1} />
        <circle cx={layout.hub.x} cy={layout.hub.z} r={template.hub.machineRadius} fill={c.hub} opacity={0.9} />
        <text x={layout.hub.x} y={layout.hub.z + text(4, 0.12)} textAnchor="middle" fontSize={text(10, 0.28)} fontWeight={700} fill="#ffffff">
          {waiting > 0 ? waiting : 'HUB'}
        </text>
        <text x={layout.hub.x} y={layout.hub.z + template.hub.platformRadius + text(13, 0.4)} textAnchor="middle" fontSize={text(11, 0.34)} fontWeight={600} fill={c.label}>
          Lead Hub{waiting > 0 ? ` · ${waiting} waiting` : ''}
        </text>
      </g>
      {markers.map((m) => (
        <PersonDot
          key={m.emp.id}
          m={m}
          r={r}
          withInitials={withInitials}
          selected={m.emp.id === selectedId}
          needsYou={(attention.get(m.emp.id)?.length ?? 0) > 0}
          fontSize={r * 0.82}
          onOpen={onOpen}
        />
      ))}
    </svg>
  );
}

/** Rooms, walls, furniture, chairs and the entrance (only changes with the template or theme). */
const StaticPlan = memo(function StaticPlan({ template, c, label }: { template: FloorTemplate; c: Palette; label: number }) {
  const floorFill: Record<string, string> = { oak: c.oak, carpet: c.carpet, walnut: c.walnut, stone: c.stone };
  const furniture = useMemo(() => furnitureShapes(template, c), [template, c]);
  const pts = (outline: [number, number][]) => outline.map(([x, z]) => `${x},${z}`).join(' ');
  const [ex, ez] = template.entrance.outside;
  return (
    <g>
      <rect x={ex - 1.2} y={ez - 0.75} width={2.4} height={1.3} rx={0.08} fill={c.porch} />
      <polygon points={pts(template.footprint)} fill={c.oak} />
      {template.rooms.map((room) => (
        <polygon key={room.id} points={pts(room.outline)} fill={floorFill[room.floor] ?? c.oak} />
      ))}
      {furniture}
      {template.seats.map((s) => (
        <circle key={s.id} cx={s.pos[0]} cy={s.pos[1]} r={0.2} fill={c.chair} opacity={0.75} />
      ))}
      {template.walls.map((w) => (
        <WallLine key={w.id} wall={w} c={c} />
      ))}
      {template.rooms
        .filter((room) => room.type !== 'sales_floor')
        .map((room) => {
          const [cx, cz, width] = labelPoint(room.outline);
          // Skip names that do not fit the room (e.g. the narrow print corner); the list names it.
          if (room.name.length * label * 0.66 > width - 0.2) return null;
          return (
            <text
              key={room.id}
              x={cx}
              y={cz}
              textAnchor="middle"
              fontSize={label}
              fontWeight={600}
              letterSpacing={0.02}
              fill={c.label}
              stroke={floorFill[room.floor] ?? c.oak}
              strokeWidth={label * 0.28}
              strokeLinejoin="round"
              paintOrder="stroke"
              style={{ textTransform: 'uppercase' }}
            >
              {room.name}
            </text>
          );
        })}
      <text x={ex} y={ez + label * 0.35} textAnchor="middle" fontSize={label * 0.9} fill={c.label}>
        Entrance
      </text>
    </g>
  );
});

function WallLine({ wall, c }: { wall: FloorTemplate['walls'][number]; c: Palette }) {
  const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const ux = (wall.b[0] - wall.a[0]) / len;
  const uz = (wall.b[1] - wall.a[1]) / len;
  const at = (s: number): [number, number] => [wall.a[0] + ux * s, wall.a[1] + uz * s];
  const color = wall.kind === 'glass' ? c.glass : wall.kind === 'glass_walnut' ? c.walnutWall : wall.kind === 'partition' ? c.partition : c.wall;
  const width = wall.kind === 'glass' ? 0.08 : Math.max(0.12, wall.thickness);
  const segs: [number, number][] = [];
  let cursor = 0;
  for (const o of [...wall.openings].filter((o) => o.kind !== 'window').sort((p, q) => p.from - q.from)) {
    if (o.from > cursor) segs.push([cursor, o.from]);
    cursor = Math.max(cursor, o.to);
  }
  if (cursor < len) segs.push([cursor, len]);
  return (
    <g>
      {segs.map(([s0, s1]) => {
        const [x1, z1] = at(s0);
        const [x2, z2] = at(s1);
        return <line key={s0} x1={x1} y1={z1} x2={x2} y2={z2} stroke={color} strokeWidth={width} strokeLinecap="square" />;
      })}
      {wall.openings
        .filter((o) => o.kind === 'window')
        .map((o) => {
          const [x1, z1] = at(o.from);
          const [x2, z2] = at(o.to);
          return <line key={`w${o.from}`} x1={x1} y1={z1} x2={x2} y2={z2} stroke={c.window} strokeWidth={width * 0.55} />;
        })}
    </g>
  );
}

function furnitureShapes(template: FloorTemplate, c: Palette) {
  const kindAt = (x: number, z: number) => template.props.find((p) => Math.abs(p.pos[0] - x) < 0.06 && Math.abs(p.pos[1] - z) < 0.06)?.type ?? '';
  const [hx, hz] = template.hub.pos;
  return template.obstacles.map((o, i) => {
    const type = kindAt(o.pos[0], o.pos[1]);
    if (o.kind === 'circle') {
      if (Math.hypot(o.pos[0] - hx, o.pos[1] - hz) < 0.1) return null; // the hub machine is drawn separately
      return <circle key={i} cx={o.pos[0]} cy={o.pos[1]} r={o.r * 0.9} fill={type.startsWith('floor_lamp') ? c.furnitureEdge : c.plant} />;
    }
    const fill =
      type === 'sofa_green' || type === 'armchair_green'
        ? c.sofa
        : type === 'reception_counter'
          ? c.marble
          : type.includes('walnut') || type === 'chair_visitor'
            ? c.walnutFurniture
            : c.furniture;
    const [w, d] = o.size;
    return (
      <rect
        key={i}
        x={o.pos[0] - w / 2}
        y={o.pos[1] - d / 2}
        width={w}
        height={d}
        rx={0.06}
        fill={fill}
        stroke={c.furnitureEdge}
        strokeWidth={0.03}
        transform={o.facing ? `rotate(${-o.facing} ${o.pos[0]} ${o.pos[1]})` : undefined}
      />
    );
  });
}

/** Where each person is drawn: own desk, calling booth, lounge seat; offline people leave a dashed seat. */
function placeMarkers(state: FloorState, layout: FloorLayout): Marker[] {
  const out: Marker[] = [];
  for (const emp of state.employees) {
    const loc = locationOf(state, emp);
    const spot = loc.kind === 'booth' ? layout.booths[loc.index] : loc.kind === 'lounge' ? layout.lounge[loc.index] : layout.homes[emp.desk];
    if (!spot) continue;
    out.push({ emp, x: spot.x, z: spot.z, present: loc.kind !== 'gone' });
  }
  return out.sort((a, b) => a.z - b.z);
}

const PersonDot = memo(function PersonDot({
  m,
  r,
  withInitials,
  selected,
  needsYou,
  fontSize,
  onOpen,
}: {
  m: Marker;
  r: number;
  withInitials: boolean;
  selected: boolean;
  needsYou: boolean;
  fontSize: number;
  onOpen: (id: string) => void;
}) {
  const { emp, x, z, present } = m;
  const tone = `var(--status-${EMPLOYEE_STATUS_TONE[emp.status]}-fg)`;
  return (
    <g className="cursor-pointer" onClick={() => onOpen(emp.id)} data-person={emp.id} data-status={emp.status}>
      <title>{`${firstName(emp.name)}, ${EMPLOYEE_STATUS_LABEL[emp.status]}`}</title>
      {emp.status === 'on_call' && present && <circle cx={x} cy={z} r={r * 1.75} fill="none" stroke={tone} strokeWidth={r * 0.18} className="motion-safe:animate-pulse" />}
      {selected && <circle cx={x} cy={z} r={r * 1.38} fill="none" stroke="var(--accent)" strokeWidth={r * 0.2} />}
      <circle
        cx={x}
        cy={z}
        r={r}
        fill={withInitials ? 'var(--surface)' : tone}
        stroke={tone}
        strokeWidth={r * 0.24}
        strokeDasharray={present ? undefined : `${r * 0.45} ${r * 0.3}`}
        opacity={present ? 1 : 0.7}
      />
      {withInitials && (
        <text x={x} y={z + fontSize * 0.36} textAnchor="middle" fontSize={fontSize} fontWeight={700} fill={present ? 'var(--fg)' : 'var(--muted)'}>
          {initials(emp.name)}
        </text>
      )}
      {needsYou && (
        <g>
          <circle cx={x + r * 0.85} cy={z - r * 0.85} r={r * 0.46} fill="var(--status-red-fg)" stroke="var(--surface)" strokeWidth={r * 0.1} />
          <text x={x + r * 0.85} y={z - r * 0.85 + r * 0.24} textAnchor="middle" fontSize={r * 0.62} fontWeight={800} fill="var(--surface)">
            !
          </text>
        </g>
      )}
    </g>
  );
});

/** Where a room's name goes: centred near its south edge (open floor or a glass wall in every template), plus the room width. */
function labelPoint(outline: [number, number][]): [number, number, number] {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, z] of outline) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  return [(x0 + x1) / 2, z1 - 0.3, x1 - x0];
}
