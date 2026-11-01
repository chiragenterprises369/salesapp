'use client';

import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PlatformSection, usePlatformList } from './platform-section';

const KPIS = ['Active companies', 'Users active today', 'Monthly recurring revenue', 'Leads this month'] as const;

/** Platform overview: KPI cards and recent sign-ups (data from Phase 9). */
export function PlatformOverview() {
  const kpis = usePlatformList('overview-kpis');
  return (
    <PlatformSection
      section="overview-signups"
      title="Overview"
      description="Health of the platform at a glance: companies, usage and revenue."
      icon="LayoutDashboard"
      columns={[
        { key: 'company', label: 'Recent sign-up' },
        { key: 'plan', label: 'Plan' },
        { key: 'users', label: 'Users', align: 'right' },
        { key: 'city', label: 'City', hideBelow: 'sm' },
        { key: 'created', label: 'Signed up', hideBelow: 'md' },
      ]}
      emptyTitle="No sign-ups to show yet"
      emptyDescription="New companies appear here once the platform API is connected (Phase 9)."
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((label) => (
          <Card key={label}>
            <CardHeader className="pb-1">
              <CardDescription>{label}</CardDescription>
            </CardHeader>
            <CardContent>
              {kpis.isPending ? (
                <Skeleton className="h-7 w-20" />
              ) : (
                <p className="text-2xl font-semibold text-muted tabular" aria-label={`${label}: no data yet`}>
                  –
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </PlatformSection>
  );
}
