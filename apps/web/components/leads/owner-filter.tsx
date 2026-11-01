'use client';

import { ChevronDown, UserRound } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useLeadsViewState } from '@/lib/leads/state';
import { useMe } from '@/lib/session/session';
import { ACTIVE_FILTER_CLASS, useScopedUsers } from './lead-meta';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './primitives/menu';

const ALL = '__all';

/** Owner dropdown: All users, Me, Unassigned, then users visible in the caller's data scope. */
export function OwnerFilter() {
  const me = useMe();
  const users = useScopedUsers();
  const ownerIds = useLeadsViewState((s) => s.filters.ownerId);
  const setFilters = useLeadsViewState((s) => s.setFilters);
  const others = users.filter((u) => u.id !== me?.user.id);

  const value = !ownerIds?.length ? ALL : ownerIds.length === 1 ? ownerIds[0]! : 'multi';
  const label =
    value === ALL
      ? 'All users'
      : value === 'me'
        ? 'Me'
        : value === 'unassigned'
          ? 'Unassigned'
          : value === 'multi'
            ? `${ownerIds!.length} owners`
            : (users.find((u) => u.id === value)?.name ?? 'Owner');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="md"
          aria-label={`Owner: ${label}`}
          className={value !== ALL ? ACTIVE_FILTER_CLASS : undefined}
        >
          <UserRound aria-hidden />
          <span className="max-w-32 truncate">{label}</span>
          <ChevronDown aria-hidden className="text-muted" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => setFilters({ ownerId: v === ALL ? undefined : [v] })}
        >
          <DropdownMenuRadioItem value={ALL}>All users</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="me">Me</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="unassigned">Unassigned</DropdownMenuRadioItem>
          {others.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                {me?.role.dataScope === 'team' ? 'Your team' : 'Team members'}
              </DropdownMenuLabel>
              {others.map((u) => (
                <DropdownMenuRadioItem key={u.id} value={u.id}>
                  <Avatar name={u.name} size="xs" status={u.status} aria-hidden />
                  <span className="truncate">{u.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </>
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
