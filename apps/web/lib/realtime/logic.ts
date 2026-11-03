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
    case 'attendance':
      return 'attendance';
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

// ---------------------------------------------------------------- screen reported by a page

/** Module panels of the Team Floor workspace (features/team-floor/workspace/store.ts `ModuleId`). */
export type FloorModule = 'leads' | 'inbox' | 'tasks' | 'calls' | 'dashboard' | 'today';

const FLOOR_MODULE_PATH: Record<FloorModule, string> = {
  leads: '/app/leads',
  inbox: '/app/inbox',
  tasks: '/app/tasks',
  calls: '/app/calls',
  dashboard: '/app',
  today: '/me',
};

/**
 * Screen of a floor workspace panel: the same screen as the module's own page, with the floor's
 * query string (leads `?view=table`, the `?lead=` drawer, inbox `?c=`). No panel = the floor.
 */
export function screenForFloorModule(module: FloorModule | null, search = ''): AppScreen {
  return module ? screenForPath(FLOOR_MODULE_PATH[module], search) : 'team_floor';
}

type ScreenSource = { pathname: string; read: () => AppScreen | null };
let screenSource: ScreenSource | null = null;
const screenListeners = new Set<() => void>();

/**
 * A page that shows several modules on one route (the Team Floor workspace with its docked panels)
 * reports the screen in use: while the tab is still on `pathname`, the heartbeat asks `read()`
 * (null = use the path's own screen). Returns the unregister function (call it on unmount).
 *
 *   useEffect(() => registerScreenSource(location.pathname, () => (open ? screenForFloorModule(open, location.search) : null)), [open]);
 *   useEffect(() => screenChanged(), [open]);
 */
export function registerScreenSource(pathname: string, read: () => AppScreen | null): () => void {
  const source: ScreenSource = { pathname, read };
  screenSource = source;
  return () => {
    if (screenSource === source) {
      screenSource = null;
      screenChanged();
    }
  };
}

/** The reported screen changed (panel opened, switched or closed): the realtime client beats now. */
export function screenChanged(): void {
  for (const l of screenListeners) l();
}

/** Subscribe to `screenChanged()` (the realtime client). Returns unsubscribe. */
export function onScreenChanged(listener: () => void): () => void {
  screenListeners.add(listener);
  return () => screenListeners.delete(listener);
}

/** Screen for the heartbeat: the registered source while on its route, else the path's screen. */
export function currentScreen(pathname: string, search = ''): AppScreen {
  if (screenSource && screenSource.pathname === pathname) {
    try {
      const s = screenSource.read();
      if (s) return s;
    } catch {
      /* a failing source never breaks the heartbeat */
    }
  }
  return screenForPath(pathname, search);
}

export function activityFor(
  hidden: boolean,
  lastInputAt: number,
  now: number,
): 'active' | 'idle' | 'hidden' {
  if (hidden) return 'hidden';
  return now - lastInputAt > IDLE_AFTER_MS ? 'idle' : 'active';
}

/**
 * Change #19 wave B CRM events (and the wave C billing events) by prefix. Related lists refresh too (a deal shows on its contact and
 * account; a payment changes the invoice, its quotation and the deal). `routing.` and `capture_form.`
 * have no events yet; their scopes are ready for when the API publishes them.
 */
const CRM_EVENT_SCOPES: Partial<Record<string, readonly SyncScope[]>> = {
  contact: ['contacts', 'accounts', 'deals'],
  account: ['accounts', 'contacts', 'deals'],
  deal: ['deals', 'contacts', 'accounts'],
  quotation: ['quotations', 'deals', 'contacts', 'accounts'],
  invoice: ['invoices', 'quotations', 'deals', 'contacts', 'accounts'],
  catalog: ['products'],
  meeting: ['calendar', 'contacts', 'accounts', 'deals'],
  routing: ['routing'],
  capture_form: ['capture-forms'],
  // change #19 wave C: the company's Vistar subscription, invoices and usage alerts (billing.read users).
  billing: ['billing'],
};

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
  const crm = CRM_EVENT_SCOPES[type.split('.')[0] ?? ''];
  if (crm) return [...crm];
  return [];
}

/** Scopes from a `sync.required` payload, unknown names dropped. */
export function knownScopes(scopes: readonly string[]): SyncScope[] {
  const all = new Set<string>(SYNC_SCOPES);
  return [...new Set(scopes.filter((s): s is SyncScope => all.has(s)))];
}
