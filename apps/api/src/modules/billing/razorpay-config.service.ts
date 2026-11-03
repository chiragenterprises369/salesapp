import { Injectable } from '@nestjs/common';
import { PLATFORM_SETTING_KEYS, type RazorpayConfigStatus, type RazorpayConfigUpdate, type RazorpayMode } from '@vistar/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service.js';
import type { PlatformAuthContext } from '../../common/auth/auth-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import { decryptSecret, encryptSecret } from '../../infra/crypto/secrets.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

const KEY = PLATFORM_SETTING_KEYS.razorpay;
const CACHE_MS = 30_000;

const PublicSchema = z.object({ mode: z.enum(['test', 'live']), keyId: z.string(), enabled: z.boolean(), keySecretLast4: z.string().nullable().default(null), lastWebhookAt: z.string().nullable().default(null) });
const SecretSchema = z.object({ keySecret: z.string().min(1), webhookSecret: z.string().min(1) });

export interface RazorpayCredentials {
  mode: RazorpayMode;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

/** Which provider checkout uses now (BILLING_PROVIDER, the Razorpay config, NODE_ENV). */
export type ActiveProvider = { kind: 'razorpay'; creds: RazorpayCredentials } | { kind: 'mock' } | { kind: 'none' };

/**
 * Razorpay config in PlatformSetting billing.razorpay: `value` = mode, key id, enabled (public; checkout.js needs
 * the key id), `secretEncrypted` = AES-256-GCM JSON of the key secret and webhook secret (ENCRYPTION_KEY). Secrets
 * are write-only: never returned, never logged, only the last 4 characters of the key secret are shown.
 */
@Injectable()
export class RazorpayConfigService {
  private cache: { at: number; creds: RazorpayCredentials | null; enabled: boolean } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async load(): Promise<{ creds: RazorpayCredentials | null; enabled: boolean }> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    const row = await this.prisma.platformSetting.findUnique({ where: { key: KEY } });
    const pub = PublicSchema.safeParse(row?.value);
    let creds: RazorpayCredentials | null = null;
    if (pub.success && row?.secretEncrypted) {
      try {
        const secret = SecretSchema.parse(JSON.parse(decryptSecret(row.secretEncrypted)));
        creds = { mode: pub.data.mode, keyId: pub.data.keyId, ...secret };
      } catch {
        creds = null; // ENCRYPTION_KEY changed or a broken row: treated as not configured
      }
    }
    this.cache = { at: Date.now(), creds, enabled: pub.success && pub.data.enabled };
    return this.cache;
  }

  /** BILLING_PROVIDER=razorpay|mock|none forces a provider; auto = Razorpay when configured, else mock outside production. */
  async active(): Promise<ActiveProvider> {
    const env = getEnv();
    const choice = env.BILLING_PROVIDER;
    if (choice === 'none') return { kind: 'none' };
    if (choice === 'mock') return env.NODE_ENV === 'production' ? { kind: 'none' } : { kind: 'mock' };
    const { creds, enabled } = await this.load();
    if (creds && enabled) return { kind: 'razorpay', creds };
    if (choice === 'razorpay') return { kind: 'none' };
    return env.NODE_ENV === 'production' ? { kind: 'none' } : { kind: 'mock' };
  }

  /** Credentials for a payment that was created with Razorpay (even if the config was disabled since). */
  async credentials(): Promise<RazorpayCredentials | null> {
    return (await this.load()).creds;
  }

  async status(): Promise<RazorpayConfigStatus> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: KEY } });
    const pub = PublicSchema.safeParse(row?.value);
    const active = await this.active();
    return {
      configured: pub.success && !!row?.secretEncrypted,
      enabled: pub.success && pub.data.enabled,
      mode: pub.success ? pub.data.mode : null,
      keyId: pub.success ? pub.data.keyId : null,
      keySecretLast4: pub.success ? pub.data.keySecretLast4 : null,
      webhookSecretSet: pub.success && !!row?.secretEncrypted,
      webhookUrl: `${getEnv().API_PUBLIC_URL.replace(/\/$/, '')}/api/hooks/razorpay`,
      activeProvider: active.kind,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      lastWebhookAt: pub.success ? pub.data.lastWebhookAt : null,
    };
  }

  async save(admin: PlatformAuthContext, req: Request, body: RazorpayConfigUpdate): Promise<RazorpayConfigStatus> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: KEY } });
    const prevPub = PublicSchema.safeParse(row?.value);
    let prevSecret: z.infer<typeof SecretSchema> | null = null;
    if (row?.secretEncrypted) {
      try {
        prevSecret = SecretSchema.parse(JSON.parse(decryptSecret(row.secretEncrypted)));
      } catch {
        prevSecret = null;
      }
    }
    const keySecret = body.keySecret ?? prevSecret?.keySecret;
    const webhookSecret = body.webhookSecret ?? prevSecret?.webhookSecret;
    const missing = [!keySecret && 'keySecret', !webhookSecret && 'webhookSecret'].filter((x): x is string => !!x);
    if (missing.length) throw new AppException('VALIDATION_FAILED', 'Some fields are invalid', { details: missing.map((path) => ({ path, message: 'Enter the secret (needed on the first save)' })) });
    const value = { mode: body.mode, keyId: body.keyId, enabled: body.enabled, keySecretLast4: keySecret!.slice(-4), lastWebhookAt: prevPub.success ? prevPub.data.lastWebhookAt : null };
    const secretEncrypted = encryptSecret(JSON.stringify({ keySecret, webhookSecret }));
    await this.prisma.platformSetting.upsert({ where: { key: KEY }, create: { key: KEY, value, secretEncrypted, updatedById: admin.adminId }, update: { value, secretEncrypted, updatedById: admin.adminId } });
    this.cache = null;
    await this.audit.platform(admin, req, {
      action: 'config.razorpay',
      entityType: 'platform_setting',
      entityId: KEY,
      diff: { mode: body.mode, keyId: body.keyId, enabled: body.enabled, keySecretChanged: !!body.keySecret, webhookSecretChanged: !!body.webhookSecret },
    });
    return this.status();
  }

  async remove(admin: PlatformAuthContext, req: Request): Promise<RazorpayConfigStatus> {
    const { count } = await this.prisma.platformSetting.deleteMany({ where: { key: KEY } });
    this.cache = null;
    if (count) await this.audit.platform(admin, req, { action: 'config.razorpay_remove', entityType: 'platform_setting', entityId: KEY });
    return this.status();
  }

  /** Remember the last verified webhook (shown on the config card). */
  async touchWebhook(at: Date): Promise<void> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: KEY } });
    const pub = PublicSchema.safeParse(row?.value);
    if (!row || !pub.success) return;
    await this.prisma.platformSetting.update({ where: { key: KEY }, data: { value: { ...pub.data, lastWebhookAt: at.toISOString() } } });
  }
}
