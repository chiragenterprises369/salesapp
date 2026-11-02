import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';

/**
 * Content checks for uploads (D-065). Everything reads from the temp file on disk, so a 150 MB APK is never
 * held in memory: magic bytes from the head, zip directories from the tail.
 */

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function readHead(path: string, bytes: number): Promise<Buffer> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

const startsWith = (buf: Buffer, sig: number[], at = 0) => sig.every((b, i) => buf[at + i] === b);

export type ImageKind = 'png' | 'jpeg' | 'webp' | 'svg' | 'ico';

/** Detect an image type from its first bytes; null = not an accepted image. */
export function sniffImage(head: Buffer): ImageKind | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (startsWith(head, [0x00, 0x00, 0x01, 0x00])) return 'ico';
  const text = head.toString('utf8').replace(/^\uFEFF/, '').trimStart().slice(0, 4096).toLowerCase();
  if ((text.startsWith('<?xml') || text.startsWith('<svg') || text.startsWith('<!--')) && text.includes('<svg')) return 'svg';
  return null;
}

/** SVGs are served with a sandbox CSP anyway; scripts and event handlers are refused up front. */
export function svgLooksUnsafe(text: string): boolean {
  return /<script|<foreignobject|javascript:|\son[a-z]+\s*=/i.test(text);
}

export interface GlbCheck {
  ok: boolean;
  problem?: string;
}

/** GLB 2.0: magic "glTF", version 2, declared length = file size, first chunk JSON with asset.version 2.x. */
export async function checkGlb(path: string, size: number): Promise<GlbCheck> {
  const head = await readHead(path, 20);
  if (head.length < 20 || head.subarray(0, 4).toString('latin1') !== 'glTF') return { ok: false, problem: 'This is not a GLB file (missing the glTF header)' };
  const version = head.readUInt32LE(4);
  if (version !== 2) return { ok: false, problem: `GLB version ${version} is not supported; export glTF 2.0` };
  if (head.readUInt32LE(8) !== size) return { ok: false, problem: 'The GLB file is truncated or has extra bytes' };
  const jsonLength = head.readUInt32LE(12);
  if (head.subarray(16, 20).toString('latin1') !== 'JSON' || jsonLength <= 0 || jsonLength > size) return { ok: false, problem: 'The GLB has no JSON chunk' };
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(Math.min(jsonLength, 32 * 1024 * 1024));
    await fh.read(buf, 0, buf.length, 20);
    const json = JSON.parse(buf.toString('utf8').replace(/[\u0000 ]+$/, '')) as { asset?: { version?: string } };
    if (!json.asset?.version?.startsWith('2')) return { ok: false, problem: 'The GLB asset version is not 2.0' };
  } catch {
    return { ok: false, problem: 'The GLB JSON chunk is not valid JSON' };
  } finally {
    await fh.close();
  }
  return { ok: true };
}

export interface ZipEntry {
  name: string;
  compressedSize: number;
  size: number;
}

/** Entry names of a zip (central directory). Throws when the file is not a readable zip. */
export async function readZipEntries(path: string, size: number, maxEntries = 5000): Promise<ZipEntry[]> {
  const head = await readHead(path, 4);
  if (!startsWith(head, [0x50, 0x4b, 0x03, 0x04])) throw new Error('not a zip');
  const fh = await open(path, 'r');
  try {
    const tailLen = Math.min(size, 65_557);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('no end of central directory');
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (count > maxEntries) throw new Error('too many entries');
    if (cdOffset + cdSize > size) throw new Error('central directory out of range');
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const entries: ZipEntry[] = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
      const compressedSize = cd.readUInt32LE(p + 20);
      const uncompressed = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      entries.push({ name: cd.subarray(p + 46, p + 46 + nameLen).toString('utf8'), compressedSize, size: uncompressed });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    await fh.close();
  }
}

/** Zipped glTF: one .gltf at any depth, safe relative paths, uncompressed total within a sane limit. */
export async function checkGltfZip(path: string, size: number): Promise<GlbCheck> {
  let entries: ZipEntry[];
  try {
    entries = await readZipEntries(path, size);
  } catch {
    return { ok: false, problem: 'This is not a readable zip file' };
  }
  if (entries.some((e) => e.name.includes('..') || e.name.startsWith('/') || e.name.includes('\\') || /^[a-z]:/i.test(e.name))) return { ok: false, problem: 'The zip contains unsafe paths' };
  const gltf = entries.filter((e) => e.name.toLowerCase().endsWith('.gltf'));
  if (gltf.length !== 1) return { ok: false, problem: gltf.length ? 'The zip must contain exactly one .gltf file' : 'The zip contains no .gltf file' };
  const total = entries.reduce((n, e) => n + e.size, 0);
  if (total > 400 * 1024 * 1024) return { ok: false, problem: 'The unpacked model is larger than 400 MB' };
  return { ok: true };
}

/** APK = zip with AndroidManifest.xml and at least one classes*.dex. */
export async function checkApk(path: string, size: number): Promise<GlbCheck> {
  let entries: ZipEntry[];
  try {
    entries = await readZipEntries(path, size, 100_000);
  } catch {
    return { ok: false, problem: 'This is not an APK (not a zip file)' };
  }
  const names = new Set(entries.map((e) => e.name));
  if (!names.has('AndroidManifest.xml')) return { ok: false, problem: 'This is not an APK (AndroidManifest.xml is missing)' };
  if (!entries.some((e) => /^classes\d*\.dex$/.test(e.name))) return { ok: false, problem: 'This is not an APK (no classes.dex)' };
  return { ok: true };
}

/** Lower-case extension without the dot ('' when none). */
export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m ? m[1]!.toLowerCase() : '';
}

/** File name safe to store and to send in Content-Disposition. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const clean = base.replace(/[^\w.\- ()]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
  return clean || 'file';
}
