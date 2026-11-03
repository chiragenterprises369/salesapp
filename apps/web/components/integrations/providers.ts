import { API_ORIGIN } from '@/lib/api/config';

/**
 * What the hub shows for each provider: name, one-line purpose, icon, the connect form fields
 * (secret fields are write-only), setup steps and copyable values. The API's own provider
 * description wins where it sends one (requests-19c W1); this catalog fills the rest so the page
 * works with either.
 */
export type ProviderFieldType = 'text' | 'url' | 'email' | 'number' | 'select' | 'boolean' | 'password';

export interface ProviderField {
  key: string;
  label: string;
  type: ProviderFieldType;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** Shown only when another field has one of these values (telephony provider). */
  when?: { key: string; equals: readonly string[] };
  defaultValue?: string | boolean;
}

export interface ProviderCopyable {
  key: string;
  label: string;
  value: string;
  hint?: string;
}

export interface ProviderMeta {
  provider: string;
  name: string;
  description: string;
  /** lucide icon name (NavIcon). */
  icon: string;
  category: 'Lead sources' | 'Messaging' | 'Calling' | 'Email' | 'Calendar' | 'Other';
  fields: ProviderField[];
  setupSteps: string[];
  copyables: ProviderCopyable[];
  canSync: boolean;
  canTest: boolean;
  /** OAuth providers connect through a redirect instead of a form. */
  oauth?: boolean;
}

const HOOKS = `${API_ORIGIN}/api/hooks`;

