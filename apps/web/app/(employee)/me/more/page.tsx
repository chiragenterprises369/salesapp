import type { Metadata } from 'next';
import { MoreList } from '@/components/employee/more-list';

export const metadata: Metadata = { title: 'More' };

export default function MorePage() {
  return <MoreList />;
}
