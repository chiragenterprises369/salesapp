import { Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import {
  eventPayloadSchemas,
  HeartbeatSchema,
  JoinableRoomSchema,
  REALTIME_NAMESPACE,
  rooms,
  SYNC_SCOPES,
  type Ack,
  type DomainEvent,
} from '@vistar/shared';
import type { Namespace, Socket } from 'socket.io';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { createRedis } from '../../infra/redis/redis.module.js';
import { PresenceService } from '../presence/presence.service.js';
import { audienceOf, lostVisibility, maySee } from './audience.js';
import { SocketAuthService, VIEWER_TTL_MS, type SocketPrincipal } from './socket-auth.service.js';

type WorkspacePrincipal = Extract<SocketPrincipal, { kind: 'workspace' }>;
interface SocketState {
  principal: SocketPrincipal;
  client: 'web' | 'android';
  lastBeatAt: number;
  expiryTimer: NodeJS.Timeout | null;
}

/** Socket ids are per connection; presence counts each connection as one device. */
export const socketDeviceId = (socketId: string) => `sock:${socketId}`;
/** Room of a team (managers can target it; fan-out still filters per socket). */
export const teamRoom = (teamId: string) => `team:${teamId}`;
export const PLATFORM_ROOM = 'platform:admins';
const MIN_BEAT_GAP_MS = 2_000;
const LEAD_OWNER_TTL_MS = 5_000;

const corsOrigins = () =>
  getEnv()
    .WEB_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

/**
 * Realtime gateway (namespace /realtime, CONTRACTS section 7).
 * - Handshake `auth: { token, client?, appVersion?, fresh? }`: workspace token -> rooms ws:<wid>,
 *   user:<uid>, team:<teamId>; Super Admin token -> platform:admins only (no tenant events).
 *   Failures reach the client as connect_error with message = error code.
 * - Fan-out: every API instance receives every domain event from the Redis event bus and delivers it
 *   to ITS OWN sockets only (socket.emit is local), after the payload passes the shared schema and the
 *   socket's data scope (audience.ts). The Socket.IO Redis adapter is attached so room operations
 *   (joins, disconnects, server-side emits to rooms) work across instances; bus events are never
 *   broadcast through it, so nothing is delivered twice.
 * - Reconnect: every new connection gets `sync.required` (all scopes, reason "reconnect") unless the
 *   client says `auth.fresh = true` (first connect right after loading data). Clients refetch the
 *   Team Floor snapshot then.
 * - Presence: connecting counts as a heartbeat; clients send `presence.heartbeat` every
 *   HEARTBEAT_INTERVAL_MS. A deliberate client disconnect (socket.disconnect()) is a logout of that
 *   device; a dropped transport is not (the 45 s timeout decides).
 * - Token expiry: `auth.expired { reason: "expired" }` then disconnect; a revoked session or a
 *   deactivated user gets `auth.expired { reason: "revoked" }` within VIEWER_TTL_MS.
 */
@WebSocketGateway({ namespace: REALTIME_NAMESPACE, cors: { origin: corsOrigins(), credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() private nsp!: Namespace;
  private readonly sockets = new Map<string, SocketState>();
  private readonly leadOwners = new Map<string, { ownerId: string | null; at: number }>();
  private unsubscribe: (() => void) | null = null;
  private adapterClients: Array<{ quit: () => Promise<unknown> }> = [];

  constructor(
    private readonly socketAuth: SocketAuthService,
    private readonly events: EventBus,
    private readonly presence: PresenceService,
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  afterInit(nsp: Namespace): void {
    const pub = createRedis('pubsub');
    const sub = createRedis('pubsub');
    if (pub && sub) {
      nsp.server.adapter(createAdapter(pub, sub, { key: 'vistar:socket.io' }));
      this.adapterClients = [pub, sub];
    }
    nsp.use((socket, next) => {
      const auth = (socket.handshake.auth ?? {}) as Record<string, unknown>;
      const header = socket.handshake.headers.authorization;
      const token = typeof auth.token === 'string' ? auth.token : typeof header === 'string' ? header.replace(/^Bearer\s+/i, '') : null;
      this.socketAuth
        .authenticate(token)
        .then((principal) => {
          this.sockets.set(socket.id, { principal, client: auth.client === 'android' ? 'android' : 'web', lastBeatAt: 0, expiryTimer: null });
          next();
        })
        .catch((err: unknown) => {
          const code = err instanceof AppException ? err.code : 'AUTH_TOKEN_INVALID';
          const e = new Error(code) as Error & { data?: unknown };
          e.data = { code, message: err instanceof AppException ? err.message : 'Sign in again' };
          next(e);
        });
    });
    this.unsubscribe = this.events.subscribe((event) => this.fanOut(event));
  }

  async onModuleDestroy(): Promise<void> {
    this.unsubscribe?.();
    for (const s of this.sockets.values()) if (s.expiryTimer) clearTimeout(s.expiryTimer);
    await Promise.all(this.adapterClients.map((c) => c.quit().catch(() => undefined)));
  }

  async handleConnection(socket: Socket): Promise<void> {
    const state = this.sockets.get(socket.id);
    if (!state) {
      socket.disconnect(true);
      return;
    }
    socket.on('disconnect', (reason: string) => this.onDisconnect(socket, reason));
    const p = state.principal;
    const msUntilExpiry = Math.max(1_000, p.expiresAt - Date.now());
    state.expiryTimer = setTimeout(() => this.expire(socket, 'expired'), Math.min(msUntilExpiry, 2 ** 31 - 1));
    if (p.kind === 'platform') {
      await socket.join(PLATFORM_ROOM);
      return;
    }
    await socket.join([rooms.workspace(p.workspaceId), rooms.user(p.userId), ...(p.teamId ? [teamRoom(p.teamId)] : [])]);
    const auth = (socket.handshake.auth ?? {}) as Record<string, unknown>;
    if (auth.fresh !== true) socket.emit('sync.required', { scopes: [...SYNC_SCOPES], reason: 'reconnect' });
    if (!p.auth.impersonation) await this.beat(socket, state, 'active');
  }

  private onDisconnect(socket: Socket, reason: string): void {
    const state = this.sockets.get(socket.id);
    this.sockets.delete(socket.id);
    if (!state) return;
    if (state.expiryTimer) clearTimeout(state.expiryTimer);
    const p = state.principal;
    if (p.kind === 'workspace' && !p.auth.impersonation && reason === 'client namespace disconnect') {
      void this.presence.deviceGone(p.workspaceId, p.userId, socketDeviceId(socket.id)).catch((err: Error) => this.logger.warn(`presence deviceGone failed: ${err.message}`));
    }
  }

  @SubscribeMessage('presence.heartbeat')
  async onHeartbeat(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<{ ok: boolean }> {
    const state = this.sockets.get(socket.id);
    if (!state || state.principal.kind !== 'workspace' || state.principal.auth.impersonation) return { ok: false };
    const parsed = HeartbeatSchema.safeParse(body);
    if (!parsed.success) return { ok: false };
    if (parsed.data.client) state.client = parsed.data.client === 'android' ? 'android' : 'web';
    const now = Date.now();
    if (now - state.lastBeatAt < MIN_BEAT_GAP_MS) return { ok: true };
    if (now - state.principal.viewerAt > VIEWER_TTL_MS && !(await this.revalidate(socket, state))) return { ok: false };
    await this.beat(socket, state, parsed.data.activity);
    return { ok: true };
  }

  @SubscribeMessage('room.join')
  async onJoin(@ConnectedSocket() socket: Socket, @MessageBody() body: { room?: unknown }, ack?: Ack): Promise<{ ok: true } | { ok: false; error: string }> {
    const res = await this.join(socket, body?.room);
    if (typeof ack === 'function') ack(res);
    return res;
  }

  @SubscribeMessage('room.leave')
  async onLeave(@ConnectedSocket() socket: Socket, @MessageBody() body: { room?: unknown }, ack?: Ack): Promise<{ ok: true } | { ok: false; error: string }> {
    const parsed = JoinableRoomSchema.safeParse(body?.room);
    const res: { ok: true } | { ok: false; error: string } = parsed.success ? { ok: true } : { ok: false, error: 'VALIDATION_FAILED' };
    if (parsed.success) await socket.leave(parsed.data);
    if (typeof ack === 'function') ack(res);
    return res;
  }

  /** Number of local sockets (tests, health). */
  get localSocketCount(): number {
    return this.sockets.size;
  }

  // ---------------------------------------------------------------- internals

  private async beat(socket: Socket, state: SocketState, activity: 'active' | 'idle' | 'hidden'): Promise<void> {
    const p = state.principal as WorkspacePrincipal;
    state.lastBeatAt = Date.now();
    try {
      await this.presence.heartbeat({ workspaceId: p.workspaceId, userId: p.userId, sessionId: p.sessionId }, { deviceId: socketDeviceId(socket.id), client: state.client, activity });
    } catch (err) {
      this.logger.warn(`presence heartbeat failed: ${(err as Error).message}`);
    }
  }

  private expire(socket: Socket, reason: 'expired' | 'revoked'): void {
    socket.emit('auth.expired', { reason });
    socket.disconnect(true);
  }

  /** Refresh scope and session state; false (and disconnected) when the session is gone. */
  private async revalidate(socket: Socket, state: SocketState): Promise<boolean> {
    if (state.principal.kind !== 'workspace') return true;
    try {
      state.principal = await this.socketAuth.refresh(state.principal);
      return true;
    } catch (err) {
      const p = state.principal;
      if (!p.auth.impersonation) {
        void this.presence.logout(p.workspaceId, p.userId, p.sessionId).catch(() => undefined);
      }
      this.expire(socket, err instanceof AppException && err.code === 'AUTH_TOKEN_EXPIRED' ? 'expired' : 'revoked');
      return false;
    }
  }

  private async join(socket: Socket, room: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
    const state = this.sockets.get(socket.id);
    if (!state || state.principal.kind !== 'workspace') return { ok: false, error: 'FORBIDDEN' };
    const parsed = JoinableRoomSchema.safeParse(room);
    if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
    const [prefix, id] = parsed.data.split(':') as [string, string];
    const p = state.principal;
    const db = this.prisma.forTenant(p.workspaceId);
    const can = (perm: string) => p.viewer.permissions.has(perm);
    let allowed = false;
    if (prefix === 'lead' && can('leads.read')) {
      const lead = await db.lead.findFirst({ where: { id, deletedAt: null }, select: { ownerId: true } });
      allowed = !!lead && (await this.scope.canSee(p.auth, lead.ownerId));
    } else if (prefix === 'workflow' && can('workflows.read')) {
      allowed = (await db.workflow.count({ where: { id } })) === 1;
    } else if (prefix === 'run' && can('workflows.read')) {
      allowed = (await db.workflowRun.count({ where: { id } })) === 1;
    } else if (prefix === 'conv' && can('messages.read')) {
      const conv = await db.conversation.findFirst({ where: { id }, select: { assigneeId: true } });
      allowed = !!conv && (conv.assigneeId === null ? p.viewer.visibleUserIds === null || can('messages.team_inbox') : await this.scope.canSee(p.auth, conv.assigneeId));
    }
    // Same answer for "not yours" and "does not exist" (no tenant probing).
    if (!allowed) return { ok: false, error: 'NOT_FOUND' };
    await socket.join(parsed.data);
    return { ok: true };
  }

  private async leadOwner(workspaceId: string, leadId: string): Promise<string | null | undefined> {
    const key = `${workspaceId}:${leadId}`;
    const hit = this.leadOwners.get(key);
    const now = Date.now();
    if (hit && now - hit.at < LEAD_OWNER_TTL_MS) return hit.ownerId;
    const row = await this.prisma.forTenant(workspaceId).lead.findFirst({ where: { id: leadId }, select: { ownerId: true } }).catch(() => null);
    if (!row) return undefined;
    if (this.leadOwners.size > 5_000) this.leadOwners.clear();
    this.leadOwners.set(key, { ownerId: row.ownerId, at: now });
    return row.ownerId;
  }

  /** Deliver one bus event to the local sockets that may see it. */
  private async fanOut(event: DomainEvent): Promise<void> {
    const local = this.nsp?.adapter.rooms.get(rooms.workspace(event.workspaceId));
    if (!local || local.size === 0) return;
    const schema = eventPayloadSchemas[event.type];
    if (!schema || !schema.safeParse(event.payload).success) {
      this.logger.error(`Dropped ${event.type}: payload does not match the shared schema`);
      return;
    }
    const audience = audienceOf(event);
    const owner = audience.kind === 'lead' ? await this.leadOwner(event.workspaceId, audience.leadId) : undefined;
    const contentEvent = event.type === 'message.received' || event.type === 'message.sent' || event.type === 'conversation.updated';
    for (const socketId of local) {
      const socket = this.nsp.sockets.get(socketId);
      const state = this.sockets.get(socketId);
      if (!socket || !state || state.principal.kind !== 'workspace') continue;
      if (Date.now() - state.principal.viewerAt > VIEWER_TTL_MS && !(await this.revalidate(socket, state))) continue;
      const p = state.principal as WorkspacePrincipal;
      // Support sessions see message content only when the company allowed it.
      if (contentEvent && p.auth.impersonation && !p.auth.impersonation.contentAccess) continue;
      if (maySee(p.viewer, event, audience, owner)) socket.emit(event.type, event);
      else if (lostVisibility(p.viewer, event)) socket.emit('sync.required', { scopes: ['leads', 'board'], reason: 'gap' });
    }
  }
}
