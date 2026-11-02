import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RouteView } from '@/components/attendance/route-view';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = { title: 'Field routes' };

export default function FieldRoutesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-lg" aria-label="Loading the route" />}>
      <RouteView />
    </Suspense>
  );
}
