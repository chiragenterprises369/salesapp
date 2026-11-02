import type { Metadata } from 'next';
import { FloorRequestsList } from './_components/requests-list';

export const metadata: Metadata = { title: 'Floors' };

export default function SuperAdminFloorsPage() {
  return <FloorRequestsList />;
}
