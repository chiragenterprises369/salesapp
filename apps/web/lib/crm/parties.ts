'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountListQuery, AccountUpdate, ContactListQuery, ContactUpdate, CrmBulkAction, RouteBody } from '@vistar/shared';
import { crmKeys } from './keys';
import { getCrmSource } from './source';

/**
 * Contacts (people) and accounts (companies): lists, detail, related records, timeline with notes,
 * create, update, delete, bulk and merge. Both entities have the same API shape.
 */
const src = () => getCrmSource();
const PAGE = 50;

export type ContactQuery = Partial<Omit<ContactListQuery, 'cursor' | 'limit'>>;
export type AccountQuery = Partial<Omit<AccountListQuery, 'cursor' | 'limit'>>;

// ---------------------------------------------------------------- contacts

export function useContacts(q: ContactQuery, opts: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: crmKeys.contacts.list(q),
    queryFn: ({ pageParam }) => src().contacts.list({ ...q, limit: PAGE, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

export function useContact(id: string | null | undefined) {
  return useQuery({ queryKey: crmKeys.contacts.detail(id ?? ''), queryFn: () => src().contacts.get(id!), enabled: !!id });
}

export function useContactRelated(id: string) {
  return useQuery({ queryKey: crmKeys.contacts.related(id), queryFn: () => src().contacts.related(id) });
}

export function useContactDuplicates(id: string, enabled: boolean) {
  return useQuery({ queryKey: crmKeys.contacts.duplicates(id), queryFn: () => src().contacts.duplicates(id), enabled });
}

export function useContactTimeline(id: string) {
  return useInfiniteQuery({
    queryKey: crmKeys.contacts.timeline(id),
    queryFn: ({ pageParam }) => src().contacts.timeline(id, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useContactMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: crmKeys.contacts.all });
  return {
    create: useMutation({ mutationFn: (body: RouteBody<'contactCreate'>) => src().contacts.create(body), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: ContactUpdate }) => src().contacts.update(id, patch),
      onSuccess: (c) => {
        qc.setQueryData(crmKeys.contacts.detail(c.id), c);
        return qc.invalidateQueries({ queryKey: ['contacts', 'list'] });
      },
    }),
    remove: useMutation({ mutationFn: (id: string) => src().contacts.remove(id), onSuccess: refresh }),
    bulk: useMutation({ mutationFn: (a: CrmBulkAction) => src().contacts.bulk(a), onSuccess: refresh }),
    merge: useMutation({ mutationFn: (m: RouteBody<'contactMerge'>) => src().contacts.merge(m), onSuccess: refresh }),
    addNote: useMutation({
      mutationFn: ({ id, body }: { id: string; body: string }) => src().contacts.addNote(id, body),
      onSuccess: (_n, { id }) => qc.invalidateQueries({ queryKey: crmKeys.contacts.timeline(id) }),
    }),
  };
}

// ---------------------------------------------------------------- accounts

export function useAccounts(q: AccountQuery, opts: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: crmKeys.accounts.list(q),
    queryFn: ({ pageParam }) => src().accounts.list({ ...q, limit: PAGE, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

export function useAccount(id: string | null | undefined) {
  return useQuery({ queryKey: crmKeys.accounts.detail(id ?? ''), queryFn: () => src().accounts.get(id!), enabled: !!id });
}

export function useAccountRelated(id: string) {
  return useQuery({ queryKey: crmKeys.accounts.related(id), queryFn: () => src().accounts.related(id) });
}

export function useAccountDuplicates(id: string, enabled: boolean) {
  return useQuery({ queryKey: crmKeys.accounts.duplicates(id), queryFn: () => src().accounts.duplicates(id), enabled });
}

export function useAccountTimeline(id: string) {
  return useInfiniteQuery({
    queryKey: crmKeys.accounts.timeline(id),
    queryFn: ({ pageParam }) => src().accounts.timeline(id, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useAccountMutations() {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: crmKeys.accounts.all }), qc.invalidateQueries({ queryKey: crmKeys.contacts.all })]);
  return {
    create: useMutation({ mutationFn: (body: RouteBody<'accountCreate'>) => src().accounts.create(body), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: AccountUpdate }) => src().accounts.update(id, patch),
      onSuccess: (a) => {
        qc.setQueryData(crmKeys.accounts.detail(a.id), a);
        return qc.invalidateQueries({ queryKey: ['accounts', 'list'] });
      },
    }),
    remove: useMutation({ mutationFn: (id: string) => src().accounts.remove(id), onSuccess: refresh }),
    bulk: useMutation({ mutationFn: (a: CrmBulkAction) => src().accounts.bulk(a), onSuccess: refresh }),
    merge: useMutation({ mutationFn: (m: RouteBody<'accountMerge'>) => src().accounts.merge(m), onSuccess: refresh }),
    addNote: useMutation({
      mutationFn: ({ id, body }: { id: string; body: string }) => src().accounts.addNote(id, body),
      onSuccess: (_n, { id }) => qc.invalidateQueries({ queryKey: crmKeys.accounts.timeline(id) }),
    }),
  };
}

/** Flatten infinite pages. */
export function flatPages<T>(data: { pages: Array<{ items: T[] }> } | undefined): T[] {
  return data ? data.pages.flatMap((p) => p.items) : [];
}
