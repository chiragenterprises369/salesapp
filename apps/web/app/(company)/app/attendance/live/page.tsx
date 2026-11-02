import type { Metadata } from 'next';
import { LiveView } from '@/components/attendance/live-view';

export const metadata: Metadata = { title: 'Live field map' };

export default function FieldLivePage() {
  return <LiveView />;
}
