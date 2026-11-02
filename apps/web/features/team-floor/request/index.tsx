'use client';

import { useQuery } from '@tanstack/react-query';
import { FLOOR_REQUEST_MIN_IMAGES, type FloorRequestStatus } from '@vistar/shared';
import { Building2 } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api/client';
import { isMockData } from '@/lib/api/data-source';

/**
 * PLACEHOLDER of `FloorRequestPanel` (floor-interface-19b.md). FLOOR (frontend-3d) owns
 * `features/team-floor/request/**` and replaces this file with the real panel (reference images by
 * category, headcount and notes, submit, status timeline). Same export name and props, so the Team Floor
 * workspace mounts either. On merge FLOOR's version wins.
 */
export interface FloorRequestPanelProps {
  /** Company admin (settings.manage): may submit; others see the status only. */
  canManage: boolean;
}

const STATUS: Record<FloorRequestStatus, { label: string; tone: 'blue' | 'amber' | 'green' | 'red'; text: string }> = {
  submitted: { label: 'Submitted', tone: 'blue', text: 'Vistar has your photos. Your office is being prepared.' },
  in_progress: { label: 'In progress', tone: 'amber', text: 'Your office is being prepared. It replaces the default floor once it is published.' },
  published: { label: 'Published', tone: 'green', text: 'Your own office floor is live.' },
  rejected: { label: 'Needs changes', tone: 'red', text: 'Vistar needs different photos. See the note below.' },
};

export function FloorRequestPanel({ canManage }: FloorRequestPanelProps) {
  const mock = isMockData();
  const layout = useQuery({
    queryKey: ['team-floor', 'workspace', 'layout'],
    queryFn: () => api.call('teamFloorLayout'),
    enabled: !mock,
    staleTime: 60_000,
  });

  if (!mock && layout.isPending) return <Skeleton className="h-28 w-full rounded-lg" aria-label="Loading your office floor" />;
  const request = layout.data?.request ?? null;
  if (request) {
    const s = STATUS[request.status];
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-card" role="status">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-fg">Your office floor</h3>
          <Chip tone={s.tone}>{s.label}</Chip>
        </div>
        <p className="text-sm text-fg-secondary">{s.text}</p>
        {request.statusNote && <p className="text-sm text-muted-strong">Note from Vistar: {request.statusNote}</p>}
      </div>
    );
  }
  return (
    <EmptyState
      size="sm"
      icon={<Building2 />}
      title="Get your own office on the floor"
      description={
        canManage
          ? `Upload at least ${FLOOR_REQUEST_MIN_IMAGES} photos of your office (work area, a cabin or meeting room). Vistar builds your floor from them. The upload form opens here.`
          : 'Your company admin can send photos of your office so Vistar builds your own floor. Until then you see the default office.'
      }
    />
  );
}
