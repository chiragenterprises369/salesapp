'use client';

import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PlatformSection, usePlatformKpis } from './platform-section';

const KPIS = ['Active companies', 'Users active today', 'Monthly recurring revenue', 'Leads this month'] as const;

/** Platform overview: KPI cards and recent sign-ups (mock platform world until Phase 9). */
export function PlatformOverview() {
  const kpis = usePlatformKpis();
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
      emptyDescription="New companies appear here as soon as they sign up."
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((label) => {
          const k = kpis.data?.find((x) => x.label === label);
          return (
            <Card key={label}>
              <CardHeader className="pb-1">
                <CardDescription>{label}</CardDescription>
              </CardHeader>
              <CardContent>
                {kpis.isPending ? (
                  <Skeleton className="h-7 w-20" />
                ) : k ? (
                  <>
                    <p className="text-2xl font-semibold text-fg tabular">{k.value}</p>
                    <p className="mt-0.5 text-xs text-muted">{k.hint}</p>
                  </>
                ) : (
                  <p className="text-2xl font-semibold text-muted tabular" aria-label={`${label}: no data yet`}>
                    –
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </PlatformSection>
  );
}
