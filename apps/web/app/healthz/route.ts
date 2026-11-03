// ---- change #20: prod
/** Liveness for the container health check and Caddy (no data, no auth). */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
}
// ---- end change #20: prod
