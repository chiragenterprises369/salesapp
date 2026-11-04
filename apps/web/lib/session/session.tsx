'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_USER_SETTINGS,
  presenceToEmployeeStatus,
  type GoogleAuthRequest,
  type ImpersonationStartSchema,
  type InviteAccept,
  type MeResponse,
  type PlatformAdmin,
  type Principal,
  type ProfileUpdate,
  type SignupRequest,
  type StatusUpdate,
  type SuperLoginChallenge,
  type SupportAccessUpdate,
  type User,
  type UserSettings,
  type UserSettingsUpdate,
  type Workspace,
  type WorkspaceUpdate,
} from '@vistar/shared';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { z } from 'zod';
import { create } from 'zustand';
import { api, configureApiClient, refreshAccessToken, superApi, type SessionEndReason } from '../api/client';
import { isMockData } from '../api/data-source';
import { clearAccessToken, decodeTokenClaims, getAccessTokenFor, setAccessToken, type Audience } from '../api/tokens';
import { readMockDb } from '../mock-db';
import { startRealtime } from '../realtime/client';
import { MOCK_PERSONAS, mockMe, mockPlatformAdmin, type MockPersona } from './mock';

/**
 * SESSION CONTRACT (web). Every panel reads identity, permissions and settings from here; hook
 * names and shapes are stable.
 *
 * API mode (default, SPEC 29.8): real sign-in against the API.
 * - Workspace: POST /auth/login | /auth/signup | /auth/invite/accept | /auth/google return the access
 *   token (kept in memory, lib/api/tokens) and `me`; the API sets the httpOnly refresh cookie.
 *   A page load restores the session with POST /auth/refresh + GET /auth/me.
 * - Platform: POST /api/super/auth/login (password -> TOTP challenge, otpauth URL while enrolling),
 *   then /verify; reload restores with /api/super/auth/refresh.
 * - `vistar.session` in localStorage is only a hint ("a refresh cookie may exist for this audience")
 *   so signed-out visitors cause no 401 calls; it holds no token. Removing it in one tab signs out
 *   the others.
 * - Impersonation ("View as company"): the platform session asks for a read-only workspace token
 *   (POST /api/super/impersonations) and views the company with it; ending it returns to the console.
 *
 * Mock mode (automated tests only, see lib/api/data-source): personas from fixtures stored in
 * localStorage (`vistar.mock.persona`), plus the dev helpers `?mockAs=<persona>`, `&impersonating=1`
 * and `NEXT_PUBLIC_MOCK_PERSONA`.
 */
export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';
export type Session =
  | { audience: 'workspace'; me: MeResponse; accessToken: string | null }
  | { audience: 'platform'; admin: PlatformAdmin; accessToken: string | null };

interface ImpersonationState {
  sessionId: string;
  admin: PlatformAdmin;
}

interface SessionState {
  status: SessionStatus;
  session: Session | null;
  /** Why the last session ended (shown on the sign-in page), or a connection problem. */
  endReason: SessionEndReason | null;
  /** Set while a Super Admin views a company (API mode). */
  impersonating: ImpersonationState | null;
  hydrate: () => void;
  /** Mock mode only (tests and the dev persona switcher). */
  signInMock: (persona: MockPersona, opts?: { impersonating?: boolean }) => void;
  /** POST /auth/login. Throws ApiRequestError (AUTH_INVALID_CREDENTIALS, AUTH_ACCOUNT_DISABLED, RATE_LIMITED...). */
  signIn: (email: string, password: string) => Promise<MeResponse>;
  /** POST /auth/signup: new company workspace with the caller as company admin. */
  signUp: (body: SignupRequest) => Promise<MeResponse>;
  /** POST /auth/invite/accept. */
  acceptInvite: (body: InviteAccept) => Promise<MeResponse>;
  /** POST /auth/google (idToken from Google Identity Services). */
  signInWithGoogle: (body: GoogleAuthRequest) => Promise<MeResponse>;
  /** Super Admin step 1: password. Returns the TOTP challenge (with otpauthUrl while enrolling). */
  superSignIn: (email: string, password: string) => Promise<SuperLoginChallenge>;
  /** Super Admin step 2: 6-digit code. Starts the platform session. */
  superVerify: (challengeToken: string, code: string) => Promise<PlatformAdmin>;
  signOut: () => void;
  /** GET /auth/me again (role, permissions, workspace, labels, packs). */
  reloadMe: () => Promise<MeResponse | null>;
  /** PATCH /me/settings (optimistic). Deep-merges theme and notifications. */
  updateSettings: (patch: UserSettingsUpdate) => Promise<UserSettings>;
  /** PATCH /workspace (admins). */
  updateWorkspace: (patch: WorkspaceUpdate) => Promise<Workspace>;
  /** PATCH /me/profile (name, phone, title, avatar). */
  updateProfile: (patch: ProfileUpdate) => Promise<User>;
  /** PUT /me/status (Available, On call, Break, Offline). */
  setStatus: (status: StatusUpdate['status']) => Promise<User>;
  /** PUT /workspace/support-access (company admins). */
  updateSupportAccess: (body: SupportAccessUpdate) => Promise<Workspace>;
  /** Super Admin: start "View as company" (POST /api/super/impersonations). */
  startImpersonation: (body: z.input<typeof ImpersonationStartSchema>) => Promise<MeResponse>;
  /** End "View as company" and return to the console. */
  endImpersonation: () => Promise<void>;
}

