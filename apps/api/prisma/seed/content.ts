/**
 * Static demo content for the dev seed: call notes, dispositions, task titles, WhatsApp message bodies
 * (Hinglish and English), quick replies, notification texts, audit actions and workflow errors.
 * Placeholders use {key} and are filled by fill() in ./util.ts. No PII: every name and number used with
 * these strings comes from the generated fixtures.
 */
import type { CallOutcome, NotificationType, TaskPriority, TaskType } from '@vistar/shared';

// ---------------------------------------------------------------- calls

/** Outcome weights for outbound calls (status is derived from the outcome). */
export const OUTBOUND_OUTCOMES: Array<[CallOutcome | 'failed', number]> = [
  ['answered', 0.3],
  ['interested', 0.12],
  ['not_interested', 0.07],
  ['callback', 0.12],
  ['wrong_number', 0.02],
  ['voicemail', 0.06],
  ['missed', 0.27],
  ['failed', 0.04],
];

export const INBOUND_OUTCOMES: Array<[CallOutcome, number]> = [
  ['answered', 0.5],
  ['interested', 0.17],
  ['callback', 0.06],
  ['missed', 0.27],
];

export const DISPOSITIONS: Record<CallOutcome | 'failed', readonly string[]> = {
  answered: ['Requirement discussed', 'Shared price on call', 'Asked for catalogue', 'Quantity confirmed', 'Payment terms discussed', 'Delivery timeline discussed'],
  interested: ['Interested - send quote', 'Demo scheduled', 'Sample requested', 'Order likely this week', 'Wants site visit'],
  not_interested: ['Price too high', 'Already purchased', 'Requirement cancelled', 'Went with local supplier', 'Just checking rates'],
  callback: ['Call back later', 'Busy in meeting', 'Call after 4 pm', 'Call tomorrow morning', 'Decision maker not available'],
  wrong_number: ['Wrong number', 'Number belongs to someone else'],
  voicemail: ['Left voicemail', 'Voicemail full'],
  missed: ['Not reachable', 'Ringing, no answer', 'Switched off', 'Busy tone'],
  failed: ['Network issue', 'Call failed to connect'],
};

export const CALL_NOTES: Partial<Record<CallOutcome, readonly string[]>> = {
  answered: [
    'Customer ne {product} ka rate poocha, GST alag se bataya.',
    'Discussed {product}; they need {qty}. Will share final rate after checking stock.',
    '{first} ji se baat hui, requirement next week finalise karenge.',
    'Asked about delivery to {city}. Freight extra, told them 7-10 days.',
    'Spoke to purchase head. Wants 2 vendor quotes before deciding.',
    'Customer ko catalogue chahiye WhatsApp pe, bhej diya.',
    'Confirmed GST number and billing address for the quotation.',
  ],
  interested: [
    'Very interested in {product}. Send quotation for {qty} today.',
    '{first} ji ready hain, bas 2% discount chahiye. Manager se approval lena hai.',
    'Wants a sample before the bulk order. Courier sample to {city}.',
    'Site visit fixed for Saturday 11 am at their {city} unit.',
    'Good lead: repeat requirement every month. Prepare annual rate contract.',
  ],
  not_interested: [
    'Already bought from a local supplier last week.',
    'Budget nahi hai abhi, 3 mahine baad try karna.',
    'Our rate is about 8% higher than what they got. Not moving forward.',
    'They were only comparing prices online. Closing for now.',
  ],
  callback: [
    'Busy in a meeting, asked to call after 4 pm.',
    'Kal subah 11 baje call karne ko bola.',
    'Owner is travelling, call back on Monday.',
    'Asked to call back after they check with accounts.',
  ],
  wrong_number: ['Number belongs to someone else. Ask IndiaMART for an alternate contact.'],
  voicemail: ['Left a short message with our number and company name.'],
};

// ---------------------------------------------------------------- lead timeline notes

export const FIRST_CONTACT_NOTES = [
  'Spoke on mobile; requirement noted: {product}, {qty}.',
  'First call done. {first} ji ko rate list chahiye.',
  'Called from personal phone, customer interested. Will follow up on WhatsApp.',
  'Connected on call. Needs delivery to {city}; asked for GST invoice.',
] as const;

