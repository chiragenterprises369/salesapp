import { CAPTURE_HONEYPOT_FIELD, CAPTURE_RATE_LIMITS, CaptureFormSchema, PublicCaptureFormSchema } from '@vistar/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, type Harness } from '../../testing/http-harness.js';

/**
 * Lead capture forms over HTTP (change #19 wave B): builder validation, public form, submit -> routed lead with
 * UTM on the timeline, consent, honeypot, idempotency, dedupe, per-IP rate limit (429), paused forms (410).
 * Run: `pnpm --filter @vistar/api test capture.http`.
 */
let h: Harness;
let a: Awaited<ReturnType<Harness['workspace']>>;
let rep: { userId: string; token: string };
let form: ReturnType<typeof CaptureFormSchema.parse>;

const FIELDS = [
  { id: 'name', label: 'Name', type: 'text', required: true, mapTo: 'name' },
  { id: 'phone', label: 'Mobile', type: 'phone', required: true, mapTo: 'phone' },
  { id: 'city', label: 'City', type: 'text', mapTo: 'city' },
  { id: 'budget', label: 'Budget', type: 'number', mapTo: 'valueInr' },
  { id: 'size', label: 'Team size', type: 'select', options: [{ value: 's', label: 'Small' }, { value: 'l', label: 'Large' }] },
];

beforeAll(async () => {
  h = await createHarness('capture');
  a = await h.workspace('a');
  rep = await h.member(a.workspaceId, 'employee', 'cap-rep');
  await h.api().post('/api/v1/routing-rules').set(bearer(a.token)).send({ name: 'Web leads', conditions: { sources: ['website'] }, userIds: [rep.userId], respectWorkingHours: false, respectAvailability: false });
}, 90_000);

afterAll(async () => {
  await h?.close();
});

/** Wait until the current minute has room for a burst (the limiter counts per wall-clock minute). */
async function freshMinute(): Promise<void> {
  const s = new Date().getSeconds();
  if (s > 45) await new Promise((r) => setTimeout(r, (61 - s) * 1000));
}

