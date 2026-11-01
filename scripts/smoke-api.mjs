// API smoke check for wave reports (orchestrator). Needs a running API and a seeded DB.
// Usage: node scripts/smoke-api.mjs [baseUrl]   (default http://localhost:4000)
// Logs in as seeded personas, calls key endpoints, validates responses with the shared schemas,
// and checks tenant isolation, data scope, RBAC and token audiences. Exits 1 on any failure.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const S = await import(pathToFileURL(resolve('packages/shared/dist/index.js')).href);
const base = process.argv[2] ?? 'http://localhost:4000';
const PASSWORD = 'vistar-demo-123';
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text };
}

const parses = (schema, data) => {
  const r = schema.safeParse(data);
  return r.success
    ? ''
    : r.error.issues
        .slice(0, 2)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
};

async function login(email) {
  const r = await call('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD } });
  const err = parses(S.AuthSessionSchema, r.json);
  check(`login ${email}`, r.status === 200 && !err, `${r.status} ${err}`);
  return r.json?.accessToken;
}

const health = await call('GET', '/api/health');
check('health db+redis', health.json?.db && health.json?.redis, JSON.stringify(health.json));

const admin = await login('anil@shakti.example');
const manager = await login('priya@shakti.example');
const employee = await login('rohit@shakti.example');
const viewer = await login('deepa@shakti.example');
const other = await login('jignesh@navkar.example');

const me = await call('GET', '/api/v1/auth/me', { token: manager });
check(
  'auth/me parses (manager)',
  me.status === 200 && !parses(S.MeResponseSchema, me.json),
  parses(S.MeResponseSchema, me.json),
);
check('manager has team members', (me.json?.teamMemberIds?.length ?? 0) > 1);
check('ai_node off by default', me.json?.workspace?.features?.ai_node === false);

const listPage = S.pageOf(S.LeadListItemSchema);
const count = async (token) => (await call('GET', '/api/v1/leads?limit=1', { token })).json?.total;
const [ca, cm, ce, cv] = [
  await count(admin),
  await count(manager),
  await count(employee),
  await count(viewer),
];
check('admin sees all 2,500 Shakti leads', ca === 2500, String(ca));
check('manager sees team subset', cm > 0 && cm < ca, String(cm));
check('employee sees own subset', ce > 0 && ce < cm, String(ce));
check('viewer sees all (read-only)', cv === 2500, String(cv));

const page = await call('GET', '/api/v1/leads?limit=20&sort=valueInr&dir=desc', { token: admin });
check(
  'lead list parses',
  page.status === 200 && !parses(listPage, page.json),
  parses(listPage, page.json),
);
const leadId = page.json?.items?.[0]?.id;

const iso = await call('GET', `/api/v1/leads/${leadId}`, { token: other });
check('other tenant gets 404 on Shakti lead', iso.status === 404, String(iso.status));
const viewerCreate = await call('POST', '/api/v1/leads', {
  token: viewer,
  body: { name: 'Should fail' },
});
check('viewer cannot create lead (403)', viewerCreate.status === 403, String(viewerCreate.status));
const empRole = await call('POST', '/api/v1/roles', {
  token: employee,
  body: { name: 'X', kind: 'employee', dataScope: 'own', permissions: [] },
});
check('employee cannot create role (403)', empRole.status === 403, String(empRole.status));

const pipelines = await call('GET', '/api/v1/pipelines', { token: admin });
const pipelineId = pipelines.json?.items?.[0]?.id;
const board = await call('GET', `/api/v1/pipelines/${pipelineId}/board?perColumn=5`, {
  token: admin,
});
check(
  'board parses',
  board.status === 200 && !parses(S.BoardSchema, board.json),
  parses(S.BoardSchema, board.json),
);
const colSum = board.json?.columns?.reduce((a, c) => a + c.count, 0);
check('board counts sum to list total', colSum === ca, `${colSum} vs ${ca}`);

// New leads go to the top of their column (D-037).
const created = await call('POST', '/api/v1/leads', {
  token: admin,
  body: { name: 'Smoke Test Lead', valueInr: 1000 },
});
check(
  'create lead (201)',
  created.status === 201 && !parses(S.LeadSchema, created.json),
  `${created.status} ${parses(S.LeadSchema, created.json)}`,
);
const after = await call('GET', `/api/v1/pipelines/${pipelineId}/board?perColumn=1`, {
  token: admin,
});
const top = after.json?.columns?.find((c) => c.stage.id === created.json?.stageId)?.leads?.[0]?.id;
check('new lead is at the top of its column', top === created.json?.id);
if (created.json?.id) await call('DELETE', `/api/v1/leads/${created.json.id}`, { token: admin });

const dash = await call('GET', '/api/v1/dashboard/summary', { token: manager });
check(
  'dashboard summary parses',
  dash.status === 200 && !parses(S.DashboardSummarySchema, dash.json),
  parses(S.DashboardSummarySchema, dash.json),
);
const today = await call('GET', '/api/v1/me/today', { token: employee });
check(
  'me/today parses',
  today.status === 200 && !parses(S.MyTodaySchema, today.json),
  parses(S.MyTodaySchema, today.json),
);
const tasks = await call('GET', '/api/v1/tasks?scope=mine', { token: employee });
check(
  'tasks list parses',
  tasks.status === 200 && !parses(S.pageOf(S.TaskSchema), tasks.json),
  parses(S.pageOf(S.TaskSchema), tasks.json),
);
const settings = await call('PATCH', '/api/v1/me/settings', {
  token: viewer,
  body: { theme: { mode: 'dark' } },
});
check(
  'settings PATCH keeps leadsViewMode key',
  settings.status === 200 && 'leadsViewMode' in (settings.json ?? {}),
  String(settings.status),
);
await call('PATCH', '/api/v1/me/settings', { token: viewer, body: { theme: { mode: 'system' } } });

const superWithWorkspace = await call('GET', '/api/super/me', { token: admin });
check(
  'workspace token rejected by /api/super (401)',
  superWithWorkspace.status === 401,
  String(superWithWorkspace.status),
);
const superLogin = await call('POST', '/api/super/auth/login', {
  body: { email: 'owner@vistar.example', password: PASSWORD },
});
check(
  'super admin login returns 2FA challenge',
  superLogin.status === 200 &&
    superLogin.json?.challengeToken &&
    superLogin.json?.enrollmentRequired === true,
  String(superLogin.status),
);
const noAuth = await call('GET', '/api/v1/leads');
check(
  'no token -> 401 envelope',
  noAuth.status === 401 && S.isApiError(noAuth.json),
  String(noAuth.status),
);

const failed = results.filter((r) => !r.ok);
for (const r of results)
  console.info(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  (${r.detail})`}`);
console.info(`\n${results.length - failed.length}/${results.length} API checks passed`);
process.exit(failed.length ? 1 : 0);