export const LEAD_NOTES = [
  'Customer wants delivery before month end.',
  'Rate thoda zyada laga, 3% discount maanga hai.',
  'Purchase manager is {first}; decision by Friday.',
  'Payment terms: 50% advance, balance before dispatch.',
  'Asked for test certificate and ISI mark details.',
  'Competitor quoted lower, but they prefer our quality.',
  'GST number verified, billing to {company}.',
  'Visit planned to {city} next week, combine with other leads.',
  'Requirement is recurring: {qty} every month.',
  'Customer ne bola transport unka khud ka hai, ex-works rate do.',
  'Sent revised quote with freight included.',
  'Need approval from Anil sir for extra discount.',
] as const;

export const QUANTITIES = ['50 pieces', '100 pieces', '200 units', '500 kg', '1 tonne', '2 tonnes', '20 rolls', '1,000 boxes', '5 sets', '300 meters', '10 units', '1 truck load'] as const;

// ---------------------------------------------------------------- tasks

export const TASK_TITLES: Record<TaskType, readonly string[]> = {
  call: ['Call {name} for requirement details', 'Call back {name}', 'Confirm quantity with {name}', 'Call {name} about payment terms'],
  follow_up: ['Follow up with {name} on quote', 'Follow up: {product} for {company}', 'Check if {name} received the catalogue', 'Remind {name} about the sample'],
  meeting: ['Site visit at {company}, {city}', 'Video call demo with {name}', 'Meet {name} at their {city} office'],
  email: ['Email catalogue to {name}', 'Send quotation PDF to {company}', 'Email test certificate to {name}'],
  todo: ['Prepare quotation for {product}', 'Check stock for {product}', 'Get discount approval for {company}', 'Arrange sample dispatch to {city}'],
};

export const TASK_NOTES = [
  'Customer prefers a call after 4 pm.',
  'Mention the festive offer.',
  'Share price with GST and freight separately.',
  'Ask for the PO number.',
  'Keep the quote valid for 15 days.',
] as const;

/** Tasks without a lead, per role. */
export const PERSONAL_TASKS: Record<'manager' | 'employee' | 'company_admin', ReadonlyArray<{ title: string; type: TaskType; priority: TaskPriority }>> = {
  employee: [
    { title: 'Update weekly pipeline sheet', type: 'todo', priority: 'normal' },
    { title: 'Submit travel expenses', type: 'todo', priority: 'low' },
    { title: 'Clean up duplicate IndiaMART enquiries', type: 'todo', priority: 'low' },
    { title: 'Prepare for Monday sales review', type: 'meeting', priority: 'normal' },
  ],
  manager: [
    { title: 'Review overdue follow-ups of the team', type: 'todo', priority: 'high' },
    { title: 'Weekly sales review meeting', type: 'meeting', priority: 'normal' },
    { title: 'Approve pending discount requests', type: 'todo', priority: 'high' },
    { title: 'Set next month targets', type: 'todo', priority: 'normal' },
  ],
  company_admin: [
    { title: 'Renew IndiaMART subscription', type: 'todo', priority: 'normal' },
    { title: 'Review monthly revenue with accounts', type: 'meeting', priority: 'normal' },
    { title: 'Approve festive price list', type: 'todo', priority: 'high' },
  ],
};

// ---------------------------------------------------------------- WhatsApp

/** First message from a lead who came in through WhatsApp (click-to-chat ad or QR). */
export const WA_INBOUND_OPENERS = [
  'Hi, I saw your ad for {product}. Price kya hai?',
  'Namaste, {product} chahiye. Rate bhejo please.',
  'Hello, do you supply {product} in {city}?',
  'Hi, need {qty} of {product}. Please share best price.',
  'Sir {product} ka catalogue bhej dijiye.',
  'Good morning, I want a quotation for {product}.',
] as const;

export const WA_INBOUND_REPLIES = {
  price: ['Price batao please', 'Rate kya hai {qty} ka?', 'What is the price with GST?', 'Kitna padega delivery ke saath?', 'Please share quotation'],
  catalog: ['Catalogue bhejiye', 'Please share brochure and photos', 'Details bhejo sir', 'Can you send product photos?'],
  not_interested: ['Not interested, thanks', 'Abhi requirement nahi hai', 'No need now, already purchased'],
  other: ['Kal call karo 11 baje', 'Delivery {city} tak hogi?', 'Ok noted', 'Thik hai', 'Payment terms kya hain?', 'GST bill milega na?', 'Sample mil sakta hai?'],
} as const;

export const WA_AGENT_REPLIES = [
  'Sure {first} ji, sharing the price list now.',
  'Ji sir, {product} ka rate GST extra hai. Quotation 10 min mein bhejta hoon.',
  'Main aapko 5 min mein call karta hoon.',
  'Quotation PDF bhej diya hai, please check.',
  'Delivery to {city} takes 7-10 working days.',
  'Yes, GST invoice will be provided. Please share your GST number.',
  'Sample courier kar dete hain, address bhej dijiye.',
  'Thank you {first} ji. Let me know if you need anything else.',
  'Payment terms: 50% advance, balance before dispatch.',
] as const;

