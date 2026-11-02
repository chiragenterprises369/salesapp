import { Injectable, Logger } from '@nestjs/common';
import type { PushData, PushTestResult } from '@vistar/shared';
import { JWT } from 'google-auth-library';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { FirebaseConfigService } from './firebase-config.service.js';

export interface PushMessage {
  title: string;
  body?: string | null;
  data: PushData;
}

type SendResult = { ok: true; messageId: string } | { ok: false; error: string; unregistered: boolean };

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const SEND_TIMEOUT_MS = 8000;

/**
 * Push sender: FCM HTTP v1 with the service account uploaded in the Super Admin config section (D-058).
 * When Firebase is not configured every send is skipped with a debug log, so callers never need to check.
 * Tokens FCM reports as unregistered are marked (Device.tokenInvalidAt) and skipped afterwards.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private client: { email: string; keyId: string; jwt: JWT } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseConfigService,
  ) {}

  private async auth(): Promise<{ projectId: string; token: string } | null> {
    const sa = await this.firebase.serviceAccount();
    if (!sa) return null;
    if (!this.client || this.client.email !== sa.clientEmail || this.client.keyId !== sa.privateKeyId) {
      this.client = { email: sa.clientEmail, keyId: sa.privateKeyId, jwt: new JWT({ email: sa.clientEmail, key: sa.privateKey, scopes: [FCM_SCOPE] }) };
    }
    const { token } = await this.client.jwt.getAccessToken();
    return token ? { projectId: sa.projectId, token } : null;
  }

  private async send(projectId: string, accessToken: string, fcmToken: string, msg: PushMessage): Promise<SendResult> {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: fcmToken,
          notification: { title: msg.title, ...(msg.body ? { body: msg.body } : {}) },
          data: Object.fromEntries(Object.entries(msg.data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])),
          android: { priority: 'high' },
        },
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { name?: string; error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> } };
    if (res.ok && body.name) return { ok: true, messageId: body.name };
    const code = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status ?? `HTTP ${res.status}`;
    return { ok: false, error: code, unregistered: code === 'UNREGISTERED' || (res.status === 404 && code === 'NOT_FOUND') };
  }

  /** Send to every active device of a user. Never throws. Returns the number of devices reached. */
  async sendToUser(workspaceId: string, userId: string, msg: PushMessage): Promise<number> {
    try {
      const auth = await this.auth();
      if (!auth) {
        this.logger.debug('Push skipped: Firebase service account not configured');
        return 0;
      }
      const devices = await this.prisma.forTenant(workspaceId).device.findMany({ where: { userId, fcmToken: { not: null }, tokenInvalidAt: null }, select: { id: true, fcmToken: true } });
      let sent = 0;
      for (const d of devices) {
        const r = await this.send(auth.projectId, auth.token, d.fcmToken!, msg).catch((err: Error) => ({ ok: false as const, error: err.name, unregistered: false }));
        if (r.ok) sent++;
        else if (r.unregistered) await this.prisma.forTenant(workspaceId).device.update({ where: { id: d.id }, data: { tokenInvalidAt: new Date() } });
        else this.logger.warn(`Push failed (${r.error})`);
      }
      return sent;
    } catch (err) {
      this.logger.warn(`Push failed: ${(err as Error).name}`);
      return 0;
    }
  }

  /** Super Admin test send to one token. */
  async test(fcmToken: string): Promise<PushTestResult> {
    const auth = await this.auth().catch(() => null);
    if (!auth) return { ok: false, messageId: null, error: 'Upload the Firebase service account first' };
    const r = await this.send(auth.projectId, auth.token, fcmToken, { title: 'Vistar test notification', body: 'Push notifications work', data: { kind: 'system', workspaceId: '' } }).catch(
      (err: Error) => ({ ok: false as const, error: err.name, unregistered: false }),
    );
    return r.ok ? { ok: true, messageId: r.messageId, error: null } : { ok: false, messageId: null, error: r.error };
  }
}