// ------------------------------------------------------------------ storage helpers

const KEY_PERSONA = 'vistar.mock.persona';
const keySettings = (p: MockPersona) => `vistar.mock.settings.${p}`;
const keyProfile = (p: MockPersona) => `vistar.mock.profile.${p}`;
const KEY_WORKSPACE = 'vistar.mock.workspace';
/** API mode: which audience may have a refresh cookie (no secrets). */
export const SESSION_HINT_KEY = 'vistar.session';
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

function readHint(): Audience | null {
  const h = read<{ audience?: string }>(SESSION_HINT_KEY);
  return h?.audience === 'workspace' || h?.audience === 'platform' ? h.audience : null;
}
const writeHint = (audience: Audience | null) => write(SESSION_HINT_KEY, audience ? { audience, at: Date.now() } : null);

// ------------------------------------------------------------------ mock personas

function buildMock(persona: MockPersona, impersonating = false): Session {
  if (persona === 'super_admin') return { audience: 'platform', admin: mockPlatformAdmin(), accessToken: null };
  // Settings saved before a key existed (e.g. the D-052 appearance keys) get that key's default.
  const savedSettings = read<Partial<UserSettings>>(keySettings(persona));
  const me = mockMe(persona, {
    labels: readMockDb().state.labelOverrides,
    packs: readMockDb()
      .packs.filter((p) => p.status === 'active' && p.installedVersion)
      .map((p) => ({ key: p.key, version: p.installedVersion!, modes: p.modes })),
    settings: savedSettings ? { ...DEFAULT_USER_SETTINGS, ...savedSettings } : undefined,
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

function mergeSettings(prev: UserSettings, patch: UserSettingsUpdate): UserSettings {
  return {
    ...prev,
    ...patch,
    theme: { ...prev.theme, ...(patch.theme ?? {}) },
    notifications: { ...prev.notifications, ...(patch.notifications ?? {}) },
  } as UserSettings;
}

function requireWorkspace(s: Session | null): Extract<Session, { audience: 'workspace' }> {
  if (!s || s.audience !== 'workspace') throw new Error('Not signed in to a workspace');
  return s;
}

/** Hydrate runs once per page (React strict mode mounts effects twice). */
let hydrateStarted = false;

export const useSessionStore = create<SessionState>()((set, get) => {
  const setMe = (me: MeResponse) => set({ status: 'authenticated', session: { audience: 'workspace', me, accessToken: null }, endReason: null });
  /** Replace part of `me` if the same user is still signed in. */
  const patchMe = (userId: string, fn: (me: MeResponse) => MeResponse) => {
    const s = get().session;
    if (s?.audience === 'workspace' && s.me.user.id === userId) set({ session: { ...s, me: fn(s.me) } });
  };

  const startWorkspace = (accessToken: string, expiresIn: number, me: MeResponse) => {
    setAccessToken('workspace', accessToken, expiresIn);
    writeHint('workspace');
    try {
      window.localStorage.setItem('vistar.dataSource', 'api');
    } catch {
      /* ignore */
    }
    setMe(me);
    return me;
  };

  return {
    status: 'loading',
    session: null,
    endReason: null,
    impersonating: null,

    hydrate: () => {
      if (isMockData()) {
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
        set({ status: 'authenticated', session: buildMock(stored.persona, stored.impersonating) });
        return;
      }

      if (hydrateStarted) return;
      hydrateStarted = true;
      const hint = readHint();
      if (!hint) return set({ status: 'unauthenticated', session: null });
      void (async () => {
        try {
          if (hint === 'workspace') {
            await refreshAccessToken('workspace');
            setMe(await api.call('authMe'));
          } else {
            // onPlatformRefresh (below) stores the admin of the rotated session.
            await refreshAccessToken('platform');
          }
        } catch (e) {
          // Session-ending refresh errors already signed out (onSessionEnded). A network failure
          // keeps the hint, so reloading once the API is back restores the session.
          if (get().status === 'loading') {
            const err = e as { code?: string; message?: string };
            set({
              status: 'unauthenticated',
              session: null,
              endReason: { code: (err.code ?? 'SERVICE_UNAVAILABLE') as SessionEndReason['code'], message: err.message ?? 'Tootodo could not reach the server.' },
            });
          }
        }
      })();
    },

    signInMock: (persona, opts = {}) => {
      write(KEY_PERSONA, { persona, impersonating: !!opts.impersonating });
      try {
        window.localStorage.setItem('vistar.dataSource', 'mock');
        window.localStorage.setItem('vistar.mock.persona', persona);
      } catch {
        /* ignore */
      }
      set({ status: 'authenticated', session: buildMock(persona, opts.impersonating), endReason: null });
    },

    signIn: async (email, password) => {
      const r = await api.call('authLogin', { body: { email, password } });
      return startWorkspace(r.accessToken, r.expiresIn, r.me);
    },

    signUp: async (body) => {
      const r = await api.call('authSignup', { body });
      return startWorkspace(r.accessToken, r.expiresIn, r.me);
    },

    acceptInvite: async (body) => {
      const r = await api.call('inviteAccept', { body });
      return startWorkspace(r.accessToken, r.expiresIn, r.me);
    },

    signInWithGoogle: async (body) => {
      const r = await api.call('authGoogle', { body });
      return startWorkspace(r.accessToken, r.expiresIn, r.me);
    },

    superSignIn: (email, password) => superApi.call('superLogin', { body: { email, password } }),

    superVerify: async (challengeToken, code) => {
      const s = await superApi.call('superVerify', { body: { challengeToken, code } });
      setAccessToken('platform', s.accessToken, s.expiresIn);
      writeHint('platform');
      set({ status: 'authenticated', session: { audience: 'platform', admin: s.admin, accessToken: null }, endReason: null, impersonating: null });
      return s.admin;
    },

    signOut: () => {
      if (isMockData()) {
        write(KEY_PERSONA, null);
        set({ status: 'unauthenticated', session: null });
        return;
      }
      if (get().impersonating) {
        void get().endImpersonation();
        return;
      }
      const s = get().session;
      if (s) {
        const audience: Audience = s.audience;
        // Start the logout call while the hint still allows a token refresh (its synchronous part
        // runs now), then drop the session at once; the call finishes in the background.
        const logout = audience === 'workspace' ? api.call('authLogout') : superApi.call('superLogout');
        void logout.catch(() => undefined).finally(() => clearAccessToken(audience));
      }
      writeHint(null);
      set({ status: 'unauthenticated', session: null, endReason: null });
    },

    reloadMe: async () => {
      if (isMockData()) {
        const s = get().session;
        return s?.audience === 'workspace' ? s.me : null;
      }
      const s = get().session;
      if (s?.audience !== 'workspace') return null;
      const me = await api.call('authMe');
      set({ session: { audience: 'workspace', me, accessToken: null } });
      return me;
    },

    updateSettings: async (patch) => {
      const s = requireWorkspace(get().session);
      if (isMockData()) {
        await delay();
        const next = mergeSettings(s.me.settings, patch);
        write(keySettings(s.me.role.kind), next);
        set({ session: { ...s, me: { ...s.me, settings: next } } });
        return next;
      }
      const userId = s.me.user.id;
      const before = s.me.settings;
      patchMe(userId, (me) => ({ ...me, settings: mergeSettings(me.settings, patch) }));
      try {
        const saved = await api.call('mySettingsUpdate', { body: patch });
        patchMe(userId, (me) => ({ ...me, settings: saved }));
        return saved;
      } catch (e) {
        // Undo only the keys this call changed (another save may have landed meanwhile).
        const undo = Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof UserSettings]]));
        patchMe(userId, (me) => ({ ...me, settings: { ...me.settings, ...undo } as UserSettings }));
        throw e;
      }
    },

    updateWorkspace: async (patch) => {
      const s = requireWorkspace(get().session);
      if (isMockData()) {
        await delay();
        const stored = { ...(read<Partial<Workspace>>(KEY_WORKSPACE) ?? {}), ...patch } as Partial<Workspace>;
        write(KEY_WORKSPACE, stored);
        const workspace = { ...s.me.workspace, ...patch } as Workspace;
        set({ session: { ...s, me: { ...s.me, workspace } } });
        return workspace;
      }
      const workspace = await api.call('workspaceUpdate', { body: patch });
      patchMe(s.me.user.id, (me) => ({ ...me, workspace }));
      return workspace;
    },

    updateProfile: async (patch) => {
      const s = requireWorkspace(get().session);
      if (isMockData()) {
        await delay();
        const key = keyProfile(s.me.role.kind);
        const stored = { ...(read<Partial<User>>(key) ?? {}), ...patch } as Partial<User>;
        write(key, stored);
        const user = { ...s.me.user, ...patch } as User;
        set({ session: { ...s, me: { ...s.me, user } } });
        return user;
      }
      const user = await api.call('myProfileUpdate', { body: patch });
      patchMe(s.me.user.id, (me) => ({ ...me, user }));
      return user;
    },

    setStatus: async (status) => {
      const s = requireWorkspace(get().session);
      if (isMockData()) {
        await delay();
        const key = keyProfile(s.me.role.kind);
        const statusChangedAt = new Date().toISOString();
        // Mock: the manual status maps to the coarse User.status (the real API returns MyPresence, D-062).
        const coarse = status === 'idle' ? 'idle' : presenceToEmployeeStatus(status);
        write(key, { ...(read<Partial<User>>(key) ?? {}), status: coarse, statusChangedAt });
        const user: User = { ...s.me.user, status: coarse, statusChangedAt };
        set({ session: { ...s, me: { ...s.me, user } } });
        return user;
      }
      // PUT /me/status answers with the server-decided presence (a live call outranks the manual status).
      const presence = await api.call('myStatusUpdate', { body: { status } });
      let user = s.me.user;
      patchMe(s.me.user.id, (me) => {
        user = { ...me.user, status: presence.employeeStatus, statusChangedAt: presence.since };
        return { ...me, user };
      });
      return user;
    },

    updateSupportAccess: async (body) => {
      if (isMockData()) {
        const { enabled, durationHours = 24, includeContent = false } = body;
        const supportAccess = enabled
          ? { until: new Date(Date.now() + durationHours * 3_600_000).toISOString(), includeContent }
          : { until: null, includeContent: false };
        return get().updateWorkspace({ supportAccess } as unknown as WorkspaceUpdate);
      }
      const s = requireWorkspace(get().session);
      const workspace = await api.call('supportAccessUpdate', { body });
      patchMe(s.me.user.id, (me) => ({ ...me, workspace }));
      return workspace;
    },

    startImpersonation: async (body) => {
      const s = get().session;
      if (!s || s.audience !== 'platform') throw new Error('Only a Super Admin can view a company');
      const started = await superApi.call('superImpersonateStart', { body });
      if (!started.accessToken) throw new Error('The API did not return a support session token');
      const exp = Number(decodeTokenClaims(started.accessToken)?.exp ?? 0);
      const expiresIn = exp ? exp - Date.now() / 1000 : (Date.parse(started.expiresAt) - Date.now()) / 1000;
      setAccessToken('workspace', started.accessToken, expiresIn, { refreshable: false });
      try {
        const me = await api.call('authMe');
        set({ status: 'authenticated', session: { audience: 'workspace', me, accessToken: null }, impersonating: { sessionId: started.id, admin: s.admin } });
        return me;
      } catch (e) {
        clearAccessToken('workspace');
        throw e;
      }
    },

    endImpersonation: async () => {
      const imp = get().impersonating;
      if (!imp) return;
      clearAccessToken('workspace');
      set({ session: { audience: 'platform', admin: imp.admin, accessToken: null }, impersonating: null, status: 'authenticated' });
      await superApi.call('superImpersonateEnd', { params: { id: imp.sessionId } }).catch(() => undefined);
    },
  };
});

