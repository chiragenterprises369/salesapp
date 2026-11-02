// Static server for the Flutter web preview (build/web). Usage, from apps/mobile:
//   node tool/serve_web.mjs [port=3010]
// Routes are hash URLs (http://localhost:3010/#/today); unknown paths fall back to index.html.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] ?? process.env.PORT ?? 3010);
const root = resolve(fileURLToPath(new URL('../build/web', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
  '.bin': 'application/octet-stream',
  '.frag': 'application/octet-stream',
};

if (!existsSync(join(root, 'index.html'))) {
  console.error(`No build at ${root}. Run: flutter build web --release --no-web-resources-cdn --dart-define=VISTAR_API_URL=http://localhost:4020`);
  process.exit(1);
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!path.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(path) || statSync(path).isDirectory()) path = join(root, 'index.html');
  const type = types[extname(path)] ?? 'application/octet-stream';
  // index.html and the service worker are never cached, so a new build shows at once.
  const noCache = path.endsWith('index.html') || path.endsWith('flutter_service_worker.js') || path.endsWith('version.json');
  res.writeHead(200, { 'content-type': type, 'cache-control': noCache ? 'no-store' : 'public, max-age=3600' });
  createReadStream(path).pipe(res);
}).listen(port, () => console.log(`Vistar web preview on http://localhost:${port} (from ${root})`));