export const WA_INBOUND_FOLLOWUPS = [
  'Ok, quotation mil gaya. Thoda discount milega?',
  'Thank you, will confirm by tomorrow.',
  'Can you do delivery by next week?',
  'Rate thoda kam karo, regular order denge.',
  'Ok sir, I will discuss with my partner.',
  'Address: {company}, {city}. GST number baad mein bhejta hoon.',
] as const;

export const WA_MISSED_CALL_REPLIES = ['Haan, call back karo', 'Ok, call me in 10 min', 'Sorry, was driving. Call now please', 'Busy hoon, shaam ko call karna'] as const;

export const WA_WON_INBOUND = ['Order confirm karte hain, PI bhejo.', 'Please go ahead with the order. PO attached on email.', 'Payment kar diya hai, dispatch details bhejo.'] as const;
export const WA_WON_AGENT = ['PI shared, thank you for the order!', 'Order booked. Dispatch in 3 days, will share LR copy.', 'Thank you {first} ji, payment received. Dispatching tomorrow.'] as const;
export const WA_LOST_INBOUND = ['Sorry, we finalised with another vendor.', 'Abhi ke liye cancel kar do.', 'Budget approve nahi hua.'] as const;
export const WA_STOP = 'STOP';

export const WA_INTERNAL_NOTES = [
  'Price sensitive customer, offer max 3% discount.',
  'Ask Priya before approving credit.',
  'Repeat buyer, prioritise this one.',
  'Customer prefers Hindi, call instead of long messages.',
] as const;

/** Meta error texts for failed outbound messages. */
export const WA_SEND_ERRORS = [
  '(#131026) Message undeliverable: recipient is not on WhatsApp',
  '(#131047) Re-engagement message: more than 24 hours since the customer last replied',
  '(#131049) Meta chose not to deliver this marketing message',
] as const;

export const QUICK_REPLIES: ReadonlyArray<{ shortcut: string; body: string }> = [
  { shortcut: '/price', body: 'Thank you for your enquiry. Please find our latest price list attached. All prices are exclusive of GST.' },
  { shortcut: '/catalog', body: 'Here is our product catalogue. Let us know which items you need and the quantity.' },
  { shortcut: '/gst', body: 'Please share your GST number and billing address so we can prepare the invoice.' },
  { shortcut: '/delivery', body: 'Delivery takes 7-10 working days after the order is confirmed. Freight is charged at actuals.' },
  { shortcut: '/payment', body: 'Payment terms: 50% advance with the PO, balance before dispatch. We accept NEFT, RTGS and UPI.' },
  { shortcut: '/sample', body: 'We can courier a sample. Please share the delivery address and a contact number.' },
  { shortcut: '/callback', body: 'Sorry we missed you. Our sales executive will call you back within 15 minutes.' },
  { shortcut: '/thanks', body: 'Dhanyavaad! It was great speaking with you. We look forward to working together.' },
  { shortcut: '/location', body: 'Our factory and office address is on the letterhead attached. Visiting hours: 10 am to 6 pm, Monday to Saturday.' },
  { shortcut: '/hindi', body: 'Namaste ji, aapki enquiry ke liye dhanyavaad. Rate list bhej rahe hain, koi sawaal ho toh call kariye.' },
];

// ---------------------------------------------------------------- workflows

export const WORKFLOW_ERRORS = {
  send: '(#131026) Message undeliverable: recipient is not on WhatsApp',
  noPhone: 'Lead has no phone number',
  window: 'Outside the 24 h window and the template is paused',
} as const;

// ---------------------------------------------------------------- notifications

export const NOTIFICATION_TEXT: Record<NotificationType, { title: string; body?: string }> = {
  lead_assigned: { title: 'New lead assigned: {lead}', body: '{company} · {source}' },
  message_received: { title: 'New WhatsApp message from {lead}', body: '{preview}' },
  task_due: { title: 'Reminder: {task}', body: 'Due at {time} · {lead}' },
  task_overdue: { title: 'Task overdue: {task}', body: 'For {lead}' },
  workflow_failed: { title: 'Workflow failed: {workflow}', body: '{lead} · {error}' },
  mention: { title: '{actor} mentioned you on {lead}', body: '{note}' },
  import_completed: { title: 'Import finished: {file}', body: '{created} leads created, {skipped} skipped' },
  system: { title: '{title}', body: '{body}' },
  meeting_reminder: { title: 'Meeting in {minutes} min: {title}', body: '{time}' },
};

