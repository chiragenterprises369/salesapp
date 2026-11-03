'use client';

import { formatNumber, type Company } from '@vistar/shared';
import { Users } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';

/** Users of one company. The user list needs GET /api/super/companies/{id}/users (requests-20 #1). */
export function CompanyUsersTab({ company: c }: { company: Company }) {
  const count = c.userCount ?? c.usage.seats;
  return (
    <EmptyState
      icon={<Users />}
      title={`${formatNumber(count)} ${count === 1 ? 'user' : 'users'} in ${c.name}`}
      description="The list of people, roles and last activity arrives with the next API update. Company admins manage their team in Team, Users."
    />
  );
}
