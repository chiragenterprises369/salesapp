import { formatInr, type NodeType } from '@vistar/shared';
import { mockUsers } from '@vistar/shared/fixtures';
import { describeCron } from './cron';
import { enumLabel, OP_LABELS, SOURCE_LABELS, stageName } from './labels';

const USERS = mockUsers();
const userName = (id: string) => USERS.find((u) => u.id === id)?.name ?? 'Unknown user';

type Cfg = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function valueText(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  if (v === null || v === undefined || v === '') return '…';
  return String(v);
}

/** One-line config summary shown on the node card. */
export function configSummary(type: NodeType, c: Cfg): string {
  switch (type) {
    case 'trigger.indiamart_lead':
      return 'New IndiaMART enquiry';
    case 'trigger.website_form':
      return str(c.formKey) ? `Form "${str(c.formKey)}"` : 'Any website form';
    case 'trigger.inbound_webhook':
      return str(c.endpointId) ? `Endpoint ${str(c.endpointId)}` : 'Choose an endpoint';
    case 'trigger.whatsapp_message':
      return arr(c.keywords).length ? `Keywords: ${arr(c.keywords).join(', ')}` : 'Any WhatsApp message';
    case 'trigger.contact_created':
      return arr(c.sources).length ? `From ${arr(c.sources).map((s) => SOURCE_LABELS[s as keyof typeof SOURCE_LABELS] ?? s).join(', ')}` : 'Any source';
    case 'trigger.stage_changed':
      return `${stageName(str(c.fromStageKey)) || 'Any stage'} → ${stageName(str(c.toStageKey)) || 'any stage'}`;
    case 'trigger.call_missed':
      return 'Any missed inbound call';
    case 'trigger.schedule':
      return describeCron(str(c.cron)) ?? 'Set a schedule';

    case 'action.upsert_contact':
      if (!c.createDeal) return 'Contact only';
      return typeof c.dealValueInr === 'number' ? `Contact + deal ${formatInr(c.dealValueInr)}` : 'Contact + deal at lead value';
    case 'action.send_whatsapp_template':
      return str(c.templateName) ? `Template ${str(c.templateName)}` : 'Choose a template';
    case 'action.send_whatsapp_text':
    case 'action.send_sms':
      return str(c.body).trim() || 'Write a message';
    case 'action.send_email':
      return str(c.subject) || 'Add a subject';
    case 'action.create_task':
      return str(c.title) || 'Add a title';
    case 'action.create_call_task': {
      const due = typeof c.dueInMinutes === 'number' ? `due in ${dueText(c.dueInMinutes)}` : '';
      return [enumLabel(str(c.priority) || 'high'), due].filter(Boolean).join(' · ');
    }
    case 'action.assign_owner': {
      const ids = arr(c.userIds) as string[];
      const strategy = str(c.strategy);
      if (strategy === 'specific') return ids[0] ? userName(ids[0]) : 'Choose a person';
      if (strategy === 'rule') return `By rule · ${plural(arr(c.rules).length, 'rule')}`;
      return `${enumLabel(strategy || 'round_robin')} · ${ids.length ? plural(ids.length, 'person', 'people') : 'all sales reps'}`;
    }
    case 'action.add_tag':
      return arr(c.tags).length ? arr(c.tags).join(', ') : 'Add tags';
    case 'action.change_stage':
      return str(c.stageKey) ? `Move to ${stageName(str(c.stageKey))}` : 'Choose a stage';
    case 'action.update_field':
      return str(c.field) ? `${str(c.field)} = ${valueText(c.value)}` : 'Choose a field';
    case 'action.outbound_webhook': {
      try {
        return `POST ${new URL(str(c.url)).host}`;
      } catch {
        return 'Add a URL';
      }
    }

    case 'logic.wait': {
      const amount = typeof c.amount === 'number' ? c.amount : 0;
      const unit = str(c.unit) || 'hours';
      const base = amount ? `${amount} ${amount === 1 ? unit.replace(/s$/, '') : unit}` : 'Set a duration';
      return [base, c.businessHoursOnly ? 'business hours' : null, c.resumeOnReply ? 'ends on reply' : null].filter(Boolean).join(' · ');
    }
    case 'logic.condition': {
      if (c.kind === 'replied') return c.since === 'run_start' ? 'Lead replied since the run started' : 'Lead replied to our last message';
      if (c.kind === 'keyword') return arr(c.keywords).length ? `Reply has ${arr(c.keywords).join(c.matchAll ? ' + ' : ' / ')}` : 'Add keywords';
      if (c.kind === 'field') {
        const r = (c.rule ?? {}) as Cfg;
        return `${str(r.field) || 'field'} ${OP_LABELS[str(r.op) as keyof typeof OP_LABELS] ?? str(r.op)} ${r.op === 'exists' ? '' : valueText(r.value)}`.trim();
      }
      return 'Choose a condition';
    }
    case 'logic.switch':
      return `${enumLabel(str(c.on) || 'reply_keyword')} · ${plural(arr(c.cases).length, 'case')} + default`;
    case 'logic.dedupe':
      return `${arr(c.matchBy).map((m) => enumLabel(String(m)).split(' (')[0]).join(', ') || 'Match by'} · ${typeof c.withinDays === 'number' ? c.withinDays : 90} days`;
    case 'logic.loop_limit':
      return typeof c.max === 'number' ? `Up to ${plural(c.max, 'pass', 'passes')}` : 'Set a limit';
    case 'logic.stop':
      return str(c.reason) || 'End the run';
    case 'ai.classify_intent':
      return arr(c.labels).join(', ') || 'Add labels';
  }
}

export function dueText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 1440 === 0) return plural(minutes / 1440, 'day');
  if (minutes % 60 === 0) return plural(minutes / 60, 'hour');
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
