'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Super Admin "Config" section (SPEC 29.6, D-058) and per-company switches (29.4).
 *
 * ADAPTER until contracts-19: a mock platform store in localStorage (`vistar.mock.platform.config`)
 * shared by every persona in this browser, so an APK uploaded in the console shows up in the employee
 * panel and a company switch shows up in that company's Settings. Secrets are never kept: the
 * service account is validated in the browser and only its status is stored.
 * TODO(contracts-19): PLATFORM routes (Super Admin audience) for Firebase, releases and switches,
 * and GET /app/android/latest for the employee panel.
 */

export const ANDROID_PACKAGE = 'app.vistar.employee';

export interface FirebaseAppConfig {
  fileName: string;
  projectId: string;
  /** Sender id (project_number). */
  senderId: string;
  /** Android app ids found in the file. */
  packages: string[];
  /** True when the file has a client for ANDROID_PACKAGE. */
  packageOk: boolean;
  appId: string | null;
  uploadedAt: string;
}

export interface ServiceAccountStatus {
  configured: boolean;
  projectId: string | null;
  uploadedAt: string | null;
}

export interface AndroidRelease {
  id: string;
  version: string;
  versionCode: number | null;
  notes: string;
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
  /** Download URL; null in the adapter after a reload (the file itself is not stored). */
  url: string | null;
}

export interface CompanySwitches {
  customDomain: boolean;
  fieldTracking: boolean;
}

interface PlatformConfigState {
  firebase: FirebaseAppConfig | null;
  serviceAccount: ServiceAccountStatus;
  releases: AndroidRelease[];
  switches: Record<string, CompanySwitches>;
}

const KEY = 'vistar.mock.platform.config';
const EMPTY: PlatformConfigState = { firebase: null, serviceAccount: { configured: false, projectId: null, uploadedAt: null }, releases: [], switches: {} };
/** Object URLs for files uploaded in this tab (the adapter cannot keep the APK itself). */
const sessionFiles = new Map<string, string>();

function load(): PlatformConfigState {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<PlatformConfigState>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}
function save(state: PlatformConfigState) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}
const pause = (ms = 250) => new Promise((r) => setTimeout(r, ms));

export class ConfigError extends Error {}

// ---------------------------------------------------------------- parsing (browser-side checks; the API re-validates)

interface GoogleServicesJson {
  project_info?: { project_id?: string; project_number?: string };
  client?: Array<{ client_info?: { mobilesdk_app_id?: string; android_client_info?: { package_name?: string } } }>;
}

export function parseGoogleServices(text: string, fileName: string): Omit<FirebaseAppConfig, 'uploadedAt'> {
  let json: GoogleServicesJson;
  try {
    json = JSON.parse(text) as GoogleServicesJson;
  } catch {
    throw new ConfigError(`${fileName} is not valid JSON. Download google-services.json again from the Firebase console.`);
  }
  const projectId = json.project_info?.project_id;
  const senderId = json.project_info?.project_number;
  if (!projectId || !senderId || !Array.isArray(json.client)) {
    throw new ConfigError(`${fileName} does not look like google-services.json (project_info or client is missing).`);
  }
  const packages = json.client.map((c) => c.client_info?.android_client_info?.package_name).filter((p): p is string => !!p);
  const match = json.client.find((c) => c.client_info?.android_client_info?.package_name === ANDROID_PACKAGE);
  return { fileName, projectId, senderId, packages, packageOk: !!match, appId: match?.client_info?.mobilesdk_app_id ?? null };
}

export function parseServiceAccount(text: string, fileName: string): { projectId: string } {
  let json: { type?: string; project_id?: string; private_key?: string; client_email?: string };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new ConfigError(`${fileName} is not valid JSON.`);
  }
  if (json.type !== 'service_account' || !json.project_id || !json.private_key || !json.client_email) {
    throw new ConfigError(`${fileName} is not a service account key. In Firebase: Project settings > Service accounts > Generate new private key.`);
  }
  return { projectId: json.project_id };
}

const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
export const MAX_APK_BYTES = 200 * 1024 * 1024;

