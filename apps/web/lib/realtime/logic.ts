import { SYNC_SCOPES, type AppScreen, type EventName, type SyncScope } from '@vistar/shared';

/**
 * Pure helpers of the web realtime client (unit tested): which screen a path is, which query
 * scopes an event makes stale, and the activity the heartbeat reports.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Screen reported with heartbeats (APP_SCREENS) for a web path and query string. */
export function screenForPath(pathname: string, search = ''): AppScreen {
  const params = new URLSearchParams(search);
  const parts = pathname.split('/').filter(Boolean);
  const panel = parts[0];
  if (panel !== 'app' && panel !== 'me') return 'other';
  const section = parts[1];
  if (!section) return 'home';
  switch (section) {
    case 'leads':
      if (parts[2] || params.get('lead')) return 'lead_detail';
      return params.get('view') === 'table' ? 'leads' : panel === 'me' ? 'leads' : 'board';
    case 'calls':
      return 'calls';
    case 'inbox':
      return params.get('c') || params.get('conversation') ? 'conversation' : 'inbox';
    case 'tasks':
      return 'tasks';
    case 'team-floor':
      return 'team_floor';
    case 'reports':
    case 'targets':
    case 'performance':
      return 'reports';
    case 'settings':
    case 'preferences':
    case 'profile':
      return 'settings';
    default:
      return 'other';
  }
}

/** Lead open on the page (lead detail route or the `?lead=` drawer), for the heartbeat. */
export function leadIdForPath(pathname: string, search = ''): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (
    (parts[0] === 'app' || parts[0] === 'me') &&
    parts[1] === 'leads' &&
    parts[2] &&
    UUID.test(parts[2])
  )
    return parts[2];
  const q = new URLSearchParams(search).get('lead');
  return q && UUID.test(q) ? q : null;
}

/** No input for this long while the tab is visible -> `idle`. */
export const IDLE_AFTER_MS = 120_000;

export function activityFor(
  hidden: boolean,
  lastInputAt: number,
  now: number,
): 'active' | 'idle' | 'hidden' {
  if (hidden) return 'hidden';
  return now - lastInputAt > IDLE_AFTER_MS ? 'idle' : 'active';
}

/**
 * Query scopes (first element of every query key) an event makes stale. The client refetches them
 * (debounced), so pages stay in step without polling.
 */
export function scopesForEvent(type: EventName): SyncScope[] {
  if (type.startsWith('lead.') || type === 'stage.changed') return ['leads', 'board', 'dashboard'];
  if (type === 'activity.created') return ['leads'];
  if (
    type === 'feed.item' ||
    type === 'dashboard.kpis_updated' ||
    type === 'attention.raised' ||
    type === 'attention.resolved'
  )
    return ['dashboard'];
  if (type.startsWith('task.')) return ['tasks', 'dashboard'];
  if (type.startsWith('call.')) return ['calls', 'dashboard', 'team-floor'];
  if (type === 'employee.status_changed' || type === 'employee.zone_changed')
    return ['team-floor', 'presence'];
  if (type.startsWith('attendance.') || type === 'location.updated')
    return ['attendance', 'team-floor'];
  if (type.startsWith('message.') || type === 'conversation.updated') return ['conversations'];
  if (type === 'notification.created') return ['notifications'];
  if (type.startsWith('workflow.')) return ['workflows'];
  if (type === 'webhook.delivery_updated') return ['workflows'];
  if (type === 'import.progress') return ['leads', 'board'];
  if (type === 'customization.changed' || type.startsWith('pack.'))
    return ['customization', 'workspace'];
  if (type.startsWith('record.')) return ['records'];
  if (type === 'theme.changed' || type === 'workspace.branding_changed') return ['workspace'];
  if (type === 'floor.published' || type === 'floor_request.updated') return ['team-floor'];
  return [];
}

/** Scopes from a `sync.required` payload, unknown names dropped. */
export function knownScopes(scopes: readonly string[]): SyncScope[] {
  const all = new Set<string>(SYNC_SCOPES);
  return [...new Set(scopes.filter((s): s is SyncScope => all.has(s)))];
}
