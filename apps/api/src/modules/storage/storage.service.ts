import { Injectable, Logger } from '@nestjs/common';
import { FloorPlanSchema, UPLOAD_LIMITS, type FilePurpose, type FileUrl, type FloorModelFormat, type FloorPlan, type StoredFile } from '@vistar/shared';
import type { Response } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppException } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import type { File as FileRow, PlatformFile } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import {
  checkApk,
  checkGlb,
  checkGltfZip,
  extensionOf,
  readHead,
  sanitizeFileName,
  sha256File,
  sniffImage,
  svgLooksUnsafe,
  type ImageKind,
} from './file-validation.js';
import { createDriver, LocalDiskDriver, repoRoot, S3Driver, type StorageDriver } from './storage.drivers.js';

/** Minimal multer file (disk storage via `dest`, or memory storage with `buffer`). */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  path?: string;
  buffer?: Buffer;
}

export const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'vistar-uploads');

const IMAGE_MIME: Record<ImageKind, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon' };
const EXT_KIND: Record<string, ImageKind> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', svg: 'svg', ico: 'ico' };
const IMAGE_PURPOSES = new Set<FilePurpose>(['logo', 'favicon', 'login_image', 'reference_image']);
const AUDIO_MIME: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', amr: 'audio/amr', '3gp': 'audio/3gpp', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm' };

/** Sandbox CSP for every download: an uploaded SVG or HTML can never run script on the API origin. */
const DOWNLOAD_CSP = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";

export interface ValidatedUpload {
  ext: string;
  mime: string;
  /** floor_model only */
  format?: FloorModelFormat;
  /** layout_json only: the parsed plan */
  plan?: FloorPlan;
}

type TokenScope = 't' | 'p';

