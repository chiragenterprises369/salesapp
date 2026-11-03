import { WEBHOOK_TOLERANCE_SEC } from '@vistar/shared';
import { shellQuote } from './openapi';

/**
 * Copyable code for the webhook pages. Secrets are never put into the snippets: they read
 * VISTAR_WEBHOOK_SECRET / VISTAR_API_KEY from the environment (the real value is shown once).
 */

const SAMPLE_BODY = { name: 'Asha Patil', mobile: '9876543210', city: 'Pune', product: 'Steel racks' };

function bodyText(sample: unknown): string {
  try {
    const s = sample === undefined || sample === null ? SAMPLE_BODY : sample;
    const text = JSON.stringify(s);
    return text.length > 2000 ? JSON.stringify(SAMPLE_BODY) : text;
  } catch {
    return JSON.stringify(SAMPLE_BODY);
  }
}

/** bash + openssl: sign `${t}.${body}` and POST it to an inbound source. */
export function inboundCurl(url: string, sample?: unknown): string {
  return [
    `# Set VISTAR_WEBHOOK_SECRET to the source's signing secret first.`,
    `BODY=${shellQuote(bodyText(sample))}`,
    `T=$(date +%s)`,
    `SIG=$(printf '%s.%s' "$T" "$BODY" | openssl dgst -sha256 -hmac "$VISTAR_WEBHOOK_SECRET" -hex | sed 's/^.* //')`,
    `curl -X POST ${shellQuote(url)} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H "X-Vistar-Signature: t=$T,v1=$SIG" \\`,
    `  -H "Idempotency-Key: $(date +%s%N)" \\`,
    `  --data "$BODY"`,
  ].join('\n');
}

/** Node 18+ (built-in fetch and crypto): sign and send to an inbound source. */
export function inboundNode(url: string, sample?: unknown): string {
  return [
    `import { createHmac, randomUUID } from 'node:crypto';`,
    ``,
    `const url = ${JSON.stringify(url)};`,
    `const secret = process.env.VISTAR_WEBHOOK_SECRET; // the source's signing secret`,
    `const body = JSON.stringify(${bodyText(sample)});`,
    ``,
    `const t = Math.floor(Date.now() / 1000);`,
    `const v1 = createHmac('sha256', secret).update(\`\${t}.\${body}\`).digest('hex');`,
    ``,
    `const res = await fetch(url, {`,
    `  method: 'POST',`,
    `  headers: {`,
    `    'content-type': 'application/json',`,
    `    'x-vistar-signature': \`t=\${t},v1=\${v1}\`,`,
    `    'idempotency-key': randomUUID(), // a retry with the same key is not processed twice`,
    `  },`,
    `  body,`,
    `});`,
    `console.log(res.status, await res.text());`,
  ].join('\n');
}

/** Receiver side (Node + Express): verify an outbound Vistar delivery before trusting it. */
export function outboundVerifyNode(): string {
  return [
    `import express from 'express';`,
    `import { createHmac, timingSafeEqual } from 'node:crypto';`,
    ``,
    `const app = express();`,
    `const secret = process.env.VISTAR_WEBHOOK_SECRET; // shown once when you created the subscription`,
    ``,
    `// Use the raw body: the signature covers the exact bytes Vistar sent.`,
    `app.post('/hooks/vistar', express.raw({ type: 'application/json' }), (req, res) => {`,
    `  const header = req.get('x-vistar-signature') ?? '';`,
    `  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=', 2)));`,
    `  const t = Number(parts.t);`,
    `  if (!t || Math.abs(Date.now() / 1000 - t) > ${WEBHOOK_TOLERANCE_SEC}) return res.status(401).send('stale');`,
    `  const expected = createHmac('sha256', secret).update(\`\${t}.\${req.body}\`).digest('hex');`,
    `  const given = String(parts.v1 ?? '');`,
    `  const ok = given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));`,
    `  if (!ok) return res.status(401).send('bad signature');`,
    ``,
    `  const event = JSON.parse(req.body.toString('utf8'));`,
    `  // X-Vistar-Delivery is unique per delivery: store it to ignore retries you already handled.`,
    `  console.log(req.get('x-vistar-delivery'), event.type);`,
    `  res.sendStatus(200); // any 2xx within 10 s counts as delivered`,
    `});`,
    ``,
    `app.listen(8080);`,
  ].join('\n');
}

/** curl with an API key (the key comes from the environment). */
export function apiKeyCurl(baseUrl: string): string {
  return [`# export VISTAR_API_KEY=vst_live_... (shown once when you created the key)`, `curl ${shellQuote(`${baseUrl.replace(/\/+$/, '')}/api/v1/leads?limit=5`)} \\`, `  -H "Authorization: Bearer $VISTAR_API_KEY"`].join('\n');
}
