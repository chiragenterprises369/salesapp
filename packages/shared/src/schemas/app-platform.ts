import { z } from 'zod';
import { DevicePlatformSchema } from '../enums.js';
import { IdSchema, IsoDateTimeSchema } from './common.js';

/**
 * PLATFORM CONFIG, ANDROID APP AND DEVICES (D-056, D-058, SPEC 29.1, 29.6).
 *
 * Firebase is configured at runtime. The Super Admin uploads `google-services.json` (parsed with
 * parseGoogleServicesJson: the client entry for ANDROID_PACKAGE_NAME) and the service account JSON (FCM HTTP v1
 * sender). Both are stored encrypted with ENCRYPTION_KEY in PlatformSetting; the service account is never
 * returned, only its status. The app calls GET /app/config and `Firebase.initializeApp(options:)` with
 * `firebase`, so one APK works with any Firebase project.
 */

export const ANDROID_PACKAGE_NAME = 'app.vistar.employee';

// ---------------------------------------------------------------- google-services.json

const GoogleServicesFileSchema = z.object({
  project_info: z.object({
    project_number: z.string().regex(/^\d{6,20}$/, { error: 'project_info.project_number must be digits' }),
    project_id: z.string().regex(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/, { error: 'project_info.project_id is not a Firebase project id' }),
    storage_bucket: z.string().optional(),
  }),
  client: z
    .array(
      z.object({
        client_info: z.object({
          mobilesdk_app_id: z.string(),
          android_client_info: z.object({ package_name: z.string() }).optional(),
        }),
        api_key: z.array(z.object({ current_key: z.string() })).optional(),
      }),
    )
    .min(1, { error: 'client must list at least one app' }),
});

/** Public Firebase options for `FirebaseOptions` in the app (safe to serve without auth). */
export const FirebaseClientOptionsSchema = z.object({
  projectId: z.string(),
  /** = project_number */
  messagingSenderId: z.string(),
  appId: z.string().regex(/^1:\d+:android:[0-9a-f]+$/),
  apiKey: z.string(),
  storageBucket: z.string().nullable(),
  packageName: z.string(),
});
export type FirebaseClientOptions = z.infer<typeof FirebaseClientOptionsSchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function parseJson(raw: unknown): ParseResult<unknown> {
  if (typeof raw !== 'string') return { ok: true, value: raw };
  try {
    return { ok: true, value: JSON.parse(raw.replace(/^\uFEFF/, '')) };
  } catch {
    return { ok: false, errors: ['The file is not valid JSON'] };
  }
}

/**
 * Parse a `google-services.json` and pick the Android client of `packageName`.
 * Errors are user-safe sentences (shown in the Super Admin config section).
 */
export function parseGoogleServicesJson(raw: unknown, packageName: string = ANDROID_PACKAGE_NAME): ParseResult<FirebaseClientOptions> {
  const json = parseJson(raw);
  if (!json.ok) return json;
  const file = GoogleServicesFileSchema.safeParse(json.value);
  if (!file.success) return { ok: false, errors: file.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)) };
  const { project_info: info, client } = file.data;
  const app = client.find((c) => c.client_info.android_client_info?.package_name === packageName);
  if (!app) {
    const found = client.map((c) => c.client_info.android_client_info?.package_name).filter(Boolean);
    return { ok: false, errors: [`No Android app with package ${packageName} in this file${found.length ? ` (found: ${found.join(', ')})` : ''}. Add the app in the Firebase console and download the file again`] };
  }
  const errors: string[] = [];
  const appId = app.client_info.mobilesdk_app_id;
  if (!/^1:\d+:android:[0-9a-f]+$/.test(appId)) errors.push('client_info.mobilesdk_app_id is not an Android app id');
  else if (appId.split(':')[1] !== info.project_number) errors.push('The app id does not belong to this project number');
  const apiKey = app.api_key?.find((k) => /^AIza[0-9A-Za-z_-]{35}$/.test(k.current_key))?.current_key;
  if (!apiKey) errors.push('api_key.current_key is missing or not a Google API key');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { projectId: info.project_id, messagingSenderId: info.project_number, appId, apiKey: apiKey!, storageBucket: info.storage_bucket ?? null, packageName },
  };
}

// ---------------------------------------------------------------- service account (server only)

const ServiceAccountFileSchema = z.object({
  type: z.literal('service_account', { error: 'type must be "service_account" (download a service account key, not google-services.json)' }),
  project_id: z.string().min(1),
  private_key_id: z.string().min(8),
  private_key: z.string().includes('-----BEGIN PRIVATE KEY-----', { error: 'private_key is not a PEM private key' }),
  client_email: z.string().regex(/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/, { error: 'client_email is not a service account email' }),
  token_uri: z.string().url().optional(),
});

export interface FirebaseServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKeyId: string;
  privateKey: string;
  tokenUri: string;
}

/** Parse a Firebase service account key file. The result contains the private key: keep it server-side and encrypted. */
export function parseServiceAccountJson(raw: unknown): ParseResult<FirebaseServiceAccount> {
  const json = parseJson(raw);
  if (!json.ok) return json;
  const file = ServiceAccountFileSchema.safeParse(json.value);
  if (!file.success) return { ok: false, errors: file.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)) };
  const f = file.data;
  return {
    ok: true,
    value: { projectId: f.project_id, clientEmail: f.client_email, privateKeyId: f.private_key_id, privateKey: f.private_key, tokenUri: f.token_uri ?? 'https://oauth2.googleapis.com/token' },
  };
}

