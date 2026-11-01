'use client';

import {
  type MeResponse,
  type PlatformAdmin,
  type Principal,
  type ProfileUpdate,
  type StatusUpdate,
  type SupportAccessUpdate,
  type User,
  type UserSettings,
  type UserSettingsUpdate,
  type Workspace,
  type WorkspaceUpdate,
} from '@vistar/shared';
import { useEffect, useMemo, type ReactNode } from 'react';
import { create } from 'zustand';
import { MOCK_PERSONAS, mockMe, mockPlatformAdmin, type MockPersona } from './mock';
import { readMockDb } from '../mock-db';

/**
 * SESSION CONTRACT (web). OWNER: orchestrator. Every panel reads identity, permissions and
 * settings from here. Wave 1 = mock personas persisted in localStorage; Wave 3 swaps the internals
 * for /auth/me, /api/super/me and real login without changing these hooks.
 *
 * Dev helpers (non-production only):
 * - `?mockAs=company_admin|manager|employee|viewer|super_admin` signs in as that persona.
 * - `?mockAs=company_admin&impersonating=1` shows the Super Admin impersonation state.
 * - `NEXT_PUBLIC_MOCK_PERSONA=<persona>` signs in automatically when nobody is signed in
 *   (feature tracks use it; the shell track leaves it unset to test the login flow).
 */
export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';
export type Session =
  | { audience: 'workspace'; me: MeResponse; accessToken: string | null }
  | { audience: 'platform'; admin: PlatformAdmin; accessToken: string | null };

interface SessionState {
  status: SessionStatus;
  session: Session | null;
  hydrate: () => void;
  /** Wave 1 only. Wave 3 replaces with signIn(email, password) / signInSuper(...). */
  signInMock: (persona: MockPersona, opts?: { impersonating?: boolean }) => void;
  signOut: () => void;
  /** PATCH /me/settings (mock: merged and persisted locally per persona). Deep-merges theme and notifications. */
  updateSettings: (patch: UserSettingsUpdate) => Promise<UserSettings>;
  /** PATCH /workspace (admins). */
  updateWorkspace: (patch: WorkspaceUpdate) => Promise<Workspace>;
  /** PATCH /me/profile (name, phone, title, avatar). */
  updateProfile: (patch: ProfileUpdate) => Promise<User>;
  /** PUT /me/status (Available, On call, Break, Offline). */
  setStatus: (status: StatusUpdate['status']) => Promise<User>;
  /** PUT /workspace/support-access (company admins). */
  updateSupportAccess: (body: SupportAccessUpdate) => Promise<Workspace>;
}

const KEY_PERSONA = 'vistar.mock.persona';
const keySettings = (p: MockPersona) => `vistar.mock.settings.${p}`;
const keyProfile = (p: MockPersona) => `vistar.mock.profile.${p}`;
const KEY_WORKSPACE = 'vistar.mock.workspace';
const isDev = process.env.NODE_ENV !== 'production';

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function build(persona: MockPersona, impersonating = false): Session {
  if (persona === 'super_admin') return { audience: 'platform', admin: mockPlatformAdmin(), accessToken: null };
  const me = mockMe(persona, {
    labels: readMockDb().state.labelOverrides,
    packs: readMockDb()
      .packs.filter((p) => p.status === 'active' && p.installedVersion)
      .map((p) => ({ key: p.key, version: p.installedVersion!, modes: p.modes })),
    settings: read<UserSettings>(keySettings(persona)) ?? undefined,
    workspace: read<Partial<Workspace>>(KEY_WORKSPACE) ?? undefined,
    impersonating,
  });
  const profile = read<Partial<User>>(keyProfile(persona));
  return { audience: 'workspace', me: profile ? { ...me, user: { ...me.user, ...profile } } : me, accessToken: null };
}

function currentPersona(s: Session | null): MockPersona | null {
  if (!s) return null;
  return s.audience === 'platform' ? 'super_admin' : s.me.role.kind;
}

const delay = () => new Promise((r) => setTimeout(r, 150));

