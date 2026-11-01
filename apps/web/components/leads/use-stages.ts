'use client';

import type { Stage } from '@vistar/shared';
import { mockPipeline } from '@vistar/shared/fixtures';
import { useMemo } from 'react';
import { useDefaultPipeline } from '@/lib/customization';

/** Static default pipeline: FALLBACK ONLY while the live pipeline loads (same ids as the mock DB seed). */
export const FALLBACK_PIPELINE = mockPipeline();
export const FALLBACK_STAGES: readonly Stage[] = FALLBACK_PIPELINE.stages;

export interface PipelineStages {
  pipelineId: string;
  stages: readonly Stage[];
  byId: ReadonlyMap<string, Stage>;
  /** False while the static fallback is shown. */
  live: boolean;
}

/**
 * Stages of the default pipeline from the flexible data layer (Settings > Stages edits show up
 * everywhere). Falls back to the static default stages while loading, so ids still resolve.
 */
export function usePipelineStages(): PipelineStages {
  const q = useDefaultPipeline();
  const pipeline = q.data ?? FALLBACK_PIPELINE;
  return useMemo(
    () => ({
      pipelineId: pipeline.id,
      stages: pipeline.stages,
      byId: new Map(pipeline.stages.map((s) => [s.id, s])),
      live: !!q.data,
    }),
    [pipeline, q.data],
  );
}

/** Stage name for a stage id (timeline, exports). */
export const stageNameOf = (byId: ReadonlyMap<string, Stage>, id: string | null | undefined) =>
  id ? byId.get(id)?.name : undefined;
