'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InviteCreate, MeResponse, RoleCreate, Tag, Team, User, UserSummary, UserUpdate } from '@vistar/shared';
import { mockTeams, mockUsers, TAGS } from '@vistar/shared/fixtures';
import { useMemo } from 'react';
import { useMe } from '../session/session';
import { api } from './client';
import { isMockData, noteMockUse } from './data-source';

/**
 * People, teams, roles, invites and tags. API mode reads the real routes; the test-only mock data
 * mode keeps the fixture users so mock e2e suites see the same names as before. Query keys start
 * with the 'dashboard' sync scope (team data) or 'leads' (tags), so realtime resyncs refresh them.
 */
export const directoryKeys = {
  userOptions: (userId: string | null) => ['dashboard', 'directory', userId, 'user-options'] as const,
  users: (userId: string | null, includeInactive: boolean) => ['dashboard', 'directory', userId, 'users', includeInactive] as const,
  teams: (userId: string | null) => ['dashboard', 'directory', userId, 'teams'] as const,
  roles: (userId: string | null) => ['dashboard', 'directory', userId, 'roles'] as const,
  invites: (userId: string | null) => ['dashboard', 'directory', userId, 'invites'] as const,
  tags: (userId: string | null) => ['leads', 'directory', userId, 'tags'] as const,
};

/** Mock-mode equivalent of GET /users/options (scope applied like the API). */
function mockUserOptions(me: MeResponse | null): UserSummary[] {
  noteMockUse('directory');
  const all = mockUsers().filter((u) => u.role !== 'viewer');
  if (!me) return [];
  if (me.role.dataScope === 'all') return all;
  if (me.role.dataScope === 'own') return all.filter((u) => u.id === me.user.id);
  const visible = new Set([me.user.id, ...me.teamMemberIds]);
  return all.filter((u) => visible.has(u.id));
}

/** Assignable people for owner filters and pickers (GET /users/options, respects data scope). */
export function useUserOptions() {
  const me = useMe();
  const mock = isMockData();
  return useQuery({
    queryKey: directoryKeys.userOptions(me?.user.id ?? null),
    queryFn: async () => (mock ? mockUserOptions(me) : (await api.call('userOptions')).items),
    enabled: !!me && (mock || me.permissions.includes('leads.read')),
    staleTime: 5 * 60_000,
  });
}

/** Scoped users as a plain array (empty while loading). Same shape as the old fixture helper. */
export function useScopedUserList(): UserSummary[] {
  const q = useUserOptions();
  return useMemo(() => q.data ?? [], [q.data]);
}

/** id -> name for every person the caller may see (timelines, custom user fields). */
export function useUserNames(): ReadonlyMap<string, string> {
  const list = useScopedUserList();
  const me = useMe();
  return useMemo(() => {
    const m = new Map(list.map((u) => [u.id, u.name] as const));
    if (me && !m.has(me.user.id)) m.set(me.user.id, me.user.name);
    return m;
  }, [list, me]);
}

/** Team members with emails (GET /users, team.read). */
export function useUsers(opts: { includeInactive?: boolean } = {}) {
  const me = useMe();
  const include = !!opts.includeInactive;
  return useQuery({
    queryKey: directoryKeys.users(me?.user.id ?? null, include),
    queryFn: async (): Promise<User[]> => (await api.call('userList', { query: include ? { includeInactive: true } : {} })).items,
    enabled: !!me && !isMockData() && me.permissions.includes('team.read'),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UserUpdate }) => api.call('userUpdate', { params: { id }, body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', 'directory'] }),
  });
}

export function useTeams() {
  const me = useMe();
  const mock = isMockData();
  return useQuery({
    queryKey: directoryKeys.teams(me?.user.id ?? null),
    queryFn: async (): Promise<Team[]> => {
      if (mock) {
        noteMockUse('directory');
        return mockTeams();
      }
      return (await api.call('teamList')).items;
    },
    enabled: !!me && (mock || me.permissions.includes('team.read')),
    staleTime: 5 * 60_000,
  });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; managerId?: string | null; memberIds?: string[] }) => api.call('teamCreate', { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', 'directory'] }),
  });
}

export function useRoles() {
  const me = useMe();
  return useQuery({
    queryKey: directoryKeys.roles(me?.user.id ?? null),
    queryFn: async () => (await api.call('roleList')).items,
    enabled: !!me && !isMockData() && me.permissions.includes('team.read'),
  });
}

export function useRoleMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['dashboard', 'directory'] });
  return {
    create: useMutation({ mutationFn: (body: RoleCreate) => api.call('roleCreate', { body }), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: Partial<RoleCreate> }) => api.call('roleUpdate', { params: { id }, body: patch }), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api.call('roleDelete', { params: { id } }), onSuccess: done }),
  };
}

export function useInvites() {
  const me = useMe();
  return useQuery({
    queryKey: directoryKeys.invites(me?.user.id ?? null),
    queryFn: async () => (await api.call('inviteList')).items,
    enabled: !!me && !isMockData() && me.permissions.includes('team.manage'),
  });
}

export function useInviteMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['dashboard', 'directory'] });
  return {
    create: useMutation({ mutationFn: (body: Partial<InviteCreate> & Pick<InviteCreate, 'roleId'>) => api.call('inviteCreate', { body }), onSuccess: done }),
    revoke: useMutation({ mutationFn: (id: string) => api.call('inviteRevoke', { params: { id } }), onSuccess: done }),
  };
}

/** Tags with usage counts (GET /tags). Mock mode: the fixture tag names with no counts. */
export function useTags() {
  const me = useMe();
  const mock = isMockData();
  return useQuery({
    queryKey: directoryKeys.tags(me?.user.id ?? null),
    queryFn: async (): Promise<Tag[]> => {
      if (mock) {
        noteMockUse('directory');
        return TAGS.map((name, i) => ({ id: `0190f5a0-0000-7000-8000-9000000000${String(i).padStart(2, '0')}`, name, color: null, usageCount: 0 }));
      }
      return (await api.call('tagList')).items;
    },
    enabled: !!me,
    staleTime: 5 * 60_000,
  });
}

/** Tag names for pickers and filters. */
export function useTagNames(): readonly string[] {
  const q = useTags();
  return useMemo(() => (q.data ?? []).map((t) => t.name), [q.data]);
}