export const useSessionStore = create<SessionState>()((set, get) => ({
  status: 'loading',
  session: null,

  hydrate: () => {
    let stored = read<{ persona: MockPersona; impersonating?: boolean }>(KEY_PERSONA);
    if (isDev) {
      const params = new URLSearchParams(window.location.search);
      const as = params.get('mockAs') as MockPersona | null;
      if (as && MOCK_PERSONAS.includes(as)) {
        stored = { persona: as, impersonating: params.get('impersonating') === '1' };
        write(KEY_PERSONA, stored);
      }
      const envPersona = process.env.NEXT_PUBLIC_MOCK_PERSONA as MockPersona | undefined;
      if (!stored && envPersona && MOCK_PERSONAS.includes(envPersona)) stored = { persona: envPersona };
    }
    if (!stored) return set({ status: 'unauthenticated', session: null });
    set({ status: 'authenticated', session: build(stored.persona, stored.impersonating) });
  },

  signInMock: (persona, opts = {}) => {
    write(KEY_PERSONA, { persona, impersonating: !!opts.impersonating });
    set({ status: 'authenticated', session: build(persona, opts.impersonating) });
  },

  signOut: () => {
    write(KEY_PERSONA, null);
    set({ status: 'unauthenticated', session: null });
  },

  updateSettings: async (patch) => {
    const s = get().session;
    if (!s || s.audience !== 'workspace') throw new Error('Not signed in to a workspace');
    await delay();
    const prev = s.me.settings;
    const next: UserSettings = {
      ...prev,
      ...patch,
      theme: { ...prev.theme, ...(patch.theme ?? {}) },
      notifications: { ...prev.notifications, ...(patch.notifications ?? {}) },
    } as UserSettings;
    write(keySettings(s.me.role.kind), next);
    set({ session: { ...s, me: { ...s.me, settings: next } } });
    return next;
  },

  updateWorkspace: async (patch) => {
    const s = get().session;
    if (!s || s.audience !== 'workspace') throw new Error('Not signed in to a workspace');
    await delay();
    const stored = { ...(read<Partial<Workspace>>(KEY_WORKSPACE) ?? {}), ...patch } as Partial<Workspace>;
    write(KEY_WORKSPACE, stored);
    const workspace = { ...s.me.workspace, ...patch } as Workspace;
    set({ session: { ...s, me: { ...s.me, workspace } } });
    return workspace;
  },

  updateProfile: async (patch) => {
    const s = get().session;
    if (!s || s.audience !== 'workspace') throw new Error('Not signed in to a workspace');
    await delay();
    const key = keyProfile(s.me.role.kind);
    const stored = { ...(read<Partial<User>>(key) ?? {}), ...patch } as Partial<User>;
    write(key, stored);
    const user = { ...s.me.user, ...patch } as User;
    set({ session: { ...s, me: { ...s.me, user } } });
    return user;
  },

  setStatus: async (status) => {
    const s = get().session;
    if (!s || s.audience !== 'workspace') throw new Error('Not signed in to a workspace');
    await delay();
    const key = keyProfile(s.me.role.kind);
    const statusChangedAt = new Date().toISOString();
    write(key, { ...(read<Partial<User>>(key) ?? {}), status, statusChangedAt });
    const user: User = { ...s.me.user, status, statusChangedAt };
    set({ session: { ...s, me: { ...s.me, user } } });
    return user;
  },

  updateSupportAccess: async ({ enabled, durationHours = 24, includeContent = false }) => {
    const supportAccess = enabled
      ? { until: new Date(Date.now() + durationHours * 3_600_000).toISOString(), includeContent }
      : { until: null, includeContent: false };
    return get().updateWorkspace({ supportAccess } as unknown as WorkspaceUpdate);
  },
}));

/** Mount once (root providers). Hydrates after mount, so server and first client render agree ("loading"). */
export function SessionProvider({ children }: { children: ReactNode }) {
  const hydrate = useSessionStore((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);
  return <>{children}</>;
}

export function useSessionStatus(): SessionStatus {
  return useSessionStore((s) => s.status);
}

export function useSession(): Session | null {
  return useSessionStore((s) => s.session);
}

/** Workspace session data (Company and Employee panels). Null for Super Admin or signed out. */
export function useMe(): MeResponse | null {
  return useSessionStore((s) => (s.session?.audience === 'workspace' ? s.session.me : null));
}

export function usePrincipal(): Principal | null {
  const session = useSession();
  return useMemo<Principal | null>(() => {
    if (!session) return null;
    return session.audience === 'platform' ? { audience: 'platform' } : { audience: 'workspace', kind: session.me.role.kind };
  }, [session]);
}

/** Workspace permissions or platform permissions, depending on the session audience. */
export function usePermissions(): readonly string[] {
  const session = useSession();
  return useMemo(() => {
    if (!session) return [];
    return session.audience === 'platform' ? session.admin.permissions : session.me.permissions;
  }, [session]);
}

export function useCan(permission: string): boolean {
  return usePermissions().includes(permission);
}

export function useSessionActions() {
  const signInMock = useSessionStore((s) => s.signInMock);
  const signOut = useSessionStore((s) => s.signOut);
  const updateSettings = useSessionStore((s) => s.updateSettings);
  const updateWorkspace = useSessionStore((s) => s.updateWorkspace);
  const updateProfile = useSessionStore((s) => s.updateProfile);
  const setStatus = useSessionStore((s) => s.setStatus);
  const updateSupportAccess = useSessionStore((s) => s.updateSupportAccess);
  return useMemo(
    () => ({ signInMock, signOut, updateSettings, updateWorkspace, updateProfile, setStatus, updateSupportAccess }),
    [signInMock, signOut, updateSettings, updateWorkspace, updateProfile, setStatus, updateSupportAccess],
  );
}

/** Access token for the HTTP/socket clients (null in Wave 1). */
export function getAccessToken(): string | null {
  return useSessionStore.getState().session?.accessToken ?? null;
}

export { currentPersona, MOCK_PERSONAS, type MockPersona };
