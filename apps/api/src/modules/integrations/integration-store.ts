import { Injectable, Logger } from '@nestjs/common';
import {
  GOOGLE_OAUTH_CALLBACK_PATH,
  INTEGRATION_CATALOG,
  indiamartPushPath,
  telephonyWebhookPath,
  whatsappWebhookPath,
  type FeatureFlags,
  type Integration,
  type IntegrationProvider,
  type IntegrationStatus,
} from '@vistar/shared';
import { getEnv } from '../../config/env.js';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import type { Integration as IntegrationRow, Prisma } from '../../generated/prisma/client.js';
import { decryptSecret, encryptSecret, randomToken } from '../../infra/crypto/secrets.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { publishSafe, SYSTEM_ACTOR, type TenantDb } from '../leads/lib/context.js';
import { WorkspaceService } from '../workspace/workspace.service.js';
import type { ProviderCheck } from './providers/adapters.js';
import { googleConfigured } from './providers/adapters.js';

export type { IntegrationRow };

/** Tokens Vistar generates for a provider to call us (encrypted in Integration.inboundTokensEncrypted). */
export interface InboundTokens {
  pushKey?: string;
  verifyToken?: string;
  callbackToken?: string;
}

const TOKEN_KIND: Partial<Record<IntegrationProvider, keyof InboundTokens>> = { indiamart: 'pushKey', whatsapp_cloud: 'verifyToken', telephony: 'callbackToken' };
const TOKEN_PREFIX: Record<keyof InboundTokens, string> = { pushKey: 'im_', verifyToken: 'wa_', callbackToken: 'tel_' };

/** "abcdefgh1234" -> "••••1234" (short values only show the bullets). */
export const maskHint = (v: string) => (v.length >= 8 ? `••••${v.slice(-4)}` : '••••');

// ---- change #20: prod
/**
 * "Sync now" handlers registered by modules that cannot be imported here without a cycle (Google Calendar sync
 * registers itself on start). Returns what was pulled and applied.
 */
export const providerSyncHooks: Partial<Record<IntegrationProvider, (workspaceId: string) => Promise<{ pulled: number; applied: number }>>> = {};
// ---- end change #20: prod

export interface IntegrationView {
  features: FeatureFlags;
  /** integrations.manage: include endpoints (push URL with key, verify token, callback token). */
  manage: boolean;
}

/**
 * Integration rows: decrypt / encrypt secrets and inbound tokens, map to the IntegrationSchema DTO (all five
 * providers, never-connected ones as placeholders), apply check results and publish integration.updated
 * (the event never carries endpoints: its audience includes read-only users).
 */
@Injectable()
export class IntegrationStore {
  private readonly logger = new Logger(IntegrationStore.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly workspaces: WorkspaceService,
  ) {}

  db(workspaceId: string) {
    return this.prisma.forTenant(workspaceId);
  }

  async row(workspaceId: string, provider: IntegrationProvider): Promise<IntegrationRow | null> {
    return this.db(workspaceId).integration.findFirst({ where: { provider } });
  }

  async features(workspaceId: string): Promise<FeatureFlags> {
    const db = this.db(workspaceId);
    const ws = await db.workspace.findFirst({ select: { plan: true } });
    return this.workspaces.features(db, ws?.plan ?? 'free');
  }

  secretsOf(row: Pick<IntegrationRow, 'secretsEncrypted'> | null): Record<string, string> {
    if (!row?.secretsEncrypted) return {};
    try {
      return JSON.parse(decryptSecret(row.secretsEncrypted)) as Record<string, string>;
    } catch {
      this.logger.warn('Integration secrets could not be decrypted (ENCRYPTION_KEY changed?)');
      return {};
    }
  }

  tokensOf(row: Pick<IntegrationRow, 'inboundTokensEncrypted'> | null): InboundTokens {
    if (!row?.inboundTokensEncrypted) return {};
    try {
      return JSON.parse(decryptSecret(row.inboundTokensEncrypted)) as InboundTokens;
    } catch {
      return {};
    }
  }

  encryptSecrets(secrets: Record<string, string>): { secretsEncrypted: string | null; secretHints: Record<string, string> } {
    const keys = Object.keys(secrets).filter((k) => secrets[k] !== '');
    if (!keys.length) return { secretsEncrypted: null, secretHints: {} };
    const clean = Object.fromEntries(keys.map((k) => [k, secrets[k]!]));
    // OAuth tokens are internal: no hint for them.
    const hints = Object.fromEntries(keys.filter((k) => !['refreshToken', 'accessToken', 'expiryDate', 'scope'].includes(k)).map((k) => [k, maskHint(clean[k]!)]));
    return { secretsEncrypted: encryptSecret(JSON.stringify(clean)), secretHints: hints };
  }

  /** Make sure the provider's inbound token exists (rotate = new one). Returns the encrypted JSON or null. */
  ensureTokens(provider: IntegrationProvider, current: InboundTokens, rotate = false): string | null {
    const kind = TOKEN_KIND[provider];
    if (!kind) return null;
    const next: InboundTokens = { ...current };
    if (rotate || !next[kind]) next[kind] = `${TOKEN_PREFIX[kind]}${randomToken(24)}`;
    return encryptSecret(JSON.stringify(next));
  }

