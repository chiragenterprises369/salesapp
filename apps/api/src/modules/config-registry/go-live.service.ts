import { Injectable } from '@nestjs/common';
import { type GoLiveCheck, type GoLiveCheckKey, type GoLiveChecklist } from '@vistar/shared';
import { COMPANY_FIXTURES } from '@vistar/shared/fixtures';
import { getEnv } from '../../config/env.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { PlatformConfigService } from './platform-config.service.js';
import { platformConfig, storageConfig, telephonyConfig } from './snapshot.js';

const PLACEHOLDER = /change[-_ ]?me|changeme|secret|example|placeholder|password|vistar|dev[-_]|test[-_]|^x+$|^0+$/i;
const BACKUP_FRESH_MS = 48 * 3_600_000;

/** A server secret looks generated: long, varied, no placeholder words. */
export function strongSecret(v: string | undefined, min = 48): boolean {
  if (!v || v.length < min) return false;
  if (PLACEHOLDER.test(v)) return false;
  return new Set(v).size >= 16;
}

const cfgHref = (group: string) => `/super-admin/config?group=${group}`;

/**
 * GO-LIVE CHECKLIST (change #20, SPEC 30): computed production checks for the Super Admin, each with a status, a
 * reason and where to fix it. Also used for a boot log in production (PROD-HUB): `await goLive.evaluate()`.
 */
