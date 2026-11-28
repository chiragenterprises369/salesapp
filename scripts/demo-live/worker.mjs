/**
 * Live demo worker: keeps the Team Floor and the Leads board of a demo company busy around the clock.
 * Node port of scripts/demo-live.ps1 for an always-on host (Render Background Worker). Demo data only;
 * never point it at a workspace with real customer data.
 *
 * Every person of the team has their own day: desk work (presence heartbeats with the screen and lead they
 * have open), phone calls, breaks and lunch, meetings and field visits; back at the desk they clear a few
 * overdue follow-ups. The admin adds new IndiaMART, website and WhatsApp leads, moves leads along the
 * pipeline (sometimes to Won) and hands out leads that waited more than 3 minutes. The pace is calmer than
 * the PowerShell script so the database does not grow too fast when it runs for weeks.
 *
 * Run:  node scripts/demo-live/worker.mjs          (Node 20+, no dependencies)
 * Env:  DEMO_API_URL   API base with version (default: the demo API of demo.crm.tootodo.com; never production)
 *       DEMO_COMPANY   shakti | navkar | sunrise (default shakti)
 *       DEMO_PASSWORD  password of the demo accounts (default: the demo seed password, docs/DEMO.md)
 *       DEMO_HOURS     "always" (default), or office hours in India time such as "09:30-19:30" (Mon-Sat):
 *                      outside them everyone is offline and only an occasional enquiry comes in
 * Logs go to stdout. Sessions are kept alive with the refresh cookie, not a new password sign-in.
 */

const API = (process.env.DEMO_API_URL || 'https://salesapp-api-demo.onrender.com/api/v1').replace(/\/+$/, '');
const ORIGIN = API.replace(/\/api(\/v\d+)?$/, '');
const COMPANY = (process.env.DEMO_COMPANY || 'shakti').trim();
const PASSWORD = process.env.DEMO_PASSWORD || 'vistar-demo-123';
const HOURS = (process.env.DEMO_HOURS || 'always').trim();
const REFRESH_COOKIE = 'vistar_rt';
const TICK_MS = 4_000;

const COMPANIES = {
  shakti: { admin: 'anil', team: ['priya', 'gurpreet', 'rohit', 'kavita', 'farah', 'lakshmi', 'sneha', 'mohit', 'karthik', 'imran'] },
  navkar: { admin: 'jignesh', team: ['hetal', 'bhavin', 'komal', 'ravi'] },
  sunrise: { admin: 'senthil', team: ['revathi', 'arun', 'divya'] },
};
const SCREENS = ['leads', 'board', 'lead_detail', 'lead_detail', 'inbox', 'conversation', 'tasks', 'calls', 'home', 'reports'];
const BREAKS = [
  { status: 'on_break', note: 'Chai break' },
  { status: 'lunch' },
  { status: 'away', note: 'Back in 10 min' },
  { status: 'on_break' },
];
const MEETINGS = [
  { status: 'in_meeting', note: 'Client meeting, conference room' },
  { status: 'in_meeting', note: 'Weekly sales review' },
  { status: 'field_visit', note: 'Site visit, Andheri MIDC' },
  { status: 'field_visit', note: 'Dealer visit, Bhiwandi' },
  { status: 'in_meeting', note: 'Quotation discussion with buyer' },
];
const FIRST = ['Rajesh', 'Suresh', 'Amit', 'Neha', 'Pooja', 'Vikram', 'Sanjay', 'Kiran', 'Deepak', 'Anjali', 'Manoj', 'Ritu', 'Harish', 'Meena', 'Arvind', 'Swati', 'Nitin', 'Rekha'];
const LAST = ['Patel', 'Shah', 'Mehta', 'Gupta', 'Agarwal', 'Jain', 'Reddy', 'Nair', 'Iyer', 'Kulkarni', 'Deshmukh', 'Singh', 'Verma', 'Chopra'];
const FIRMS = ['Traders', 'Enterprises', 'Industries', 'Engineering Works', 'Fabricators', 'Infra Projects', 'Steel House', 'Hardware Mart'];
const CITIES = [['Pune', 'Maharashtra'], ['Ahmedabad', 'Gujarat'], ['Surat', 'Gujarat'], ['Nashik', 'Maharashtra'], ['Indore', 'Madhya Pradesh'], ['Jaipur', 'Rajasthan'], ['Coimbatore', 'Tamil Nadu'], ['Ludhiana', 'Punjab'], ['Hyderabad', 'Telangana'], ['Nagpur', 'Maharashtra']];
const PRODUCTS = ['SS pipe 2 inch, 500 m', 'MS angle 50x50, 3 tonnes', 'GI sheets 0.5 mm, 200 pcs', 'SS 304 sheets, 1 tonne', 'MS channel 100 mm, 2 tonnes', 'SS round bar 25 mm, 800 kg', 'GI pipe 1.5 inch, 300 m'];

