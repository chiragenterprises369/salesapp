import { Injectable, Logger } from '@nestjs/common';
import {
  INTEGRATION_CATALOG,
  INTEGRATION_CONFIG_SCHEMAS,
  type Integration,
  type IntegrationConnect,
  type IntegrationOAuthStart,
  type IntegrationProvider,
  type IntegrationProviderInfo,
  type IntegrationSyncResult,
  type IntegrationTestRequest,
  type IntegrationTestResult,
} from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { randomToken } from '../../infra/crypto/secrets.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { KvStore } from '../auth/state/kv.store.js';
import { can, requestActor } from '../leads/lib/context.js';
import { IndiamartService } from './indiamart.service.js';
import { IntegrationStore, providerSyncHooks, type IntegrationRow, type IntegrationView } from './integration-store.js';
import { GOOGLE_SCOPES, googleCheck, googleClient, googleConfigured, smtpCheck, TELEPHONY_ADAPTERS, whatsappCheck, type ProviderCheck } from './providers/adapters.js';

const OAUTH_STATE_TTL_SEC = 600;
const oauthKey = (state: string) => `oauth:google:${state}`;
const WHATSAPP_VERIFY_HINT = 'Paste the callback URL and verify token into Meta (WhatsApp > Configuration) and click Verify and save';
const GOOGLE_SIGN_IN_HINT = 'Sign in with Google to finish connecting';

type Issue = { path: string; message: string };
const issuesOf = (prefix: string, err: z.ZodError): Issue[] => err.issues.map((i) => ({ path: [prefix, ...i.path.map(String)].join('.'), message: i.message }));

