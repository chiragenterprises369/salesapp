import { parseSentryDsn, renderEmail, type ConfigTestResult, type RegistryGroupKey } from '@vistar/shared';
import { randomUUID } from 'node:crypto';
import { getEnv } from '../../config/env.js';
import { exotelTelephony } from '../integrations/providers/adapters.js';
import { createPlatformMailer, DevLogMailer, type Mailer } from '../mail/mailer.js';
import { StorageService } from '../storage/storage.service.js';
import { googleOAuthConfig, mailConfig, monitoringConfig, platformBranding, platformConfig, storageConfig, telephonyConfig, whatsappAppConfig } from './snapshot.js';

type Details = Record<string, string | number | boolean | null>;
const result = (ok: boolean, message: string, started: number, details: Details | null = null): ConfigTestResult => ({ ok, message, latencyMs: Date.now() - started, at: new Date().toISOString(), details });

/** Missing required fields of a group as a readable failure (tests run with the SAVED values). */
function missingResult(group: RegistryGroupKey, started: number): ConfigTestResult | null {
  const ev = platformConfig()[group].evaluation;
  return ev.status === 'missing' ? result(false, `Fill in first: ${ev.missing.join(', ')}`, started) : null;
}

async function testEmail(to: string, started: number): Promise<ConfigTestResult> {
  const cfg = mailConfig();
  const production = getEnv().NODE_ENV === 'production';
  const mailer: Mailer | null = createPlatformMailer(cfg) ?? (production ? null : new DevLogMailer({ name: platformBranding().productName, email: 'no-reply@vistar.local' }));
  if (!mailer) return missingResult('email', started) ?? result(false, 'Platform email is not configured', started);
  if (mailer.verify) {
    const v = await mailer.verify();
    if (!v.ok) return result(false, v.message, started, { provider: mailer.kind });
  }
  const b = platformBranding();
  const rendered = renderEmail(
    { subject: `Test e-mail from ${b.productName}`, html: `<p>This is a test e-mail from ${b.productName} Super Admin &gt; Config &gt; Platform email.</p><p>Invites, password resets and billing e-mails will be sent with these settings.</p>` },
    {},
    { brand: { name: b.productName, footerLines: b.emailFooter ? [b.emailFooter] : [] } },
  );
  const sent = await mailer.send({ to, subject: rendered.subject, html: rendered.html, text: rendered.text });
  const domain = to.split('@')[1] ?? '';
  return result(sent.ok, sent.ok ? `Test e-mail sent to ${to.slice(0, 1)}***@${domain} via ${sent.via}${cfg?.devDefault ? ' (development default: Mailpit)' : ''}` : sent.message, started, { provider: sent.via, messageId: sent.messageId });
}

async function testStorage(started: number): Promise<ConfigTestResult> {
  const cfg = storageConfig();
  if (!cfg) return missingResult('storage', started) ?? result(false, 'File storage is not configured', started);
  const probe = await StorageService.probe(cfg);
  return result(probe.ok, probe.message, started, { driver: cfg.driver });
}

/** Exchange a dummy code: Google answers invalid_client for wrong credentials and invalid_grant for good ones. */
async function testGoogle(started: number): Promise<ConfigTestResult> {
  const g = googleOAuthConfig();
  if (!g) return missingResult('google_oauth', started) ?? result(false, 'Client id and secret are required', started);
  const redirect = `${getEnv().API_PUBLIC_URL.replace(/\/+$/, '')}/api/oauth/google/callback`;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret, code: `vistar-config-test-${randomUUID()}`, grant_type: 'authorization_code', redirect_uri: redirect }).toString(),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === 'invalid_grant') return result(true, 'Google accepted the client id and secret', started, { redirectUri: redirect });
    if (body.error === 'redirect_uri_mismatch') return result(false, `Credentials work, but add ${redirect} to the authorised redirect URIs`, started, { redirectUri: redirect });
    if (body.error === 'invalid_client' || body.error === 'unauthorized_client') return result(false, 'Google rejected the client id or secret', started);
    return result(false, `Unexpected answer from Google (${body.error ?? `HTTP ${res.status}`})`, started);
  } catch {
    return result(false, 'Could not reach Google', started);
  }
}

