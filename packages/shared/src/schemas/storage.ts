import { z } from 'zod';
import { FilePurposeSchema, FileVisibilitySchema, type FilePurpose, type FileVisibility } from '../enums.js';
import { IdSchema, IsoDateTimeSchema } from './common.js';

/**
 * STORAGE CONTRACT (D-065). Every upload goes through the API storage adapter (driver `local` in
 * development: files under STORAGE_LOCAL_ROOT, default `<repo>/.data/uploads`; driver `s3` for S3, MinIO
 * or Bunny behind the same interface). Rows: tenant `File` (workspaceId) for company files, including
 * floor models a Super Admin uploads for a company; platform `PlatformFile` for APKs.
 *
 * Reading:
 *  - public files (branding: logo, favicon, login image) are served without auth at GET /api/files/p/{id};
 *  - private files only through short-lived signed URLs from GET /files/{id}/url (workspace) or
 *    GET /api/super/files/{id}/url (Super Admin), served at GET /api/files/d/{token}.
 * Downloads carry `X-Content-Type-Options: nosniff` and a sandbox CSP, so an uploaded SVG cannot run script.
 *
 * Multipart: field `file` (exactly one) plus the text fields of the route (`bodyFields` in API_ROUTES).
 */

const MB = 1024 * 1024;

export interface UploadLimit {
  maxBytes: number;
  /** Accepted MIME types (the API also checks the extension and, where possible, the magic bytes). */
  mimes: readonly string[];
  extensions: readonly string[];
  visibility: FileVisibility;
  /** Who uploads: workspace (POST /files), super (Super Admin routes) or a dedicated route (call recordings). */
  uploadedVia: 'workspace' | 'super' | 'call_route';
}

export const UPLOAD_LIMITS: Record<FilePurpose, UploadLimit> = {
  logo: { maxBytes: 2 * MB, mimes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'], extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'], visibility: 'public', uploadedVia: 'workspace' },
  favicon: { maxBytes: 512 * 1024, mimes: ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml'], extensions: ['png', 'ico', 'svg'], visibility: 'public', uploadedVia: 'workspace' },
  login_image: { maxBytes: 5 * MB, mimes: ['image/png', 'image/jpeg', 'image/webp'], extensions: ['png', 'jpg', 'jpeg', 'webp'], visibility: 'public', uploadedVia: 'workspace' },
  reference_image: { maxBytes: 15 * MB, mimes: ['image/png', 'image/jpeg', 'image/webp'], extensions: ['png', 'jpg', 'jpeg', 'webp'], visibility: 'private', uploadedVia: 'workspace' },
  floor_model: { maxBytes: 40 * MB, mimes: ['model/gltf-binary', 'application/octet-stream', 'application/zip', 'application/x-zip-compressed'], extensions: ['glb', 'zip'], visibility: 'private', uploadedVia: 'super' },
  apk: { maxBytes: 150 * MB, mimes: ['application/vnd.android.package-archive', 'application/octet-stream', 'application/zip'], extensions: ['apk'], visibility: 'private', uploadedVia: 'super' },
  call_recording: {
    maxBytes: 50 * MB,
    mimes: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/amr', 'audio/3gpp', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'application/octet-stream'],
    extensions: ['mp3', 'm4a', 'mp4', 'aac', 'amr', '3gp', 'ogg', 'oga', 'opus', 'wav', 'webm'],
    visibility: 'private',
    uploadedVia: 'call_route',
  },
  attachment: { maxBytes: 20 * MB, mimes: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'], extensions: ['png', 'jpg', 'jpeg', 'webp', 'pdf'], visibility: 'private', uploadedVia: 'workspace' },
};

/** Purposes accepted by the generic workspace upload (POST /files). */
export const WORKSPACE_UPLOAD_PURPOSES = ['logo', 'favicon', 'login_image', 'reference_image'] as const satisfies readonly FilePurpose[];
export const WorkspaceUploadPurposeSchema = z.enum(WORKSPACE_UPLOAD_PURPOSES);

/** Multipart text fields of POST /files. */
export const FileUploadFieldsSchema = z.object({ purpose: WorkspaceUploadPurposeSchema });
export type FileUploadFields = z.infer<typeof FileUploadFieldsSchema>;

/** A stored file (metadata only; the bytes are never in JSON). */
export const StoredFileSchema = z.object({
  id: IdSchema,
  purpose: FilePurposeSchema,
  name: z.string().describe('Original file name (sanitised)'),
  mime: z.string(),
  size: z.number().int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  visibility: FileVisibilitySchema,
  /** Absolute URL for public files (GET /api/files/p/{id}); null for private files (ask for a signed URL). */
  publicUrl: z.string().url().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type StoredFile = z.infer<typeof StoredFileSchema>;

/** Short-lived signed download URL (default 15 min). */
export const FileUrlSchema = z.object({
  url: z.string().url(),
  expiresAt: IsoDateTimeSchema,
});
export type FileUrl = z.infer<typeof FileUrlSchema>;

/** Reference to a file inside another resource (branding, floor request image, floor model). */
export const FileRefSchema = z.object({
  fileId: IdSchema,
  name: z.string(),
  mime: z.string(),
  size: z.number().int().min(0),
  /** Public URL (branding) or a signed URL valid for 15 min (detail responses); null in list responses. */
  url: z.string().url().nullable(),
});
export type FileRef = z.infer<typeof FileRefSchema>;

export const SignedFileTokenParamSchema = z.object({ token: z.string().min(20).max(600) });
