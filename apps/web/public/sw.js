/*
 * Vistar Employee panel service worker (minimal, registered in production for /me only).
 * Network first for page loads; when the network is unavailable, shows a small offline page.
 * No data is cached: leads and calls always come fresh from the API.
 */
const OFFLINE_HTML = `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Offline · Vistar</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px; text-align: center; background: Canvas; color: CanvasText; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { font-size: 14px; margin: 0 0 16px; opacity: 0.8; }
  button { font: inherit; font-size: 16px; min-height: 44px; padding: 0 20px; border-radius: 8px; border: 1px solid GrayText; background: ButtonFace; color: ButtonText; }
</style>
</head>
<body>
<main>
  <h1>You are offline</h1>
  <p>Vistar needs a connection to load your leads and calls. Check your mobile data or Wi-Fi.</p>
  <button type="button" onclick="location.reload()">Try again</button>
</main>
</body>
</html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.mode !== 'navigate') return;
  event.respondWith(
    fetch(request).catch(
      () => new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }),
    ),
  );
});
