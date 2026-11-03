'use client';

import {
  ANDROID_PACKAGE_NAME,
  parseGoogleServicesJson,
  type AndroidRelease,
  type AppConfig,
  type Company,
  type FeatureFlag,
  type FirebaseConfigStatus,
  type RouteBody,
} from '@vistar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMode, apiUrl } from './http';

/**
 * Super Admin "Config" section (SPEC 29.6, D-058), per-company switches (29.4) and the employee
 * panel's app download (29.1), on the PLATFORM routes (Super Admin audience):
 *   GET/PUT/DELETE /api/super/config/firebase[/client|/service-account|/{part}]   multipart `file`
 *   GET/POST/PATCH /api/super/android-releases[/{id}]   multipart `file` + versionName, versionCode, notes, minSupported
 *   PUT /api/super/companies/{id}/flags { overrides }   (custom_domain, field_tracking)
 *   GET /app/config (public): android.latest with downloadUrl (GET /app/android/latest)
 * Mock layer (no access token: automated tests): a platform store in localStorage shared by every
 * persona in the browser. Secrets are never kept there: the service account is validated in the
 * browser and only its status is stored.
 */

export const ANDROID_PACKAGE = ANDROID_PACKAGE_NAME;
export type { AndroidRelease, FirebaseConfigStatus };

export interface CompanySwitches {
  customDomain: boolean;
  fieldTracking: boolean;
}

interface MockState {
  firebase: FirebaseConfigStatus;
  releases: AndroidRelease[];
  switches: Record<string, Partial<CompanySwitches>>;
}

const KEY = 'vistar.mock.platform.config';
const EMPTY_FIREBASE: FirebaseConfigStatus = {
  client: null,
  clientUploadedAt: null,
  serviceAccount: { configured: false, projectId: null, clientEmail: null, privateKeyIdLast4: null, uploadedAt: null },
  projectMatch: null,
  pushReady: false,
};
const EMPTY: MockState = { firebase: EMPTY_FIREBASE, releases: [], switches: {} };
/** Object URLs of APKs uploaded in this tab (the mock layer cannot keep the file itself). */
const sessionFiles = new Map<string, string>();

function load(): MockState {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<MockState>) : {};
    return { firebase: { ...EMPTY_FIREBASE, ...v.firebase }, releases: Array.isArray(v.releases) ? v.releases : [], switches: v.switches ?? {} };
  } catch {
    return EMPTY;
  }
}
function save(state: MockState) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}
const pause = (ms = 250) => new Promise((r) => setTimeout(r, ms));

export class ConfigError extends Error {}

const withMatch = (f: FirebaseConfigStatus): FirebaseConfigStatus => ({
  ...f,
  projectMatch: f.client && f.serviceAccount.configured ? f.client.projectId === f.serviceAccount.projectId : null,
  pushReady: f.serviceAccount.configured,
});

// ---------------------------------------------------------------- browser-side checks (the API re-validates)

/** Preview of google-services.json before upload: project, sender id, package check. */
export async function previewGoogleServices(file: File) {
  const text = await file.text();
  const parsed = parseGoogleServicesJson(text, ANDROID_PACKAGE);
  let packages: string[] = [];
  let projectId: string | null = null;
  let senderId: string | null = null;
  try {
    const json = JSON.parse(text.replace(/^\uFEFF/, '')) as { project_info?: { project_id?: string; project_number?: string }; client?: Array<{ client_info?: { android_client_info?: { package_name?: string } } }> };
    projectId = json.project_info?.project_id ?? null;
    senderId = json.project_info?.project_number ?? null;
    packages = (json.client ?? []).map((c) => c.client_info?.android_client_info?.package_name).filter((p): p is string => !!p);
  } catch {
    /* parse errors are in `parsed` */
  }
  return { parsed, packages, projectId, senderId, packageOk: packages.includes(ANDROID_PACKAGE) };
}

/** Light check of a service account key in the browser; never stored or shown. */
export async function checkServiceAccount(file: File): Promise<{ projectId: string; clientEmail: string; keyIdLast4: string }> {
  let json: { type?: string; project_id?: string; private_key?: string; client_email?: string; private_key_id?: string };
  try {
    json = JSON.parse((await file.text()).replace(/^\uFEFF/, '')) as typeof json;
  } catch {
    throw new ConfigError(`${file.name} is not valid JSON.`);
  }
  if (json.type !== 'service_account' || !json.project_id || !json.private_key?.includes('PRIVATE KEY') || !json.client_email) {
    throw new ConfigError(`${file.name} is not a service account key. In Firebase: Project settings > Service accounts > Generate new private key.`);
  }
  return { projectId: json.project_id, clientEmail: json.client_email, keyIdLast4: (json.private_key_id ?? '').slice(-4) };
}

