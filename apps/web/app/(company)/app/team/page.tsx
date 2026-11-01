import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/common/placeholder-page';

export const metadata: Metadata = { title: 'Team and roles' };

export default function TeamPage() {
  return (
    <PlaceholderPage
      title="Team and roles"
      description="People in your workspace, the teams they belong to and their roles."
      icon="UsersRound"
      anyOf={['team.read']}
      emptyTitle="Invite your sales team"
      emptyDescription="Add people by email or share an invite link, put them in teams and give each a role."
      action={{ label: 'Review roles', href: '/app/settings/roles', anyOf: ['roles.manage'] }}
      fallback={{ label: 'Open Live Team Floor', href: '/app/team-floor', anyOf: ['teamfloor.read'] }}
    />
  );
}
