/**
 * Integration hub catalog (change #19 wave C, D-069): connect form fields, setup steps and capabilities per
 * provider. Static; the API adds availability (platform env) and enabled (plan feature) per request in
 * GET /integrations/catalog. Field keys equal the keys of INTEGRATION_CONFIG_SCHEMAS[provider].config / .secrets.
 */
import type { IntegrationProvider } from './enums.js';
import { API_KEY_SCOPES, type ApiKeyScope } from './rbac.js';
import type { ApiKeyScopeOption, IntegrationField, IntegrationProviderInfo } from './schemas/integration.js';

type CatalogEntry = Omit<IntegrationProviderInfo, 'availability' | 'availabilityNote' | 'enabled'>;

const field = (f: Partial<IntegrationField> & Pick<IntegrationField, 'key' | 'label' | 'type'>): IntegrationField => ({
  secret: false,
  required: false,
  placeholder: null,
  help: null,
  options: null,
  default: null,
  showIf: null,
  ...f,
});

export const INTEGRATION_CATALOG: Record<IntegrationProvider, CatalogEntry> = {
  indiamart: {
    provider: 'indiamart',
    label: 'IndiaMART Lead Manager',
    description: 'Bring IndiaMART enquiries (direct, buy-leads, PNS calls, WhatsApp) in as routed leads. Pull every few minutes, or let IndiaMART push each new lead.',
    category: 'leads',
    featureFlag: null,
    fields: [
      field({ key: 'crmKey', label: 'Pull API key', type: 'password', secret: true, required: true, placeholder: 'glusr_crm_key', help: 'Lead Manager > Import/Export Leads > Pull API > Generate Key. The key expires after 7 days without use.' }),
      field({ key: 'pullEnabled', label: 'Pull new leads automatically', type: 'boolean', default: true }),
      field({ key: 'pullIntervalMin', label: 'Pull every (minutes)', type: 'number', default: 15, help: 'IndiaMART allows one pull per 5 minutes; 10 to 15 is recommended.', showIf: { key: 'pullEnabled', equals: true } }),
      field({ key: 'pushEnabled', label: 'Accept push (real time)', type: 'boolean', default: false, help: 'Paste the push URL below into Lead Manager > Push API.' }),
      field({ key: 'tags', label: 'Tags for IndiaMART leads', type: 'tags', default: [] }),
    ],
    setupSteps: [
      'Sign in to seller.indiamart.com and open Lead Manager.',
      'Open the menu (three dots) > Import/Export Leads > Pull API and click Generate Key.',
      'Paste the key here and save. Vistar tests it and pulls the last 24 hours.',
      'Optional: turn on push and paste the push URL into Push API so leads arrive within seconds.',
      'Each enquiry becomes a lead with source IndiaMART; repeats of the same UNIQUE_QUERY_ID are skipped and lead routing picks the owner.',
    ],
    capabilities: { test: true, sync: true, push: true, oauth: false, mock: true },
    docsUrl: 'https://help.indiamart.com/knowledge-base/lms-crm-integration-v2/',
  },
  whatsapp_cloud: {
    provider: 'whatsapp_cloud',
    label: 'WhatsApp Cloud API',
    description: 'Receive WhatsApp messages and delivery statuses in the Inbox (24-hour reply window) from your own Meta app and number.',
    category: 'messaging',
    featureFlag: 'whatsapp',
    fields: [
      field({ key: 'phoneNumberId', label: 'Phone number ID', type: 'text', required: true, placeholder: '1234567890123456', help: 'Meta app > WhatsApp > API setup' }),
      field({ key: 'wabaId', label: 'WhatsApp Business Account ID', type: 'text', placeholder: '1029384756' }),
      field({ key: 'displayPhoneNumber', label: 'Business number', type: 'text', placeholder: '+91 98765 43210' }),
      field({ key: 'accessToken', label: 'Access token', type: 'password', secret: true, required: true, help: 'A permanent system user token with whatsapp_business_messaging' }),
      field({ key: 'appSecret', label: 'App secret', type: 'password', secret: true, required: true, help: 'Meta app > App settings > Basic. Used to check X-Hub-Signature-256' }),
    ],
    setupSteps: [
      'In developers.facebook.com create (or open) your Business app with the WhatsApp product.',
      'Copy the phone number ID and WhatsApp Business Account ID from WhatsApp > API setup.',
      'Create a system user with a permanent token (whatsapp_business_messaging, whatsapp_business_management) and copy the app secret.',
      'Save here. Then in WhatsApp > Configuration paste the callback URL and verify token shown below and click Verify and save.',
      'Subscribe the webhook fields messages (and message_status if listed). The card turns green after Meta verifies the URL.',
    ],
    capabilities: { test: true, sync: true, push: true, oauth: false, mock: true },
    docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks',
  },
  telephony: {
    provider: 'telephony',
    label: 'Cloud telephony',
    description: 'Click-to-call and call records through a telephony provider. Exotel is supported; the mock adapter simulates calls in development.',
    category: 'calls',
    featureFlag: 'telephony',
    fields: [
      field({ key: 'provider', label: 'Provider', type: 'select', required: true, options: [{ value: 'exotel', label: 'Exotel' }], default: 'exotel' }),
      field({ key: 'accountSid', label: 'Account SID', type: 'text', required: true, showIf: { key: 'provider', equals: 'exotel' } }),
      field({ key: 'subdomain', label: 'API region', type: 'select', options: [{ value: 'api.in.exotel.com', label: 'Mumbai (api.in.exotel.com)' }, { value: 'api.exotel.com', label: 'Singapore (api.exotel.com)' }], default: 'api.in.exotel.com', showIf: { key: 'provider', equals: 'exotel' } }),
      field({ key: 'callerId', label: 'ExoPhone (caller ID)', type: 'text', placeholder: '08047XXXXXX', showIf: { key: 'provider', equals: 'exotel' } }),
      field({ key: 'recordCalls', label: 'Record calls', type: 'boolean', default: true }),
      field({ key: 'apiKey', label: 'API key', type: 'password', secret: true, required: true, showIf: { key: 'provider', equals: 'exotel' } }),
      field({ key: 'apiToken', label: 'API token', type: 'password', secret: true, required: true, showIf: { key: 'provider', equals: 'exotel' } }),
    ],
    setupSteps: [
      'In the Exotel dashboard open Settings > API and copy the account SID, API key and API token.',
      'Pick the region your account lives in and the ExoPhone to show to customers.',
      'Save here; Vistar checks the credentials.',
      'Paste the status callback URL shown below into the Exotel app (Passthru / status callback) so call results reach Vistar.',
    ],
    capabilities: { test: true, sync: false, push: true, oauth: false, mock: true },
    docsUrl: 'https://developer.exotel.com/api',
  },
  smtp: {
    provider: 'smtp',
    label: 'Email (SMTP)',
    description: 'Send quotations, invoices and workflow e-mails from your own mailbox (Zoho, Google Workspace, Microsoft 365 or any SMTP server).',
    category: 'email',
    featureFlag: null,
    fields: [
      field({ key: 'host', label: 'SMTP host', type: 'text', required: true, placeholder: 'smtp.zoho.in' }),
      field({ key: 'port', label: 'Port', type: 'number', required: true, default: 587 }),
      field({ key: 'secure', label: 'TLS from the start (port 465)', type: 'boolean', default: false }),
      field({ key: 'username', label: 'User name', type: 'text', placeholder: 'sales@yourcompany.in' }),
      field({ key: 'password', label: 'Password or app password', type: 'password', secret: true }),
      field({ key: 'fromEmail', label: 'From address', type: 'email', required: true, placeholder: 'sales@yourcompany.in' }),
      field({ key: 'fromName', label: 'From name', type: 'text', placeholder: 'Your Company Sales' }),
    ],
    setupSteps: [
      'Find the SMTP settings of your mail provider (for Zoho: smtp.zoho.in, port 587).',
      'If your account uses two-step sign-in, create an app password and use it here.',
      'Save and send a test e-mail to yourself.',
    ],
    capabilities: { test: true, sync: false, push: false, oauth: false, mock: true },
    docsUrl: null,
  },
  google_calendar: {
    provider: 'google_calendar',
    label: 'Google Calendar',
    description: 'Connect a Google account so meetings planned in Vistar can be copied to Google Calendar.',
    category: 'calendar',
    featureFlag: null,
    fields: [
      field({ key: 'calendarId', label: 'Calendar', type: 'text', default: 'primary', help: '"primary" or a calendar ID from Google Calendar settings' }),
      field({ key: 'pushMeetings', label: 'Copy Vistar meetings to this calendar', type: 'boolean', default: true }),
    ],
    setupSteps: [
      'Click Connect with Google and sign in with the account whose calendar you want to use.',
      'Allow Vistar to see and edit events on your calendars.',
      'You come back here and the card shows the connected account.',
    ],
    capabilities: { test: true, sync: true, push: false, oauth: true, mock: true },
    docsUrl: null,
  },
};

const SCOPE_RESOURCE_LABELS: Record<string, string> = { leads: 'Leads', tasks: 'Tasks', calls: 'Calls', messages: 'Messages', workflows: 'Workflows' };
const SCOPE_ACTION_LABELS: Record<string, string> = { read: 'Read', create: 'Create', update: 'Update', send: 'Send' };

/** Scope picker rows: every API key scope; `allowed` = the caller holds the permission (keys never exceed their creator). */
export function apiKeyScopeOptions(granted: readonly string[]): ApiKeyScopeOption[] {
  return API_KEY_SCOPES.map((scope: ApiKeyScope) => {
    const [resource = '', action = ''] = scope.split('.');
    return {
      scope,
      resource,
      action,
      label: `${SCOPE_RESOURCE_LABELS[resource] ?? resource}: ${SCOPE_ACTION_LABELS[action] ?? action}`,
      allowed: granted.includes(scope),
    };
  });
}