/**
 * STORAGE (D-065). Validates uploads per purpose (size, extension, MIME, magic bytes, model / APK structure),
 * writes them through the configured driver, and serves them with signed URLs (private) or a public route
 * (branding). Used by branding, floors, platform config and, in the realtime stream, call recordings:
 *   const row = await storage.saveTenantFile(workspaceId, 'call_recording', file, { uploadedById });
 *   const url = storage.signedUrl(row);
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly env = getEnv();
  private readonly primary: StorageDriver = createDriver(this.env);
  private readonly drivers = new Map<string, StorageDriver>([[this.primary.name, this.primary]]);
  private readonly tokenKey = createHmac('sha256', Buffer.from(this.env.ENCRYPTION_KEY, 'base64')).update('vistar:file-url:v1').digest();

  constructor(private readonly prisma: PrismaService) {}

  get driverName(): string {
    return this.primary.name;
  }

  /** Root of the local driver (tests and dev tooling). */
  get localRoot(): string | null {
    return this.primary instanceof LocalDiskDriver ? this.primary.root : null;
  }

  private driver(name: string): StorageDriver {
    let d = this.drivers.get(name);
    if (!d) {
      d = name === 's3' ? new S3Driver(this.env) : new LocalDiskDriver(this.env.STORAGE_LOCAL_ROOT ? path.resolve(this.env.STORAGE_LOCAL_ROOT) : path.join(repoRoot(), '.data', 'uploads'));
      this.drivers.set(name, d);
    }
    return d;
  }

  // ---------------------------------------------------------------- validation

  /** Throws PAYLOAD_TOO_LARGE, FILE_TYPE_NOT_ALLOWED or FILE_INVALID; returns the stored extension and MIME. */
  async validate(purpose: FilePurpose, file: UploadedFileLike | undefined): Promise<ValidatedUpload> {
    if (!file) throw new AppException('VALIDATION_FAILED', 'Attach a file in the "file" field', { details: [{ path: 'file', message: 'Required' }] });
    const limit = UPLOAD_LIMITS[purpose];
    if (file.size > limit.maxBytes) throw new AppException('PAYLOAD_TOO_LARGE', `The file is larger than ${Math.round(limit.maxBytes / 1024 / 1024) || 1} MB`);
    if (file.size === 0) throw new AppException('FILE_INVALID', 'The file is empty');
    const ext = extensionOf(file.originalname);
    if (!limit.extensions.includes(ext)) throw new AppException('FILE_TYPE_NOT_ALLOWED', `Use one of: ${limit.extensions.map((e) => `.${e}`).join(', ')}`);
    const src = await this.tempPath(file);

    if (IMAGE_PURPOSES.has(purpose) || (purpose === 'attachment' && ext !== 'pdf')) {
      const head = await readHead(src, 4096);
      const kind = sniffImage(head);
      if (!kind || kind !== EXT_KIND[ext]) throw new AppException('FILE_INVALID', `The file content is not a valid .${ext} image`);
      if (kind === 'svg') {
        const text = (await readFile(src)).toString('utf8');
        if (svgLooksUnsafe(text)) throw new AppException('FILE_INVALID', 'SVG files with scripts or event handlers are not allowed');
      }
      return { ext, mime: IMAGE_MIME[kind] };
    }
    if (purpose === 'attachment') {
      const head = await readHead(src, 5);
      if (head.toString('latin1') !== '%PDF-') throw new AppException('FILE_INVALID', 'The file content is not a PDF');
      return { ext, mime: 'application/pdf' };
    }
    if (purpose === 'floor_model') {
      if (ext === 'json') {
        if (file.size > 5 * 1024 * 1024) throw new AppException('PAYLOAD_TOO_LARGE', 'A floor plan JSON must be under 5 MB');
        let json: unknown;
        try {
          json = JSON.parse((await readFile(src)).toString('utf8').replace(/^\uFEFF/, ''));
        } catch {
          throw new AppException('FILE_INVALID', 'The floor plan is not valid JSON');
        }
        const plan = FloorPlanSchema.safeParse(json);
        if (!plan.success) {
          throw new AppException('FILE_INVALID', 'The floor plan does not match the Vistar floor plan format', {
            details: plan.error.issues.slice(0, 50).map((i) => ({ path: i.path.join('.'), message: i.message })),
          });
        }
        return { ext, mime: 'application/json', format: 'layout_json', plan: plan.data };
      }
      const check = ext === 'glb' ? await checkGlb(src, file.size) : await checkGltfZip(src, file.size);
      if (!check.ok) throw new AppException('FILE_INVALID', check.problem ?? 'The model file is invalid');
      return ext === 'glb' ? { ext, mime: 'model/gltf-binary', format: 'glb' } : { ext, mime: 'application/zip', format: 'gltf_zip' };
    }
    if (purpose === 'apk') {
      const check = await checkApk(src, file.size);
      if (!check.ok) throw new AppException('APP_RELEASE_INVALID', check.problem ?? 'The APK is invalid');
      return { ext, mime: 'application/vnd.android.package-archive' };
    }
    // call_recording: the phone recorders use many containers; extension + declared MIME decide.
    if (!limit.mimes.includes(file.mimetype)) throw new AppException('FILE_TYPE_NOT_ALLOWED', 'This audio type is not supported');
    return { ext, mime: AUDIO_MIME[ext] ?? 'application/octet-stream' };
  }

  /** Path of the uploaded bytes on disk (writes memory uploads to a temp file). */
  private async tempPath(file: UploadedFileLike): Promise<string> {
    if (file.path) return file.path;
    if (!file.buffer) throw new AppException('VALIDATION_FAILED', 'The upload is empty');
    const p = path.join(os.tmpdir(), `vistar-mem-${randomUUID()}`);
    await writeFile(p, file.buffer);
    file.path = p;
    return p;
  }

  /** Remove the temp file of an upload (always call in `finally`). */
  async discard(file: UploadedFileLike | undefined): Promise<void> {
    if (file?.path) await rm(file.path, { force: true }).catch(() => undefined);
  }

  // ---------------------------------------------------------------- writes

  /** Validate and store a company file (tenant File row). */
  async saveTenantFile(
    workspaceId: string,
    purpose: FilePurpose,
    file: UploadedFileLike | undefined,
    opts: { uploadedById?: string | null; uploadedByAdminId?: string | null; leadId?: string | null } = {},
  ): Promise<FileRow & { format?: FloorModelFormat; plan?: FloorPlan }> {
    const v = await this.validate(purpose, file);
    const src = await this.tempPath(file!);
    const id = randomUUID();
    const key = `t/${workspaceId}/${purpose}/${id}.${v.ext}`;
    const sha256 = await sha256File(src);
    await this.primary.put(key, src, file!.size, v.mime);
    const row = await this.prisma.forTenant(workspaceId).file.create({
      data: {
        id,
        workspaceId,
        purpose,
        visibility: UPLOAD_LIMITS[purpose].visibility,
        key,
        name: sanitizeFileName(file!.originalname),
        mime: v.mime,
        size: file!.size,
        sha256,
        driver: this.primary.name,
        uploadedById: opts.uploadedById ?? null,
        uploadedByAdminId: opts.uploadedByAdminId ?? null,
        leadId: opts.leadId ?? null,
      },
    });
    return v.format ? { ...row, format: v.format, ...(v.plan ? { plan: v.plan } : {}) } : row;
  }

  /** Validate and store a platform file (APK). */
  async savePlatformFile(purpose: FilePurpose, file: UploadedFileLike | undefined, uploadedById: string | null): Promise<PlatformFile> {
    const v = await this.validate(purpose, file);
    const src = await this.tempPath(file!);
    const id = randomUUID();
    const key = `p/${purpose}/${id}.${v.ext}`;
    const sha256 = await sha256File(src);
    await this.primary.put(key, src, file!.size, v.mime);
    return this.prisma.platformFile.create({
      data: { id, purpose, key, name: sanitizeFileName(file!.originalname), mime: v.mime, size: file!.size, sha256, driver: this.primary.name, uploadedById },
    });
  }

  async deleteObject(row: { key: string; driver: string }): Promise<void> {
    await this.driver(row.driver).delete(row.key).catch((err: Error) => this.logger.warn(`Storage delete failed: ${err.name}`));
  }

  // ---------------------------------------------------------------- reads

  publicUrl(fileId: string): string {
    return `${this.env.API_PUBLIC_URL.replace(/\/+$/, '')}/api/files/p/${fileId}`;
  }

  toStoredFile(row: FileRow): StoredFile {
    return {
      id: row.id,
      purpose: row.purpose,
      name: row.name,
      mime: row.mime,
      size: row.size,
      sha256: row.sha256,
      visibility: row.visibility,
      publicUrl: row.visibility === 'public' ? this.publicUrl(row.id) : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Signed download URL for a tenant file (scope t) or a platform file (scope p). */
  signedUrl(row: { id: string }, scope: TokenScope = 't', ttlSec = this.env.FILE_URL_TTL_SEC): FileUrl {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const payload = Buffer.from(JSON.stringify({ s: scope, i: row.id, e: exp })).toString('base64url');
    const sig = createHmac('sha256', this.tokenKey).update(payload).digest('base64url');
    return { url: `${this.env.API_PUBLIC_URL.replace(/\/+$/, '')}/api/files/d/${payload}.${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** Verify a signed token; null when tampered or expired. */
  verifyToken(token: string): { scope: TokenScope; id: string } | null {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = createHmac('sha256', this.tokenKey).update(payload).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { s?: string; i?: string; e?: number };
      if ((data.s !== 't' && data.s !== 'p') || typeof data.i !== 'string' || typeof data.e !== 'number') return null;
      if (data.e * 1000 < Date.now()) return null;
      return { scope: data.s, id: data.i };
    } catch {
      return null;
    }
  }

  /** Read a small stored object fully (e.g. the branding logo for PDFs). null when missing or larger than maxBytes. */
  async readBuffer(row: { key: string; driver: string }, maxBytes = 5 * 1024 * 1024): Promise<Buffer | null> {
    try {
      const body = await this.driver(row.driver).get(row.key);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of body) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += b.length;
        if (size > maxBytes) {
          body.destroy();
          return null;
        }
        chunks.push(b);
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  /** Stream a stored file with safe headers. */
  async send(res: Response, row: { key: string; driver: string; mime: string; size: number; name: string }, opts: { cache: 'public' | 'private'; download?: boolean }): Promise<void> {
    let body;
    try {
      body = await this.driver(row.driver).get(row.key);
    } catch {
      throw new AppException('NOT_FOUND', 'File not found');
    }
    res.setHeader('Content-Type', row.mime);
    res.setHeader('Content-Length', String(row.size));
    res.setHeader('Content-Disposition', `${opts.download ? 'attachment' : 'inline'}; filename="${row.name.replace(/"/g, '')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', DOWNLOAD_CSP);
    // Images and models are embedded by the web app on another origin (img, three.js loader).
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', opts.cache === 'public' ? 'public, max-age=3600' : 'private, max-age=300');
    await new Promise<void>((resolve, reject) => {
      body.on('error', reject);
      res.on('finish', resolve);
      res.on('close', resolve);
      body.pipe(res);
    });
  }
}
