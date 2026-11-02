import type { Metadata } from 'next';
import { FloorRequestDetail } from '../../_components/request-detail';

export const metadata: Metadata = { title: 'Floor request' };

export default async function SuperAdminFloorRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FloorRequestDetail id={decodeURIComponent(id)} />;
}