const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
export const MAX_APK_BYTES = 150 * 1024 * 1024;

export function validateRelease(input: { versionName: string; versionCode: string; notes: string; file: File | null }, existing: readonly AndroidRelease[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const latestCode = Math.max(0, ...existing.map((r) => r.versionCode));
  if (!VERSION_RE.test(input.versionName.trim())) errors.versionName = 'Use a version like 1.4.0.';
  else if (existing.some((r) => r.versionName === input.versionName.trim())) errors.versionName = `Version ${input.versionName.trim()} is already uploaded.`;
  if (!/^\d{1,10}$/.test(input.versionCode.trim()) || Number(input.versionCode) < 1) errors.versionCode = 'A whole number from 1, as in the app build.';
  else if (Number(input.versionCode) <= latestCode) errors.versionCode = `Must be higher than ${latestCode}, the latest release.`;
  if (input.notes.trim().length > 2000) errors.notes = 'Keep the notes under 2,000 characters.';
  if (!input.file) errors.file = 'Choose the APK file.';
  else if (!input.file.name.toLowerCase().endsWith('.apk')) errors.file = 'The file must be an .apk.';
  else if (input.file.size > MAX_APK_BYTES) errors.file = 'The APK must be under 150 MB.';
  return errors;
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- Firebase

const K = {
  firebase: ['platform', 'config', 'firebase'] as const,
  releases: ['platform', 'config', 'releases'] as const,
  switches: ['platform', 'config', 'switches'] as const,
  app: ['platform', 'app-config'] as const,
};

export function useFirebaseStatus() {
  return useQuery({
    queryKey: K.firebase,
    queryFn: async () => (apiMode() ? api<FirebaseConfigStatus>('/api/super/config/firebase') : (await pause(), withMatch(load().firebase))),
  });
}

function upload(path: string, file: File, fields: Record<string, string> = {}, method = 'PUT') {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', file);
  return api<unknown>(path, { method, form });
}

export function useUploadGoogleServices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<FirebaseConfigStatus> => {
      if (apiMode()) return (await upload('/api/super/config/firebase/client', file)) as FirebaseConfigStatus;
      const { parsed } = await previewGoogleServices(file);
      if (!parsed.ok) throw new ConfigError(parsed.errors.join('. '));
      await pause(400);
      const s = load();
      s.firebase = withMatch({ ...s.firebase, client: parsed.value, clientUploadedAt: new Date().toISOString() });
      save(s);
      return s.firebase;
    },
    onSuccess: (data) => qc.setQueryData(K.firebase, data),
  });
}

export function useUploadServiceAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<FirebaseConfigStatus> => {
      const check = await checkServiceAccount(file);
      if (apiMode()) return (await upload('/api/super/config/firebase/service-account', file)) as FirebaseConfigStatus;
      await pause(400);
      const s = load();
      const [local, domain] = check.clientEmail.split('@');
      s.firebase = withMatch({
        ...s.firebase,
        serviceAccount: { configured: true, projectId: check.projectId, clientEmail: `${(local ?? '').slice(0, 3)}***@${domain ?? ''}`, privateKeyIdLast4: check.keyIdLast4 || null, uploadedAt: new Date().toISOString() },
      });
      save(s);
      return s.firebase;
    },
    onSuccess: (data) => qc.setQueryData(K.firebase, data),
  });
}

export function useRemoveFirebasePart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (part: 'client' | 'service_account'): Promise<FirebaseConfigStatus> => {
      if (apiMode()) return api<FirebaseConfigStatus>(`/api/super/config/firebase/${part}`, { method: 'DELETE' });
      await pause();
      const s = load();
      s.firebase = withMatch(part === 'client' ? { ...s.firebase, client: null, clientUploadedAt: null } : { ...s.firebase, serviceAccount: EMPTY_FIREBASE.serviceAccount });
      save(s);
      return s.firebase;
    },
    onSuccess: (data) => qc.setQueryData(K.firebase, data),
  });
}

// ---------------------------------------------------------------- Android releases

export function useAndroidReleases() {
  return useQuery({
    queryKey: K.releases,
    queryFn: async (): Promise<AndroidRelease[]> => {
      if (apiMode()) {
        const r = await api<{ items: AndroidRelease[] } | AndroidRelease[]>('/api/super/android-releases');
        return (Array.isArray(r) ? r : r.items).slice().sort((a, b) => b.versionCode - a.versionCode);
      }
      await pause();
      return load().releases.slice().sort((a, b) => b.versionCode - a.versionCode);
    },
  });
}

