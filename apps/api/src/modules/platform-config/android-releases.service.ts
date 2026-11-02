import { Injectable } from '@nestjs/common';
import { ANDROID_PACKAGE_NAME, type AndroidRelease, type AndroidReleaseUploadFields, type AppConfig } from '@vistar/shared';
import type { Request, Response } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { PlatformAuthContext } from '../../common/auth/auth-context.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import type { AndroidRelease as ReleaseRow, PlatformFile } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { StorageService, type UploadedFileLike } from '../storage/storage.service.js';
import { FirebaseConfigService } from './firebase-config.service.js';

type Row = ReleaseRow & { file: PlatformFile };

/** Android APK releases (D-058): uploaded by the Super Admin, latest one served to the employee panel and the app. */
@Injectable()
export class AndroidReleasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly firebase: FirebaseConfigService,
  ) {}

  private async toRelease(r: Row): Promise<AndroidRelease> {
    const admin = r.uploadedById ? await this.prisma.platformAdmin.findUnique({ where: { id: r.uploadedById }, select: { id: true, name: true } }) : null;
    return {
      id: r.id,
      versionName: r.versionName,
      versionCode: r.versionCode,
      notes: r.notes,
      fileId: r.fileId,
      fileName: r.file.name,
      size: r.size,
      sha256: r.sha256,
      minSupported: r.minSupported,
      uploadedBy: admin,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async list(): Promise<{ items: AndroidRelease[] }> {
    const rows = await this.prisma.androidRelease.findMany({ include: { file: true }, orderBy: { versionCode: 'desc' } });
    return { items: await Promise.all(rows.map((r) => this.toRelease(r))) };
  }

  async upload(admin: PlatformAuthContext, req: Request, file: UploadedFileLike | undefined, fields: AndroidReleaseUploadFields): Promise<AndroidRelease> {
    if (await this.prisma.androidRelease.count({ where: { versionCode: fields.versionCode } })) throw new AppException('CONFLICT', `Version code ${fields.versionCode} was already uploaded; increase versionCode`);
    const stored = await this.storage.savePlatformFile('apk', file, admin.adminId);
    const row = await this.prisma.androidRelease
      .create({
        data: { versionName: fields.versionName, versionCode: fields.versionCode, notes: fields.notes || null, fileId: stored.id, size: stored.size, sha256: stored.sha256, minSupported: fields.minSupported, uploadedById: admin.adminId },
        include: { file: true },
      })
      .catch(async (err: { code?: string }) => {
        await this.storage.deleteObject(stored);
        await this.prisma.platformFile.delete({ where: { id: stored.id } }).catch(() => undefined);
        if (err.code === 'P2002') throw new AppException('CONFLICT', `Version code ${fields.versionCode} was already uploaded`);
        throw err;
      });
    await this.audit.platform(admin, req, { action: 'android_release.upload', entityType: 'android_release', entityId: row.id, diff: { versionName: row.versionName, versionCode: row.versionCode, sha256: row.sha256, minSupported: row.minSupported } });
    return this.toRelease(row);
  }

  async update(admin: PlatformAuthContext, req: Request, id: string, body: { notes?: string | null; minSupported?: boolean }): Promise<AndroidRelease> {
    const before = await this.prisma.androidRelease.findUnique({ where: { id } });
    if (!before) throw notFound('Release');
    const row = await this.prisma.androidRelease.update({
      where: { id },
      data: { ...(body.notes !== undefined ? { notes: body.notes } : {}), ...(body.minSupported !== undefined ? { minSupported: body.minSupported } : {}) },
      include: { file: true },
    });
    await this.audit.platform(admin, req, { action: 'android_release.update', entityType: 'android_release', entityId: id, diff: { minSupported: { from: before.minSupported, to: row.minSupported }, notesChanged: body.notes !== undefined } });
    return this.toRelease(row);
  }

  private latest() {
    return this.prisma.androidRelease.findFirst({ orderBy: { versionCode: 'desc' }, include: { file: true } });
  }

  async appConfig(): Promise<AppConfig> {
    const [latest, min, firebase] = await Promise.all([
      this.latest(),
      this.prisma.androidRelease.findFirst({ where: { minSupported: true }, orderBy: { versionCode: 'desc' }, select: { versionCode: true } }),
      this.firebase.clientOptions(),
    ]);
    const base = getEnv().API_PUBLIC_URL.replace(/\/+$/, '');
    return {
      firebase,
      android: {
        packageName: ANDROID_PACKAGE_NAME,
        latest: latest
          ? { versionName: latest.versionName, versionCode: latest.versionCode, notes: latest.notes, size: latest.size, sha256: latest.sha256, createdAt: latest.createdAt.toISOString(), downloadUrl: `${base}/api/v1/app/android/latest` }
          : null,
        minSupportedVersionCode: min?.versionCode ?? null,
      },
      serverTime: new Date().toISOString(),
    };
  }

  async downloadLatest(res: Response): Promise<void> {
    const latest = await this.latest();
    if (!latest) throw notFound('Android release');
    await this.storage.send(res, { ...latest.file, name: `vistar-${latest.versionName}.apk` }, { cache: 'private', download: true });
  }
}
