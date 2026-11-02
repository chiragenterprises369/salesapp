'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useMe } from '@/lib/session/session';
import { viewerFromMe, worldContext } from '@/lib/world';
import { useReportSummary } from '@/lib/world/hooks';
import { forecastByStage } from './logic';

/**
 * Reports data adapter over `@/lib/world`: the scoped report summary for a range (and the previous
 * range for comparisons), plus the stage breakdown of the revenue forecast. The forecast breakdown
 * is an extra reader (docs/REQUESTS.md, To: frontend-app); it uses the same scope rule as
 * reportSummary().forecastInr. Wave 3: GET /reports/summary and /reports/forecast.
 */
export function useReport(range: { from: number; to: number } | null) {
  return useReportSummary(range?.from ?? 0, range?.to ?? 0);
}

export function useForecast() {
  const me = useMe();
  const v = useMemo(() => viewerFromMe(me), [me]);
  return useQuery({
    queryKey: ['dashboard', 'pages', v.userId, 'forecast'],
    queryFn: async () => {
      await new Promise((r) => setTimeout(r, 200));
      const ctx = worldContext();
      return forecastByStage(ctx.leads, ctx.stages, v.visible);
    },
    enabled: !!v.userId,
  });
}

let since: number | null = null;
/** Time of the oldest lead in the world: earlier ranges have no data, so comparisons with them are skipped. */
export function dataSince(): number {
  if (since === null) since = worldContext().leads.reduce((m, l) => Math.min(m, Date.parse(l.createdAt)), Number.POSITIVE_INFINITY);
  return since;
}