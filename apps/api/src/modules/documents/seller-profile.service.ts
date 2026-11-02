import { Injectable } from '@nestjs/common';
import { SETTING_KEYS, SellerProfileSchema, stateCodeFromGstin, type SellerProfile, type SellerProfileResponse, type SellerSnapshot } from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { normalizeAddress } from '../crm/lib/values.js';
import { requestActor } from '../leads/lib/context.js';

const KEY = SETTING_KEYS.workspace.sellerProfile;

export const isProfileComplete = (p: SellerProfile | null): p is SellerProfile => !!p && !!p.legalName && !!p.address.stateCode;

export const snapshotOf = (p: SellerProfile): SellerSnapshot => ({
  legalName: p.legalName,
  tradeName: p.tradeName,
  gstin: p.gstin,
  pan: p.pan,
  address: p.address,
  phone: p.phone,
  email: p.email,
  website: p.website,
  bank: p.bank,
  signatureLabel: p.signatureLabel,
});

/** The company's GST identity for documents (Setting key billing.sellerProfile, workspace scope). */
@Injectable()
export class SellerProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async load(workspaceId: string): Promise<SellerProfile | null> {
    const row = await this.prisma.forTenant(workspaceId).setting.findFirst({ where: { scope: 'workspace', scopeId: workspaceId, key: KEY }, select: { value: true } });
    if (!row) return null;
    const r = SellerProfileSchema.safeParse(row.value);
    return r.success ? r.data : null;
  }

  response(profile: SellerProfile | null): SellerProfileResponse {
    return { profile, stateCode: profile?.address.stateCode ?? null, complete: isProfileComplete(profile) };
  }

  async get(auth: AuthContext): Promise<SellerProfileResponse> {
    return this.response(await this.load(auth.workspaceId));
  }

  /** Profile needed to send a quotation or issue an invoice. */
  async require(workspaceId: string): Promise<SellerProfile> {
    const p = await this.load(workspaceId);
    if (!isProfileComplete(p)) throw new AppException('SELLER_PROFILE_INCOMPLETE', 'Add your company legal name and state in Settings > GST and billing first');
    return p;
  }

  async update(auth: AuthContext, req: Request, body: SellerProfile): Promise<SellerProfileResponse> {
    const wid = auth.workspaceId;
    const address = normalizeAddress(body.address);
    if (!address?.stateCode) throw new AppException('VALIDATION_FAILED', 'Pick the state of your billing address', { details: [{ path: 'address.stateCode', message: 'Required' }], status: 422 });
    const gstState = stateCodeFromGstin(body.gstin);
    if (gstState && gstState !== address.stateCode) {
      throw new AppException('VALIDATION_FAILED', 'Your GSTIN belongs to a different state than the address', { details: [{ path: 'address.stateCode', message: 'Does not match the GSTIN state' }], status: 422 });
    }
    const profile: SellerProfile = { ...body, address, pan: body.pan ?? (body.gstin ? body.gstin.slice(2, 12) : null) };
    const before = await this.load(wid);
    const db = this.prisma.forTenant(wid);
    await db.setting.upsert({
      where: { workspaceId_scope_scopeId_key: { workspaceId: wid, scope: 'workspace', scopeId: wid, key: KEY } },
      create: { workspaceId: wid, scope: 'workspace', scopeId: wid, key: KEY, value: profile as unknown as Prisma.InputJsonObject },
      update: { value: profile as unknown as Prisma.InputJsonObject },
    });
    const actor = await requestActor(db, auth);
    await this.audit.record(
      auth,
      req,
      { action: 'billing.profile_update', entityType: 'workspace', entityId: wid, diff: { before: before ? { gstin: before.gstin, stateCode: before.address.stateCode, legalName: before.legalName } : null, after: { gstin: profile.gstin, stateCode: address.stateCode, legalName: profile.legalName } } },
      actor.summary?.name,
    );
    return this.response(profile);
  }
}
