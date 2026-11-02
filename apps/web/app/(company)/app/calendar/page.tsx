import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CalendarPage } from '@/components/calendar/calendar-page';

export const metadata: Metadata = { title: 'Calendar' };

export default function Page() {
  return (
    <Suspense>
      <CalendarPage />
    </Suspense>
  );
}