export function validateRelease(input: { version: string; versionCode: string; notes: string; file: File | null }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!VERSION_RE.test(input.version.trim())) errors.version = 'Use a version like 1.4.0.';
  if (input.versionCode.trim() && !/^\d{1,9}$/.test(input.versionCode.trim())) errors.versionCode = 'A whole number, higher than the last release.';
  if (input.notes.trim().length > 2000) errors.notes = 'Keep the notes under 2,000 characters.';
  if (!input.file) errors.file = 'Choose the APK file.';
  else if (!input.file.name.toLowerCase().endsWith('.apk')) errors.file = 'The file must be an .apk.';
  else if (input.file.size > MAX_APK_BYTES) errors.file = 'The APK must be under 200 MB.';
  return errors;
}

// ---------------------------------------------------------------- hooks

const KEYS = { config: ['platform', 'config'] as const, latest: ['platform', 'android-latest'] as const };

export function usePlatformConfig() {
  return useQuery({
    queryKey: KEYS.config,
    queryFn: async () => {
      await pause();
      const s = load();
      return { ...s, releases: s.releases.map((r) => ({ ...r, url: sessionFiles.get(r.id) ?? r.url })) };
    },
  });
}

export function useUploadGoogleServices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const parsed = parseGoogleServices(await file.text(), file.name);
      await pause(400);
      const s = load();
      s.firebase = { ...parsed, uploadedAt: new Date().toISOString() };
      save(s);
      return s.firebase;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEYS.config }),
  });
}

export function useUploadServiceAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const { projectId } = parseServiceAccount(await file.text(), file.name);
      await pause(400);
      const s = load();
      s.serviceAccount = { configured: true, projectId, uploadedAt: new Date().toISOString() };
      save(s);
      return s.serviceAccount;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEYS.config }),
  });
}

export function useRemoveServiceAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await pause();
      const s = load();
      s.serviceAccount = EMPTY.serviceAccount;
      save(s);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEYS.config }),
  });
}

export function useUploadRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { version: string; versionCode: number | null; notes: string; file: File; onProgress?: (pct: number) => void }) => {
      const s = load();
      if (s.releases.some((r) => r.version === input.version)) throw new ConfigError(`Version ${input.version} is already uploaded. Raise the version number.`);
      const latestCode = Math.max(0, ...s.releases.map((r) => r.versionCode ?? 0));
      if (input.versionCode !== null && input.versionCode <= latestCode) throw new ConfigError(`The version code must be higher than ${latestCode}.`);
      for (let p = 10; p <= 100; p += 30) {
        input.onProgress?.(Math.min(100, p));
        await pause(120);
      }
      const release: AndroidRelease = {
        id: crypto.randomUUID(),
        version: input.version,
        versionCode: input.versionCode,
        notes: input.notes,
        fileName: input.file.name,
        sizeBytes: input.file.size,
        uploadedAt: new Date().toISOString(),
        url: null,
      };
      sessionFiles.set(release.id, URL.createObjectURL(input.file));
      s.releases = [release, ...s.releases];
      save(s);
      return release;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEYS.config });
      void qc.invalidateQueries({ queryKey: KEYS.latest });
    },
  });
}

export function useDeleteRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await pause();
      const s = load();
      s.releases = s.releases.filter((r) => r.id !== id);
      save(s);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEYS.config });
      void qc.invalidateQueries({ queryKey: KEYS.latest });
    },
  });
}

export function useSetCompanySwitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId, key, value }: { workspaceId: string; key: keyof CompanySwitches; value: boolean }) => {
      await pause(200);
      const s = load();
      s.switches = { ...s.switches, [workspaceId]: { customDomain: false, fieldTracking: false, ...s.switches[workspaceId], [key]: value } };
      save(s);
      return s.switches[workspaceId]!;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEYS.config }),
  });
}

/** Switches for one company (Settings > Domain reads the custom domain switch). */
export function readCompanySwitches(workspaceId: string): CompanySwitches {
  return { customDomain: false, fieldTracking: false, ...load().switches[workspaceId] };
}

/** Newest release first: the one the employee panel links to. */
export function latestRelease(releases: readonly AndroidRelease[]): AndroidRelease | null {
  return releases[0] ?? null;
}

/** GET /app/android/latest (adapter). Null when no release exists. */
export function useLatestAndroidRelease() {
  return useQuery({
    queryKey: KEYS.latest,
    queryFn: async () => {
      await pause(150);
      const r = latestRelease(load().releases);
      return r ? { ...r, url: sessionFiles.get(r.id) ?? r.url } : null;
    },
    staleTime: 5 * 60_000,
  });
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