export function useUploadRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { versionName: string; versionCode: number; notes: string; minSupported: boolean; file: File }): Promise<AndroidRelease> => {
      if (apiMode()) {
        return (await upload(
          '/api/super/android-releases',
          input.file,
          { versionName: input.versionName, versionCode: String(input.versionCode), notes: input.notes, minSupported: String(input.minSupported) },
          'POST',
        )) as AndroidRelease;
      }
      const s = load();
      const release: AndroidRelease = {
        id: crypto.randomUUID(),
        versionName: input.versionName,
        versionCode: input.versionCode,
        notes: input.notes || null,
        fileId: crypto.randomUUID(),
        fileName: input.file.name,
        size: input.file.size,
        sha256: await sha256Hex(input.file),
        minSupported: input.minSupported,
        uploadedBy: null,
        createdAt: new Date().toISOString(),
      };
      sessionFiles.set(release.id, URL.createObjectURL(input.file));
      s.releases = [release, ...s.releases];
      save(s);
      return release;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: K.releases });
      void qc.invalidateQueries({ queryKey: K.app });
    },
  });
}

export function useUpdateRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: { notes?: string | null; minSupported?: boolean } }) => {
      if (apiMode()) return api<AndroidRelease>(`/api/super/android-releases/${id}`, { method: 'PATCH', json: patch });
      const s = load();
      s.releases = s.releases.map((r) => (r.id === id ? { ...r, ...patch } : r));
      save(s);
      return s.releases.find((r) => r.id === id)!;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: K.releases });
      void qc.invalidateQueries({ queryKey: K.app });
    },
  });
}

// ---------------------------------------------------------------- per-company switches

/** Mock switches: custom domain off by default (every plan), field tracking on. */
export function readCompanySwitches(workspaceId: string): CompanySwitches {
  const v = typeof window === 'undefined' ? {} : (load().switches[workspaceId] ?? {});
  return { customDomain: v.customDomain ?? false, fieldTracking: v.fieldTracking ?? true };
}

/** Switch state per company id. API: from GET /api/super/companies (effective features + overrides). */
export function useCompanySwitches() {
  return useQuery({
    queryKey: K.switches,
    queryFn: async (): Promise<Record<string, CompanySwitches & { overrides: Company['flagOverrides'] }>> => {
      if (apiMode()) {
        const page = await api<{ items: Company[] }>('/api/super/companies?limit=100');
        return Object.fromEntries(
          page.items.map((c) => [
            c.id,
            { customDomain: !!(c.features?.custom_domain ?? c.flagOverrides.custom_domain), fieldTracking: !!(c.features?.field_tracking ?? c.flagOverrides.field_tracking ?? true), overrides: c.flagOverrides },
          ]),
        );
      }
      const s = load();
      return Object.fromEntries(Object.keys(s.switches).map((id) => [id, { ...readCompanySwitches(id), overrides: {} }]));
    },
  });
}

const SWITCH_FLAG: Record<keyof CompanySwitches, FeatureFlag> = { customDomain: 'custom_domain', fieldTracking: 'field_tracking' };

export function useSetCompanySwitch() {
  const qc = useQueryClient();
  return useMutation({
    // `overrides` (the company's current overrides) is no longer needed; kept so callers stay unchanged.
    mutationFn: async ({ workspaceId, key, value }: { workspaceId: string; key: keyof CompanySwitches; value: boolean; overrides?: Company['flagOverrides'] }) => {
      if (apiMode()) {
        // CompanyFlagsUpdateSchema.overrides is a partial map since 3d6adb3: send only the switch that changed,
        // so a concurrent change to another flag is never overwritten with a stale value.
        const body: RouteBody<'superCompanyFlags'> = { overrides: { [SWITCH_FLAG[key]]: value } };
        await api<Company>(`/api/super/companies/${workspaceId}/flags`, { method: 'PUT', json: body });
        return;
      }
      await pause(200);
      const s = load();
      s.switches = { ...s.switches, [workspaceId]: { ...s.switches[workspaceId], [key]: value } };
      save(s);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.switches }),
  });
}

// ---------------------------------------------------------------- employee panel: latest release

export type LatestRelease = NonNullable<AppConfig['android']['latest']>;

/** GET /app/config (public) -> android.latest; null when no release exists (the card is hidden). */
export function useLatestAndroidRelease() {
  return useQuery({
    queryKey: K.app,
    queryFn: async (): Promise<LatestRelease | null> => {
      if (apiMode()) return (await api<AppConfig>('/app/config', { auth: false })).android.latest;
      await pause(150);
      const r = load().releases.slice().sort((a, b) => b.versionCode - a.versionCode)[0];
      if (!r) return null;
      return {
        versionName: r.versionName,
        versionCode: r.versionCode,
        notes: r.notes,
        size: r.size,
        sha256: r.sha256,
        createdAt: r.createdAt,
        downloadUrl: sessionFiles.get(r.id) ?? apiUrl('/app/android/latest'),
      };
    },
    staleTime: 5 * 60_000,
  });
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
