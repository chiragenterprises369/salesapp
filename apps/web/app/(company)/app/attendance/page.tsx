import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RegisterView } from '@/components/attendance/register-view';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = { title: 'Attendance' };

export default function AttendancePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-lg" aria-label="Loading the register" />}>
      <RegisterView />
    </Suspense>
  );
}
