import type { Metadata } from 'next';
import { TeamFloorView } from './team-floor-view';

export const metadata: Metadata = { title: 'Live Team Floor' };

export default function TeamFloorPage() {
  return <TeamFloorView />;
}
