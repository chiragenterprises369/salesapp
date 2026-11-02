import { FloorAssetSchema, FloorRequestSchema, seatMapFromPlan, FloorPlanSchema, TeamFloorLayoutSchema, type SeatMap } from '@vistar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, floorPlan, makeGlb, makeZip, PNG_1PX, type Harness } from '../../testing/http-harness.js';

/**
 * Custom Team Floors over HTTP (D-061, SPEC 29.5, 29.11): reference-image requests (minimums per category, 422
 * FLOOR_REQUEST_INCOMPLETE, files checked per tenant and purpose), the company layout (template until published),
 * Super Admin request status, floor uploads (GLB, zipped glTF, AI-written layout_json validated with FloorPlanSchema),
 * seat map, publish (409 FLOOR_NOT_READY without seats), supersede, signed model URLs and tenant isolation.
 */

let h: Harness;
let a: Awaited<ReturnType<Harness['workspace']>>;
let b: Awaited<ReturnType<Harness['workspace']>>;
let employeeA = '';
let superToken = '';
let readerToken = '';
const refs: string[] = [];
let refB = '';
let logoA = '';
let requestId = '';
let glbId = '';
let planId = '';

const up = async (token: string, purpose: string) => {
  const res = await h.api().post('/api/v1/files').set(bearer(token)).field('purpose', purpose).attach('file', PNG_1PX, `${purpose}.png`);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
};
const images = (cats: string[], ids = refs) => cats.map((category, i) => ({ fileId: ids[i]!, category }));
const floorUpload = (workspaceId: string, data: Buffer, name: string, fields: Record<string, string> = {}, token = superToken) => {
  const req = h.api().post(`/api/super/companies/${workspaceId}/floors`).set(bearer(token));
  for (const [k, v] of Object.entries(fields)) req.field(k, v);
  return req.attach('file', data, name);
};
const pathOf = (url: string) => new URL(url).pathname;

beforeAll(async () => {
  h = await createHarness('floor');
  a = await h.workspace('a');
  b = await h.workspace('b');
  employeeA = (await h.member(a.workspaceId, 'employee', 'emp')).token;
  superToken = (await h.superAdmin(['platform.companies.read', 'platform.companies.manage'])).token;
  readerToken = (await h.superAdmin(['platform.companies.read'], 'reader')).token;
  for (let i = 0; i < 4; i++) refs.push(await up(a.token, 'reference_image'));
  refB = await up(b.token, 'reference_image');
  logoA = await up(a.token, 'logo');
}, 90_000);

afterAll(async () => {
  await h?.close();
});

