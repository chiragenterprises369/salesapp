import { Injectable } from '@nestjs/common';
import {
  SETTING_KEYS,
  SETUP_ACKNOWLEDGEABLE_ITEMS,
  SETUP_SETTING_KEYS,
  type SetupChecklist,
  type SetupItem,
  type SetupItemKey,
} from '@vistar/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { IntegrationStore } from '../integrations/integration-store.js';
import { requireUserId } from '../workspace/users.service.js';

const AckSchema = z.array(z.string()).catch([]);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type ItemDraft = Omit<SetupItem, 'acknowledgeable' | 'acknowledged'>;

/**
 * COMPANY SETUP CHECKLIST (change #20, SPEC 30): computed from what the workspace has (no stored progress except
 * the items an admin ticks by hand), so it can never drift from reality.
 */
@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationStore,
  ) {}

  private async acknowledged(workspaceId: string): Promise<string[]> {
    const row = await this.prisma.forTenant(workspaceId).setting.findFirst({ where: { scope: 'workspace', scopeId: workspaceId, key: SETUP_SETTING_KEYS.acknowledged }, select: { value: true } });
    return AckSchema.parse(row?.value ?? []);
  }

  checklist(auth: AuthContext): Promise<SetupChecklist> {
    return this.checklistFor(auth.workspaceId, auth.userId);
  }

  /**
   * The checklist of any workspace. `userId` decides `bannerDismissed` (null: Super Admin view or an API key,
   * always false). Used by GET /setup and by GET /api/super/companies/{id}/setup.
   */
  async checklistFor(workspaceId: string, userId: string | null): Promise<SetupChecklist> {
    const wid = workspaceId;
    const db = this.prisma.forTenant(wid);
    const settingKeys = [SETTING_KEYS.workspace.brandingLogoLight, SETTING_KEYS.workspace.brandingBrandColor, SETTING_KEYS.workspace.sellerProfile];
    const [ws, settings, ack, banner, users, invites, customRoles, connected, approvedWa, emailTemplates, routing, forms, apiKeys, webhooks, markers, floorRequests, fieldStaff, features] = await Promise.all([
      db.workspace.findFirst({ select: { holidays: true } }),
      db.setting.findMany({ where: { scope: 'workspace', scopeId: wid, key: { in: settingKeys } }, select: { key: true, value: true } }),
      this.acknowledged(wid),
      userId ? db.setting.findFirst({ where: { scope: 'user', scopeId: userId, key: SETUP_SETTING_KEYS.bannerDismissed }, select: { value: true } }) : null,
      db.user.count({ where: { isActive: true, deletedAt: null } }),
      db.invite.count({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
      db.role.count({ where: { isSystem: false } }),
      db.integration.count({ where: { status: { in: ['connected', 'needs_attention'] } } }),
      db.template.count({ where: { channel: 'whatsapp', status: 'approved' } }),
      db.emailTemplate.count(),
      db.routingRule.count({ where: { active: true } }),
      db.captureForm.count({ where: { deletedAt: null } }),
      db.apiKey.count({ where: { revokedAt: null } }),
      db.webhookEndpoint.count(),
      db.officeMarker.count(),
      db.floorRequest.count(),
      db.user.findMany({ where: { isActive: true, deletedAt: null, isFieldStaff: true }, select: { id: true, devices: { select: { id: true }, take: 1 } } }),
      this.integrations.features(wid),
    ]);
    const s = new Map(settings.map((r) => [r.key, r.value]));
    const has = (k: string) => {
      const v = s.get(k);
      return v !== undefined && v !== null && v !== '';
    };
    const seller = s.get(SETTING_KEYS.workspace.sellerProfile) as { legalName?: string; address?: { stateCode?: string | null } } | undefined;
    const holidays = Array.isArray(ws?.holidays) ? ws.holidays.length : 0;
    const acked = (k: SetupItemKey) => ack.includes(k);
    const fieldWithDevice = fieldStaff.filter((u) => u.devices.length).length;
    const allDevices = fieldStaff.length ? undefined : await db.device.count();

    const drafts: ItemDraft[] = [
      { key: 'branding', label: 'Brand your workspace', description: 'Logo and brand colour for the app, PDFs and e-mails', status: has(SETTING_KEYS.workspace.brandingLogoLight) || has(SETTING_KEYS.workspace.brandingBrandColor) ? 'done' : 'todo', optional: false, href: '/app/settings/branding', actionLabel: 'Open branding', detail: has(SETTING_KEYS.workspace.brandingLogoLight) ? 'Logo uploaded' : null },
      { key: 'billing_profile', label: 'Add GST and billing details', description: 'Legal name, GSTIN and address on quotations and invoices', status: seller?.legalName && seller.address?.stateCode ? 'done' : 'todo', optional: false, href: '/app/settings/billing-profile', actionLabel: 'Add details', detail: null },
      { key: 'business_hours', label: 'Set business hours and holidays', description: 'Lead routing, tracking and reminders follow your working hours', status: holidays > 0 || acked('business_hours') ? 'done' : 'todo', optional: false, href: '/app/settings/hours', actionLabel: 'Set hours', detail: holidays ? `${plural(holidays, 'holiday')} added` : 'Default hours: Monday to Saturday' },
      { key: 'team_invited', label: 'Invite your team', description: 'Add managers and employees', status: users > 1 ? 'done' : invites > 0 ? 'in_progress' : 'todo', optional: false, href: '/app/team', actionLabel: 'Invite people', detail: users > 1 ? `${plural(users, 'member')}` : invites ? `${plural(invites, 'invite')} pending` : null },
      { key: 'roles_reviewed', label: 'Review roles and permissions', description: 'Check what managers, employees and viewers can see and do', status: customRoles > 0 || acked('roles_reviewed') ? 'done' : 'todo', optional: false, href: '/app/settings/roles', actionLabel: 'Review roles', detail: customRoles ? `${plural(customRoles, 'custom role')}` : null },
      { key: 'integrations', label: 'Connect your channels', description: 'IndiaMART, WhatsApp, telephony, e-mail or Google Calendar', status: connected > 0 ? 'done' : 'todo', optional: false, href: '/app/integrations', actionLabel: 'Open integrations', detail: connected ? `${plural(connected, 'integration')} connected` : null },
      { key: 'whatsapp_templates', label: 'Get WhatsApp templates approved', description: 'Templates are needed to message customers after 24 hours', status: !features.whatsapp ? 'not_applicable' : approvedWa > 0 ? 'done' : 'todo', optional: false, href: '/app/settings/whatsapp-templates', actionLabel: 'Open templates', detail: features.whatsapp ? `${plural(approvedWa, 'approved template')}` : 'WhatsApp is not in your plan' },
      { key: 'email_templates', label: 'Review e-mail templates', description: 'Quotation, invoice, reminder and meeting e-mails with your branding', status: emailTemplates > 0 || acked('email_templates') ? 'done' : 'todo', optional: false, href: '/app/settings/email-templates', actionLabel: 'Open e-mail templates', detail: emailTemplates ? `${plural(emailTemplates, 'template')} customised` : 'Using the defaults' },
      { key: 'lead_routing', label: 'Set up lead routing', description: 'Assign new leads automatically (round-robin or least busy)', status: routing > 0 ? 'done' : 'todo', optional: false, href: '/app/settings/lead-routing', actionLabel: 'Add a rule', detail: routing ? `${plural(routing, 'active rule')}` : null },
      { key: 'capture_forms', label: 'Create a lead capture form', description: 'Collect leads from your website or a hosted page', status: forms > 0 ? 'done' : 'todo', optional: false, href: '/app/settings/lead-capture', actionLabel: 'Create a form', detail: forms ? `${plural(forms, 'form')}` : null },
      { key: 'api_webhooks', label: 'API keys and webhooks', description: 'Connect your ERP, website or Zapier', status: apiKeys + webhooks > 0 ? 'done' : 'todo', optional: true, href: '/app/settings/api-keys', actionLabel: 'Open API keys', detail: apiKeys + webhooks ? [apiKeys ? plural(apiKeys, 'API key') : null, webhooks ? plural(webhooks, 'webhook') : null].filter(Boolean).join(', ') : null },
      { key: 'office_floor', label: 'Office markers and your 3D floor', description: 'Room markers for zone tracking and a custom Team Floor of your office', status: markers + floorRequests > 0 ? 'done' : 'todo', optional: true, href: '/app/settings/office-markers', actionLabel: 'Add markers', detail: [markers ? plural(markers, 'marker') : null, floorRequests ? 'floor requested' : null].filter(Boolean).join(', ') || null },
      {
        key: 'android_app',
        label: 'Install the Android app',
        description: 'Employees install the app for SIM calling, attendance and push notifications',
        status: acked('android_app') ? 'done' : fieldStaff.length ? (fieldWithDevice === fieldStaff.length ? 'done' : fieldWithDevice ? 'in_progress' : 'todo') : (allDevices ?? 0) > 0 ? 'done' : 'todo',
        optional: false,
        href: '/app/team',
        actionLabel: 'Share the app link',
        detail: fieldStaff.length ? `${fieldWithDevice} of ${plural(fieldStaff.length, 'field staff member')} registered a device` : allDevices ? `${plural(allDevices, 'device')} registered` : null,
      },
    ];
    const items: SetupItem[] = drafts.map((d) => ({ ...d, acknowledgeable: SETUP_ACKNOWLEDGEABLE_ITEMS.includes(d.key), acknowledged: acked(d.key) }));
    const required = items.filter((i) => !i.optional && i.status !== 'not_applicable');
    const done = required.filter((i) => i.status === 'done').length;
    const percent = required.length ? Math.round((done / required.length) * 100) : 100;
    return { items, done, total: required.length, percent, complete: done === required.length, bannerDismissed: !!banner?.value };
  }

  private async upsertSetting(auth: AuthContext, scope: 'workspace' | 'user', key: string, value: Prisma.InputJsonValue): Promise<void> {
    const scopeId = scope === 'workspace' ? auth.workspaceId : requireUserId(auth);
    await this.prisma.forTenant(auth.workspaceId).setting.upsert({
      where: { workspaceId_scope_scopeId_key: { workspaceId: auth.workspaceId, scope, scopeId, key } },
      create: { workspaceId: auth.workspaceId, scope, scopeId, key, value },
      update: { value },
    });
  }

  async acknowledge(auth: AuthContext, req: Request, key: SetupItemKey, acknowledged: boolean): Promise<SetupChecklist> {
    if (!SETUP_ACKNOWLEDGEABLE_ITEMS.includes(key)) throw new AppException('VALIDATION_FAILED', 'This item is detected automatically and cannot be ticked by hand');
    const current = await this.acknowledged(auth.workspaceId);
    const next = acknowledged ? [...new Set([...current, key])] : current.filter((k) => k !== key);
    await this.upsertSetting(auth, 'workspace', SETUP_SETTING_KEYS.acknowledged, next);
    await this.audit.record(auth, req, { action: 'setup.acknowledge', entityType: 'workspace', entityId: auth.workspaceId, diff: { key, acknowledged } });
    return this.checklist(auth);
  }

  async banner(auth: AuthContext, dismissed: boolean): Promise<SetupChecklist> {
    if (dismissed) await this.upsertSetting(auth, 'user', SETUP_SETTING_KEYS.bannerDismissed, new Date().toISOString());
    else await this.prisma.forTenant(auth.workspaceId).setting.deleteMany({ where: { scope: 'user', scopeId: requireUserId(auth), key: SETUP_SETTING_KEYS.bannerDismissed } });
    return this.checklist(auth);
  }
}
