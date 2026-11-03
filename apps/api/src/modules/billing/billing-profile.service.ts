import { Injectable } from '@nestjs/common';
import {
  PLATFORM_SETTING_KEYS,
  PlatformBillingProfileSchema,
  stateCodeFromGstin,
  stateName,
  type PlatformBillingProfile,
  type PlatformBillingProfileResponse,
  type SellerSnapshot,
} from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { PlatformAuthContext } from '../../common/auth/auth-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

const KEY = PLATFORM_SETTING_KEYS.billingProfile;
const CACHE_MS = 30_000;

/** Vistar's own billing identity on its invoices (PlatformSetting billing.vistarProfile; no secrets). */
@Injectable()
export class BillingProfileService {
  private cache: { at: number; profile: PlatformBillingProfile | null } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async load(): Promise<PlatformBillingProfile | null> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.profile;
    const row = await this.prisma.platformSetting.findUnique({ where: { key: KEY } });
    const parsed = row?.value ? PlatformBillingProfileSchema.safeParse(row.value) : null;
    const profile = parsed?.success ? parsed.data : null;
    this.cache = { at: Date.now(), profile };
    return profile;
  }

  static complete(p: PlatformBillingProfile | null): p is PlatformBillingProfile {
    return !!p && !!p.legalName && !!p.address.stateCode;
  }

  async response(): Promise<PlatformBillingProfileResponse> {
    const profile = await this.load();
    return { profile, complete: BillingProfileService.complete(profile) };
  }

  /** The profile needed to issue an invoice; SELLER_PROFILE_INCOMPLETE until a Super Admin saved it. */
  async require(): Promise<PlatformBillingProfile> {
    const p = await this.load();
    if (!BillingProfileService.complete(p)) throw new AppException('SELLER_PROFILE_INCOMPLETE', 'Save the Vistar billing profile (legal name and state) in Super Admin > Billing before issuing invoices');
    return p;
  }

  static snapshot(p: PlatformBillingProfile): SellerSnapshot {
    return { legalName: p.legalName, tradeName: p.tradeName, gstin: p.gstin, pan: p.pan, address: p.address, phone: p.phone, email: p.email, website: p.website, bank: p.bank, signatureLabel: p.signatureLabel };
  }

  async save(admin: PlatformAuthContext, req: Request, body: PlatformBillingProfile): Promise<PlatformBillingProfileResponse> {
    if (body.gstin) {
      const fromGstin = stateCodeFromGstin(body.gstin);
      if (fromGstin && body.address.stateCode && fromGstin !== body.address.stateCode) {
        throw new AppException('VALIDATION_FAILED', 'Some fields are invalid', { details: [{ path: 'address.stateCode', message: `The GSTIN is registered in ${stateName(fromGstin) ?? fromGstin}` }] });
      }
    }
    const value = { ...body, address: { ...body.address, state: body.address.state ?? stateName(body.address.stateCode) } } as unknown as Prisma.InputJsonObject;
    await this.prisma.platformSetting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedById: admin.adminId }, update: { value, updatedById: admin.adminId } });
    this.cache = null;
    await this.audit.platform(admin, req, { action: 'billing.profile_update', entityType: 'platform_setting', entityId: KEY, diff: { legalName: body.legalName, gstin: body.gstin, stateCode: body.address.stateCode, invoicePrefix: body.invoicePrefix } });
    return this.response();
  }
}
