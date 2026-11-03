import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  configFieldActive,
  configFieldSchema,
  configSettingKey,
  maskSecretHint,
  PLATFORM_CONFIG_GROUPS,
  PLATFORM_SETTING_KEYS,
  REGISTRY_GROUP_KEYS,
  type ConfigAuditEntry,
  type ConfigFieldDef,
  type ConfigGroup,
  type ConfigGroupKey,
  type ConfigGroupStatus,
  type ConfigGroupUpdate,
  type ConfigRegistry,
  type ConfigTestResult,
  type ConfigValue,
  type RegistryGroupKey,
} from '@vistar/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service.js';
import type { PlatformAuthContext } from '../../common/auth/auth-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { decryptSecret, encryptSecret } from '../../infra/crypto/secrets.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { clientIp } from '../auth/auth.constants.js';
import { ipAllowed } from '../auth/super/ip-allowlist.js';
import { buildSnapshot, platformConfig, setPlatformConfigSnapshot, type PanelValues } from './snapshot.js';

const REFRESH_MS = 30_000;

/** Stored in PlatformSetting.value of `config.<group>` (never secrets). */
const StoredValueSchema = z.object({
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).default({}),
  hints: z.record(z.string(), z.string()).default({}),
  lastTest: z.object({ ok: z.boolean(), message: z.string(), latencyMs: z.number().int().nullable(), at: z.string(), details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable().default(null) }).nullable().default(null),
});
type StoredValue = z.infer<typeof StoredValueSchema>;

interface GroupRow {
  stored: StoredValue;
  secrets: Record<string, string>;
  updatedAt: Date | null;
  updatedById: string | null;
}

const fieldsOf = (group: ConfigGroupKey) => PLATFORM_CONFIG_GROUPS[group].fields as readonly ConfigFieldDef[];
const isRegistry = (g: ConfigGroupKey): g is RegistryGroupKey => PLATFORM_CONFIG_GROUPS[g].kind === 'registry';

export type ConfigChangeListener = (group: RegistryGroupKey) => void;

/**
 * PLATFORM CONFIG REGISTRY (change #20, D-073). Super Admin > Config: typed groups, secrets encrypted with
 * ENCRYPTION_KEY and write-only (masked hints), status per group, test actions, audit trail. Keeps the in-memory
 * snapshot (`platformConfig()`) fresh: at boot, every 30 s (other instances) and right after a change.
 */
