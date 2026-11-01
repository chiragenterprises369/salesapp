import type { Metadata } from 'next';
import { TodayView } from '@/components/employee/today-view';

export const metadata: Metadata = { title: 'Today' };

export default function EmployeeHomePage() {
  return <TodayView />;
}
