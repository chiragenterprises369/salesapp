import type { AppScreen, ChipTone, ClientKind, EmployeeStatus, PresenceActivity, PresenceSource, PresenceStatus, ZoneSignalSource } from '@vistar/shared';

/** UI copy for live presence (Team Floor workspace, attendance). No floor state here: light to import. */

// ---------------------------------------------------------------- labels (UI copy)

export const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  available: 'Available',
  on_call: 'On a call',
  in_meeting: 'In a meeting',
  on_break: 'On a break',
  lunch: 'At lunch',
  field_visit: 'On a field visit',
  away: 'Away',
  offline: 'Offline',
};

/** Same tones as the coarse status chips (on call blue, available green, busy amber, away and offline grey). */
export const PRESENCE_TONE: Record<PresenceStatus, ChipTone> = {
  available: 'green',
  on_call: 'blue',
  in_meeting: 'amber',
  on_break: 'grey',
  lunch: 'grey',
  field_visit: 'amber',
  away: 'grey',
  offline: 'grey',
};

const COARSE_LABEL: Record<EmployeeStatus, string> = {
  on_call: 'On a call',
  idle: 'Available',
  busy: 'Busy',
  away: 'Away',
  offline: 'Offline',
};
const COARSE_TONE: Record<EmployeeStatus, ChipTone> = { on_call: 'blue', idle: 'green', busy: 'amber', away: 'grey', offline: 'grey' };

/** Label and tone for a person: the detailed status when known, else the coarse floor status. */
export function statusView(live: { status: PresenceStatus | null } | undefined, coarse: EmployeeStatus): { label: string; tone: ChipTone } {
  if (live?.status) return { label: PRESENCE_LABEL[live.status], tone: PRESENCE_TONE[live.status] };
  return { label: COARSE_LABEL[coarse], tone: COARSE_TONE[coarse] };
}

/** Which observed fact set the current status (shown as "Source"). */
export const SOURCE_LABEL: Record<PresenceSource, string> = {
  session: 'Signed in or out',
  heartbeat: 'Vistar open on the web or the Android app',
  manual: 'Set by them',
  phone_state: 'Phone call state from the Android app',
  call_log: 'Phone call log from the Android app',
  telephony: 'Calling provider',
  attendance: 'Attendance check-in or check-out',
  working_hours: 'Working hours',
  timeout: 'No signal for 45 seconds',
  system: 'Vistar',
};

export const ZONE_SOURCE_LABEL: Record<ZoneSignalSource, string> = {
  ble: 'Office beacon',
  wifi: 'Office Wi-Fi',
  qr: 'QR code scan',
  nfc: 'NFC tag tap',
  manual: 'Picked by them',
};

/** "Exact" (QR, NFC), "High", "Medium", "Low" for a zone confidence. */
export function confidenceLabel(source: ZoneSignalSource, confidence: number): string {
  if ((source === 'qr' || source === 'nfc') && confidence >= 0.99) return 'Exact';
  if (confidence >= 0.8) return 'High';
  if (confidence >= 0.5) return 'Medium';
  return 'Low';
}

export const SCREEN_LABEL: Record<AppScreen, string> = {
  home: 'Home',
  leads: 'Leads list',
  lead_detail: 'A lead',
  board: 'Leads board',
  calls: 'Calls',
  call: 'A call screen',
  inbox: 'Inbox',
  conversation: 'A WhatsApp chat',
  tasks: 'Tasks',
  team_floor: 'Team Floor',
  attendance: 'Attendance',
  reports: 'Reports',
  settings: 'Settings',
  other: 'Another page',
};

const CLIENT_LABEL: Record<ClientKind, string> = { web: 'Web', android: 'Android app' };

/** "Android app, active", "Web, tab in the background" (null when nothing is known). */
export function clientLabel(activity: PresenceActivity | null | undefined): string | null {
  if (!activity?.client) return null;
  const where = CLIENT_LABEL[activity.client];
  switch (activity.clientActivity) {
    case 'active':
      return `${where}, active`;
    case 'idle':
      return `${where}, idle (no input for 2 min)`;
    case 'hidden':
      return activity.client === 'android' ? `${where}, in the background` : `${where}, tab in the background`;
    default:
      return where;
  }
}
