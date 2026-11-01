import type { Metadata } from 'next';
import { PerformanceView } from '@/components/employee/performance-view';

export const metadata: Metadata = { title: 'My performance' };

export default function MyPerformancePage() {
  return <PerformanceView />;
}
