import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BUNNY_STORAGE_HOSTS, type StorageDriverKind } from '@vistar/shared';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { StorageConfig } from '../config-registry/snapshot.js';

/**
 * Storage adapter (D-065; change #20: the driver comes from Super Admin > Config > File storage at runtime).
 * Keys are driver-relative paths like `t/<workspaceId>/<purpose>/<id>.<ext>` (tenant files) or
 * `p/<purpose>/<id>.<ext>` (platform files). Drivers never see user-supplied names. Every stored row keeps the
 * driver it was written with, so switching drivers never breaks old files.
 */
export interface StorageDriver {
  readonly name: StorageDriverKind;
  /** Store the temp file at `src` under `key`. */
  put(key: string, src: string, size: number, mime: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

/** Monorepo root (the folder with pnpm-workspace.yaml), from the API's working directory. */
export function repoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.resolve(start);
}

const SAFE_KEY = /^[a-z]\/[A-Za-z0-9/_.-]+$/;

function assertKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error('Invalid storage key');
}

export class LocalDiskDriver implements StorageDriver {
  readonly name = 'local' as const;
  constructor(readonly root: string) {}

  private resolve(key: string): string {
    assertKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, src: string): Promise<void> {
    const dest = this.resolve(key);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }

  async get(key: string): Promise<Readable> {
    const full = this.resolve(key);
    await stat(full); // throws ENOENT before the response starts
    return createReadStream(full);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

export class S3Driver implements StorageDriver {
  readonly name = 's3' as const;
  private readonly client: S3Client;

  constructor(private readonly cfg: Extract<StorageConfig, { driver: 's3' }>) {
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint || undefined,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    });
  }

  async put(key: string, src: string, size: number, mime: string): Promise<void> {
    assertKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: createReadStream(src), ContentLength: size, ContentType: mime }));
  }

  async get(key: string): Promise<Readable> {
    assertKey(key);
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    return out.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}

export class StorageHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'StorageHttpError';
  }
}

/**
 * Bunny Storage, native HTTP API (the S3-compatible endpoint rejected the AWS signature earlier):
 *   PUT|GET|DELETE https://<region host>/<storage zone>/<key>   header AccessKey: <storage zone password>
 * PUT sends the SHA-256 checksum so Bunny rejects a corrupted upload. Hosts come from a fixed list (no SSRF).
 */
export class BunnyDriver implements StorageDriver {
  readonly name = 'bunny' as const;
  private readonly base: string;

  constructor(private readonly cfg: Extract<StorageConfig, { driver: 'bunny' }>) {
    const host = BUNNY_STORAGE_HOSTS[cfg.region] ?? BUNNY_STORAGE_HOSTS.de!;
    if (!/^[A-Za-z0-9-]{1,64}$/.test(cfg.storageZone)) throw new Error('Invalid Bunny storage zone name');
    this.base = `https://${host}/${cfg.storageZone}`;
  }

  private url(key: string): string {
    assertKey(key);
    return `${this.base}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  private async request(method: 'PUT' | 'GET' | 'DELETE', key: string, init: { body?: Readable; size?: number; sha256?: string; mime?: string } = {}): Promise<Response> {
    const headers: Record<string, string> = { AccessKey: this.cfg.password };
    if (init.size !== undefined) headers['content-length'] = String(init.size);
    if (init.sha256) headers.Checksum = init.sha256.toUpperCase();
    if (init.mime) headers['content-type'] = 'application/octet-stream';
    const res = await fetch(this.url(key), {
      method,
      headers,
      body: init.body ? (Readable.toWeb(init.body) as unknown as BodyInit) : undefined,
      // Node needs duplex 'half' for a streaming request body.
      ...(init.body ? { duplex: 'half' } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(method === 'PUT' ? 300_000 : 60_000),
    } as RequestInit);
    return res;
  }

  async put(key: string, src: string, size: number, mime: string): Promise<void> {
    const sha256 = await sha256Of(src);
    const res = await this.request('PUT', key, { body: createReadStream(src), size, sha256, mime });
    if (res.status !== 201 && res.status !== 200) throw new StorageHttpError(res.status, res.status === 401 ? 'Bunny rejected the storage password' : `Bunny upload failed (HTTP ${res.status})`);
    await res.body?.cancel().catch(() => undefined);
  }

  async get(key: string): Promise<Readable> {
    const res = await this.request('GET', key);
    if (res.status !== 200 || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      throw new StorageHttpError(res.status, res.status === 404 ? 'File not found' : `Bunny download failed (HTTP ${res.status})`);
    }
    return Readable.fromWeb(res.body as unknown as WebReadableStream);
  }

  async delete(key: string): Promise<void> {
    const res = await this.request('DELETE', key);
    await res.body?.cancel().catch(() => undefined);
    if (res.status !== 200 && res.status !== 404) throw new StorageHttpError(res.status, `Bunny delete failed (HTTP ${res.status})`);
  }
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export function localRoot(root: string | null): string {
  return root ? path.resolve(root) : path.join(repoRoot(), '.data', 'uploads');
}

/** Driver for a resolved storage config. */
export function createDriverFor(cfg: StorageConfig): StorageDriver {
  if (cfg.driver === 's3') return new S3Driver(cfg);
  if (cfg.driver === 'bunny') return new BunnyDriver(cfg);
  return new LocalDiskDriver(localRoot(cfg.root));
}