// ---------------------------------------------------------------- helpers

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const secs = (min, max) => Date.now() + rand(min, max) * 1000;
const clock = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
const say = (message) => console.log(`${clock()} ${message}`);

/** Office hours in India time ("09:30-19:30", Mon-Sat), or null for "always". */
function parseHours(value) {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return { from: Number(m[1]) * 60 + Number(m[2]), to: Number(m[3]) * 60 + Number(m[4]) };
}
const OFFICE = HOURS === 'always' ? null : parseHours(HOURS);

function officeOpen(now = new Date()) {
  if (!OFFICE) return true;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  if (parts.weekday === 'Sun') return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= OFFICE.from && minutes < OFFICE.to;
}

let failStreak = 0;

async function http(method, path, { token, body, cookie, timeoutMs = 30_000 } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, setCookies: res.headers.getSetCookie?.() ?? [] };
}

const reason = (e) => (e?.name === 'TimeoutError' ? 'timeout' : e?.cause?.code || e?.message || String(e));

function refreshFrom(setCookies) {
  for (const c of setCookies) {
    const m = new RegExp(`^${REFRESH_COOKIE}=([^;]*)`).exec(c);
    if (m && m[1]) return m[1];
  }
  return null;
}

function sessionFrom(email, r, previous) {
  const ttl = Number(r.json?.expiresIn) || 900;
  return {
    email,
    token: r.json.accessToken,
    exp: Date.now() + Math.max(60, ttl - 120) * 1000,
    refresh: refreshFrom(r.setCookies) ?? previous?.refresh ?? null,
    userId: r.json?.me?.user?.id ?? previous?.userId ?? null,
  };
}

async function login(email) {
  try {
    const r = await http('POST', '/auth/login', { body: { email, password: PASSWORD }, timeoutMs: 90_000 });
    if (!r.ok || !r.json?.accessToken) {
      say(`login failed ${email}: ${r.status} ${r.json?.error?.code ?? ''}`.trim());
      return null;
    }
    failStreak = 0;
    return sessionFrom(email, r);
  } catch (e) {
    failStreak++;
    say(`login failed ${email}: ${reason(e)}`);
    return null;
  }
}

/** Refresh the access token before it expires (rotating refresh cookie); sign in again when the session ended. */
async function keepFresh(s) {
  if (Date.now() < s.exp) return;
  if (s.refresh) {
    try {
      const r = await http('POST', '/auth/refresh', { cookie: `${REFRESH_COOKIE}=${s.refresh}` });
      if (r.ok && r.json?.accessToken) {
        Object.assign(s, sessionFrom(s.email, r, s));
        return;
      }
      say(`session of ${s.email} ended (${r.status}), signing in again`);
    } catch (e) {
      failStreak++;
      say(`refresh failed ${s.email}: ${reason(e)}`);
      return; // network trouble: try again on a later tick
    }
  }
  const next = await login(s.email);
  if (next) Object.assign(s, next);
}

async function call(s, method, path, body) {
  try {
    const r = await http(method, path, { token: s.token, body });
    failStreak = 0;
    if (r.status === 401) s.exp = 0; // refresh on the next tick
    if (!r.ok) {
      say(`${method} ${path} failed: ${r.status} ${r.json?.error?.code ?? ''}`.trim());
      return null;
    }
    return r.json ?? {};
  } catch (e) {
    failStreak++;
    say(`${method} ${path} failed: ${reason(e)}`);
    return null;
  }
}

