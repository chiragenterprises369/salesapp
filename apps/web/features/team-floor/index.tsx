'use client';

import type { TeamFloorMode } from '@vistar/shared';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * PUBLIC API of features/team-floor (contract; owner frontend-3d replaces the implementation,
 * keeps the export name and props). The three.js bundle must stay lazy (next/dynamic inside).
 * Mounted at /app/team-floor (full) and /me/team-floor (readOnly, flat default) by frontend-app.
 */
export interface TeamFloorProps {
  /** 'auto' = 3D on capable desktops, flat on mobile/low-end/reduced motion. User setting teamFloorMode. */
  mode?: TeamFloorMode;
  /** Employee panel: no reassign/resolve actions. */
  readOnly?: boolean;
  /** Manager scope: only these users (null = whole workspace). */
  userIds?: string[] | null;
}

export function TeamFloor(_props: TeamFloorProps) {
  return <Skeleton className="h-[calc(100dvh-8rem)] w-full rounded-lg" aria-label="Team floor loading" />;
}