  async toDtos(workspaceId: string, rows: IntegrationRow[], view: IntegrationView): Promise<Integration[]> {
    const db = this.db(workspaceId);
    const userIds = [...new Set(rows.map((r) => r.connectedById).filter((x): x is string => !!x))];
    const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: USER_SUMMARY_SELECT }) : [];
    const userBy = new Map(users.map((u) => [u.id, toUserSummary(u)]));
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    return (Object.keys(INTEGRATION_CATALOG) as IntegrationProvider[]).map((p) => this.toDto(workspaceId, p, byProvider.get(p) ?? null, view, userBy));
  }

  async toDtoOne(workspaceId: string, provider: IntegrationProvider, row: IntegrationRow | null, view: IntegrationView): Promise<Integration> {
    const [dto] = (await this.toDtos(workspaceId, row ? [row] : [], view)).filter((d) => d.provider === provider);
    return dto!;
  }

  toDto(workspaceId: string, provider: IntegrationProvider, row: IntegrationRow | null, view: IntegrationView, userBy: Map<string, ReturnType<typeof toUserSummary>> = new Map()): Integration {
    const env = getEnv();
    const api = env.API_PUBLIC_URL.replace(/\/$/, '');
    const entry = INTEGRATION_CATALOG[provider];
    const notConfigured = provider === 'google_calendar' && !googleConfigured();
    const connected = !!row && row.status !== 'not_connected';
    const tokens = view.manage && row ? this.tokensOf(row) : {};
    const config = (row?.config ?? {}) as Record<string, unknown>;
    const telephonyPath = row?.mode === 'mock' ? 'mock' : String(config.provider ?? 'exotel');
    const endpoints = view.manage
      ? {
          pushUrl: provider === 'indiamart' && connected && tokens.pushKey ? `${api}${indiamartPushPath(workspaceId)}?key=${encodeURIComponent(tokens.pushKey)}` : null,
          webhookUrl: provider === 'whatsapp_cloud' && connected ? `${api}${whatsappWebhookPath(workspaceId)}` : null,
          verifyToken: provider === 'whatsapp_cloud' && connected ? (tokens.verifyToken ?? null) : null,
          callbackUrl: provider === 'telephony' && connected && tokens.callbackToken ? `${api}${telephonyWebhookPath(workspaceId, telephonyPath)}?token=${encodeURIComponent(tokens.callbackToken)}` : null,
          oauthRedirectUri: provider === 'google_calendar' ? `${api}${GOOGLE_OAUTH_CALLBACK_PATH}` : null,
        }
      : null;
    return {
      id: row?.id ?? null,
      provider,
      status: row?.status ?? 'not_connected',
      mode: row?.mode ?? 'live',
      displayName: row?.displayName ?? entry.label,
      config,
      hasSecrets: !!row?.secretsEncrypted,
      secretHints: (row?.secretHints ?? {}) as Record<string, string>,
      lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
      lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
      nextSyncAt: row?.nextSyncAt?.toISOString() ?? null,
      attention: row?.attention ?? null,
      connectedAt: row?.connectedAt?.toISOString() ?? null,
      connectedBy: row?.connectedById ? (userBy.get(row.connectedById) ?? null) : null,
      endpoints,
      stats: (row?.stats ?? {}) as Record<string, number | string | null>,
      availability: notConfigured ? 'not_configured' : 'ready',
      availabilityNote: notConfigured ? 'Google sign-in is not set up on this Vistar server (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET). Mock mode works in development.' : null,
      enabled: entry.featureFlag ? view.features[entry.featureFlag] : true,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  /** Status after a check: ok -> connected (or needs_attention with a reason), not ok -> error (or needs_attention). */
  static statusFor(check: ProviderCheck): IntegrationStatus {
    if (check.ok) return check.attention ? 'needs_attention' : 'connected';
    return check.attention ? 'needs_attention' : 'error';
  }

  async applyCheck(db: TenantDb, row: IntegrationRow, check: ProviderCheck, extra: Prisma.IntegrationUncheckedUpdateInput = {}): Promise<IntegrationRow> {
    const stats = { ...((row.stats ?? {}) as Record<string, unknown>), ...(check.stats ?? {}) };
    return db.integration.update({
      where: { id: row.id },
      data: {
        status: IntegrationStore.statusFor(check),
        lastCheckedAt: new Date(),
        lastError: check.ok ? null : check.message.slice(0, 500),
        attention: check.attention ?? null,
        stats: stats as Prisma.InputJsonObject,
        ...(check.config ? { config: { ...((row.config ?? {}) as Record<string, unknown>), ...check.config } as Prisma.InputJsonObject } : {}),
        ...extra,
      },
    });
  }

  /** integration.updated for everyone with integrations.read (no endpoints in the event). */
  async publish(workspaceId: string, row: IntegrationRow | null, provider: IntegrationProvider, actor = SYSTEM_ACTOR): Promise<void> {
    const features = await this.features(workspaceId);
    const integration = await this.toDtoOne(workspaceId, provider, row, { features, manage: false });
    await publishSafe(this.events, this.logger, 'integration.updated', workspaceId, { integration }, { actor });
  }
}
