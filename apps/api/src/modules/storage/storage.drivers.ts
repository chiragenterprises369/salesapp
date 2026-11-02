import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { existsSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { Env } from '../../config/env.js';

/**
 * Storage adapter (D-065). Keys are driver-relative paths like `t/<workspaceId>/<purpose>/<id>.<ext>`
 * (tenant files) or `p/<purpose>/<id>.<ext>` (platform files). Drivers never see user-supplied names.
 */
export interface StorageDriver {
  readonly name: 'local' | 's3';
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

export class LocalDiskDriver implements StorageDriver {
  readonly name = 'local' as const;
  constructor(readonly root: string) {}

  private resolve(key: string): string {
    if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error('Invalid storage key');
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

  constructor(private readonly env: Env) {
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: env.S3_ACCESS_KEY && env.S3_SECRET_KEY ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } : undefined,
    });
  }

  async put(key: string, src: string, size: number, mime: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, Body: createReadStream(src), ContentLength: size, ContentType: mime }));
  }

  async get(key: string): Promise<Readable> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
    return out.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
  }
}

export function createDriver(env: Env): StorageDriver {
  if (env.STORAGE_DRIVER === 's3') return new S3Driver(env);
  return new LocalDiskDriver(env.STORAGE_LOCAL_ROOT ? path.resolve(env.STORAGE_LOCAL_ROOT) : path.join(repoRoot(), '.data', 'uploads'));
}