// ------------------------------------------------------------------ client wiring (API mode)

configureApiClient({
  canRefresh: (audience) => readHint() === audience,
  onSessionEnded: (audience, reason) => {
    const st = useSessionStore.getState();
    if (audience === 'workspace' && st.impersonating) {
      void st.endImpersonation();
      return;
    }
    const s = st.session;
    if (s && s.audience !== audience) return;
    writeHint(null);
    useSessionStore.setState({ status: 'unauthenticated', session: null, endReason: reason, impersonating: null });
  },
  onPlatformRefresh: (session) => {
    const st = useSessionStore.getState();
    if (st.impersonating) {
      useSessionStore.setState({ impersonating: { ...st.impersonating, admin: session.admin } });
      return;
    }
    if (st.status === 'loading' || st.session?.audience === 'platform') {
      useSessionStore.setState({ status: 'authenticated', session: { audience: 'platform', admin: session.admin, accessToken: null }, endReason: null });
    }
  },
  onWorkspaceRefresh: (tokens) => {
    // A changed role or permission set (or another tab signing in as someone else) needs a fresh /auth/me.
    const s = useSessionStore.getState().session;
    if (s?.audience !== 'workspace') return;
    const claims = decodeTokenClaims(tokens.accessToken);
    if (!claims) return;
    const perms = Array.isArray(claims.perms) ? [...(claims.perms as string[])].sort().join(',') : '';
    const mine = [...s.me.permissions].sort().join(',');
    if (claims.sub !== s.me.user.id || claims.rid !== s.me.role.id || perms !== mine) {
      void useSessionStore.getState().reloadMe().catch(() => undefined);
    }
  },
});