/**
 * Integration hub (SPEC 15.5, change #19 wave C, D-069): IndiaMART, WhatsApp Cloud API, telephony (mock, Exotel),
 * SMTP and Google Calendar behind adapters with a live and a dev mock mode. Secrets are validated per provider,
 * encrypted with ENCRYPTION_KEY, never returned (masked hints only) and never logged. Every change is audited.
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: IntegrationStore,
    private readonly indiamart: IndiamartService,
    private readonly audit: AuditService,
    private readonly kv: KvStore,
  ) {}

  private async view(auth: AuthContext): Promise<IntegrationView> {
    return { features: await this.store.features(auth.workspaceId), manage: can(auth, 'integrations.manage') };
  }

  private async dto(auth: AuthContext, provider: IntegrationProvider, row: IntegrationRow | null): Promise<Integration> {
    return this.store.toDtoOne(auth.workspaceId, provider, row, await this.view(auth));
  }

  async catalog(auth: AuthContext): Promise<{ items: IntegrationProviderInfo[] }> {
    const features = await this.store.features(auth.workspaceId);
    const google = googleConfigured();
    return {
      items: (Object.keys(INTEGRATION_CATALOG) as IntegrationProvider[]).map((p) => {
        const entry = INTEGRATION_CATALOG[p];
        const notConfigured = p === 'google_calendar' && !google;
        return {
          ...entry,
          availability: notConfigured ? 'not_configured' : 'ready',
          availabilityNote: notConfigured ? 'Google sign-in is not set up on this Vistar server (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET). Mock mode works in development.' : null,
          enabled: entry.featureFlag ? features[entry.featureFlag] : true,
        };
      }),
    };
  }

  async list(auth: AuthContext): Promise<{ items: Integration[] }> {
    const rows = await this.store.db(auth.workspaceId).integration.findMany({});
    return { items: await this.store.toDtos(auth.workspaceId, rows, await this.view(auth)) };
  }

  async get(auth: AuthContext, provider: IntegrationProvider): Promise<Integration> {
    return this.dto(auth, provider, await this.store.row(auth.workspaceId, provider));
  }

  private async requireConnected(auth: AuthContext, provider: IntegrationProvider): Promise<IntegrationRow> {
    const row = await this.store.row(auth.workspaceId, provider);
    if (!row || row.status === 'not_connected') throw new AppException('INTEGRATION_NOT_CONNECTED', `Connect ${INTEGRATION_CATALOG[provider].label} first`);
    return row;
  }

  // ---------------------------------------------------------------- connect

  async connect(auth: AuthContext, req: Request, provider: IntegrationProvider, body: IntegrationConnect): Promise<Integration> {
    const wid = auth.workspaceId;
    const env = getEnv();
    const entry = INTEGRATION_CATALOG[provider];
    const features = await this.store.features(wid);
    if (entry.featureFlag && !features[entry.featureFlag]) throw new AppException('FEATURE_DISABLED', `${entry.label} is not part of your plan`);
    if (body.mode === 'mock' && env.NODE_ENV === 'production') throw new AppException('INTEGRATION_NOT_CONFIGURED', 'Mock mode is only available in development');
    if (provider === 'google_calendar' && body.mode === 'live' && !googleConfigured()) {
      throw new AppException('INTEGRATION_NOT_CONFIGURED', 'Google sign-in is not set up on this server (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)');
    }
    // One provider's schemas; the union of the five object types is widened so .partial() / .shape type-check.
    const schemas = INTEGRATION_CONFIG_SCHEMAS[provider] as unknown as { config: z.ZodObject; secrets: z.ZodObject };
    const mock = body.mode === 'mock';
    const db = this.store.db(wid);
    const row = await this.store.row(wid, provider);

    // config (mock mode needs no credentials, so every field is optional there)
    const parsedConfig = (mock ? schemas.config.partial() : schemas.config).safeParse(body.config);
    const issues: Issue[] = parsedConfig.success ? [] : issuesOf('config', parsedConfig.error);
    const config: Record<string, unknown> = parsedConfig.success ? { ...(parsedConfig.data as Record<string, unknown>) } : {};
    if (provider === 'telephony') {
      if (mock) config.provider = 'mock';
      else if (config.provider !== 'exotel') issues.push({ path: 'config.provider', message: 'Live telephony supports exotel; use mock mode for the mock adapter' });
      else if (!config.accountSid) issues.push({ path: 'config.accountSid', message: 'Required' });
    }
    // keep values Vistar set itself (Google account e-mail)
    const previous = (row?.config ?? {}) as Record<string, unknown>;
    if (provider === 'google_calendar' && previous.accountEmail) config.accountEmail = previous.accountEmail;

    // secrets: omitted keys keep the stored value, "" removes it; Google tokens come from the OAuth callback only
    const secretKeys = new Set(Object.keys(schemas.secrets.shape));
    const stored = this.store.secretsOf(row);
    const merged: Record<string, string> = provider === 'google_calendar' ? { ...stored } : Object.fromEntries(Object.entries(stored).filter(([k]) => secretKeys.has(k)));
    const changedSecrets: string[] = [];
    if (provider !== 'google_calendar') {
      for (const [k, v] of Object.entries(body.secrets)) {
        if (!secretKeys.has(k)) {
          issues.push({ path: `secrets.${k}`, message: 'Unknown secret field' });
          continue;
        }
        if (v === '') delete merged[k];
        else merged[k] = v;
        changedSecrets.push(k);
      }
      if (!mock) {
        const s = schemas.secrets.safeParse(merged);
        if (!s.success) issues.push(...issuesOf('secrets', s.error));
      }
    }
    if (issues.length) throw new AppException('VALIDATION_FAILED', 'Some fields are invalid', { details: issues });

    if (provider === 'whatsapp_cloud' && !mock) {
      const taken = await this.prisma.integration.count({
        where: { provider: 'whatsapp_cloud', mode: 'live', status: { not: 'not_connected' }, workspaceId: { not: wid }, config: { path: ['phoneNumberId'], equals: String(config.phoneNumberId) } },
      });
      if (taken) throw new AppException('CONFLICT', 'This WhatsApp phone number ID is connected to another workspace');
    }

    const now = new Date();
    const { secretsEncrypted, secretHints } = this.store.encryptSecrets(merged);
    const inboundTokensEncrypted = this.store.ensureTokens(provider, this.store.tokensOf(row));
    const wasConnected = !!row && row.status !== 'not_connected';
    const googlePending = provider === 'google_calendar' && !mock && !merged.refreshToken;
    const pullEnabled = provider === 'indiamart' && config.pullEnabled !== false;
    const data = {
      displayName: body.displayName ?? row?.displayName ?? entry.label,
      mode: body.mode,
      config: config as Prisma.InputJsonObject,
      secretsEncrypted,
      secretHints: secretHints as Prisma.InputJsonObject,
      inboundTokensEncrypted,
      status: googlePending ? ('needs_attention' as const) : ('connected' as const),
      attention: googlePending ? GOOGLE_SIGN_IN_HINT : provider === 'whatsapp_cloud' && !mock && !(row?.syncState as { webhookVerifiedAt?: string } | null)?.webhookVerifiedAt ? WHATSAPP_VERIFY_HINT : null,
      lastError: null,
      connectedAt: wasConnected ? row.connectedAt : now,
      connectedById: wasConnected ? row.connectedById : auth.userId,
      nextSyncAt: provider === 'indiamart' ? (pullEnabled ? now : null) : null,
      // a mode switch starts the IndiaMART window again
      ...(row && row.mode !== body.mode ? { syncState: {} } : {}),
    };
    let saved = row ? await db.integration.update({ where: { id: row.id }, data }) : await db.integration.create({ data: { workspaceId: wid, provider, ...data } });

    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, {
      action: wasConnected ? 'integration.update' : 'integration.connect',
      entityType: 'integration',
      entityId: saved.id,
      diff: { provider, mode: body.mode, configKeys: Object.keys(config), secretFieldsChanged: changedSecrets },
    }, actor.summary?.name);

    if (body.test && !googlePending) {
      try {
        const result = await this.runTest(auth, saved, { to: undefined });
        saved = result.row;
      } catch (err) {
        // e.g. IndiaMART pulled less than 5 minutes ago: keep the saved state, the admin can test later
        if (!(err instanceof AppException)) throw err;
      }
    }
    await this.store.publish(wid, saved, provider, actor.event);
    return this.dto(auth, provider, saved);
  }

  // ---------------------------------------------------------------- test and sync

  private async runTest(auth: AuthContext, row: IntegrationRow, body: IntegrationTestRequest): Promise<{ row: IntegrationRow; check: ProviderCheck }> {
    const db = this.store.db(auth.workspaceId);
    const mock = row.mode === 'mock';
    const config = (row.config ?? {}) as Record<string, unknown>;
    const secrets = this.store.secretsOf(row);
    let check: ProviderCheck;
    switch (row.provider) {
      case 'indiamart': {
        const started = Date.now();
        const out = await this.indiamart.pull(auth.workspaceId, true);
        if (!out) throw new AppException('CONFLICT', 'A pull is already running');
        return { row: out.row, check: { ok: out.ok, message: out.message, latencyMs: Date.now() - started } };
      }
      case 'whatsapp_cloud': {
        check = await whatsappCheck(config, secrets, mock);
        const verified = !!(row.syncState as { webhookVerifiedAt?: string } | null)?.webhookVerifiedAt;
        if (check.ok && !mock && !verified) check = { ...check, attention: WHATSAPP_VERIFY_HINT };
        break;
      }
      case 'telephony':
        check = await TELEPHONY_ADAPTERS[mock ? 'mock' : 'exotel'].check(config, secrets);
        break;
      case 'smtp': {
        let to = body.to;
        if (!to && auth.userId) to = (await db.user.findFirst({ where: { id: auth.userId }, select: { email: true } }))?.email;
        if (!to) throw new AppException('VALIDATION_FAILED', 'Give an address for the test e-mail', { details: [{ path: 'to', message: 'Required' }] });
        check = await smtpCheck(config, secrets, mock, to);
        break;
      }
      case 'google_calendar':
        check = await googleCheck(secrets, mock);
        break;
      default:
        throw new AppException('VALIDATION_FAILED', 'Unknown provider');
    }
    const updated = await this.store.applyCheck(db, row, check);
    return { row: updated, check };
  }

  async test(auth: AuthContext, provider: IntegrationProvider, body: IntegrationTestRequest): Promise<IntegrationTestResult> {
    const row = await this.requireConnected(auth, provider);
    const { row: updated, check } = await this.runTest(auth, row, body);
    const actor = await requestActor(this.store.db(auth.workspaceId), auth);
    await this.store.publish(auth.workspaceId, updated, provider, actor.event);
    return { ok: check.ok, message: check.message, latencyMs: check.latencyMs, integration: await this.dto(auth, provider, updated) };
  }

  async sync(auth: AuthContext, provider: IntegrationProvider): Promise<IntegrationSyncResult> {
    const row = await this.requireConnected(auth, provider);
    if (!INTEGRATION_CATALOG[provider].capabilities.sync) throw new AppException('VALIDATION_FAILED', `${INTEGRATION_CATALOG[provider].label} has nothing to sync`);
    const actor = await requestActor(this.store.db(auth.workspaceId), auth);
    if (provider === 'indiamart') {
      const out = await this.indiamart.pull(auth.workspaceId, true);
      if (!out) throw new AppException('CONFLICT', 'A pull is already running');
      return {
        ok: out.ok,
        message: out.message,
        fetched: out.fetched,
        created: out.created,
        updated: 0,
        skipped: out.skipped,
        windowStart: out.windowStart?.toISOString() ?? null,
        windowEnd: out.windowEnd?.toISOString() ?? null,
        integration: await this.dto(auth, provider, out.row),
      };
    }
    const { row: tested, check } = await this.runTest(auth, row, {});
    // ---- change #20: prod (Google Calendar: pull the changes now)
    const hook = providerSyncHooks[provider];
    const pulled = hook && check.ok && row.mode === 'live' ? await hook(auth.workspaceId).catch(() => null) : null;
    // ---- end change #20: prod
    const updated = await this.store.db(auth.workspaceId).integration.update({ where: { id: tested.id }, data: { lastSyncAt: new Date() } });
    await this.store.publish(auth.workspaceId, updated, provider, actor.event);
    return { ok: check.ok, message: pulled ? `${check.message}; ${pulled.applied} of ${pulled.pulled} changed events applied` : check.message, fetched: pulled?.pulled ?? 0, created: 0, updated: pulled?.applied ?? 0, skipped: 0, windowStart: null, windowEnd: null, integration: await this.dto(auth, provider, updated) };
  }

  // ---------------------------------------------------------------- disconnect, tokens

  async disconnect(auth: AuthContext, req: Request, provider: IntegrationProvider): Promise<Integration> {
    const db = this.store.db(auth.workspaceId);
    const row = await this.store.row(auth.workspaceId, provider);
    if (!row) return this.dto(auth, provider, null);
    if (provider === 'google_calendar' && row.mode === 'live' && googleConfigured()) {
      const token = this.store.secretsOf(row).refreshToken;
      if (token) await googleClient().revokeToken(token).catch(() => undefined);
    }
    const updated = await db.integration.update({
      where: { id: row.id },
      data: { status: 'not_connected', secretsEncrypted: null, secretHints: {}, inboundTokensEncrypted: null, lastError: null, attention: null, connectedAt: null, connectedById: null, nextSyncAt: null, syncState: {}, syncLockedUntil: null, stats: {} },
    });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'integration.disconnect', entityType: 'integration', entityId: row.id, diff: { provider } }, actor.summary?.name);
    await this.store.publish(auth.workspaceId, updated, provider, actor.event);
    return this.dto(auth, provider, updated);
  }

  async rotateToken(auth: AuthContext, req: Request, provider: IntegrationProvider): Promise<Integration> {
    if (!['indiamart', 'whatsapp_cloud', 'telephony'].includes(provider)) throw new AppException('VALIDATION_FAILED', 'This provider has no Vistar token');
    const row = await this.requireConnected(auth, provider);
    const db = this.store.db(auth.workspaceId);
    const updated = await db.integration.update({ where: { id: row.id }, data: { inboundTokensEncrypted: this.store.ensureTokens(provider, this.store.tokensOf(row), true) } });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'integration.rotate_token', entityType: 'integration', entityId: row.id, diff: { provider } }, actor.summary?.name);
    return this.dto(auth, provider, updated);
  }

  // ---------------------------------------------------------------- Google OAuth

  async oauthStart(auth: AuthContext, provider: IntegrationProvider): Promise<IntegrationOAuthStart> {
    if (provider !== 'google_calendar') throw new AppException('VALIDATION_FAILED', 'Only Google Calendar connects with a sign-in');
    if (!googleConfigured()) throw new AppException('INTEGRATION_NOT_CONFIGURED', 'Google sign-in is not set up on this server (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)');
    if (!auth.userId) throw new AppException('FORBIDDEN', 'Sign in as a user to connect Google');
    const db = this.store.db(auth.workspaceId);
    const row = await this.store.row(auth.workspaceId, provider);
    if (!row) {
      await db.integration.create({ data: { workspaceId: auth.workspaceId, provider, displayName: INTEGRATION_CATALOG[provider].label, mode: 'live', status: 'needs_attention', attention: GOOGLE_SIGN_IN_HINT, config: { calendarId: 'primary', pushMeetings: true }, connectedById: auth.userId } });
    }
    const state = randomToken(24);
    await this.kv.set(oauthKey(state), JSON.stringify({ workspaceId: auth.workspaceId, userId: auth.userId }), OAUTH_STATE_TTL_SEC);
    const authUrl = googleClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', include_granted_scopes: true, scope: GOOGLE_SCOPES, state });
    return { authUrl, expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_SEC * 1000).toISOString() };
  }

  /** Google redirect: single-use state, code exchange, tokens stored encrypted. Returns the web URL to redirect to. */
  async oauthCallback(q: { code?: string; state: string; error?: string }): Promise<string> {
    const web = `${getEnv().WEB_ORIGIN.replace(/\/$/, '')}/app/integrations?provider=google_calendar`;
    const back = (result: 'connected' | 'error', message?: string) => `${web}&result=${result}${message ? `&message=${encodeURIComponent(message)}` : ''}`;
    const raw = await this.kv.get(oauthKey(q.state));
    await this.kv.del(oauthKey(q.state));
    if (!raw) return back('error', 'The sign-in link expired. Try again');
    const { workspaceId, userId } = JSON.parse(raw) as { workspaceId: string; userId: string };
    if (q.error || !q.code) return back('error', q.error === 'access_denied' ? 'Google access was not allowed' : 'Google sign-in failed');
    const db = this.store.db(workspaceId);
    const row = await db.integration.findFirst({ where: { provider: 'google_calendar' } });
    if (!row) return back('error', 'Start the connection again');
    try {
      const client = googleClient();
      const { tokens } = await client.getToken(q.code);
      let email: string | null = null;
      if (tokens.id_token) {
        const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: getEnv().GOOGLE_CLIENT_ID });
        email = ticket.getPayload()?.email ?? null;
      }
      const previous = this.store.secretsOf(row);
      const secrets: Record<string, string> = {
        ...(previous.refreshToken ? { refreshToken: previous.refreshToken } : {}),
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        ...(tokens.access_token ? { accessToken: tokens.access_token } : {}),
        ...(tokens.expiry_date ? { expiryDate: String(tokens.expiry_date) } : {}),
        ...(tokens.scope ? { scope: tokens.scope } : {}),
      };
      if (!secrets.refreshToken) return back('error', 'Google did not return offline access. Remove Vistar from your Google account permissions and try again');
      const { secretsEncrypted } = this.store.encryptSecrets(secrets);
      const config = { ...((row.config ?? {}) as Record<string, unknown>), ...(email ? { accountEmail: email } : {}) };
      const updated = await db.integration.update({
        where: { id: row.id },
        data: { mode: 'live', status: 'connected', attention: null, lastError: null, secretsEncrypted, secretHints: {}, config: config as Prisma.InputJsonObject, connectedAt: new Date(), connectedById: userId, lastCheckedAt: new Date() },
      });
      await this.audit.system(workspaceId, { action: 'integration.connect', entityType: 'integration', entityId: row.id, diff: { provider: 'google_calendar', byUserId: userId } });
      await this.store.publish(workspaceId, updated, 'google_calendar');
      return back('connected');
    } catch (err) {
      this.logger.warn(`Google OAuth exchange failed: ${(err as Error).name}`);
      await db.integration.update({ where: { id: row.id }, data: { status: 'error', lastError: 'Google sign-in failed', lastCheckedAt: new Date() } });
      return back('error', 'Google sign-in failed');
    }
  }
}
