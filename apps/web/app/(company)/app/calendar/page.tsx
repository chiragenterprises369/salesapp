import type { Metadata } from 'next';
import { CalendarPage } from '@/components/calendar/calendar-page';

export const metadata: Metadata = { title: 'Calendar' };

export default function Page() {
  return <CalendarPage />;
}