export const PROVIDER_CATALOG: Record<string, ProviderMeta> = {
  indiamart: {
    provider: 'indiamart',
    name: 'IndiaMART',
    description: 'New buyer enquiries from IndiaMART Lead Manager become leads, routed to the right person.',
    icon: 'Store',
    category: 'Lead sources',
    canSync: true,
    canTest: true,
    fields: [
      { key: 'crmKey', label: 'CRM key', type: 'password', secret: true, required: true, hint: 'IndiaMART seller panel > Lead Manager > Import/Export leads > CRM integration key.' },
      {
        key: 'mode',
        label: 'How leads arrive',
        type: 'select',
        defaultValue: 'pull',
        options: [
          { value: 'pull', label: 'Vistar fetches new leads every few minutes (pull)' },
          { value: 'push', label: 'IndiaMART sends each lead to Vistar (push)' },
          { value: 'both', label: 'Both (push, with pull as a safety net)' },
        ],
      },
      {
        key: 'pullIntervalMinutes',
        label: 'Fetch every',
        type: 'select',
        defaultValue: '10',
        when: { key: 'mode', equals: ['pull', 'both'] },
        options: [
          { value: '5', label: '5 minutes (IndiaMART allows one call every 5 minutes)' },
          { value: '10', label: '10 minutes' },
          { value: '15', label: '15 minutes' },
          { value: '30', label: '30 minutes' },
        ],
      },
    ],
    setupSteps: [
      'Sign in to the IndiaMART seller panel and open Lead Manager.',
      'Open the CRM integration (Pull API) page and copy your CRM key.',
      'Paste the key here and save. Vistar checks it and fetches the last 24 hours of enquiries.',
      'For push: give IndiaMART the push URL below and keep pull on as a safety net. Duplicates are skipped by the enquiry id.',
    ],
    copyables: [],
  },
  whatsapp_cloud: {
    provider: 'whatsapp_cloud',
    name: 'WhatsApp Cloud API',
    description: 'Send and receive WhatsApp messages in the Inbox with your Meta business number.',
    icon: 'MessageCircle',
    category: 'Messaging',
    canSync: true,
    canTest: true,
    fields: [
      { key: 'phoneNumberId', label: 'Phone number ID', type: 'text', required: true, hint: 'Meta developer app > WhatsApp > API setup.' },
      { key: 'businessAccountId', label: 'WhatsApp Business account ID', type: 'text', required: true },
      { key: 'accessToken', label: 'Permanent access token', type: 'password', secret: true, required: true, hint: 'A system user token with whatsapp_business_messaging and whatsapp_business_management.' },
      { key: 'appSecret', label: 'App secret', type: 'password', secret: true, required: true, hint: 'Used to check the X-Hub-Signature-256 header of every webhook call.' },
    ],
    setupSteps: [
      'In Meta for Developers, open your app and add the WhatsApp product.',
      'Copy the phone number ID, the business account ID and a permanent access token.',
      'Under Configuration > Webhook, paste the callback URL and the verify token below, then subscribe to "messages".',
      'Save here and send a test message. Replies within 24 hours are free-form; after that only approved templates.',
    ],
    copyables: [{ key: 'webhookUrl', label: 'Callback URL', value: `${HOOKS}/whatsapp`, hint: 'Paste into Meta > WhatsApp > Configuration > Webhook.' }],
  },
  telephony: {
    provider: 'telephony',
    name: 'Telephony',
    description: 'Click-to-call through your cloud telephony account, with call logs and recordings on the lead.',
    icon: 'PhoneCall',
    category: 'Calling',
    canSync: false,
    canTest: true,
    fields: [
      {
        key: 'provider',
        label: 'Provider',
        type: 'select',
        defaultValue: 'mock',
        options: [
          { value: 'mock', label: 'Test provider (no real calls)' },
          { value: 'exotel', label: 'Exotel' },
        ],
      },
      { key: 'accountSid', label: 'Account SID', type: 'text', required: true, when: { key: 'provider', equals: ['exotel'] } },
      { key: 'apiKey', label: 'API key', type: 'text', required: true, when: { key: 'provider', equals: ['exotel'] } },
      { key: 'apiToken', label: 'API token', type: 'password', secret: true, required: true, when: { key: 'provider', equals: ['exotel'] } },
      {
        key: 'subdomain',
        label: 'Region',
        type: 'select',
        defaultValue: 'api.in.exotel.com',
        when: { key: 'provider', equals: ['exotel'] },
        options: [
          { value: 'api.in.exotel.com', label: 'Mumbai (api.in.exotel.com)' },
          { value: 'api.exotel.com', label: 'Singapore (api.exotel.com)' },
        ],
      },
      { key: 'callerId', label: 'ExoPhone (caller ID)', type: 'text', placeholder: '08047XXXXXX', when: { key: 'provider', equals: ['exotel'] } },
    ],
    setupSteps: [
      'Pick the test provider to try click-to-call without a telephony account.',
      'For Exotel: copy the account SID, API key and token from Exotel > Settings > API.',
      'Add the status callback URL below in your Exotel app so call results and recordings reach Vistar.',
    ],
    copyables: [{ key: 'callbackUrl', label: 'Status callback URL', value: `${HOOKS}/telephony/exotel`, hint: 'Only needed for Exotel.' }],
  },
  smtp: {
    provider: 'smtp',
    name: 'Email (SMTP)',
    description: 'Send quotations, invoices and workflow emails from your own address.',
    icon: 'Mail',
    category: 'Email',
    canSync: false,
    canTest: true,
    fields: [
      { key: 'host', label: 'SMTP server', type: 'text', required: true, placeholder: 'smtp.zoho.in' },
      { key: 'port', label: 'Port', type: 'number', required: true, defaultValue: '587', hint: '587 with STARTTLS, or 465 with TLS.' },
      { key: 'secure', label: 'Use TLS from the start (port 465)', type: 'boolean', defaultValue: false },
      { key: 'username', label: 'User name', type: 'text', required: true },
      { key: 'password', label: 'Password or app password', type: 'password', secret: true, required: true },
      { key: 'fromEmail', label: 'From address', type: 'email', required: true, placeholder: 'sales@yourcompany.in' },
      { key: 'fromName', label: 'From name', type: 'text', placeholder: 'Shakti Industries' },
    ],
    setupSteps: [
      'Get the SMTP details from your email provider (Google Workspace, Zoho Mail, Microsoft 365 or your host).',
      'With two-step sign-in, create an app password and use it here.',
      'Save, then send a test email to yourself.',
    ],
    copyables: [],
  },
  google_calendar: {
    provider: 'google_calendar',
    name: 'Google Calendar',
    description: 'Meetings booked in Vistar appear in Google Calendar, and busy times block lead routing.',
    icon: 'CalendarDays',
    category: 'Calendar',
    canSync: true,
    canTest: true,
    oauth: true,
    fields: [],
    setupSteps: ['Click Connect with Google and allow calendar access for your Google account.', 'Vistar adds new meetings to your primary calendar and reads busy times.'],
    copyables: [],
  },
};

/** Catalog entry for a provider (unknown providers get a plain entry from their key). */
export function providerMeta(provider: string): ProviderMeta {
  return (
    PROVIDER_CATALOG[provider] ?? {
      provider,
      name: provider.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
      description: '',
      icon: 'Plug',
      category: 'Other',
      fields: [],
      setupSteps: [],
      copyables: [],
      canSync: false,
      canTest: true,
    }
  );
}

/** Fields visible for the current values (handles `when`). */
export function visibleFields(fields: readonly ProviderField[], values: Record<string, unknown>): ProviderField[] {
  return fields.filter((f) => !f.when || f.when.equals.includes(String(values[f.when.key] ?? fieldDefault(fields.find((x) => x.key === f.when!.key)) ?? '')));
}

export function fieldDefault(f: ProviderField | undefined): string | boolean | undefined {
  if (!f) return undefined;
  if (f.defaultValue !== undefined) return f.defaultValue;
  if (f.type === 'select') return f.options?.[0]?.value;
  if (f.type === 'boolean') return false;
  return undefined;
}
