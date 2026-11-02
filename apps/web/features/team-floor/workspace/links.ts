import type { ModuleId } from './store';

/**
 * Links inside the floor workspace stay on the floor (SPEC 29.11 "in one tab"): a link to a module page
 * opens that module as a panel, a link to a lead opens the lead drawer. Pure, unit tested.
 */
export type PanelKind = 'company' | 'employee';

export interface LinkTarget {
  /** Module panel to open; null = only the lead drawer. */
  module: ModuleId | null;
  /** Lead to open in the drawer (`?lead=` or a lead page). */
  leadId: string | null;
  /** Query of the link (Leads filters, `view`, Inbox `c`). */
  search: URLSearchParams;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where a same-origin link of the given panel goes on the floor; null = a normal navigation. */
export function linkTarget(href: string, panel: PanelKind, origin: string): LinkTarget | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const root = panel === 'company' ? 'app' : 'me';
  if (parts[0] !== root || parts.length > 3) return null;
  const section = parts[1] ?? '';
  const search = url.searchParams;
  const lead = search.get('lead');
  const leadId = lead && UUID.test(lead) ? lead : null;
  switch (section) {
    case '':
      return { module: panel === 'company' ? 'dashboard' : 'today', leadId: null, search };
    case 'leads':
      // A lead's full page stays a page (explicit "open full page" links); `?lead=` opens the drawer.
      if (parts[2]) return null;
      return leadId ? { module: null, leadId, search } : { module: 'leads', leadId: null, search };
    case 'inbox':
      return parts[2] ? null : { module: 'inbox', leadId: null, search };
    case 'tasks':
      return parts[2] ? null : { module: 'tasks', leadId: null, search };
    case 'calls':
      return parts[2] ? null : { module: 'calls', leadId: null, search };
    default:
      return null;
  }
}