/** Block until the API answers /api/health (a deploy or a cold start can take a few minutes). */
async function waitForApi() {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${ORIGIN}/api/health`, { signal: AbortSignal.timeout(90_000) });
      if (res.status < 500) {
        if (attempt) say('API is answering again');
        failStreak = 0;
        return;
      }
    } catch {
      // not up yet
    }
    if (attempt === 0) say('API is not answering, waiting');
    await sleep(30_000);
  }
}

// ---------------------------------------------------------------- the office

const company = COMPANIES[COMPANY];
if (!company) {
  console.error(`Unknown DEMO_COMPANY "${COMPANY}" (use ${Object.keys(COMPANIES).join(', ')})`);
  process.exit(1);
}
const domain = `${COMPANY}.example`;
const adminEmail = `${company.admin}@${domain}`;
const teamEmails = company.team.map((name) => `${name}@${domain}`);
const people = [];
let admin = null;
let openStages = [];
let wonStage = null;
let nextBoard = secs(20, 40);
let nextAssign = secs(30, 60);
let nextNightLead = secs(1800, 3600);
let closed = false;

async function setStatus(p, s) {
  const body = { status: s.status };
  if (s.note) body.note = s.note;
  await call(p.session, 'PUT', '/me/status', body);
  say(`${p.email} -> ${s.status}${s.note ? ` (${s.note})` : ''}`);
}

async function beat(p) {
  const body = { client: 'web', activity: rand(1, 10) > 8 ? 'idle' : 'active', screen: pick(SCREENS) };
  if (p.leads.length && ['lead_detail', 'board', 'leads'].includes(body.screen)) body.currentLeadId = pick(p.leads).id;
  await call(p.session, 'POST', '/me/presence/heartbeat', body);
  p.nextBeat = Date.now() + 15_000;
}

async function startCall(p) {
  const lead = p.leads.length ? pick(p.leads) : null;
  const phone = lead?.phone || `+919${rand(100000000, 999999999)}`;
  p.callId = `demo-${crypto.randomUUID().replaceAll('-', '')}`;
  const body = { event: 'started', clientCallId: p.callId, direction: pick(['outbound', 'outbound', 'outbound', 'inbound']), phone, startedAt: new Date().toISOString() };
  if (lead) body.leadId = lead.id;
  const r = await call(p.session, 'POST', '/me/calls/active', body);
  if (r) say(`${p.email} calling ${lead ? lead.name : phone}`);
  else p.callId = null;
}

async function endCall(p) {
  if (p.callId) {
    await call(p.session, 'POST', '/me/calls/active', { event: 'ended', clientCallId: p.callId, endedAt: new Date().toISOString() });
    say(`${p.email} call ended`);
  }
  p.callId = null;
}

/**
 * Back at the desk people clear a few overdue follow-ups (one to three), so the "Needs you" list shrinks
 * through the day instead of emptying in one second.
 */
async function doTasks(p) {
  const overdue = await call(p.session, 'GET', '/tasks?scope=mine&due=overdue&limit=5');
  const items = (overdue?.items ?? []).slice(0, rand(1, 3));
  if (!items.length) return;
  say(`${p.email} clears ${items.length} overdue task(s)`);
  for (const t of items) {
    const r = await call(p.session, 'PATCH', `/tasks/${t.id}`, { status: 'done' });
    if (r) say(`${p.email} done: ${t.title}`);
  }
}

async function newLead(source) {
  const [city, state] = pick(CITIES);
  const name = `${pick(FIRST)} ${pick(LAST)}`;
  const lead = {
    name,
    companyName: `${pick(LAST)} ${pick(FIRMS)}`,
    phone: `+919${rand(100000000, 999999999)}`,
    city,
    state,
    source: source ?? pick(['indiamart', 'indiamart', 'website', 'whatsapp']),
    productInterest: pick(PRODUCTS),
    valueInr: rand(45, 900) * 1000,
  };
  const r = await call(admin, 'POST', '/leads', lead);
  if (r) say(`new lead ${name} (${lead.source})`);
}

async function moveLead() {
  const list = await call(admin, 'GET', '/leads?limit=40');
  const openIds = openStages.map((s) => s.id);
  const candidates = (list?.items ?? []).filter((l) => openIds.includes(l.stageId));
  if (!candidates.length) return;
  const lead = pick(candidates);
  const index = openIds.indexOf(lead.stageId);
  let target = null;
  if (wonStage && rand(1, 5) === 1) target = wonStage;
  else if (index < openStages.length - 1) target = openStages[index + 1];
  else target = wonStage;
  if (!target) return;
  const r = await call(admin, 'POST', `/leads/${lead.id}/move`, { stageId: target.id });
  if (r) say(`moved ${lead.name} -> ${target.name}`);
}

/** The manager hands out leads that waited more than 3 minutes (new ones still show as waiting for a while). */
async function assignWaiting() {
  const snapshot = await call(admin, 'GET', '/team-floor/snapshot');
  for (const w of snapshot?.leadsWaiting ?? []) {
    if (Date.now() - Date.parse(w.createdAt) < 3 * 60_000 || !people.length) continue;
    const to = pick(people);
    const r = await call(admin, 'PATCH', `/leads/${w.leadId}`, { ownerId: to.session.userId });
    if (r) say(`assigned ${w.name} -> ${to.email}`);
  }
}

async function personTick(p, counts) {
  const now = Date.now();
  if (now >= p.until) {
    if (p.state === 'call') {
      await endCall(p);
      p.state = 'desk';
      p.until = secs(30, 90);
      if (rand(1, 2) === 1) await doTasks(p);
    } else if (p.state === 'break' || p.state === 'meeting') {
      await call(p.session, 'PUT', '/me/status', { status: 'available' });
      say(`${p.email} back at desk`);
      p.state = 'desk';
      p.until = secs(45, 120);
      await doTasks(p);
    } else {
      const roll = rand(1, 100);
      if (roll <= 40 && counts.onCall < 3) {
        await startCall(p);
        if (p.callId) {
          p.state = 'call';
          counts.onCall++;
          p.until = secs(60, 240);
        } else p.until = secs(30, 60);
      } else if (roll <= 55 && counts.onBreak < 3) {
        await setStatus(p, pick(BREAKS));
        p.state = 'break';
        counts.onBreak++;
        p.until = secs(120, 420);
      } else if (roll <= 65) {
        await setStatus(p, pick(MEETINGS));
        p.state = 'meeting';
        p.until = secs(180, 600);
      } else p.until = secs(45, 150); // keeps working at the desk
    }
  }
  if (Date.now() >= p.nextBeat) await beat(p);
}

async function closeOffice() {
  say('office closed: everyone goes home');
  for (const p of people) {
    await endCall(p);
    await call(p.session, 'PUT', '/me/status', { status: 'offline' });
    p.state = 'home';
  }
  closed = true;
}

async function openOffice() {
  say('office open: everyone is back at the desk');
  for (const p of people) {
    await call(p.session, 'PUT', '/me/status', { status: 'available' });
    p.state = 'desk';
    p.until = secs(10, 90);
    p.nextBeat = Date.now();
  }
  closed = false;
}

async function tick() {
  if (failStreak >= 6) {
    say('API calls keep failing; pausing until it answers');
    await waitForApi();
  }
  for (const p of people) await keepFresh(p.session);
  if (admin) await keepFresh(admin);

  if (!officeOpen()) {
    if (!closed) await closeOffice();
    // an overnight enquiry now and then
    if (Date.now() >= nextNightLead) {
      await newLead('indiamart');
      nextNightLead = secs(1800, 3600);
    }
    return;
  }
  if (closed) await openOffice();

  const counts = { onCall: people.filter((p) => p.state === 'call').length, onBreak: people.filter((p) => p.state === 'break').length };
  for (const p of people) await personTick(p, counts);

  if (Date.now() >= nextAssign) {
    await assignWaiting();
    nextAssign = secs(55, 70);
  }
  if (Date.now() >= nextBoard && openStages.length) {
    if (rand(1, 100) <= 35) await newLead();
    else await moveLead();
    nextBoard = secs(90, 180);
  }
}

async function start() {
  say(`demo for ${COMPANY} on ${API} (hours: ${OFFICE ? `${HOURS} IST, Mon-Sat` : 'always'})`);
  await waitForApi();
  while (!(admin = await login(adminEmail))) await sleep(60_000);
  for (;;) {
    const pipelines = await call(admin, 'GET', '/pipelines');
    const pipe = (pipelines?.items ?? []).find((p) => p.isDefault && p.entity === 'lead');
    if (pipe) {
      const stages = pipe.stages ?? [];
      const closedKind = (s) => ['won', 'lost'].includes(s.key) || ['won', 'lost'].includes(s.type);
      openStages = stages.filter((s) => !closedKind(s));
      wonStage = stages.find((s) => s.key === 'won' || s.type === 'won') ?? null;
      say(`pipeline ${pipe.name}: ${stages.length} stages`);
      break;
    }
    say('default lead pipeline not found yet, retrying in a minute');
    await sleep(60_000);
  }
  for (const email of teamEmails) {
    await sleep(7_000); // the API allows about 20 sign-ins a minute per address
    const session = await login(email);
    if (!session) continue;
    const mine = await call(session, 'GET', '/leads?limit=30');
    const leads = (mine?.items ?? []).filter((l) => l.phone).map((l) => ({ id: l.id, name: l.name, phone: l.phone }));
    const p = { email, session, state: 'desk', until: secs(10, 60), callId: null, leads, nextBeat: Date.now() };
    people.push(p);
    if (officeOpen()) {
      await call(session, 'PUT', '/me/status', { status: 'available' });
      await beat(p);
    }
    say(`online ${email} (${leads.length} leads)`);
  }
  if (!people.length) say('no team member could sign in; only the admin is active');
  for (;;) {
    try {
      await tick();
    } catch (e) {
      say(`tick failed: ${reason(e)}`);
    }
    await sleep(TICK_MS);
  }
}

// A deploy or restart sends SIGTERM: leave the floor tidy (calls ended, people offline) when there is time.
let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  say(`${signal}: ending calls and signing everyone off`);
  const timer = setTimeout(() => process.exit(0), 8_000);
  try {
    for (const p of people) {
      await endCall(p);
      await call(p.session, 'PUT', '/me/status', { status: 'offline' });
    }
  } finally {
    clearTimeout(timer);
    process.exit(0);
  }
}
process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