/** App access token "appId|appSecret": Meta returns the app for a valid pair. */
async function testWhatsapp(started: number): Promise<ConfigTestResult> {
  const w = whatsappAppConfig();
  if (!w.appId || !w.appSecret) return missingResult('whatsapp_app', started) ?? result(false, 'App id and app secret are required', started);
  const base = getEnv().WHATSAPP_GRAPH_URL.replace(/\/+$/, '');
  try {
    const url = `${base}/${w.graphVersion}/${encodeURIComponent(w.appId)}?fields=id,name&access_token=${encodeURIComponent(`${w.appId}|${w.appSecret}`)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; error?: { message?: string } };
    if (res.status === 200 && body.id) return result(true, `Meta accepted the app secret for ${body.name ?? body.id}`, started, { appName: body.name ?? null, verifyTokenSet: !!w.verifyToken });
    return result(false, body.error?.message ? `Meta: ${body.error.message.slice(0, 200)}` : `Meta answered HTTP ${res.status}`, started);
  } catch {
    return result(false, 'Could not reach Meta', started);
  }
}

async function testTelephony(started: number): Promise<ConfigTestResult> {
  const t = telephonyConfig();
  if (!t) return missingResult('telephony', started) ?? result(false, 'Telephony is not configured (mock is not allowed in production)', started);
  if (t.provider === 'mock') return result(true, 'Mock telephony is ready (development only; calls are simulated)', started, { provider: 'mock' });
  const check = await exotelTelephony.check({ accountSid: t.accountSid, subdomain: t.subdomain }, { apiKey: t.apiKey, apiToken: t.apiToken });
  return result(check.ok, check.message, started, { provider: 'exotel' });
}

/** Sends one info event through the Sentry store endpoint (no SDK needed). */
async function testMonitoring(started: number): Promise<ConfigTestResult> {
  const m = monitoringConfig();
  if (!m.apiDsn) return missingResult('monitoring', started) ?? result(false, 'Add the API DSN', started);
  const dsn = parseSentryDsn(m.apiDsn);
  if (!dsn) return result(false, 'The API DSN is not a valid Sentry DSN (https://<key>@<host>/<project id>)', started);
  if (m.webDsn && !parseSentryDsn(m.webDsn)) return result(false, 'The web DSN is not a valid Sentry DSN', started);
  const eventId = randomUUID().replace(/-/g, '');
  try {
    const res = await fetch(`${dsn.protocol}://${dsn.host}/api/${dsn.projectId}/store/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=vistar-config/1.0` },
      body: JSON.stringify({ event_id: eventId, message: 'Vistar Super Admin > Config > Error monitoring test event', level: 'info', platform: 'node', environment: m.environment, timestamp: new Date().toISOString(), tags: { source: 'config-test' } }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (res.status === 200) return result(true, `Sentry accepted the test event (${eventId.slice(0, 8)})`, started, { eventId });
    if (res.status === 401 || res.status === 403) return result(false, 'Sentry rejected the DSN key', started);
    return result(false, `Sentry answered HTTP ${res.status}`, started);
  } catch {
    return result(false, `Could not reach ${dsn.host}`, started);
  }
}

/** Run the test of a registry group with its saved values. */
export async function runConfigTest(group: RegistryGroupKey, opts: { to: string }): Promise<ConfigTestResult> {
  const started = Date.now();
  switch (group) {
    case 'email':
      return testEmail(opts.to, started);
    case 'storage':
      return testStorage(started);
    case 'google_oauth':
      return testGoogle(started);
    case 'whatsapp_app':
      return testWhatsapp(started);
    case 'telephony':
      return testTelephony(started);
    case 'monitoring':
      return testMonitoring(started);
    default:
      return result(false, 'This group has no test', started);
  }
}
