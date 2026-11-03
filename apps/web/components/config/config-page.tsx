import { ConfigConsole } from './config-console';

export type ConfigSearchParams = Promise<{ group?: string | string[]; section?: string | string[]; template?: string | string[] }>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/**
 * Server entry of the Super Admin Config routes: /super-admin/config (?group=<key>),
 * /super-admin/config/email-templates (?template=<key>) and /super-admin/config/go-live.
 * Keyed so a link to another section (go-live "Fix", other pages) remounts with that selection.
 */
export async function ConfigPage({ searchParams, section }: { searchParams: ConfigSearchParams; section?: 'email_templates' | 'go_live' }) {
  const sp = await searchParams;
  const group = section ?? first(sp.group) ?? first(sp.section);
  const template = first(sp.template);
  return <ConfigConsole key={`${group ?? ''}:${template ?? ''}`} initialGroup={group} initialTemplate={template} />;
}
