import type { Integration, IntegrationProviderInfo } from '@vistar/shared';

/** One provider card: the workspace's row (GET /integrations) joined with its catalog entry. */
export interface IntegrationView {
  provider: Integration['provider'];
  row: Integration;
  info: IntegrationProviderInfo | null;
  name: string;
  /** Connected, failing or needing attention: there is something to manage or disconnect. */
  configured: boolean;
  /** Not usable here: plan without the feature, or a platform setting missing (Google OAuth client). */
  blockedReason: string | null;
  copyables: Array<{ key: string; label: string; value: string; hint: string }>;
}

const COPY_LABELS: Record<string, { label: string; hint: string }> = {
  pushUrl: { label: 'Push URL', hint: 'Paste into IndiaMART Lead Manager > Push API. It contains the push key, so keep it private.' },
  webhookUrl: { label: 'Callback URL', hint: 'Paste into Meta > WhatsApp > Configuration > Webhook.' },
  verifyToken: { label: 'Verify token', hint: 'Paste next to the callback URL in Meta. Vistar answers the verification challenge with it.' },
  callbackUrl: { label: 'Status callback URL', hint: 'Paste into your Exotel app so call results and recordings reach Vistar.' },
  oauthRedirectUri: { label: 'OAuth redirect URI', hint: 'Register this in the Google Cloud console for the OAuth client.' },
};

export function toIntegrationView(row: Integration, info: IntegrationProviderInfo | null): IntegrationView {
  const endpoints = row.endpoints ?? null;
  const copyables = endpoints
    ? (Object.keys(COPY_LABELS) as Array<keyof typeof endpoints>)
        .filter((k) => typeof endpoints[k] === 'string' && endpoints[k])
        // The push URL only matters with push on; the redirect URI is for platform admins setting up OAuth.
        .filter((k) => k !== 'oauthRedirectUri')
        .map((k) => ({ key: k, value: endpoints[k] as string, ...COPY_LABELS[k]! }))
    : [];
  const blockedReason = !row.enabled
    ? 'Your plan does not include this integration. Ask the account owner to upgrade.'
    : row.availability === 'not_configured'
      ? (row.availabilityNote ?? info?.availabilityNote ?? 'This integration is not set up on this Vistar server yet.')
      : null;
  return {
    provider: row.provider,
    row,
    info,
    name: info?.label ?? row.displayName,
    configured: row.status !== 'not_connected',
    blockedReason,
    copyables,
  };
}

export function integrationViews(items: readonly Integration[], catalog: readonly IntegrationProviderInfo[]): IntegrationView[] {
  return items.map((row) => toIntegrationView(row, catalog.find((c) => c.provider === row.provider) ?? null));
}
