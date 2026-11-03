import { INTEGRATION_PROVIDERS, inboundWebhookPath, type Integration } from '@vistar/shared';
import { API_ORIGIN } from '@/lib/api/config';
import { providerMeta, type ProviderCopyable, type ProviderMeta } from './providers';

/**
 * One provider card: the API row (if any) joined with the catalog. The only place that reads the
 * Integration contract, so a contract change touches this file and not the screens.
 */
export interface IntegrationView {
  provider: string;
  meta: ProviderMeta;
  status: string;
  connected: boolean;
  /** Connected or failing: there is something to manage or disconnect. */
  configured: boolean;
  config: Record<string, unknown>;
  hasSecrets: boolean;
  secretPreviews: Record<string, string>;
  connectedAt: string | null;
  lastCheckedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  notConfiguredReason: string | null;
  copyables: ProviderCopyable[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function copyablesFor(meta: ProviderMeta, row: Integration | undefined, workspaceId: string): ProviderCopyable[] {
  const out = [...meta.copyables];
  const config = row?.config ?? {};
  if (meta.provider === 'indiamart') {
    const url = str(config.pushUrl) ?? `${API_ORIGIN}${inboundWebhookPath(workspaceId, 'indiamart')}`;
    out.push({ key: 'pushUrl', label: 'Push URL', value: url, hint: 'Give this to IndiaMART for push delivery (Lead Manager > Push API).' });
  }
  if (meta.provider === 'whatsapp_cloud') {
    const token = str(config.verifyToken);
    if (token) out.push({ key: 'verifyToken', label: 'Verify token', value: token, hint: 'Paste next to the callback URL in Meta. Vistar answers the verification challenge with it.' });
  }
  return out;
}

export function toIntegrationView(provider: string, row: Integration | undefined, workspaceId: string): IntegrationView {
  const meta = providerMeta(provider);
  const status = row?.status ?? 'not_connected';
  const config = row?.config ?? {};
  const previews = config.secretPreviews && typeof config.secretPreviews === 'object' ? (config.secretPreviews as Record<string, string>) : {};
  return {
    provider,
    meta: { ...meta, name: row?.displayName || meta.name },
    status: status === 'disconnected' ? 'not_connected' : status,
    connected: status === 'connected',
    configured: !!row && status !== 'disconnected' && status !== 'not_connected',
    config,
    hasSecrets: !!row?.hasSecrets,
    secretPreviews: previews,
    connectedAt: row?.connectedAt ?? null,
    lastCheckedAt: row?.lastCheckedAt ?? null,
    lastSyncAt: str(config.lastSyncAt),
    lastError: row?.lastError ?? null,
    notConfiguredReason: str(config.notConfiguredReason),
    copyables: copyablesFor(meta, row, workspaceId),
  };
}

/** Every known provider in catalog order, plus any extra provider the API reports. */
export function integrationViews(items: readonly Integration[], workspaceId: string): IntegrationView[] {
  const providers = [...INTEGRATION_PROVIDERS, ...items.map((i) => i.provider).filter((p) => !(INTEGRATION_PROVIDERS as readonly string[]).includes(p))];
  return providers.map((p) => toIntegrationView(p, items.find((i) => i.provider === p), workspaceId));
}
