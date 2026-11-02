import type { Metadata } from 'next';
import { FloorVersionEditor } from '../../_components/version-editor';

export const metadata: Metadata = { title: 'Floor version' };

export default async function SuperAdminFloorVersionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FloorVersionEditor id={decodeURIComponent(id)} />;
}
