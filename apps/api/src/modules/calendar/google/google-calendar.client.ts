import type { OAuth2Client } from 'google-auth-library';
import type { GoogleEvent } from './google-calendar.mapper.js';

const BASE = 'https://www.googleapis.com/calendar/v3';
const TIMEOUT_MS = 15_000;

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason: string | null = null,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }

  /** The refresh token was revoked or expired: the admin must connect again. */
  get revoked(): boolean {
    return this.reason === 'invalid_grant' || this.status === 401;
  }
}

function toError(err: unknown): GoogleApiError {
  const e = err as { response?: { status?: number; data?: { error?: string | { message?: string; errors?: Array<{ reason?: string }> } } }; message?: string };
  const status = e.response?.status ?? 0;
  const data = e.response?.data?.error;
  if (typeof data === 'string') return new GoogleApiError(status || 400, data, data);
  const reason = data?.errors?.[0]?.reason ?? null;
  return new GoogleApiError(status, (data?.message ?? (status ? `Google answered HTTP ${status}` : 'Could not reach Google')).slice(0, 300), reason);
}

export interface EventsPage {
  items: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/**
 * Minimal Google Calendar v3 client over google-auth-library (token refresh is automatic with the stored refresh
 * token). Fixed host www.googleapis.com, 15 s timeout. Updates never e-mail guests (sendUpdates=none): Vistar sends
 * its own reminders and customers should not get surprise invitations.
 */
export class GoogleCalendarClient {
  constructor(
    private readonly auth: OAuth2Client,
    private readonly calendarId: string,
  ) {}

  private url(path: string): string {
    return `${BASE}/calendars/${encodeURIComponent(this.calendarId)}${path}`;
  }

  private async call<T>(opts: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; params?: Record<string, string | number | boolean>; data?: unknown }): Promise<T> {
    try {
      const res = await this.auth.request<T>({ url: this.url(opts.path), method: opts.method, params: opts.params, data: opts.data, timeout: TIMEOUT_MS, retry: false });
      return res.data;
    } catch (err) {
      throw toError(err);
    }
  }

  /** Create or replace the event with this id (update, else insert with the id, else update a deleted copy). */
  async upsert(eventId: string, body: GoogleEvent): Promise<GoogleEvent> {
    const params = { sendUpdates: 'none', conferenceDataVersion: 0 };
    try {
      return await this.call<GoogleEvent>({ method: 'PUT', path: `/events/${encodeURIComponent(eventId)}`, params, data: body });
    } catch (err) {
      if (!(err instanceof GoogleApiError) || err.status !== 404) throw err;
    }
    try {
      return await this.call<GoogleEvent>({ method: 'POST', path: '/events', params, data: { ...body, id: eventId } });
    } catch (err) {
      // 409: the id exists (a deleted event keeps its id); a PUT brings it back
      if (!(err instanceof GoogleApiError) || err.status !== 409) throw err;
      return this.call<GoogleEvent>({ method: 'PUT', path: `/events/${encodeURIComponent(eventId)}`, params, data: { ...body, status: body.status ?? 'confirmed' } });
    }
  }

  /** Delete; already gone (404 / 410) counts as done. */
  async remove(eventId: string): Promise<void> {
    try {
      await this.call({ method: 'DELETE', path: `/events/${encodeURIComponent(eventId)}`, params: { sendUpdates: 'none' } });
    } catch (err) {
      if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return;
      throw err;
    }
  }

  async get(eventId: string): Promise<GoogleEvent | null> {
    try {
      return await this.call<GoogleEvent>({ method: 'GET', path: `/events/${encodeURIComponent(eventId)}` });
    } catch (err) {
      if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return null;
      throw err;
    }
  }

  /** One page of changes. With a sync token: incremental (410 = token expired, do a full sync). */
  list(q: { syncToken?: string; pageToken?: string }): Promise<EventsPage> {
    const params: Record<string, string | number | boolean> = { maxResults: 250, showDeleted: true, singleEvents: false };
    if (q.syncToken) params.syncToken = q.syncToken;
    if (q.pageToken) params.pageToken = q.pageToken;
    return this.call<EventsPage>({ method: 'GET', path: '/events', params });
  }

  /** Push notifications for this calendar (https address only). */
  watch(channel: { id: string; address: string; token: string; ttlSec: number }): Promise<{ id: string; resourceId: string; expiration?: string }> {
    return this.call({ method: 'POST', path: '/events/watch', data: { id: channel.id, type: 'web_hook', address: channel.address, token: channel.token, params: { ttl: String(channel.ttlSec) } } });
  }

  async stop(channel: { id: string; resourceId: string }): Promise<void> {
    try {
      await this.auth.request({ url: `${BASE}/channels/stop`, method: 'POST', data: channel, timeout: TIMEOUT_MS, retry: false });
    } catch {
      // the channel expires on its own
    }
  }
}