@Injectable()
export class GoLiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PlatformConfigService,
  ) {}

  async evaluate(): Promise<GoLiveChecklist> {
    const env = getEnv();
    const production = env.NODE_ENV === 'production';
    const snap = platformConfig();
    const items: GoLiveCheck[] = [];
    const add = (key: GoLiveCheckKey, label: string, status: GoLiveCheck['status'], detail: string, fixHref: string | null, blocking = true) => items.push({ key, label, status, detail, fixHref, blocking });

    add('node_env', 'Production mode', production ? 'pass' : 'fail', production ? 'NODE_ENV is production' : `NODE_ENV is ${env.NODE_ENV}: development defaults, mock providers and dev CORS are on`, null);

    const secrets = { JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET, JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET, SUPER_JWT_SECRET: env.SUPER_JWT_SECRET };
    const weak = Object.entries(secrets).filter(([, v]) => !strongSecret(v)).map(([k]) => k);
    const distinct = new Set(Object.values(secrets)).size === 3;
    const key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
    const keyOk = key.length === 32 && new Set(key).size >= 20;
    add(
      'secrets_strong',
      'Strong server secrets',
      !weak.length && distinct && keyOk ? 'pass' : 'fail',
      !weak.length && distinct && keyOk
        ? 'JWT, Super Admin and encryption secrets are long, random and different'
        : [weak.length ? `Too short or placeholder: ${weak.join(', ')} (use 48+ random characters: pnpm setup:env)` : null, !distinct ? 'The JWT secrets must all differ' : null, !keyOk ? 'ENCRYPTION_KEY is not 32 random bytes' : null].filter(Boolean).join('. '),
      null,
    );

    const httpsOk = env.WEB_ORIGIN.startsWith('https://') && env.API_PUBLIC_URL.startsWith('https://');
    add('public_urls_https', 'HTTPS public URLs', httpsOk ? 'pass' : 'fail', httpsOk ? 'WEB_ORIGIN and API_PUBLIC_URL use https' : `WEB_ORIGIN (${env.WEB_ORIGIN}) and API_PUBLIC_URL (${env.API_PUBLIC_URL}) must start with https://`, null);

    const storage = storageConfig();
    const storageTest = await this.config.lastTest('storage');
    const cloud = storage && storage.driver !== 'local';
    add(
      'storage_cloud',
      'Cloud file storage',
      !cloud ? 'fail' : storageTest?.ok ? 'pass' : 'warn',
      !storage ? 'File storage is not configured' : !cloud ? 'Uploads go to the local disk of this server: use S3 or Bunny' : storageTest?.ok ? `${storage.driver === 'bunny' ? 'Bunny' : 'S3'} storage tested ${storageTest.at.slice(0, 10)}` : `${storage.driver === 'bunny' ? 'Bunny' : 'S3'} storage is set but not tested yet`,
      cfgHref('storage'),
    );

    const email = snap.email.evaluation;
    add('email_configured', 'Platform email', email.status === 'configured' || email.status === 'env_fallback' ? 'pass' : 'fail', email.status === 'missing' ? `Missing: ${email.missing.join(', ')}` : email.status === 'dev_default' ? 'Uses the development mail catcher (Mailpit)' : 'Platform email is configured', cfgHref('email'));
    const emailTest = await this.config.lastTest('email');
    add('email_tested', 'Platform email tested', emailTest?.ok ? 'pass' : 'fail', emailTest ? (emailTest.ok ? `Test e-mail sent ${emailTest.at.slice(0, 10)}` : `Last test failed: ${emailTest.message}`) : 'Send a test e-mail after saving the settings', cfgHref('email'));

    const cards = await this.config.cardStatuses();
    const rz = await this.prisma.platformSetting.findUnique({ where: { key: 'billing.razorpay' }, select: { value: true, secretEncrypted: true } });
    const rzv = (rz?.value ?? null) as { mode?: string; enabled?: boolean } | null;
    const rzLive = !!rz?.secretEncrypted && rzv?.enabled === true && rzv.mode === 'live';
    add('razorpay_live', 'Razorpay live keys', rzLive ? 'pass' : 'fail', rzLive ? 'Razorpay live mode is enabled' : !rz?.secretEncrypted ? 'Razorpay is not configured: companies cannot pay online' : !rzv?.enabled ? 'Razorpay is switched off' : 'Razorpay uses test keys', cfgHref('razorpay'));

    add('firebase', 'Push notifications (Firebase)', cards.firebase.status === 'configured' ? 'pass' : 'fail', cards.firebase.note ?? 'Firebase app config and service account are uploaded', cfgHref('firebase'));

    const sentry = snap.monitoring.values.sentryDsnApi;
    add('sentry', 'Error monitoring', sentry ? 'pass' : 'fail', sentry ? `Sentry DSN set${snap.monitoring.values.sentryDsnWeb ? ' for the API and the web' : ' for the API (the web DSN is optional)'}` : 'Add the Sentry DSN of the API', cfgHref('monitoring'));

    const backup = await this.prisma.platformSetting.findUnique({ where: { key: 'ops.backup' }, select: { value: true } });
    const last = (backup?.value as { lastSuccessAt?: string } | null)?.lastSuccessAt;
    const fresh = last ? Date.now() - new Date(last).getTime() < BACKUP_FRESH_MS : false;
    add(
      'backups',
      'Database backups',
      fresh ? 'pass' : env.BACKUP_ENABLED ? 'warn' : 'fail',
      fresh ? `Last backup ${last!.slice(0, 16).replace('T', ' ')} UTC` : last ? `The last backup is older than 48 hours (${last.slice(0, 10)})` : env.BACKUP_ENABLED ? 'The backup service is enabled but has not reported a backup yet' : 'No scheduled backup: enable the backup service of the production compose (docs/DEPLOY.md)',
      null,
    );

    const mockIntegrations = await this.prisma.integration.count({ where: { mode: 'mock', status: { not: 'not_connected' } } });
    const tel = telephonyConfig();
    const mocks = [mockIntegrations ? `${mockIntegrations} integration${mockIntegrations === 1 ? '' : 's'} in mock mode` : null, tel?.provider === 'mock' ? 'telephony provider is mock' : null, env.BILLING_PROVIDER === 'mock' ? 'BILLING_PROVIDER=mock' : null, env.DEV_AUTH ? 'DEV_AUTH is on' : null].filter((x): x is string => !!x);
    add('no_mock_providers', 'No mock providers', mocks.length ? 'fail' : 'pass', mocks.length ? mocks.join(', ') : 'Every provider is live', '/super-admin/companies');

    const demoSlugs = COMPANY_FIXTURES.map((c) => c.slug);
    const demo = await this.prisma.workspace.findMany({ where: { slug: { in: demoSlugs }, deletedAt: null }, select: { slug: true } });
    add('demo_companies_absent', 'No demo companies', demo.length ? 'fail' : 'pass', demo.length ? `Demo companies exist: ${demo.map((d) => d.slug).join(', ')} (delete them or use a clean database)` : 'No demo data', '/super-admin/companies');

    const admins = await this.prisma.platformAdmin.findMany({ where: { isActive: true }, select: { email: true, mfaEnabledAt: true } });
    const without = admins.filter((a) => !a.mfaEnabledAt).length;
    add('super_admin_2fa', 'Super Admin 2FA', admins.length && !without ? 'pass' : 'fail', !admins.length ? 'No active Super Admin' : without ? `${without} Super Admin${without === 1 ? ' has' : 's have'} not enrolled 2FA` : `All ${admins.length} Super Admins use 2FA`, '/super-admin/system');

    add('android_release', 'Android app release', cards.android_releases.status === 'configured' ? 'pass' : 'fail', cards.android_releases.note ?? 'An APK is uploaded', cfgHref('android_releases'), false);
    add('billing_profile', 'Vistar billing profile', cards.billing_profile.status === 'configured' ? 'pass' : 'fail', cards.billing_profile.note ?? 'Vistar billing profile is complete', cfgHref('billing_profile'));

    const passed = items.filter((i) => i.status === 'pass').length;
    return { items, passed, total: items.length, ready: !items.some((i) => i.blocking && i.status === 'fail'), environment: env.NODE_ENV, checkedAt: new Date().toISOString() };
  }
}
