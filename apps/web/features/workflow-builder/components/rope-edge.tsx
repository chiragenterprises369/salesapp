'use client';

import { getBezierPath, type ConnectionLineComponentProps, type EdgeProps } from '@xyflow/react';
import { memo, useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/cn';
import type { FlowEdge } from '../lib/graph';
import { useBuilder, useEnv, useWorld } from '../store/context';

/**
 * Edge renderer. Physics mode: a verlet rope whose path is written by the physics world every
 * frame (React never sets `d`). Flat mode: a plain bezier from React Flow's handle positions.
 * Both modes host the run packet (dot + halo) that travels along the path.
 */
function RopeEdgeComponent({ id, source, target, sourceHandleId, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected }: EdgeProps<FlowEdge>) {
  const world = useWorld();
  const { physics } = useEnv();
  const mainRef = useRef<SVGPathElement>(null);
  const shadowRef = useRef<SVGPathElement>(null);
  const hitRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const haloRef = useRef<SVGCircleElement>(null);
  const traversed = useBuilder((s) => !!s.run?.traversed.includes(id));
  const handle = sourceHandleId ?? 'out';

  const [flatPath] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });

  useLayoutEffect(() => {
    if (!physics) return;
    const main = mainRef.current;
    const shadow = shadowRef.current;
    const hit = hitRef.current;
    if (!main || !shadow || !hit) return;
    world.registerRope(id, { source, target, sourceHandle: handle }, { main, shadow, hit });
    return () => world.unregisterRope(id);
  }, [physics, id, source, target, handle, world]);

  useLayoutEffect(() => {
    const path = mainRef.current;
    const dot = dotRef.current;
    const halo = haloRef.current;
    if (!path || !dot || !halo) return;
    world.registerPacket(id, { path, dot, halo });
    return () => world.unregisterPacket(id);
  }, [id, world]);

  const d = physics ? undefined : flatPath;
  return (
    <g className={cn('wf-edge', selected && 'is-selected', traversed && 'is-traversed', physics ? 'is-rope' : 'is-flat')}>
      <path ref={shadowRef} className="wf-edge-shadow" d={d} transform="translate(0 3)" fill="none" />
      <path ref={mainRef} className="wf-edge-path" d={d} fill="none" />
      <path ref={hitRef} className="react-flow__edge-interaction" d={d} fill="none" stroke="currentColor" strokeOpacity={0} strokeWidth={18} />
      <circle ref={haloRef} r={11} className="wf-packet-halo" style={{ opacity: 0 }} />
      <circle ref={dotRef} r={5.5} className="wf-packet" style={{ opacity: 0 }} />
    </g>
  );
}

export const RopeEdge = memo(RopeEdgeComponent);

export function ConnectionLine({ fromX, fromY, toX, toY, fromPosition, toPosition }: ConnectionLineComponentProps) {
  const [path] = getBezierPath({ sourceX: fromX, sourceY: fromY, sourcePosition: fromPosition, targetX: toX, targetY: toY, targetPosition: toPosition });
  return (
    <g>
      <path d={path} className="wf-connection-line" fill="none" />
      <circle cx={toX} cy={toY} r={4} className="wf-connection-end" />
    </g>
  );
}