describe('capture forms', () => {
  it('a form must map the name and a phone or email', async () => {
    const res = await h.api().post('/api/v1/capture-forms').set(bearer(a.token)).send({ name: 'Bad', fields: [{ id: 'x', label: 'X', type: 'text' }] });
    expect(res.status).toBe(400);
  });

  it('creates a form with hosted URL and embed snippet', async () => {
    const res = await h.api().post('/api/v1/capture-forms').set(bearer(a.token)).send({ name: 'Website enquiry', fields: FIELDS, settings: { consent: { enabled: true, required: true, text: 'OK to contact me' } } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    form = CaptureFormSchema.parse(res.body);
    expect(form.hostedUrl).toMatch(new RegExp(`/f/${form.key}$`));
    expect(form.embedHtml).toContain('<iframe');
    expect((await h.api().get('/api/v1/capture-forms').set(bearer(rep.token))).status).toBe(403);
  });

  it('the public form hides the mapping and names the honeypot', async () => {
    const res = await h.api().get(`/api/v1/public/forms/${form.key}`);
    expect(res.status).toBe(200);
    const pub = PublicCaptureFormSchema.parse(res.body);
    expect(pub.honeypotField).toBe(CAPTURE_HONEYPOT_FIELD);
    expect(JSON.stringify(pub.fields)).not.toContain('mapTo');
  });

  it('consent is required when the form says so', async () => {
    const res = await h.api().post(`/api/v1/public/forms/${form.key}/submit`).send({ values: { name: 'No consent', phone: '9812300001' } });
    expect(res.body.error.code).toBe('CONSENT_MISSING');
  });

  it('a submission becomes a routed website lead with UTM; retries are idempotent', async () => {
    await freshMinute();
    const clientSubmissionId = randomUUID();
    const body = { values: { name: 'Form Lead', phone: '98123 00002', city: 'Pune', budget: '75000', size: 'l' }, consent: true, utm: { source: 'google', campaign: 'diwali' }, clientSubmissionId };
    const res = await h.api().post(`/api/v1/public/forms/${form.key}/submit`).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ok).toBe(true);
    expect((await h.api().post(`/api/v1/public/forms/${form.key}/submit`).send(body)).status).toBe(200);
    const leads = await h.prisma.lead.findMany({ where: { workspaceId: a.workspaceId, phone: '+919812300002' } });
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ source: 'website', ownerId: rep.userId, valueInr: 75_000, city: 'Pune' });
    expect(leads[0]!.requirement).toContain('Team size: l');
    const created = await h.prisma.activity.findFirstOrThrow({ where: { leadId: leads[0]!.id, type: 'lead_created' } });
    expect(created.payload).toMatchObject({ source: 'website', formId: form.id, utm: { source: 'google', campaign: 'diwali' } });
    expect(await h.prisma.consentRecord.count({ where: { workspaceId: a.workspaceId, contactId: leads[0]!.contactId!, source: 'web_form' } })).toBe(1);
    // dedupe: same phone again adds a note to the open lead instead of a new lead
    await h.api().post(`/api/v1/public/forms/${form.key}/submit`).send({ ...body, clientSubmissionId: randomUUID() });
    expect(await h.prisma.lead.count({ where: { workspaceId: a.workspaceId, phone: '+919812300002' } })).toBe(1);
    expect(await h.prisma.activity.count({ where: { leadId: leads[0]!.id, type: 'note' } })).toBe(1);
  });

  it('a filled honeypot answers ok and stores nothing', async () => {
    const before = await h.prisma.captureSubmission.count({ where: { formId: form.id } });
    const res = await h.api().post(`/api/v1/public/forms/${form.key}/submit`).send({ values: { name: 'Bot', phone: '9812300003' }, consent: true, hp: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect(await h.prisma.captureSubmission.count({ where: { formId: form.id } })).toBe(before);
    expect(await h.prisma.lead.count({ where: { workspaceId: a.workspaceId, phone: '+919812300003' } })).toBe(0);
  });

  it('invalid answers are 422 with field paths', async () => {
    // its own form: the main form already used this minute's per-IP budget
    const f3 = CaptureFormSchema.parse((await h.api().post('/api/v1/capture-forms').set(bearer(a.token)).send({ name: 'Validation', fields: FIELDS })).body);
    const res = await h.api().post(`/api/v1/public/forms/${f3.key}/submit`).send({ values: { name: 'X', phone: '12', size: 'zzz' } });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['values.phone', 'values.size']));
  });

  it('rate limit: more than the per-IP minute limit answers 429', async () => {
    const f2 = CaptureFormSchema.parse((await h.api().post('/api/v1/capture-forms').set(bearer(a.token)).send({ name: 'Burst', fields: FIELDS.slice(0, 2) })).body);
    await freshMinute();
    const statuses: number[] = [];
    for (let i = 0; i < CAPTURE_RATE_LIMITS.perIpPerMinute + 2; i++) {
      statuses.push((await h.api().post(`/api/v1/public/forms/${f2.key}/submit`).send({ values: { name: `Burst ${i}`, phone: `98124000${String(i).padStart(2, '0')}` } })).status);
    }
    expect(statuses.slice(0, CAPTURE_RATE_LIMITS.perIpPerMinute).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(CAPTURE_RATE_LIMITS.perIpPerMinute)).toEqual([429, 429]);
  });

  it('paused and deleted forms answer 410', async () => {
    await h.api().patch(`/api/v1/capture-forms/${form.id}`).set(bearer(a.token)).send({ status: 'paused' });
    expect((await h.api().get(`/api/v1/public/forms/${form.key}`)).status).toBe(410);
    expect((await h.api().post(`/api/v1/public/forms/${form.key}/submit`).send({ values: {} })).status).toBe(410);
  });
});
