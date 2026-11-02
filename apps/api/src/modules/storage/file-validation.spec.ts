import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { makeApk, makeGlb, makeZip, PNG_1PX } from '../../testing/fixtures.js';
import { checkApk, checkGlb, checkGltfZip, extensionOf, readZipEntries, sanitizeFileName, sha256File, sniffImage, svgLooksUnsafe } from './file-validation.js';

const tmp: string[] = [];
async function file(data: Buffer | string): Promise<{ p: string; size: number }> {
  const p = path.join(os.tmpdir(), `vistar-fv-${randomUUID()}`);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  await writeFile(p, buf);
  tmp.push(p);
  return { p, size: buf.length };
}

afterAll(async () => {
  await Promise.all(tmp.map((p) => rm(p, { force: true })));
});

describe('sniffImage', () => {
  it('detects png, jpeg, webp, ico and svg from the first bytes', () => {
    expect(sniffImage(PNG_1PX)).toBe('png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toBe('webp');
    expect(sniffImage(Buffer.from([0, 0, 1, 0, 1, 0]))).toBe('ico');
    expect(sniffImage(Buffer.from('\uFEFF<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg');
    expect(sniffImage(Buffer.from('<html><body>hi</body></html>'))).toBeNull();
    expect(sniffImage(Buffer.from('GIF89a'))).toBeNull();
  });

  it('flags SVG scripts, foreignObject, javascript: links and event handlers', () => {
    expect(svgLooksUnsafe('<svg><script>x</script></svg>')).toBe(true);
    expect(svgLooksUnsafe('<svg><foreignObject/></svg>')).toBe(true);
    expect(svgLooksUnsafe('<svg><a href="javascript:alert(1)"/></svg>')).toBe(true);
    expect(svgLooksUnsafe('<svg onload="x()"></svg>')).toBe(true);
    expect(svgLooksUnsafe('<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>')).toBe(false);
  });
});

describe('GLB', () => {
  it('accepts a glTF 2.0 binary', async () => {
    const { p, size } = await file(makeGlb());
    expect(await checkGlb(p, size)).toEqual({ ok: true });
  });

  it('rejects other headers, version 1, wrong length, missing JSON chunk and asset version 1', async () => {
    const wrongMagic = await file(Buffer.concat([Buffer.from('gLTF'), makeGlb().subarray(4)]));
    expect((await checkGlb(wrongMagic.p, wrongMagic.size)).ok).toBe(false);
    const v1 = makeGlb();
    v1.writeUInt32LE(1, 4);
    const f1 = await file(v1);
    expect((await checkGlb(f1.p, f1.size)).problem).toContain('version 1');
    const extra = await file(Buffer.concat([makeGlb(), Buffer.alloc(4)]));
    expect((await checkGlb(extra.p, extra.size)).problem).toContain('truncated');
    const asset1 = await file(makeGlb({ asset: { version: '1.0' } }));
    expect((await checkGlb(asset1.p, asset1.size)).ok).toBe(false);
    const noJson = makeGlb();
    noJson.write('BIN\0', 16, 'latin1');
    const f2 = await file(noJson);
    expect((await checkGlb(f2.p, f2.size)).problem).toContain('JSON');
  });
});

describe('zip based formats', () => {
  it('reads central directory entries', async () => {
    const { p, size } = await file(makeZip([{ name: 'a.txt', data: 'abc' }, { name: 'dir/b.bin', data: Buffer.alloc(10) }]));
    expect(await readZipEntries(p, size)).toEqual([
      { name: 'a.txt', compressedSize: 3, size: 3 },
      { name: 'dir/b.bin', compressedSize: 10, size: 10 },
    ]);
  });

  it('glTF zip: exactly one .gltf, safe paths only', async () => {
    const ok = await file(makeZip([{ name: 'office/scene.gltf', data: '{}' }, { name: 'office/scene.bin', data: 'x' }]));
    expect(await checkGltfZip(ok.p, ok.size)).toEqual({ ok: true });
    const two = await file(makeZip([{ name: 'a.gltf', data: '{}' }, { name: 'b.gltf', data: '{}' }]));
    expect((await checkGltfZip(two.p, two.size)).problem).toContain('exactly one');
    for (const name of ['../x.gltf', '/abs.gltf', 'C:/x.gltf', 'a\\b.gltf']) {
      const bad = await file(makeZip([{ name, data: '{}' }]));
      expect((await checkGltfZip(bad.p, bad.size)).problem, name).toContain('unsafe');
    }
    const notZip = await file('hello');
    expect((await checkGltfZip(notZip.p, notZip.size)).ok).toBe(false);
  });

  it('APK: needs AndroidManifest.xml and classes.dex', async () => {
    const ok = await file(makeApk());
    expect(await checkApk(ok.p, ok.size)).toEqual({ ok: true });
    const noManifest = await file(makeZip([{ name: 'classes.dex', data: 'x' }]));
    expect((await checkApk(noManifest.p, noManifest.size)).problem).toContain('AndroidManifest.xml');
    const noDex = await file(makeZip([{ name: 'AndroidManifest.xml', data: 'x' }]));
    expect((await checkApk(noDex.p, noDex.size)).problem).toContain('classes.dex');
    const zipHeaderOnly = await file(Buffer.from('PK\u0003\u0004 truncated'));
    expect((await checkApk(zipHeaderOnly.p, zipHeaderOnly.size)).ok).toBe(false);
  });
});

describe('names and hashes', () => {
  it('extensions are lower-cased; names lose paths and unsafe characters', () => {
    expect(extensionOf('Office.GLB')).toBe('glb');
    expect(extensionOf('noext')).toBe('');
    expect(sanitizeFileName('C:\\Users\\x\\My "logo"<1>.png')).toBe('My _logo_1_.png');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('///')).toBe('file');
  });

  it('sha256 of a file', async () => {
    const { p } = await file('abc');
    expect(await sha256File(p)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
