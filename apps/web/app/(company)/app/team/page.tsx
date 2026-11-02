import type { Metadata } from 'next';
import { TeamPage } from '@/components/team/team-page';

export const metadata: Metadata = { title: 'Team and roles' };

export default function Page() {
  return <TeamPage />;
}
