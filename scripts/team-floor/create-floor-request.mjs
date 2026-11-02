#!/usr/bin/env node
// Creates a custom floor request for a demo company through the API (what the company admin does in the
// Team Floor tab): signs in, uploads 4 reference photos (work area x2, cabin, meeting room) with purpose
// reference_image, then POST /floor-requests with head count and notes. For QA of the Super Admin Floors
// pages without the company UI.
// Usage: node scripts/team-floor/create-floor-request.mjs --api http://localhost:4015 [--email anil@shakti.example] [--headcount 22]
import { deflateSync } from 'node:zlib';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true)]] : acc), []),
);
const api = String(args.api ?? 'http://localhost:4015').replace(/\/$/, '');
const email = args.email ?? 'anil@shakti.example';
const password = process.env.SMOKE_PASSWORD ?? 'vistar-demo-123';
const headcount = Number(args.headcount ?? 22);

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
/** Plain-colour RGB PNG, w x h. */
function png(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: w }, () => Buffer.from(rgb)))]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function call(path, init = {}, token = null) {
  const res = await fetch(`${api}${path}`, { ...init, headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${JSON.stringify(body?.error ?? body)}`);
  return body;
}

const session = await call('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
const token = session.accessToken;
const photos = [
  { category: 'work_area', name: 'work-area-1.png', rgb: [200, 170, 130], caption: 'Sales floor from the entrance' },
  { category: 'work_area', name: 'work-area-2.png', rgb: [190, 160, 120], caption: 'Calling team near the reception' },
  { category: 'cabin', name: 'cabin.png', rgb: [120, 90, 70], caption: 'Director cabin' },
  { category: 'meeting_room', name: 'conference.png', rgb: [140, 150, 165], caption: 'Conference room, 6 seats' },
];
const images = [];
for (const p of photos) {
  const form = new FormData();
  form.append('purpose', 'reference_image');
  form.append('file', new Blob([png(64, 48, p.rgb)], { type: 'image/png' }), p.name);
  const file = await call('/api/v1/files', { method: 'POST', body: form }, token);
  images.push({ fileId: file.id, category: p.category, caption: p.caption });
  console.info(`uploaded ${p.name} -> ${file.id}`);
}
const request = await call(
  '/api/v1/floor-requests',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ headcount, notes: 'One floor, about 24 x 16 m. Two cabins on the left, the calling team near the reception.', images }) },
  token,
);
console.info(`floor request ${request.id}: status ${request.status}, ${request.images.length} photos, company ${request.workspaceName}`);
