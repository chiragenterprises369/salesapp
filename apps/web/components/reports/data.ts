'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '@/lib/api/client';
import { isMockData } from '@/lib/api/data-source';
import { useMe } from '@/lib/session/session';
import { viewerFromMe, worldContext } from '@/lib/world';
import { useReportSummary } from '@/lib/world/hooks';
import { forecastByStage, type ForecastRow } from './logic';

/**
 * Reports data adapter: the scoped report summary for a range (and the previous range for
 * comparisons), plus the stage breakdown of the revenue forecast. There is no reports API yet, so
 * API mode shows an empty summary; the forecast comes from the real board (open stage totals x stage
 * probability, data scope applied by the API). The test-only mock data mode reads the mock world.
 */
export function useReport(range: { from: number; to: number } | null) {
  return useReportSummary(range?.from ?? 0, range?.to ?? 0);
}

async function apiForecast(): Promise<ForecastRow[]> {
  const pipelines = (await api.call('pipelineList')).items;
  const pipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];
  if (!pipeline) return [];
  const board = await api.call('pipelineBoard', { params: { id: pipeline.id }, query: { perColumn: 1 } });
  return board.columns
    .filter((c) => c.stage.type === 'open')
    .map((c) => {
      const probability = c.stage.probability ?? 0;
      return { stageId: c.stage.id, name: c.stage.name, probability, leads: c.count, valueInr: c.totalValueInr, weightedInr: Math.round((c.totalValueInr * probability) / 100) };
    });
}

export function useForecast() {
  const me = useMe();
  const v = useMemo(() => viewerFromMe(me), [me]);
  const mock = isMockData();
  return useQuery({
    queryKey: ['dashboard', 'pages', v.userId, 'forecast'],
    queryFn: async () => {
      if (!mock) return apiForecast();
      await new Promise((r) => setTimeout(r, 200));
      const ctx = worldContext();
      return forecastByStage(ctx.leads, ctx.stages, v.visible);
    },
    enabled: !!v.userId,
  });
}

let since: number | null = null;
/** Earliest time with data: earlier ranges have none, so comparisons with them are skipped. */
export function dataSince(): number {
  // API mode: the workspace has no report history yet (no reports API), so no comparison range.
  if (!isMockData()) return Number.POSITIVE_INFINITY;
  if (since === null) since = worldContext().leads.reduce((m, l) => Math.min(m, Date.parse(l.createdAt)), Number.POSITIVE_INFINITY);
  return since;
}
