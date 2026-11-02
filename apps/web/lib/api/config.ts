/**
 * Where the API lives. `NEXT_PUBLIC_API_URL` is the versioned base (`http://localhost:4000/api/v1`);
 * routes from API_ROUTES carry their own prefix (`/api/v1/...` or the absolute `/api/super/...`),
 * so the client only needs the origin. NEXT_PUBLIC_* values are inlined at build time.
 */
const RAW_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export const API_URL = RAW_API_URL.replace(/\/+$/, '');
export const API_ORIGIN = API_URL.replace(/\/api(\/v\d+)?$/, '');
/** Socket.IO server (namespace `/realtime`). */
export const WS_URL = (process.env.NEXT_PUBLIC_WS_URL || API_ORIGIN).replace(/\/+$/, '');

/** Default per-request timeout. Uploads and exports get longer ones. */
export const REQUEST_TIMEOUT_MS = 20_000;
export const TRANSFER_TIMEOUT_MS = 120_000;
/** Refresh the access token this long before it expires. */
export const TOKEN_REFRESH_SKEW_MS = 30_000;
