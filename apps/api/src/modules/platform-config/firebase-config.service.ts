import { Injectable } from '@nestjs/common';
import {
  maskServiceAccountEmail,
  parseGoogleServicesJson,
  parseServiceAccountJson,
  type FirebaseClientOptions,
  type FirebaseConfigStatus,
  type FirebaseServiceAccount,
} from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { PlatformAuthContext } from '../../common/auth/auth-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { decryptSecret, encryptSecret } from '../../infra/crypto/secrets.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export const FIREBASE_CLIENT_KEY = 'firebase.client';
export const FIREBASE_SA_KEY = 'firebase.serviceAccount';
const CACHE_MS = 30_000;

interface SaPublic {
  projectId: string;
  clientEmail: string;
  privateKeyIdLast4: string;
  uploadedAt: string;
}

/**
 * Firebase config in PlatformSetting (D-058). google-services.json: the parsed public options in `value`, the
 * original file encrypted in `secretEncrypted`. Service account: only public status in `value`; the JSON
 * (private key) encrypted with ENCRYPTION_KEY and never returned by any route.
 */
@Injectable()
export class FirebaseConfigService {
  private cache: { at: number; client: FirebaseClientOptions | null; sa: FirebaseServiceAccount | null } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async rows() {
    const rows = await this.prisma.platformSetting.findMany({ where: { key: { in: [FIREBASE_CLIENT_KEY, FIREBASE_SA_KEY] } } });
    return { client: rows.find((r) => r.key === FIREBASE_CLIENT_KEY) ?? null, sa: rows.find((r) => r.key === FIREBASE_SA_KEY) ?? null };
  }

  async status(): Promise<FirebaseConfigStatus> {
    const { client, sa } = await this.rows();
    const options = (client?.value as FirebaseClientOptions | null) ?? null;
    const pub = (sa?.value as SaPublic | null) ?? null;
    return {
      client: options,
      clientUploadedAt: client?.updatedAt.toISOString() ?? null,
      serviceAccount: {
        configured: !!sa?.secretEncrypted,
        projectId: pub?.projectId ?? null,
        clientEmail: pub ? maskServiceAccountEmail(pub.clientEmail) : null,
        privateKeyIdLast4: pub?.privateKeyIdLast4 ?? null,
        uploadedAt: pub?.uploadedAt ?? null,
      },
      projectMatch: options && pub ? options.projectId === pub.projectId : null,
      pushReady: !!sa?.secretEncrypted,
    };
  }

  /** Public options for GET /app/config (cached 30 s). */
  async clientOptions(): Promise<FirebaseClientOptions | null> {
    return (await this.load()).client;
  }

  /** Decrypted service account for the push sender (cached 30 s); null = push not configured. */
  async serviceAccount(): Promise<FirebaseServiceAccount | null> {
    return (await this.load()).sa;
  }

  private async load() {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    const { client, sa } = await this.rows();
    let account: FirebaseServiceAccount | null = null;
    if (sa?.secretEncrypted) {
      const parsed = parseServiceAccountJson(decryptSecret(sa.secretEncrypted));
      account = parsed.ok ? parsed.value : null;
    }
    this.cache = { at: Date.now(), client: (client?.value as FirebaseClientOptions | null) ?? null, sa: account };
    return this.cache;
  }

  private text(file: { buffer?: Buffer; size: number } | undefined): string {
    if (!file?.buffer) throw new AppException('VALIDATION_FAILED', 'Attach the JSON file in the "file" field', { details: [{ path: 'file', message: 'Required' }] });
    return file.buffer.toString('utf8');
  }

  private invalid(errors: string[]): AppException {
    return new AppException('FIREBASE_CONFIG_INVALID', errors[0] ?? 'The file is not valid', { details: errors.map((message) => ({ path: 'file', message })) });
  }

  private async save(key: string, value: Prisma.InputJsonValue, secret: string, adminId: string) {
    const secretEncrypted = encryptSecret(secret);
    await this.prisma.platformSetting.upsert({ where: { key }, create: { key, value, secretEncrypted, updatedById: adminId }, update: { value, secretEncrypted, updatedById: adminId } });
    this.cache = null;
  }

  async uploadClient(admin: PlatformAuthContext, req: Request, file: { buffer?: Buffer; size: number } | undefined): Promise<FirebaseConfigStatus> {
    const raw = this.text(file);
    const parsed = parseGoogleServicesJson(raw);
    if (!parsed.ok) throw this.invalid(parsed.errors);
    await this.save(FIREBASE_CLIENT_KEY, parsed.value as unknown as Prisma.InputJsonValue, raw, admin.adminId);
    await this.audit.platform(admin, req, { action: 'config.firebase_client', entityType: 'platform_setting', entityId: FIREBASE_CLIENT_KEY, diff: { projectId: parsed.value.projectId, appId: parsed.value.appId } });
    return this.status();
  }

  async uploadServiceAccount(admin: PlatformAuthContext, req: Request, file: { buffer?: Buffer; size: number } | undefined): Promise<FirebaseConfigStatus> {
    const raw = this.text(file);
    const parsed = parseServiceAccountJson(raw);
    if (!parsed.ok) throw this.invalid(parsed.errors);
    const pub: SaPublic = { projectId: parsed.value.projectId, clientEmail: parsed.value.clientEmail, privateKeyIdLast4: parsed.value.privateKeyId.slice(-4), uploadedAt: new Date().toISOString() };
    await this.save(FIREBASE_SA_KEY, pub as unknown as Prisma.InputJsonValue, JSON.stringify(JSON.parse(raw)), admin.adminId);
    await this.audit.platform(admin, req, { action: 'config.firebase_service_account', entityType: 'platform_setting', entityId: FIREBASE_SA_KEY, diff: { projectId: pub.projectId, privateKeyIdLast4: pub.privateKeyIdLast4 } });
    return this.status();
  }

  async remove(admin: PlatformAuthContext, req: Request, part: 'client' | 'service_account'): Promise<FirebaseConfigStatus> {
    const key = part === 'client' ? FIREBASE_CLIENT_KEY : FIREBASE_SA_KEY;
    const { count } = await this.prisma.platformSetting.deleteMany({ where: { key } });
    this.cache = null;
    if (count) await this.audit.platform(admin, req, { action: `config.firebase_${part}_delete`, entityType: 'platform_setting', entityId: key });
    return this.status();
  }
}