describe('company floor requests', () => {
  it('layout before any request: default template, no request', async () => {
    const res = await h.api().get('/api/v1/team-floor/layout').set(bearer(employeeA));
    expect(res.status).toBe(200);
    expect(TeamFloorLayoutSchema.parse(res.body)).toMatchObject({ source: 'template', templateId: 'small', floor: null, request: null });
  });

  it('422 FLOOR_REQUEST_INCOMPLETE below the minimums (3 photos, a work area, a cabin or meeting room)', async () => {
    for (const cats of [['work_area', 'cabin'], ['cabin', 'meeting_room', 'reception'], ['work_area', 'reception', 'pantry_lounge']]) {
      const res = await h.api().post('/api/v1/floor-requests').set(bearer(a.token)).send({ headcount: 12, images: images(cats) });
      expect(res.status, cats.join()).toBe(422);
      expect(res.body.error.code).toBe('FLOOR_REQUEST_INCOMPLETE');
      expect(res.body.error.details.length).toBeGreaterThan(0);
    }
  });

  it("another company's photo is 404, a logo is 422, a duplicate is 400; employees get 403", async () => {
    const cross = await h.api().post('/api/v1/floor-requests').set(bearer(a.token)).send({ headcount: 5, images: [...images(['work_area', 'cabin']), { fileId: refB, category: 'reception' }] });
    expect(cross.status).toBe(404);
    const logo = await h.api().post('/api/v1/floor-requests').set(bearer(a.token)).send({ headcount: 5, images: [...images(['work_area', 'cabin']), { fileId: logoA, category: 'reception' }] });
    expect(logo.status).toBe(422);
    expect(logo.body.error.code).toBe('FILE_INVALID');
    const dup = await h.api().post('/api/v1/floor-requests').set(bearer(a.token)).send({ headcount: 5, images: [{ fileId: refs[0], category: 'work_area' }, { fileId: refs[0], category: 'cabin' }, { fileId: refs[1], category: 'reception' }] });
    expect(dup.status).toBe(400);
    const emp = await h.api().post('/api/v1/floor-requests').set(bearer(employeeA)).send({ headcount: 5, images: images(['work_area', 'cabin', 'reception']) });
    expect(emp.status).toBe(403);
    expect(await h.prisma.floorRequest.count({ where: { workspaceId: a.workspaceId } })).toBe(0);
  });

  it('a complete request is created (201) with signed image URLs; list hides URLs; the layout shows "being prepared"', async () => {
    const res = await h.api().post('/api/v1/floor-requests').set(bearer(a.token)).send({ headcount: 12, notes: 'Two cabins, glass meeting room', images: images(['work_area', 'cabin', 'meeting_room', 'reception']).map((x, i) => ({ ...x, caption: `Photo ${i + 1}` })) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const r = FloorRequestSchema.parse(res.body);
    requestId = r.id;
    expect(r).toMatchObject({ status: 'submitted', headcount: 12, workspaceId: a.workspaceId, publishedFloorId: null });
    expect(r.images.map((i) => i.category)).toEqual(['work_area', 'cabin', 'meeting_room', 'reception']);
    expect(r.images[0]!.url).toMatch(/\/api\/files\/d\//);
    expect((await h.api().get(pathOf(r.images[0]!.url!))).status).toBe(200);

    const list = await h.api().get('/api/v1/floor-requests').set(bearer(a.token));
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].images[0].url).toBeNull();
    expect((await h.api().get(`/api/v1/floor-requests/${requestId}`).set(bearer(b.token))).status).toBe(404);
    expect((await h.api().get('/api/v1/floor-requests').set(bearer(employeeA))).status).toBe(403);

    const layout = await h.api().get('/api/v1/team-floor/layout').set(bearer(employeeA));
    expect(layout.body).toMatchObject({ source: 'template', floor: null, request: { id: requestId, status: 'submitted' } });
    expect(await h.prisma.auditLog.count({ where: { workspaceId: a.workspaceId, action: 'floor_request.create' } })).toBe(1);
  });
});

describe('Super Admin floors', () => {
  it('lists requests across companies (filter by company and status); company tokens are refused', async () => {
    const res = await h.api().get('/api/super/floor-requests').query({ workspaceId: a.workspaceId, status: 'submitted' }).set(bearer(readerToken));
    expect(res.status).toBe(200);
    expect(res.body.items.map((r: { id: string }) => r.id)).toEqual([requestId]);
    expect(res.body.items[0].workspaceName).toContain('test-floor-a');
    expect((await h.api().get('/api/super/floor-requests').set(bearer(a.token))).status).toBe(401);
    const detail = await h.api().get(`/api/super/floor-requests/${requestId}`).set(bearer(readerToken));
    expect(detail.body.images[0].url).toMatch(/\/api\/files\/d\//);
  });

  it('status: rejecting needs a note (400); reader cannot change (403); in_progress works', async () => {
    expect((await h.api().post(`/api/super/floor-requests/${requestId}/status`).set(bearer(superToken)).send({ status: 'rejected' })).status).toBe(400);
    expect((await h.api().post(`/api/super/floor-requests/${requestId}/status`).set(bearer(readerToken)).send({ status: 'in_progress' })).status).toBe(403);
    const res = await h.api().post(`/api/super/floor-requests/${requestId}/status`).set(bearer(superToken)).send({ status: 'in_progress', note: 'Building your office now' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'in_progress', statusNote: 'Building your office now' });
  });

  it('GLB upload: 422 for broken files, 415 for other types, 404 for unknown companies and foreign requests', async () => {
    const bad = await floorUpload(a.workspaceId, Buffer.from('glTF but broken'), 'office.glb');
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('FILE_INVALID');
    const truncated = makeGlb().subarray(0, 40);
    expect((await floorUpload(a.workspaceId, truncated, 'office.glb')).status).toBe(422);
    expect((await floorUpload(a.workspaceId, makeGlb(), 'office.obj')).status).toBe(415);
    expect((await floorUpload('00000000-0000-7000-8000-000000000000', makeGlb(), 'office.glb')).status).toBe(404);
    expect((await floorUpload(b.workspaceId, makeGlb(), 'office.glb', { requestId })).status).toBe(404);
    expect((await floorUpload(a.workspaceId, makeGlb(), 'office.glb', {}, readerToken)).status).toBe(403);
    const unsafeZip = makeZip([{ name: '../evil.gltf', data: '{}' }]);
    expect((await floorUpload(a.workspaceId, unsafeZip, 'office.zip')).status).toBe(422);
    const noGltf = makeZip([{ name: 'readme.txt', data: 'hi' }]);
    expect((await floorUpload(a.workspaceId, noGltf, 'office.zip')).status).toBe(422);
    expect(await h.prisma.floorAsset.count({ where: { workspaceId: a.workspaceId } })).toBe(0);
  });

  it('a GLB becomes draft v1 without seats; publish is 409 FLOOR_NOT_READY until the seat map is saved', async () => {
    const res = await floorUpload(a.workspaceId, makeGlb(), 'office.glb', { requestId, notes: 'From the AI tool' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const f = FloorAssetSchema.parse(res.body);
    glbId = f.id;
    expect(f).toMatchObject({ version: 1, status: 'draft', format: 'glb', seatMap: null, seatCount: 0, requestId });
    expect(f.model.url).toMatch(/\/api\/files\/d\//);
    const notReady = await h.api().post(`/api/super/floors/${glbId}/publish`).set(bearer(superToken));
    expect(notReady.status).toBe(409);
    expect(notReady.body.error.code).toBe('FLOOR_NOT_READY');
  });

  it('seat map: 400 for duplicate seats or unknown zones; saved when valid', async () => {
    const seatMap: SeatMap = {
      schemaVersion: 1,
      units: 'm',
      scale: 1,
      origin: [0, 0, 0],
      seats: [
        { id: 's1', kind: 'desk', position: [1, 0, 1], rotation: 0, zoneId: 'z1' },
        { id: 's2', kind: 'cabin', position: [5, 0, 1], rotation: 90, zoneId: 'z1' },
      ],
      zones: [{ id: 'z1', name: 'Floor', kind: 'work_area', polygon: [[0, 0], [8, 0], [8, 6]] }],
    };
    const dup = await h.api().put(`/api/super/floors/${glbId}/seat-map`).set(bearer(superToken)).send({ ...seatMap, seats: [seatMap.seats[0], seatMap.seats[0]] });
    expect(dup.status).toBe(400);
    const zone = await h.api().put(`/api/super/floors/${glbId}/seat-map`).set(bearer(superToken)).send({ ...seatMap, zones: [] });
    expect(zone.status).toBe(400);
    const ok = await h.api().put(`/api/super/floors/${glbId}/seat-map`).set(bearer(superToken)).send(seatMap);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ seatCount: 2, status: 'draft' });
  });

  it('publish: request published, layout custom with a signed model URL, events and audit in both logs', async () => {
    const res = await h.api().post(`/api/super/floors/${glbId}/publish`).set(bearer(superToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'published', version: 1 });
    expect(res.body.publishedAt).toBeTruthy();

    const layout = TeamFloorLayoutSchema.parse((await h.api().get('/api/v1/team-floor/layout').set(bearer(employeeA))).body);
    expect(layout).toMatchObject({ source: 'custom', floorAssetId: glbId, version: 1, request: { id: requestId, status: 'published' } });
    expect(layout.floor?.format).toBe('glb');
    const model = await h.api().get(pathOf(layout.floor!.modelUrl)).buffer(true);
    expect(model.status).toBe(200);
    expect(model.headers['content-type']).toBe('model/gltf-binary');

    const other = await h.api().get('/api/v1/team-floor/layout').set(bearer(b.token));
    expect(other.body).toMatchObject({ source: 'template', floor: null, request: null });
    expect(await h.prisma.auditLog.count({ where: { workspaceId: a.workspaceId, action: 'floor.publish', actorType: 'super_admin' } })).toBe(1);
    const req = await h.api().get(`/api/v1/floor-requests/${requestId}`).set(bearer(a.token));
    expect(req.body).toMatchObject({ status: 'published', publishedFloorId: glbId });
  });

  it('layout_json: 422 with details for an invalid plan; a valid plan gets its seat map and replaces v1 on publish', async () => {
    const broken = floorPlan();
    (broken.seats as Array<{ position: number[] }>)[0]!.position = [99, 99];
    const bad = await floorUpload(a.workspaceId, Buffer.from(JSON.stringify(broken)), 'plan.json');
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.some((d: { path: string }) => d.path.startsWith('seats.0'))).toBe(true);
    expect((await floorUpload(a.workspaceId, Buffer.from('{"not":"json"'), 'plan.json')).status).toBe(422);

    const plan = floorPlan(6);
    const res = await floorUpload(a.workspaceId, Buffer.from(JSON.stringify(plan)), 'plan.json');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    planId = res.body.id;
    expect(res.body).toMatchObject({ version: 2, format: 'layout_json', seatCount: 6, status: 'draft' });
    expect(res.body.seatMap).toEqual(seatMapFromPlan(FloorPlanSchema.parse(plan)));

    const pub = await h.api().post(`/api/super/floors/${planId}/publish`).set(bearer(superToken));
    expect(pub.status).toBe(200);
    const list = await h.api().get(`/api/super/companies/${a.workspaceId}/floors`).set(bearer(readerToken));
    expect(list.body.items.map((f: { version: number; status: string }) => [f.version, f.status])).toEqual([[2, 'published'], [1, 'superseded']]);
    const layout = await h.api().get('/api/v1/team-floor/layout').set(bearer(employeeA));
    expect(layout.body).toMatchObject({ source: 'custom', version: 2, floor: { format: 'layout_json' } });
    const json = await h.api().get(pathOf(layout.body.floor.modelUrl));
    expect(json.status).toBe(200);
    expect(json.body.kind).toBe('vistar.floor-plan');
  });

  it('superseded versions cannot be edited or re-published (409); unknown floors are 404', async () => {
    const map = (await h.api().get(`/api/super/floors/${planId}`).set(bearer(readerToken))).body.seatMap;
    expect((await h.api().put(`/api/super/floors/${glbId}/seat-map`).set(bearer(superToken)).send(map)).status).toBe(409);
    expect((await h.api().post(`/api/super/floors/${glbId}/publish`).set(bearer(superToken))).status).toBe(409);
    expect((await h.api().get('/api/super/floors/00000000-0000-7000-8000-000000000000').set(bearer(readerToken))).status).toBe(404);
    expect((await h.api().get(`/api/super/companies/00000000-0000-7000-8000-000000000000/floors`).set(bearer(readerToken))).status).toBe(404);
  });
});