@Injectable()
export class PlatformConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformConfigService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly listeners: ConfigChangeListener[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload().catch((err: Error) => this.logger.error(`Platform config load failed, using env fallbacks: ${err.name}`));
    this.timer = setInterval(() => void this.reload().catch(() => undefined), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Run on every change of a group (this instance: at once; others: on the next refresh). */
  onChange(fn: ConfigChangeListener): void {
    this.listeners.push(fn);
  }

  private async rows(): Promise<Map<RegistryGroupKey, GroupRow>> {
    const keys = REGISTRY_GROUP_KEYS.map(configSettingKey);
    const rows = await this.prisma.platformSetting.findMany({ where: { key: { in: keys } } });
    const out = new Map<RegistryGroupKey, GroupRow>();
    for (const r of rows) {
      const group = r.key.slice('config.'.length) as RegistryGroupKey;
      const parsed = StoredValueSchema.safeParse(r.value ?? {});
      let secrets: Record<string, string> = {};
      if (r.secretEncrypted) {
        try {
          secrets = z.record(z.string(), z.string()).parse(JSON.parse(decryptSecret(r.secretEncrypted)));
        } catch {
          this.logger.warn(`Secrets of ${r.key} could not be decrypted (ENCRYPTION_KEY changed?); treated as not set`);
        }
      }
      out.set(group, { stored: parsed.success ? parsed.data : { values: {}, hints: {}, lastTest: null }, secrets, updatedAt: r.updatedAt, updatedById: r.updatedById });
    }
    return out;
  }

  /** Reload the snapshot from the database; listeners run for groups whose values changed. */
  async reload(): Promise<void> {
    const rows = await this.rows();
    const panels: Partial<Record<RegistryGroupKey, PanelValues>> = {};
    for (const [g, row] of rows) panels[g] = { ...row.stored.values, ...row.secrets };
    const before = platformConfig();
    setPlatformConfigSnapshot(buildSnapshot(panels, true));
    const after = platformConfig();
    const changed = REGISTRY_GROUP_KEYS.filter((g) => JSON.stringify(before[g].values) !== JSON.stringify(after[g].values));
    for (const g of changed) {
      for (const fn of this.listeners) {
        try {
          fn(g);
        } catch (err) {
          this.logger.error(`Config change listener for ${g} failed: ${(err as Error).name}`);
        }
      }
    }
  }

  // ---------------------------------------------------------------- read

  async registry(): Promise<ConfigRegistry> {
    const [rows, cards, names] = await Promise.all([this.rows(), this.cardStatuses(), this.adminNames()]);
    return {
      environment: getEnv().NODE_ENV,
      groups: (Object.keys(PLATFORM_CONFIG_GROUPS) as ConfigGroupKey[]).map((g) => (isRegistry(g) ? this.toDto(g, rows.get(g) ?? null, names) : this.cardDto(g, cards[g as CardKey]))),
    };
  }

  async group(group: ConfigGroupKey): Promise<ConfigGroup> {
    if (!isRegistry(group)) return this.cardDto(group, (await this.cardStatuses())[group as CardKey]);
    const rows = await this.rows();
    return this.toDto(group, rows.get(group) ?? null, await this.adminNames());
  }

  private async adminNames(): Promise<Map<string, string>> {
    const admins = await this.prisma.platformAdmin.findMany({ select: { id: true, name: true } });
    return new Map(admins.map((a) => [a.id, a.name]));
  }

  private toDto(group: RegistryGroupKey, row: GroupRow | null, names: Map<string, string>): ConfigGroup {
    const def = PLATFORM_CONFIG_GROUPS[group];
    const resolved = platformConfig()[group];
    const production = getEnv().NODE_ENV === 'production';
    const effective = Object.fromEntries(Object.entries(resolved.fields).map(([k, r]) => [k, r.value]));
    const ev = resolved.evaluation;
    const fields = fieldsOf(group).map((f) => {
      const r = resolved.fields[f.key] ?? { value: null, source: 'none' as const };
      const secret = f.type === 'secret';
      const panelSecret = row?.secrets[f.key];
      const secretHint = secret ? (panelSecret ? (row?.stored.hints[f.key] ?? maskSecretHint(panelSecret)) : r.value ? maskSecretHint(String(r.value)) : null) : null;
      return {
        key: f.key,
        label: f.label,
        type: f.type,
        secret,
        help: f.help ?? null,
        placeholder: f.placeholder ?? null,
        required: !!f.required,
        active: configFieldActive(f, effective),
        when: f.when ? { field: f.when.field, in: [...f.when.in] } : null,
        options: f.options ? f.options.map((o) => ({ value: o.value, label: o.label })) : null,
        min: f.min ?? null,
        max: f.max ?? null,
        value: secret ? null : r.value,
        panelValue: secret ? null : ((row?.stored.values[f.key] as ConfigValue | undefined) ?? null),
        source: r.source,
        envVar: f.env ?? null,
        defaultValue: f.type === 'secret' ? null : (f.default ?? (!production ? f.devDefault : undefined) ?? null),
        secretSet: secret ? r.value !== null : false,
        secretHint,
      };
    });
    const label = (k: string) => fieldsOf(group).find((f) => f.key === k)?.label ?? k;
    const statusNote =
      ev.status === 'missing'
        ? `Missing: ${ev.missing.map(label).join(', ')}`
        : ev.status === 'dev_default'
          ? `Development default for ${ev.devDefaults.map(label).join(', ')}; set real values before going live`
          : ev.status === 'env_fallback'
            ? `From the server env: ${ev.fromEnv.map((k) => fieldsOf(group).find((f) => f.key === k)?.env ?? k).join(', ')}. Save them here to manage them in the panel`
            : null;
    return {
      key: group,
      label: def.label,
      description: def.description,
      icon: def.icon,
      kind: 'registry',
      status: ev.status,
      statusNote,
      requiredInProduction: def.requiredInProduction,
      testable: def.testable,
      testLabel: 'testLabel' in def ? (def.testLabel ?? null) : null,
      testNeedsRecipient: 'testNeedsRecipient' in def ? !!def.testNeedsRecipient : false,
      cardAnchor: null,
      fields,
      missing: ev.missing,
      lastTest: row?.stored.lastTest ?? null,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      updatedBy: row?.updatedById ? { id: row.updatedById, name: names.get(row.updatedById) ?? 'Super Admin' } : null,
    };
  }

  // ---------------------------------------------------------------- cards (existing routes; status only)

  async cardStatuses(): Promise<Record<CardKey, CardStatus>> {
    const production = getEnv().NODE_ENV === 'production';
    const settings = await this.prisma.platformSetting.findMany({ where: { key: { in: ['firebase.client', 'firebase.serviceAccount', PLATFORM_SETTING_KEYS.razorpay, PLATFORM_SETTING_KEYS.billingProfile] } } });
    const byKey = new Map(settings.map((s) => [s.key, s]));
    const releases = await this.prisma.androidRelease.count();
    const latest = releases ? await this.prisma.androidRelease.findFirst({ orderBy: { versionCode: 'desc' }, select: { versionName: true, createdAt: true } }) : null;

    const fc = byKey.get('firebase.client');
    const fsa = byKey.get('firebase.serviceAccount');
    const firebase: CardStatus = fc && fsa?.secretEncrypted
      ? { status: 'configured', note: null, updatedAt: newest(fc.updatedAt, fsa.updatedAt) }
      : { status: 'missing', note: !fc && !fsa?.secretEncrypted ? 'Upload google-services.json and the service account JSON' : !fc ? 'Upload google-services.json (Android app options)' : 'Upload the service account JSON (push sending)', updatedAt: fc?.updatedAt ?? fsa?.updatedAt ?? null };

    const rz = byKey.get(PLATFORM_SETTING_KEYS.razorpay);
    const rzPub = (rz?.value ?? null) as { mode?: string; enabled?: boolean } | null;
    const razorpay: CardStatus = rz?.secretEncrypted && rzPub?.enabled
      ? { status: 'configured', note: rzPub.mode === 'live' ? 'Live mode' : 'Test mode: switch to live keys before going live', updatedAt: rz.updatedAt }
      : production
        ? { status: 'missing', note: rz ? 'Razorpay is saved but switched off' : 'Add the Razorpay key id, key secret and webhook secret', updatedAt: rz?.updatedAt ?? null }
        : { status: 'dev_default', note: 'Mock checkout in development until Razorpay is saved and enabled', updatedAt: rz?.updatedAt ?? null };

    const bp = byKey.get(PLATFORM_SETTING_KEYS.billingProfile);
    const bpv = (bp?.value ?? null) as { legalName?: string; gstin?: string | null; address?: { stateCode?: string } } | null;
    const billing_profile: CardStatus = bpv?.legalName && bpv.address?.stateCode
      ? { status: 'configured', note: bpv.gstin ? null : 'No GSTIN: invoices go out without GST registration details', updatedAt: bp!.updatedAt }
      : { status: 'missing', note: 'Save the legal name and the state of Vistar\'s billing address', updatedAt: bp?.updatedAt ?? null };

    const android_releases: CardStatus = releases
      ? { status: 'configured', note: `Latest ${latest?.versionName ?? ''} (${releases} release${releases === 1 ? '' : 's'})`.trim(), updatedAt: latest?.createdAt ?? null }
      : { status: 'missing', note: 'Upload the first APK so employees can install the app', updatedAt: null };

    return { firebase, razorpay, billing_profile, android_releases };
  }

  private cardDto(group: ConfigGroupKey, card: CardStatus): ConfigGroup {
    const def = PLATFORM_CONFIG_GROUPS[group];
    return {
      key: group,
      label: def.label,
      description: def.description,
      icon: def.icon,
      kind: 'card',
      status: card.status,
      statusNote: card.note,
      requiredInProduction: def.requiredInProduction,
      testable: false,
      testLabel: null,
      testNeedsRecipient: false,
      cardAnchor: 'cardAnchor' in def ? (def.cardAnchor ?? null) : null,
      fields: [],
      missing: [],
      lastTest: null,
      updatedAt: card.updatedAt?.toISOString() ?? null,
      updatedBy: null,
    };
  }

  // ---------------------------------------------------------------- write

  async update(admin: PlatformAuthContext, req: Request, group: RegistryGroupKey, body: ConfigGroupUpdate): Promise<ConfigGroup> {
    const defs = fieldsOf(group);
    const details: { path: string; message: string }[] = [];
    const current = (await this.rows()).get(group) ?? { stored: { values: {}, hints: {}, lastTest: null }, secrets: {}, updatedAt: null, updatedById: null };
    const values: Record<string, ConfigValue> = { ...current.stored.values };
    const secrets: Record<string, string> = { ...current.secrets };
    const hints: Record<string, string> = { ...current.stored.hints };
    const changed: string[] = [];
    const cleared: string[] = [];

    for (const [key, raw] of Object.entries(body.values)) {
      const f = defs.find((d) => d.key === key);
      if (!f) {
        details.push({ path: `values.${key}`, message: 'Unknown field' });
        continue;
      }
      if (raw === null || raw === '') {
        if (f.type === 'secret' ? key in secrets : key in values) cleared.push(key);
        delete values[key];
        delete secrets[key];
        delete hints[key];
        continue;
      }
      const parsed = configFieldSchema(f).safeParse(typeof raw === 'string' && f.type !== 'secret' && f.type !== 'textarea' ? raw.trim() : raw);
      if (!parsed.success) {
        details.push({ path: `values.${key}`, message: parsed.error.issues[0]?.message ?? 'Invalid value' });
        continue;
      }
      if (f.type === 'secret') {
        const s = String(parsed.data);
        if (secrets[key] !== s) changed.push(key);
        secrets[key] = s;
        hints[key] = maskSecretHint(s);
      } else {
        if (JSON.stringify(values[key]) !== JSON.stringify(parsed.data)) changed.push(key);
        values[key] = parsed.data;
      }
    }
    this.extraChecks(group, values, req, details);
    if (details.length) throw new AppException('VALIDATION_FAILED', 'Some fields are invalid', { details });

    const key = configSettingKey(group);
    // Values changed: the last test no longer says anything about them.
    const stored: StoredValue = { values, hints, lastTest: changed.length || cleared.length ? null : current.stored.lastTest };
    const secretEncrypted = Object.keys(secrets).length ? encryptSecret(JSON.stringify(secrets)) : null;
    await this.prisma.platformSetting.upsert({
      where: { key },
      create: { key, value: stored as unknown as Prisma.InputJsonObject, secretEncrypted, updatedById: admin.adminId },
      update: { value: stored as unknown as Prisma.InputJsonObject, secretEncrypted, updatedById: admin.adminId },
    });
    await this.reload();
    if (changed.length || cleared.length) {
      await this.audit.platform(admin, req, { action: `config.${group}.update`, entityType: 'platform_config', entityId: group, diff: { changed, cleared } });
    }
    return this.group(group);
  }

  /** Cross-field rules the field schemas cannot express. */
  private extraChecks(group: RegistryGroupKey, values: Record<string, ConfigValue>, req: Request, details: { path: string; message: string }[]): void {
    const production = getEnv().NODE_ENV === 'production';
    if (group === 'security') {
      const list = values.superIpAllowlist;
      if (Array.isArray(list) && list.length && !ipAllowed(clientIp(req), list)) {
        details.push({ path: 'values.superIpAllowlist', message: `Your current IP (${clientIp(req) ?? 'unknown'}) is not in the list: add it first or you lock yourself out` });
      }
    }
    if (group === 'storage' && production) {
      if (values.driver === 'local') details.push({ path: 'values.driver', message: 'Local disk is not allowed in production: use S3 or Bunny' });
      if (typeof values.s3Endpoint === 'string' && !values.s3Endpoint.startsWith('https://')) details.push({ path: 'values.s3Endpoint', message: 'Use an https endpoint in production' });
    }
    if (group === 'email' && production && values.smtpTls === 'none') details.push({ path: 'values.smtpTls', message: 'Use STARTTLS or TLS in production' });
    if (group === 'telephony' && production && values.provider === 'mock') details.push({ path: 'values.provider', message: 'Mock telephony is not allowed in production' });
    if (group === 'google_oauth' && typeof values.clientId === 'string' && !/\.apps\.googleusercontent\.com$/.test(values.clientId)) {
      details.push({ path: 'values.clientId', message: 'A Google OAuth client id ends with .apps.googleusercontent.com' });
    }
    if (group === 'whatsapp_app' && typeof values.graphVersion === 'string' && !/^v\d{1,2}\.\d$/.test(values.graphVersion)) details.push({ path: 'values.graphVersion', message: 'Use a Graph API version like v23.0' });
  }

  async reset(admin: PlatformAuthContext, req: Request, group: RegistryGroupKey): Promise<ConfigGroup> {
    const { count } = await this.prisma.platformSetting.deleteMany({ where: { key: configSettingKey(group) } });
    await this.reload();
    if (count) await this.audit.platform(admin, req, { action: `config.${group}.reset`, entityType: 'platform_config', entityId: group });
    return this.group(group);
  }

  /** Store a test result on the group (shown on the card) and audit it. */
  async recordTest(admin: PlatformAuthContext, req: Request, group: RegistryGroupKey, result: ConfigTestResult): Promise<void> {
    const key = configSettingKey(group);
    const row = await this.prisma.platformSetting.findUnique({ where: { key } });
    const parsed = StoredValueSchema.safeParse(row?.value ?? {});
    const stored: StoredValue = { ...(parsed.success ? parsed.data : { values: {}, hints: {}, lastTest: null }), lastTest: result };
    await this.prisma.platformSetting.upsert({
      where: { key },
      create: { key, value: stored as unknown as Prisma.InputJsonObject, updatedById: admin.adminId },
      // updatedById stays: a test is not a change of values.
      update: { value: stored as unknown as Prisma.InputJsonObject },
    });
    await this.audit.platform(admin, req, { action: `config.${group}.test`, entityType: 'platform_config', entityId: group, diff: { ok: result.ok } });
  }

  /** Last stored test of a group (go-live: "platform email tested"). */
  async lastTest(group: RegistryGroupKey): Promise<ConfigTestResult | null> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: configSettingKey(group) } });
    const parsed = StoredValueSchema.safeParse(row?.value ?? {});
    return parsed.success ? parsed.data.lastTest : null;
  }

  // ---------------------------------------------------------------- audit trail

  async auditTrail(group: ConfigGroupKey): Promise<{ items: ConfigAuditEntry[] }> {
    const where: Prisma.PlatformAuditLogWhereInput = isRegistry(group)
      ? { entityType: 'platform_config', entityId: group }
      : group === 'firebase'
        ? { entityType: 'platform_setting', entityId: { in: ['firebase.client', 'firebase.serviceAccount'] } }
        : group === 'razorpay'
          ? { entityType: 'platform_setting', entityId: PLATFORM_SETTING_KEYS.razorpay }
          : group === 'billing_profile'
            ? { entityType: 'platform_setting', entityId: PLATFORM_SETTING_KEYS.billingProfile }
            : { entityType: 'android_release' };
    const rows = await this.prisma.platformAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 });
    return {
      items: rows.map((r) => {
        const diff = (r.diff ?? {}) as { changed?: unknown; cleared?: unknown; ok?: unknown };
        const keys = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
        return { id: r.id, action: r.action, adminName: r.adminName, changed: keys(diff.changed), cleared: keys(diff.cleared), ok: typeof diff.ok === 'boolean' ? diff.ok : null, ip: r.ip, at: r.createdAt.toISOString() };
      }),
    };
  }
}

type CardKey = 'firebase' | 'razorpay' | 'billing_profile' | 'android_releases';
interface CardStatus {
  status: ConfigGroupStatus;
  note: string | null;
  updatedAt: Date | null;
}

function newest(a: Date, b: Date): Date {
  return a > b ? a : b;
}
