import { renderTemplate, WORKFLOW_VARIABLES, type NodeType } from '@vistar/shared';
import { WHATSAPP_TEMPLATE_FIXTURES } from '@vistar/shared/fixtures';

export type TemplateContext = Record<string, unknown>;

/** Nested context ({ lead: { name } }) from dotted keys. */
function nest(flat: Record<string, string>): TemplateContext {
  const out: TemplateContext = {};
  for (const [path, value] of Object.entries(flat)) {
    const keys = path.split('.');
    let cur = out;
    keys.forEach((k, i) => {
      if (i === keys.length - 1) cur[k] = value;
      else cur = (cur[k] ??= {}) as TemplateContext;
    });
  }
  return out;
}

/** Context from WORKFLOW_VARIABLES examples, with optional overrides (dummy lead, reply, workspace). */
export function previewContext(overrides: Record<string, string> = {}): TemplateContext {
  const flat: Record<string, string> = Object.fromEntries(
    WORKFLOW_VARIABLES.map((v) => [v.key, v.example]),
  );
  return nest({ ...flat, ...overrides });
}

export function approvedTemplate(name: string) {
  return WHATSAPP_TEMPLATE_FIXTURES.find((t) => t.name === name) ?? null;
}

/** Fill template slots ({{1}}, {{2}}) from the node's slot -> text mapping, rendered with ctx. */
export function renderWhatsAppTemplate(
  name: string,
  variables: Record<string, string>,
  ctx: TemplateContext,
): string | null {
  const tpl = approvedTemplate(name);
  if (!tpl) return null;
  const slots: Record<string, string> = {};
  tpl.variables.forEach((path, i) => {
    const key = String(i + 1);
    slots[key] = renderTemplate(variables[key] ?? `{{${path}}}`, ctx);
  });
  return renderTemplate(tpl.body, slots);
}

/** Message text a messaging node would send, rendered with ctx (null for non-messaging nodes). */
export function renderNodeMessage(
  type: NodeType,
  config: Record<string, unknown>,
  ctx: TemplateContext,
): string | null {
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (type) {
    case 'action.send_whatsapp_template':
      return renderWhatsAppTemplate(
        s(config.templateName),
        (config.variables as Record<string, string>) ?? {},
        ctx,
      );
    case 'action.send_whatsapp_text':
    case 'action.send_sms':
      return renderTemplate(s(config.body), ctx);
    case 'action.send_email': {
      const subject = renderTemplate(s(config.subject), ctx);
      const body = renderTemplate(s(config.body), ctx);
      return subject ? `${subject}\n\n${body}` : body;
    }
    default:
      return null;
  }
}

/** Default slot mapping for a template ({ '1': '{{lead.firstName}}', ... }). */
export function defaultTemplateVariables(name: string): Record<string, string> {
  const tpl = approvedTemplate(name);
  if (!tpl) return {};
  return Object.fromEntries(tpl.variables.map((path, i) => [String(i + 1), `{{${path}}}`]));
}