export const MENTION_NOTES = [
  'Please call this customer today, they are ready to order.',
  'Sir, discount approval chahiye for this quote.',
  'Can you check the GST details here?',
  'Big order potential, handle with priority.',
  'Customer escalated about delivery, please reply.',
] as const;

export const SYSTEM_NOTICES: Record<'admin' | 'manager' | 'employee' | 'viewer', ReadonlyArray<{ title: string; body: string; href?: string }>> = {
  admin: [
    { title: 'IndiaMART sync finished', body: 'New enquiries were imported and assigned by round robin.', href: '/integrations' },
    { title: 'Support session ended', body: 'Vistar support ended a read-only "View as company" session.', href: '/settings/audit' },
    { title: 'WhatsApp template approved', body: 'Template "revival_offer" was approved by Meta.', href: '/settings/templates' },
    { title: 'Outbound webhook failing', body: 'ERP sync endpoint returned errors; deliveries are being retried.', href: '/webhooks' },
    { title: 'Monthly targets are due', body: 'Set next month targets for your teams before the 1st.', href: '/targets' },
  ],
  manager: [
    { title: 'Weekly team report is ready', body: 'Calls, conversions and response time for last week.', href: '/reports' },
    { title: 'Targets updated', body: 'This month targets for your team were published.', href: '/targets' },
    { title: 'New WhatsApp quick replies', body: 'Quick replies are available in the inbox. Type / to use them.', href: '/inbox' },
  ],
  employee: [
    { title: 'Your target for this month is live', body: 'Check your progress rings on My Performance.', href: '/performance' },
    { title: 'Tip: use quick replies', body: 'Type / in the inbox to insert a saved reply.', href: '/inbox' },
    { title: 'Status set to Offline', body: 'You were inactive for 30 minutes, so we set you to Offline.', href: '/status' },
  ],
  viewer: [
    { title: 'Monthly revenue report is ready', body: 'Won deals and collections for last month.', href: '/reports' },
    { title: 'Weekly sales summary', body: 'New leads, conversion and revenue for last week.', href: '/reports' },
    { title: 'Dashboard updated', body: 'The source ROI chart now includes WhatsApp leads.', href: '' },
  ],
};

// ---------------------------------------------------------------- saved views, tags, misc

export const TAG_COLORS: Record<string, string> = {
  hot: '#E11D48',
  'repeat-buyer': '#059669',
  export: '#2563EB',
  'gst-registered': '#0D9488',
  distributor: '#7C3AED',
  'price-sensitive': '#D97706',
  bulk: '#4F46E5',
  'follow-up': '#0EA5E9',
  tender: '#64748B',
  'missed-call-no-reply': '#DC2626',
};

export const PREFERRED_LANGUAGE_BY_STATE: Record<string, string> = {
  Gujarat: 'gu',
  Maharashtra: 'mr',
  'Tamil Nadu': 'ta',
  Telangana: 'te',
  Karnataka: 'kn',
  'West Bengal': 'bn',
};

/** GSTIN state codes for the fixture states. */
export const GST_STATE_CODES: Record<string, string> = {
  Maharashtra: '27',
  Delhi: '07',
  'Uttar Pradesh': '09',
  Gujarat: '24',
  Karnataka: '29',
  'Tamil Nadu': '33',
  Telangana: '36',
  'West Bengal': '19',
  Rajasthan: '08',
  Punjab: '03',
  'Madhya Pradesh': '23',
  Kerala: '32',
  Haryana: '06',
};

/** Documentation-range IPs (RFC 5737) and common user agents for audit rows. */
export const AUDIT_IPS = ['203.0.113.24', '203.0.113.87', '198.51.100.12', '198.51.100.45', '192.0.2.61'] as const;
export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
] as const;

export const IMPERSONATION_REASONS = [
  'Customer asked for help setting up IndiaMART lead routing (ticket #4821)',
  'Investigating WhatsApp template delivery failures reported by the admin',
  'Walkthrough of the workflow builder requested on the onboarding call',
] as const;

export const WEBHOOK_ERRORS = {
  timeout: 'Timed out after 10000 ms',
  refused: 'connect ECONNREFUSED',
  server: 'Endpoint returned HTTP 500',
  unavailable: 'Endpoint returned HTTP 503',
  signature: 'Invalid signature',
} as const;