/** Masks a service account email for display: `fir***@project.iam.gserviceaccount.com`. */
export function maskServiceAccountEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${(local ?? '').slice(0, 3)}***@${domain ?? ''}`;
}

export const FirebaseConfigPartSchema = z.object({ part: z.enum(['client', 'service_account']) });

export const FirebaseConfigStatusSchema = z.object({
  client: FirebaseClientOptionsSchema.nullable(),
  clientUploadedAt: IsoDateTimeSchema.nullable(),
  serviceAccount: z.object({
    configured: z.boolean(),
    projectId: z.string().nullable(),
    clientEmail: z.string().nullable().describe('Masked'),
    privateKeyIdLast4: z.string().nullable(),
    uploadedAt: IsoDateTimeSchema.nullable(),
  }),
  /** Both parts uploaded and for the same project; null until both exist. */
  projectMatch: z.boolean().nullable(),
  /** The server can send pushes (service account configured). */
  pushReady: z.boolean(),
});
export type FirebaseConfigStatus = z.infer<typeof FirebaseConfigStatusSchema>;

export const PushTestSchema = z.object({ token: z.string().min(20).max(4096).describe('FCM registration token of a test device') });
export const PushTestResultSchema = z.object({ ok: z.boolean(), messageId: z.string().nullable(), error: z.string().nullable() });
export type PushTestResult = z.infer<typeof PushTestResultSchema>;

/**
 * FCM data payload the server sends (all values are strings, FCM rule). The app routes on `kind`
 * (a NotificationType or `system`) and opens `href` (web path, e.g. /me/leads?lead=<id>) when tapped.
 */
export const PushDataSchema = z.object({
  kind: z.string(),
  notificationId: z.string().optional(),
  href: z.string().optional(),
  leadId: z.string().optional(),
  taskId: z.string().optional(),
  workspaceId: z.string(),
});
export type PushData = z.infer<typeof PushDataSchema>;

// ---------------------------------------------------------------- Android releases

export const AndroidVersionNameSchema = z.string().trim().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, { error: 'Use a version like 1.4.0' });

/** Multipart text fields of the APK upload (strings in multipart; coerced). */
export const AndroidReleaseUploadFieldsSchema = z.object({
  versionName: AndroidVersionNameSchema,
  versionCode: z.coerce.number().int().min(1).max(2_100_000_000),
  notes: z.string().trim().max(2000).optional(),
  /** Apps below this versionCode must update (GET /app/config minSupportedVersionCode). */
  minSupported: z.stringbool().default(false),
});
export type AndroidReleaseUploadFields = z.infer<typeof AndroidReleaseUploadFieldsSchema>;

export const AndroidReleaseUpdateSchema = z.object({ notes: z.string().trim().max(2000).nullable(), minSupported: z.boolean() }).partial();

export const AndroidReleaseSchema = z.object({
  id: IdSchema,
  versionName: z.string(),
  versionCode: z.number().int(),
  notes: z.string().nullable(),
  fileId: IdSchema,
  fileName: z.string(),
  size: z.number().int(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  minSupported: z.boolean(),
  uploadedBy: z.object({ id: IdSchema, name: z.string() }).nullable(),
  createdAt: IsoDateTimeSchema,
});
export type AndroidRelease = z.infer<typeof AndroidReleaseSchema>;

/** GET /app/config (public): everything the app needs before sign-in. */
export const AppConfigSchema = z.object({
  firebase: FirebaseClientOptionsSchema.nullable().describe('null = push not configured yet'),
  android: z.object({
    packageName: z.literal(ANDROID_PACKAGE_NAME),
    latest: z
      .object({
        versionName: z.string(),
        versionCode: z.number().int(),
        notes: z.string().nullable(),
        size: z.number().int(),
        sha256: z.string(),
        createdAt: IsoDateTimeSchema,
        /** Absolute URL of GET /app/android/latest */
        downloadUrl: z.string().url(),
      })
      .nullable(),
    /** Highest versionCode of a release marked minSupported; older apps must update. */
    minSupportedVersionCode: z.number().int().nullable(),
  }),
  serverTime: IsoDateTimeSchema,
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

// ---------------------------------------------------------------- devices (push targets)

export const DeviceRegisterSchema = z.object({
  platform: DevicePlatformSchema,
  /** Stable id of this app install (generated by the app, kept in secure storage). Upsert key per user. */
  installationId: z.string().min(8).max(200),
  /** FCM registration token; null when the user denied notifications. A token moving to another user is detached from the old row. */
  fcmToken: z.string().min(20).max(4096).nullable(),
  appVersion: z.string().max(40),
  appBuild: z.number().int().min(0).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
  osVersion: z.string().max(60).nullable().optional(),
});
export type DeviceRegister = z.infer<typeof DeviceRegisterSchema>;

export const DeviceSchema = z.object({
  id: IdSchema,
  platform: DevicePlatformSchema,
  installationId: z.string(),
  hasPushToken: z.boolean(),
  appVersion: z.string(),
  appBuild: z.number().int().nullable(),
  model: z.string().nullable(),
  osVersion: z.string().nullable(),
  lastSeenAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
});
export type Device = z.infer<typeof DeviceSchema>;