/** Mount once (root providers). Hydrates after mount, so server and first client render agree ("loading"). */
export function SessionProvider({ children }: { children: ReactNode }) {
  const hydrate = useSessionStore((s) => s.hydrate);
  const qc = useQueryClient();
  const identity = useSessionStore((s) => (s.session ? (s.session.audience === 'workspace' ? `w:${s.session.me.user.id}` : `p:${s.session.admin.id}`) : null));
  const prev = useRef<string | null>(null);

  useEffect(() => hydrate(), [hydrate]);

  // Another person's (or nobody's) data must never stay in the cache.
  useEffect(() => {
    if (prev.current && prev.current !== identity) qc.removeQueries();
    prev.current = identity;
  }, [identity, qc]);

  // Realtime socket for workspace sessions in API mode (lib/realtime): cache invalidation from
  // events, resync after reconnect and presence heartbeats (none for read-only support sessions).
  const supportSession = useSessionStore((s) => !!s.impersonating);
  useEffect(() => {
    if (isMockData() || !identity?.startsWith('w:')) return;
    const handle = startRealtime(qc, { heartbeat: !supportSession });
    return () => handle.stop();
  }, [identity, supportSession, qc]);

  // Signing out in another tab signs out here too (API mode).
  useEffect(() => {
    if (isMockData()) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SESSION_HINT_KEY) return;
      const st = useSessionStore.getState();
      if (!e.newValue && st.session && !st.impersonating) {
        clearAccessToken(st.session.audience);
        useSessionStore.setState({ status: 'unauthenticated', session: null, endReason: null });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return <>{children}</>;
}

export function useSessionStatus(): SessionStatus {
  return useSessionStore((s) => s.status);
}

export function useSession(): Session | null {
  return useSessionStore((s) => s.session);
}

/** Why the last session ended (sign-in page notice), or null. */
export function useSessionEndReason(): SessionEndReason | null {
  return useSessionStore((s) => s.endReason);
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
  const signIn = useSessionStore((s) => s.signIn);
  const signUp = useSessionStore((s) => s.signUp);
  const acceptInvite = useSessionStore((s) => s.acceptInvite);
  const signInWithGoogle = useSessionStore((s) => s.signInWithGoogle);
  const superSignIn = useSessionStore((s) => s.superSignIn);
  const superVerify = useSessionStore((s) => s.superVerify);
  const signOut = useSessionStore((s) => s.signOut);
  const reloadMe = useSessionStore((s) => s.reloadMe);
  const updateSettings = useSessionStore((s) => s.updateSettings);
  const updateWorkspace = useSessionStore((s) => s.updateWorkspace);
  const updateProfile = useSessionStore((s) => s.updateProfile);
  const setStatus = useSessionStore((s) => s.setStatus);
  const updateSupportAccess = useSessionStore((s) => s.updateSupportAccess);
  const startImpersonation = useSessionStore((s) => s.startImpersonation);
  const endImpersonation = useSessionStore((s) => s.endImpersonation);
  return useMemo(
    () => ({
      signInMock,
      signIn,
      signUp,
      acceptInvite,
      signInWithGoogle,
      superSignIn,
      superVerify,
      signOut,
      reloadMe,
      updateSettings,
      updateWorkspace,
      updateProfile,
      setStatus,
      updateSupportAccess,
      startImpersonation,
      endImpersonation,
    }),
    [signInMock, signIn, signUp, acceptInvite, signInWithGoogle, superSignIn, superVerify, signOut, reloadMe, updateSettings, updateWorkspace, updateProfile, setStatus, updateSupportAccess, startImpersonation, endImpersonation],
  );
}

/** Workspace access token for the HTTP and socket clients (null when signed out or in mock mode). */
export function getAccessToken(): string | null {
  return getAccessTokenFor('workspace');
}

export { currentPersona, MOCK_PERSONAS, type MockPersona };
